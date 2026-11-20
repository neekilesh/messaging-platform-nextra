import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import { Modality, type LiveServerMessage } from '@google/genai';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PgDatabase } from '../src/db/index.ts';
import { authenticateToken, parseCookies } from './context.ts';
import { formatGeminiError, getGeminiClient } from './lib/gemini.ts';

const ALLOWED_VOICES = new Set(['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir']);

export function setupLiveVoiceWebSocket(httpServer: HttpServer, database: PgDatabase) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (reqUrl.pathname !== '/ws/live') {
        return; // Let Socket.IO handle /socket.io/*
      }

      const queryToken = reqUrl.searchParams.get('token');
      const cookieToken = parseCookies(req.headers.cookie)['nexora_session'] || null;
      const auth = await authenticateToken(database, queryToken || cookieToken);

      if (!auth) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, reqUrl);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', async (clientWs: WebSocket, _req: IncomingMessage, reqUrl: URL) => {
    const rawVoice = reqUrl.searchParams.get('voice') || 'Zephyr';
    const voiceName = ALLOWED_VOICES.has(rawVoice) ? rawVoice : 'Zephyr';
    const systemInstruction =
      reqUrl.searchParams.get('instruction')?.trim() ||
      'You are NEXORA Live, a warm, concise real-time voice assistant. Keep spoken replies natural and clear.';

    let liveSession: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null =
      null;
    let closed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    try {
      const ai = getGeminiClient();
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            safeSend({ type: 'ready', voiceName, model: 'gemini-3.8-live' });
          },
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              safeSend({
                type: 'inputTranscript',
                text: content.inputTranscription.text,
              });
            }
            if (content?.outputTranscription?.text) {
              safeSend({
                type: 'outputTranscript',
                text: content.outputTranscription.text,
              });
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend({
                  type: 'audio',
                  audio: part.inlineData.data,
                });
              }
            }
            if (content?.interrupted) {
              safeSend({ type: 'interrupted' });
            }
            if (content?.turnComplete) {
              safeSend({ type: 'turnComplete' });
            }
          },
          onerror: (err: unknown) => {
            const formatted = formatGeminiError(err);
            safeSend({ type: 'error', error: formatted.message });
          },
          onclose: () => {
            if (!closed) {
              safeSend({ type: 'closed' });
            }
          },
        },
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      safeSend({ type: 'error', error: formatted.message });
      clientWs.close();
      return;
    }

    clientWs.on('message', (raw) => {
      if (!liveSession || closed) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          audio?: string;
          text?: string;
        };
        if (msg.audio) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.text) {
          liveSession.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch {
        // Ignore malformed frame
      }
    });

    clientWs.on('close', () => {
      closed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close error
      }
    });
  });

  return wss;
}
