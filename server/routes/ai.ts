import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import type { PgDatabase } from '../../src/db/index.ts';
import { aiArtifacts, aiMessages, aiThreads, gameScores, users } from '../../src/db/schema.ts';
import { ensureDatabaseSchema } from '../../src/db/ensure-schema.ts';
import { createRequireAuth, type AuthedRequest } from '../context.ts';
import { formatGeminiError, getGeminiClient } from '../lib/gemini.ts';

const ALLOWED_CHAT_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-4-carbon',
]);

interface GroundingPayload {
  mode: 'none' | 'googleSearch' | 'googleMaps';
  webSources: Array<{ title: string; uri: string }>;
  mapPlaces: Array<{
    title: string;
    uri: string;
    snippets: string[];
  }>;
}

export function createAiRouter(database: PgDatabase): Router {
  const router = Router();
  const requireAuth = createRequireAuth(database);

  // Maps API key lookup (fallback if Vite env wasn't baked in at build time)
  router.get('/maps-config', requireAuth, (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim() ||
      '';
    return res.json({ apiKey });
  });

  // List saved AI chat threads
  router.get('/threads', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const threads = await database
        .select()
        .from(aiThreads)
        .where(eq(aiThreads.userId, req.userId!))
        .orderBy(desc(aiThreads.updatedAt))
        .limit(30);
      return res.json({ threads });
    } catch (error) {
      console.error('GET /ai/threads failed:', error);
      return res.status(500).json({ error: 'Failed to load AI conversations.' });
    }
  });

  // Get messages in a thread
  router.get('/threads/:threadId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const threadId = String(req.params.threadId || '');
      const threadRows = await database
        .select()
        .from(aiThreads)
        .where(and(eq(aiThreads.id, threadId), eq(aiThreads.userId, req.userId!)))
        .limit(1);
      const thread = threadRows[0];
      if (!thread) {
        return res.status(404).json({ error: 'Conversation thread not found.' });
      }
      const messages = await database
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.threadId, threadId))
        .orderBy(aiMessages.createdAt);

      return res.json({
        thread,
        messages: messages.map((m) => ({
          ...m,
          grounding: m.groundingJson ? (JSON.parse(m.groundingJson) as GroundingPayload) : null,
        })),
      });
    } catch (error) {
      console.error('GET /ai/threads/:id failed:', error);
      return res.status(500).json({ error: 'Failed to load AI thread.' });
    }
  });

  // Delete thread
  router.delete('/threads/:threadId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const threadId = String(req.params.threadId || '');
      await database
        .delete(aiThreads)
        .where(and(eq(aiThreads.id, threadId), eq(aiThreads.userId, req.userId!)));
      return res.json({ deleted: true });
    } catch (error) {
      console.error('DELETE /ai/threads/:id failed:', error);
      return res.status(500).json({ error: 'Failed to delete AI thread.' });
    }
  });

  // Multi-turn Gemini Chatbot + Search Grounding + Maps Grounding
  router.post('/chat', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const body = req.body as {
        threadId?: string;
        message?: string;
        model?: string;
        persona?: string;
        systemInstruction?: string;
        groundingMode?: 'none' | 'googleSearch' | 'googleMaps';
        latLng?: { latitude: number; longitude: number };
      };

      const messageText = String(body.message || '').trim();
      if (!messageText) {
        return res.status(400).json({ error: 'Message text is required.' });
      }

      const groundingMode =
        body.groundingMode === 'googleSearch' || body.groundingMode === 'googleMaps'
          ? body.groundingMode
          : 'none';

      // Grounding features require gemini-4-hydrogen per skill rules
      const requestedModel =
        groundingMode !== 'none'
          ? 'gemini-4-hydrogen'
          : ALLOWED_CHAT_MODELS.has(String(body.model || ''))
            ? String(body.model)
            : 'gemini-4-hydrogen';

      const persona = String(body.persona || 'General Assistant').trim() || 'General Assistant';
      const systemInstruction =
        String(body.systemInstruction || '').trim() ||
        `You are NEXORA Studio AI acting in the role of ${persona}. Be concise, accurate, and directly helpful.`;

      const nowIso = new Date().toISOString();
      let threadId = body.threadId ? String(body.threadId) : '';

      if (threadId) {
        const existing = await database
          .select()
          .from(aiThreads)
          .where(and(eq(aiThreads.id, threadId), eq(aiThreads.userId, req.userId!)))
          .limit(1);
        if (!existing[0]) {
          threadId = '';
        }
      }

      if (!threadId) {
        threadId = randomUUID();
        const title =
          messageText.length > 54 ? `${messageText.slice(0, 51)}...` : messageText;
        await database.insert(aiThreads).values({
          id: threadId,
          userId: req.userId!,
          title,
          model: requestedModel,
          persona,
          systemInstruction,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      const historyRows = await database
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.threadId, threadId))
        .orderBy(aiMessages.createdAt);

      const contents = [
        ...historyRows.map((row) => ({
          role: row.role === 'model' ? ('model' as const) : ('user' as const),
          parts: [{ text: row.content }],
        })),
        {
          role: 'user' as const,
          parts: [{ text: messageText }],
        },
      ];

      const ai = getGeminiClient();
      const config: Record<string, unknown> = {
        systemInstruction,
      };

      if (groundingMode === 'googleSearch') {
        config.tools = [{ googleSearch: {} }];
      } else if (groundingMode === 'googleMaps') {
        config.tools = [{ googleMaps: {} }];
        if (
          body.latLng &&
          Number.isFinite(body.latLng.latitude) &&
          Number.isFinite(body.latLng.longitude)
        ) {
          config.toolConfig = {
            retrievalConfig: {
              latLng: {
                latitude: body.latLng.latitude,
                longitude: body.latLng.longitude,
              },
            },
          };
        }
      }

      const response = await ai.models.generateContent({
        model: requestedModel,
        contents,
        config,
      });

      const replyText = (response.text || '').trim() || 'No response text returned.';
      const rawChunks = (response.candidates?.[0]?.groundingMetadata?.groundingChunks ||
        []) as Array<{
        web?: { uri?: string; title?: string };
        maps?: {
          uri?: string;
          title?: string;
          placeAnswerSources?: {
            reviewSnippets?: Array<{ content?: string; text?: string }>;
          };
        };
      }>;

      const webSources = rawChunks
        .filter((c) => c.web?.uri)
        .map((c) => ({
          title: c.web?.title || c.web?.uri || 'Source',
          uri: c.web!.uri!,
        }));

      const mapPlaces = rawChunks
        .filter((c) => c.maps?.uri)
        .map((c) => ({
          title: c.maps?.title || 'View on Google Maps',
          uri: c.maps!.uri!,
          snippets: (c.maps?.placeAnswerSources?.reviewSnippets || [])
            .map((s) => s.content || s.text || '')
            .filter(Boolean),
        }));

      const grounding: GroundingPayload | null =
        groundingMode !== 'none' || webSources.length > 0 || mapPlaces.length > 0
          ? {
              mode: groundingMode,
              webSources,
              mapPlaces,
            }
          : null;

      const userMsgId = randomUUID();
      const modelMsgId = randomUUID();
      const replyIso = new Date().toISOString();

      await database.insert(aiMessages).values([
        {
          id: userMsgId,
          threadId,
          userId: req.userId!,
          role: 'user',
          content: messageText,
          model: requestedModel,
          groundingJson: null,
          createdAt: nowIso,
        },
        {
          id: modelMsgId,
          threadId,
          userId: req.userId!,
          role: 'model',
          content: replyText,
          model: requestedModel,
          groundingJson: grounding ? JSON.stringify(grounding) : null,
          createdAt: replyIso,
        },
      ]);

      await database
        .update(aiThreads)
        .set({ model: requestedModel, persona, systemInstruction, updatedAt: replyIso })
        .where(eq(aiThreads.id, threadId));

      return res.json({
        threadId,
        userMessage: {
          id: userMsgId,
          role: 'user',
          content: messageText,
          model: requestedModel,
          grounding: null,
          createdAt: nowIso,
        },
        assistantMessage: {
          id: modelMsgId,
          role: 'model',
          content: replyText,
          model: requestedModel,
          grounding,
          createdAt: replyIso,
        },
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Audio transcription using gemini-3.5-transcribe
  router.post('/transcribe', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const { audioBase64, mimeType, prompt } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        prompt?: string;
      };

      if (!audioBase64) {
        return res.status(400).json({ error: 'Audio data is required for transcription.' });
      }

      const cleanBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
      const safeMime = (mimeType || 'audio/webm').split(';')[0].trim();

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: safeMime,
                data: cleanBase64,
              },
            },
            {
              text: String(prompt || '').trim() || 'Transcribe this audio accurately.',
            },
          ],
        },
      });

      const transcript = (response.text || '').trim();
      const artifactId = randomUUID();
      const nowIso = new Date().toISOString();

      await database.insert(aiArtifacts).values({
        id: artifactId,
        userId: req.userId!,
        kind: 'transcript',
        model: 'gemini-3.5-transcribe',
        prompt: String(prompt || 'Audio transcription'),
        mimeType: 'text/plain',
        dataUrl: transcript,
        metadataJson: JSON.stringify({ audioMimeType: safeMime }),
        createdAt: nowIso,
      });

      return res.json({
        id: artifactId,
        model: 'gemini-3.5-transcribe',
        transcript,
        createdAt: nowIso,
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Image creation & editing using gemini-nano-banana-2.1
  router.post('/image', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const {
        prompt,
        aspectRatio,
        imageSize,
        sourceImageBase64,
        sourceMimeType,
        useWebImageSearch,
      } = req.body as {
        prompt?: string;
        aspectRatio?: string;
        imageSize?: string;
        sourceImageBase64?: string;
        sourceMimeType?: string;
        useWebImageSearch?: boolean;
      };

      const cleanPrompt = String(prompt || '').trim();
      if (!cleanPrompt) {
        return res.status(400).json({ error: 'Image prompt is required.' });
      }

      const parts: Array<Record<string, unknown>> = [];
      if (sourceImageBase64) {
        const cleanData = sourceImageBase64.includes(',')
          ? sourceImageBase64.split(',')[1]
          : sourceImageBase64;
        parts.push({
          inlineData: {
            data: cleanData,
            mimeType: sourceMimeType || 'image/png',
          },
        });
      }
      parts.push({ text: cleanPrompt });

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-nano-banana-2.1',
        contents: { parts: parts as never },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio || '1:1',
            imageSize: imageSize || '1K',
          },
          ...(useWebImageSearch
            ? {
                tools: [
                  {
                    googleSearch: {
                      searchTypes: {
                        webSearch: {},
                        imageSearch: {},
                      },
                    },
                  },
                ],
              }
            : {}),
        } as never,
      });

      let imageDataUrl = '';
      let mimeType = 'image/png';
      let caption = '';

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          mimeType = part.inlineData.mimeType || 'image/png';
          imageDataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
        } else if (part.text) {
          caption += part.text;
        }
      }

      if (!imageDataUrl) {
        return res.status(502).json({
          error: caption || 'Model did not return an image. Try adjusting your prompt.',
        });
      }

      const artifactId = randomUUID();
      const nowIso = new Date().toISOString();

      await database.insert(aiArtifacts).values({
        id: artifactId,
        userId: req.userId!,
        kind: 'image',
        model: 'gemini-nano-banana-2.1',
        prompt: cleanPrompt,
        mimeType,
        dataUrl: imageDataUrl,
        metadataJson: JSON.stringify({
          aspectRatio: aspectRatio || '1:1',
          imageSize: imageSize || '1K',
          edited: Boolean(sourceImageBase64),
          caption: caption.trim(),
        }),
        createdAt: nowIso,
      });

      return res.json({
        id: artifactId,
        model: 'gemini-nano-banana-2.1',
        imageDataUrl,
        mimeType,
        caption: caption.trim(),
        createdAt: nowIso,
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Music generation using lyria-3-clip-preview or lyria-3-pro-preview
  router.post('/music', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const { prompt, model, sourceImageBase64, sourceMimeType } = req.body as {
        prompt?: string;
        model?: string;
        sourceImageBase64?: string;
        sourceMimeType?: string;
      };

      const cleanPrompt = String(prompt || '').trim();
      if (!cleanPrompt) {
        return res.status(400).json({ error: 'Music prompt is required.' });
      }

      const selectedModel =
        model === 'lyria-3-pro-preview' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';

      const contents = sourceImageBase64
        ? {
            parts: [
              { text: cleanPrompt },
              {
                inlineData: {
                  data: sourceImageBase64.includes(',')
                    ? sourceImageBase64.split(',')[1]
                    : sourceImageBase64,
                  mimeType: sourceMimeType || 'image/jpeg',
                },
              },
            ],
          }
        : cleanPrompt;

      const ai = getGeminiClient();
      const responseStream = await ai.models.generateContentStream({
        model: selectedModel,
        contents,
      });

      const audioChunks: Buffer[] = [];
      let lyrics = '';
      let mimeType = 'audio/mpeg';

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (audioChunks.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
          if (part.text) {
            lyrics += part.text;
          }
        }
      }

      if (audioChunks.length === 0) {
        return res.status(502).json({ error: 'Music stream did not return audio data.' });
      }

      const audioBase64 = Buffer.concat(audioChunks).toString('base64');
      const audioDataUrl = `data:${mimeType};base64,${audioBase64}`;

      const artifactId = randomUUID();
      const nowIso = new Date().toISOString();

      await database.insert(aiArtifacts).values({
        id: artifactId,
        userId: req.userId!,
        kind: 'music',
        model: selectedModel,
        prompt: cleanPrompt,
        mimeType,
        dataUrl: audioDataUrl,
        metadataJson: JSON.stringify({ lyrics: lyrics.trim() }),
        createdAt: nowIso,
      });

      return res.json({
        id: artifactId,
        model: selectedModel,
        audioDataUrl,
        mimeType,
        lyrics: lyrics.trim(),
        createdAt: nowIso,
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Video generation (Text-to-Video & Image-to-Video) using gemini-omni-1.2-flash via Interactions API
  router.post('/video', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const { prompt, aspectRatio, duration, sourceImageBase64, sourceMimeType } = req.body as {
        prompt?: string;
        aspectRatio?: '16:9' | '9:16';
        duration?: string;
        sourceImageBase64?: string;
        sourceMimeType?: string;
      };

      const cleanPrompt = String(prompt || '').trim();
      if (!cleanPrompt) {
        return res.status(400).json({ error: 'Video prompt is required.' });
      }

      const safeAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';
      const safeDuration = duration || '5s';

      const input = sourceImageBase64
        ? [
            {
              type: 'image' as const,
              mime_type: sourceMimeType || 'image/png',
              data: sourceImageBase64.includes(',')
                ? sourceImageBase64.split(',')[1]
                : sourceImageBase64,
            },
            {
              type: 'text' as const,
              text: cleanPrompt,
            },
          ]
        : cleanPrompt;

      const ai = getGeminiClient();
      const interaction = await ai.interactions.create(
        {
          model: 'gemini-omni-1.2-flash',
          input: input as never,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: safeAspectRatio,
            duration: safeDuration,
            resolution: '720p',
          } as never,
        },
        { timeout: 300000 }
      );

      const videoPart = interaction.output_video;
      if (!videoPart || (!videoPart.data && !videoPart.uri)) {
        return res.status(502).json({ error: 'Video generation returned no video output.' });
      }

      const mimeType = videoPart.mime_type || 'video/mp4';
      const videoDataUrl = videoPart.data
        ? `data:${mimeType};base64,${videoPart.data}`
        : String(videoPart.uri);

      const artifactId = randomUUID();
      const nowIso = new Date().toISOString();

      await database.insert(aiArtifacts).values({
        id: artifactId,
        userId: req.userId!,
        kind: 'video',
        model: 'gemini-omni-1.2-flash',
        prompt: cleanPrompt,
        mimeType,
        dataUrl: videoDataUrl,
        metadataJson: JSON.stringify({
          aspectRatio: safeAspectRatio,
          duration: safeDuration,
          animatedFromImage: Boolean(sourceImageBase64),
        }),
        createdAt: nowIso,
      });

      return res.json({
        id: artifactId,
        model: 'gemini-omni-1.2-flash',
        videoDataUrl,
        mimeType,
        aspectRatio: safeAspectRatio,
        createdAt: nowIso,
      });
    } catch (error) {
      const formatted = formatGeminiError(error);
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Saved AI artifacts (images, music, videos, transcripts)
  router.get('/artifacts', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const rows = await database
        .select()
        .from(aiArtifacts)
        .where(eq(aiArtifacts.userId, req.userId!))
        .orderBy(desc(aiArtifacts.createdAt))
        .limit(24);
      return res.json({
        artifacts: rows.map((r) => ({
          ...r,
          metadata: r.metadataJson ? JSON.parse(r.metadataJson) : null,
        })),
      });
    } catch (error) {
      console.error('GET /ai/artifacts failed:', error);
      return res.status(500).json({ error: 'Failed to load generated artifacts.' });
    }
  });

  router.delete('/artifacts/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const id = String(req.params.id || '');
      await database
        .delete(aiArtifacts)
        .where(and(eq(aiArtifacts.id, id), eq(aiArtifacts.userId, req.userId!)));
      return res.json({ deleted: true });
    } catch (error) {
      console.error('DELETE /ai/artifacts/:id failed:', error);
      return res.status(500).json({ error: 'Failed to delete artifact.' });
    }
  });

  // 3D Arena Game High Scores (Cloud SQL PostgreSQL leaderboard)
  router.get('/scores', requireAuth, async (_req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const rows = await database
        .select({
          id: gameScores.id,
          score: gameScores.score,
          wave: gameScores.wave,
          mode: gameScores.mode,
          createdAt: gameScores.createdAt,
          username: users.username,
          displayName: users.displayName,
        })
        .from(gameScores)
        .innerJoin(users, eq(gameScores.userId, users.id))
        .orderBy(desc(gameScores.score))
        .limit(10);
      return res.json({ scores: rows });
    } catch (error) {
      console.error('GET /ai/scores failed:', error);
      return res.status(500).json({ error: 'Failed to load leaderboard.' });
    }
  });

  router.post('/scores', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await ensureDatabaseSchema(database);
      const { score, wave, mode } = req.body as {
        score?: number;
        wave?: number;
        mode?: string;
      };
      const cleanScore = Math.max(0, Math.floor(Number(score || 0)));
      const cleanWave = Math.max(1, Math.floor(Number(wave || 1)));
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      await database.insert(gameScores).values({
        id,
        userId: req.userId!,
        mode: mode || 'arcade',
        score: cleanScore,
        wave: cleanWave,
        createdAt,
      });

      return res.status(201).json({ id, score: cleanScore, wave: cleanWave, createdAt });
    } catch (error) {
      console.error('POST /ai/scores failed:', error);
      return res.status(500).json({ error: 'Failed to record score.' });
    }
  });

  return router;
}
