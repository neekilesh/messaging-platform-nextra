import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Bot,
  Download,
  ExternalLink,
  Film,
  Globe,
  Image as ImageIcon,
  Layers,
  MapPin,
  MessageSquarePlus,
  Mic,
  MicOff,
  Music,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { LiveVoicePanel } from './LiveVoicePanel';

type StudioTab = 'chat' | 'voice' | 'media';
type MediaTool = 'image' | 'video' | 'music' | 'transcribe' | 'gallery';
type GroundingMode = 'none' | 'googleSearch' | 'googleMaps';

interface ThreadSummary {
  id: string;
  title: string;
  model: string;
  persona: string;
  systemInstruction: string;
  updatedAt: string;
}

interface GroundingPayload {
  mode: GroundingMode;
  webSources: Array<{ title: string; uri: string }>;
  mapPlaces: Array<{ title: string; uri: string; snippets: string[] }>;
}

interface ChatMessageItem {
  id: string;
  role: 'user' | 'model';
  content: string;
  model: string;
  grounding: GroundingPayload | null;
  createdAt: string;
}

interface ArtifactItem {
  id: string;
  kind: 'image' | 'video' | 'music' | 'transcript';
  model: string;
  prompt: string;
  mimeType: string;
  dataUrl: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

const CHAT_MODELS = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Fast & Grounding)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Ultra-fast)' },
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon (Balanced Pro)' },
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon (Deep Reasoning)' },
];

const PERSONA_PRESETS = [
  {
    name: 'General Assistant',
    prompt: 'You are NEXORA Studio AI. Be concise, accurate, and directly helpful.',
  },
  {
    name: 'Code Architect',
    prompt:
      'You are a senior TypeScript & systems architect inside NEXORA. Give clean, production-ready answers.',
  },
  {
    name: 'Creative Director',
    prompt:
      'You are a visual and musical creative director. Help craft vivid prompts, stories, and artistic concepts.',
  },
  {
    name: 'Local Explorer',
    prompt:
      'You are a knowledgeable local city guide. Provide specific, verifiable place recommendations and route context.',
  },
];

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        base64: String(reader.result || ''),
        mimeType: file.type || 'application/octet-stream',
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read audio recording.'));
    reader.readAsDataURL(blob);
  });
}

export function AiStudioHub() {
  const [studioTab, setStudioTab] = useState<StudioTab>('chat');

  // Chatbot state
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-4-hydrogen');
  const [persona, setPersona] = useState(PERSONA_PRESETS[0].name);
  const [systemInstruction, setSystemInstruction] = useState(PERSONA_PRESETS[0].prompt);
  const [groundingMode, setGroundingMode] = useState<GroundingMode>('none');
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);

  // Media Lab state
  const [mediaTool, setMediaTool] = useState<MediaTool>('image');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);

  // Image tool state
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageAspect, setImageAspect] = useState('1:1');
  const [imageSize, setImageSize] = useState('1K');
  const [imageSearchGrounding, setImageSearchGrounding] = useState(false);
  const [imageSource, setImageSource] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const [imageResult, setImageResult] = useState<{ dataUrl: string; caption?: string } | null>(null);

  // Video tool state
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoAspect, setVideoAspect] = useState<'16:9' | '9:16'>('16:9');
  const [videoDuration, setVideoDuration] = useState('5s');
  const [videoSourceImage, setVideoSourceImage] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const [videoResultUrl, setVideoResultUrl] = useState<string | null>(null);

  // Music tool state
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicModel, setMusicModel] = useState<'lyria-3-clip-preview' | 'lyria-3-pro-preview'>('lyria-3-clip-preview');
  const [musicCoverImage, setMusicCoverImage] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const [musicResult, setMusicResult] = useState<{ dataUrl: string; lyrics?: string } | null>(null);

  // Transcription tool state
  const [transcribeInstruction, setTranscribeInstruction] = useState('Transcribe this audio accurately.');
  const [transcribeRecording, setTranscribeRecording] = useState(false);
  const [transcriptResult, setTranscriptResult] = useState<string>('');

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadThreads = useCallback(async () => {
    try {
      const res = await apiRequest<{ threads: ThreadSummary[] }>('/api/v1/ai/threads');
      setThreads(res.threads);
    } catch {
      // ignore initial error
    }
  }, []);

  const loadArtifacts = useCallback(async () => {
    try {
      const res = await apiRequest<{ artifacts: ArtifactItem[] }>('/api/v1/ai/artifacts');
      setArtifacts(res.artifacts);
    } catch {
      // ignore initial error
    }
  }, []);

  useEffect(() => {
    loadThreads();
    loadArtifacts();
  }, [loadThreads, loadArtifacts]);

  const openThread = async (threadId: string) => {
    try {
      setChatError(null);
      const res = await apiRequest<{ thread: ThreadSummary; messages: ChatMessageItem[] }>(
        `/api/v1/ai/threads/${threadId}`
      );
      setActiveThreadId(res.thread.id);
      setSelectedModel(res.thread.model);
      setPersona(res.thread.persona);
      setSystemInstruction(res.thread.systemInstruction);
      setMessages(res.messages);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to load thread.');
    }
  };

  const deleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await apiRequest(`/api/v1/ai/threads/${threadId}`, { method: 'DELETE' }).catch(() => {});
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setMessages([]);
    }
    loadThreads();
  };

  const startNewThread = () => {
    setActiveThreadId(null);
    setMessages([]);
    setChatError(null);
  };

  const requestLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {
        setChatError('Location permission denied; querying Google Maps without user coordinates.');
      }
    );
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatBusy) return;

    setChatBusy(true);
    setChatError(null);
    const optimisticUser: ChatMessageItem = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      model: groundingMode === 'none' ? selectedModel : 'gemini-4-hydrogen',
      grounding: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setChatInput('');

    try {
      const res = await apiRequest<{
        threadId: string;
        userMessage: ChatMessageItem;
        assistantMessage: ChatMessageItem;
      }>('/api/v1/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          threadId: activeThreadId || undefined,
          message: text,
          model: selectedModel,
          persona,
          systemInstruction,
          groundingMode,
          latLng: groundingMode === 'googleMaps' && userCoords ? userCoords : undefined,
        }),
      });
      setActiveThreadId(res.threadId);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        res.userMessage,
        res.assistantMessage,
      ]);
      loadThreads();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setChatInput(text);
      setChatError(err instanceof Error ? err.message : 'Chat request failed.');
    } finally {
      setChatBusy(false);
    }
  };

  const toggleDictation = async () => {
    if (dictating && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setDictating(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        try {
          const audioBase64 = await blobToBase64(blob);
          const res = await apiRequest<{ transcript: string }>('/api/v1/ai/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audioBase64, mimeType: blob.type }),
          });
          if (res.transcript) {
            setChatInput((prev) => (prev ? `${prev} ${res.transcript}` : res.transcript));
          }
        } catch (err) {
          setChatError(err instanceof Error ? err.message : 'Voice transcription failed.');
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setDictating(true);
    } catch {
      setChatError('Microphone permission is required for voice dictation.');
    }
  };

  const handleGenerateImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imagePrompt.trim() || mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const res = await apiRequest<{ imageDataUrl: string; caption?: string }>('/api/v1/ai/image', {
        method: 'POST',
        body: JSON.stringify({
          prompt: imagePrompt,
          aspectRatio: imageAspect,
          imageSize,
          useWebImageSearch: imageSearchGrounding,
          sourceImageBase64: imageSource?.base64,
          sourceMimeType: imageSource?.mimeType,
        }),
      });
      setImageResult({ dataUrl: res.imageDataUrl, caption: res.caption });
      loadArtifacts();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Image generation failed.');
    } finally {
      setMediaBusy(false);
    }
  };

  const handleGenerateVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoPrompt.trim() || mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const res = await apiRequest<{ videoDataUrl: string }>('/api/v1/ai/video', {
        method: 'POST',
        body: JSON.stringify({
          prompt: videoPrompt,
          aspectRatio: videoAspect,
          duration: videoDuration,
          sourceImageBase64: videoSourceImage?.base64,
          sourceMimeType: videoSourceImage?.mimeType,
        }),
      });
      setVideoResultUrl(res.videoDataUrl);
      loadArtifacts();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Video generation failed.');
    } finally {
      setMediaBusy(false);
    }
  };

  const handleGenerateMusic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicPrompt.trim() || mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const res = await apiRequest<{ audioDataUrl: string; lyrics?: string }>('/api/v1/ai/music', {
        method: 'POST',
        body: JSON.stringify({
          prompt: musicPrompt,
          model: musicModel,
          sourceImageBase64: musicCoverImage?.base64,
          sourceMimeType: musicCoverImage?.mimeType,
        }),
      });
      setMusicResult({ dataUrl: res.audioDataUrl, lyrics: res.lyrics });
      loadArtifacts();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Music generation failed.');
    } finally {
      setMediaBusy(false);
    }
  };

  const handleAudioTranscribeFile = async (file: File) => {
    setMediaBusy(true);
    setMediaError(null);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const res = await apiRequest<{ transcript: string }>('/api/v1/ai/transcribe', {
        method: 'POST',
        body: JSON.stringify({
          audioBase64: base64,
          mimeType,
          prompt: transcribeInstruction,
        }),
      });
      setTranscriptResult(res.transcript);
      loadArtifacts();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Transcription failed.');
    } finally {
      setMediaBusy(false);
    }
  };

  const toggleMediaMicTranscribe = async () => {
    if (transcribeRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setTranscribeRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setMediaBusy(true);
        setMediaError(null);
        try {
          const audioBase64 = await blobToBase64(blob);
          const res = await apiRequest<{ transcript: string }>('/api/v1/ai/transcribe', {
            method: 'POST',
            body: JSON.stringify({
              audioBase64,
              mimeType: blob.type,
              prompt: transcribeInstruction,
            }),
          });
          setTranscriptResult(res.transcript);
          loadArtifacts();
        } catch (err) {
          setMediaError(err instanceof Error ? err.message : 'Transcription failed.');
        } finally {
          setMediaBusy(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setTranscribeRecording(true);
    } catch {
      setMediaError('Microphone access denied.');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#080c1a]/70">
      {/* Studio Top Bar */}
      <header className="px-5 py-3.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 bg-[#090d1c]/90">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-violet-600/25 border border-violet-500/40 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-base font-display font-bold text-white leading-tight">
              NEXORA AI Studio
            </h1>
            <p className="text-[11px] text-slate-400">
              Grounded Chatbot, Live Voice, Image, Video, Music & Transcription
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-[#0e1428] p-1 rounded-xl border border-white/10">
          {[
            { id: 'chat' as StudioTab, label: 'Assistant Chat', icon: Bot },
            { id: 'voice' as StudioTab, label: 'Live Voice', icon: AudioLines },
            { id: 'media' as StudioTab, label: 'Media & Audio Lab', icon: Layers },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = studioTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStudioTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  active
                    ? 'bg-violet-600 text-white shadow-[0_0_12px_rgba(124,58,237,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {studioTab === 'voice' ? (
        <LiveVoicePanel />
      ) : studioTab === 'chat' ? (
        <div className="flex-1 flex min-h-0">
          {/* Threads Sidebar */}
          <aside className="hidden lg:flex w-68 border-r border-white/10 bg-[#090d1c]/60 flex-col p-3 gap-3 shrink-0">
            <button
              type="button"
              onClick={startNewThread}
              className="h-9 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-cyan-200 text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              New Conversation
            </button>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {threads.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  Saved AI conversations will appear here.
                </p>
              ) : (
                threads.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => openThread(t.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') openThread(t.id);
                    }}
                    className={`group rounded-xl p-2.5 border text-left cursor-pointer transition-colors flex items-start justify-between gap-2 ${
                      activeThreadId === t.id
                        ? 'bg-violet-600/20 border-violet-500/45 text-white'
                        : 'bg-white/[0.02] border-white/5 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{t.title}</p>
                      <p className="text-[10px] text-slate-500 truncate mt-0.5">{t.model}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => deleteThread(t.id, e)}
                      aria-label="Delete thread"
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Chat Workspace */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Controls Bar */}
            <div className="px-4 py-2.5 border-b border-white/10 bg-[#0b1022]/70 flex flex-wrap items-center gap-2.5">
              <select
                value={groundingMode === 'none' ? selectedModel : 'gemini-4-hydrogen'}
                disabled={groundingMode !== 'none'}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="h-8 rounded-lg bg-[#090d1c] border border-white/15 px-2.5 text-xs text-slate-200 focus:outline-none disabled:opacity-70"
              >
                {CHAT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                value={persona}
                onChange={(e) => {
                  const chosen = PERSONA_PRESETS.find((p) => p.name === e.target.value);
                  setPersona(e.target.value);
                  if (chosen) setSystemInstruction(chosen.prompt);
                }}
                className="h-8 rounded-lg bg-[#090d1c] border border-white/15 px-2.5 text-xs text-slate-200 focus:outline-none"
              >
                {PERSONA_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    Persona: {p.name}
                  </option>
                ))}
              </select>

              {/* Grounding Selector */}
              <div className="flex items-center gap-1 bg-[#090d1c] border border-white/15 rounded-lg p-0.5 ml-auto">
                {[
                  { id: 'none' as GroundingMode, label: 'Standard', icon: Bot },
                  { id: 'googleSearch' as GroundingMode, label: 'Google Search', icon: Globe },
                  { id: 'googleMaps' as GroundingMode, label: 'Google Maps', icon: MapPin },
                ].map((g) => {
                  const Icon = g.icon;
                  const active = groundingMode === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGroundingMode(g.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors ${
                        active ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {g.label}
                    </button>
                  );
                })}
              </div>

              {groundingMode === 'googleMaps' && (
                <button
                  type="button"
                  onClick={requestLocation}
                  className="h-8 px-2.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] hover:bg-cyan-500/20 cursor-pointer"
                >
                  {userCoords ? 'Location Attached' : 'Use My Location'}
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-3 py-10">
                  <Bot className="w-10 h-10 text-cyan-400" />
                  <h2 className="text-lg font-display font-semibold text-white">
                    Ask Gemini with Search & Maps Grounding
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Multi-turn history persists in PostgreSQL. Switch between Standard reasoning, live Google Search data, or Google Maps place grounding.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    {[
                      'What happened in tech news today?',
                      'Find top-rated late-night coffee shops near Times Square',
                      'Design an E2EE key rotation checklist',
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => setChatInput(sample)}
                        className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:border-cyan-400/40 cursor-pointer"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[76%] rounded-2xl px-4 py-3 text-sm leading-relaxed space-y-2.5 ${
                        msg.role === 'user'
                          ? 'bg-violet-600/25 border border-violet-500/40 text-white'
                          : 'bg-[#0e1428] border border-white/10 text-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400">
                        <span className="font-medium text-cyan-300">
                          {msg.role === 'user' ? 'You' : msg.model}
                        </span>
                        <span className="font-mono-tabular">
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="whitespace-pre-wrap">{msg.content}</div>

                      {msg.grounding?.webSources && msg.grounding.webSources.length > 0 && (
                        <div className="pt-2 border-t border-white/10 space-y-1.5">
                          <p className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                            <Globe className="w-3 h-3 text-cyan-400" />
                            Google Search Sources
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.grounding.webSources.map((src, idx) => (
                              <a
                                key={`${src.uri}-${idx}`}
                                href={src.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-300"
                              >
                                <span className="truncate max-w-[200px]">{src.title}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.grounding?.mapPlaces && msg.grounding.mapPlaces.length > 0 && (
                        <div className="pt-2 border-t border-white/10 space-y-2">
                          <p className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-emerald-400" />
                            Google Maps Places & Reviews
                          </p>
                          <div className="space-y-2">
                            {msg.grounding.mapPlaces.map((place, idx) => (
                              <div
                                key={`${place.uri}-${idx}`}
                                className="rounded-lg bg-[#090d1c] border border-white/10 p-2.5 space-y-1"
                              >
                                <a
                                  href={place.uri}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-medium text-emerald-300 hover:underline inline-flex items-center gap-1"
                                >
                                  {place.title}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                                {place.snippets.map((snip, sIdx) => (
                                  <p key={sIdx} className="text-[11px] text-slate-400">
                                    “{snip}”
                                  </p>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {chatBusy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-2.5 bg-[#0e1428] border border-white/10 text-xs text-slate-400">
                    Generating grounded response...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {chatError && (
              <div className="mx-4 mb-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-200">
                {chatError}
              </div>
            )}

            <form
              onSubmit={sendChatMessage}
              className="p-3.5 border-t border-white/10 bg-[#090d1c]/80 flex items-center gap-2"
            >
              <button
                type="button"
                onClick={toggleDictation}
                title="Dictate via Gemini Transcribe"
                className={`h-10 w-10 rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                  dictating
                    ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                    : 'border-white/15 bg-white/5 text-slate-300 hover:text-white'
                }`}
              >
                {dictating ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask anything, search the web, or discover places on Google Maps..."
                className="flex-1 h-10 rounded-xl bg-[#0e1428] border border-white/15 px-3.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
              />
              <button
                type="submit"
                disabled={chatBusy || !chatInput.trim()}
                className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* Media & Audio Lab */
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 md:p-6 gap-5">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'image' as MediaTool, label: 'Create & Edit Images', icon: ImageIcon },
              { id: 'video' as MediaTool, label: 'Text & Image to Video', icon: Film },
              { id: 'music' as MediaTool, label: 'Generate Music', icon: Music },
              { id: 'transcribe' as MediaTool, label: 'Transcribe Audio', icon: Mic },
              { id: 'gallery' as MediaTool, label: `Saved Gallery (${artifacts.length})`, icon: Layers },
            ].map((tool) => {
              const Icon = tool.icon;
              const active = mediaTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    setMediaTool(tool.id);
                    setMediaError(null);
                  }}
                  className={`h-9 px-3.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    active
                      ? 'border-cyan-400/60 bg-cyan-500/15 text-white'
                      : 'border-white/10 bg-[#0d1224] text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tool.label}
                </button>
              );
            })}
          </div>

          {mediaError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
              {mediaError}
            </div>
          )}

          {mediaTool === 'image' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <form
                onSubmit={handleGenerateImage}
                className="nexora-surface rounded-2xl p-5 border border-white/10 space-y-4"
              >
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Image Creation & Editing (gemini-nano-banana-2.1)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Generate bespoke artwork from text or upload an existing photo to transform it.
                  </p>
                </div>

                <textarea
                  rows={4}
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Describe the image to create or how to edit the uploaded photo..."
                  className="w-full rounded-xl bg-[#090d1c] border border-white/15 p-3 text-xs text-white focus:outline-none focus:border-cyan-400/60"
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Aspect Ratio</label>
                    <select
                      value={imageAspect}
                      onChange={(e) => setImageAspect(e.target.value)}
                      className="w-full h-9 rounded-xl bg-[#090d1c] border border-white/15 px-2.5 text-xs text-white"
                    >
                      {['1:1', '16:9', '9:16', '4:3', '3:4'].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Resolution</label>
                    <select
                      value={imageSize}
                      onChange={(e) => setImageSize(e.target.value)}
                      className="w-full h-9 rounded-xl bg-[#090d1c] border border-white/15 px-2.5 text-xs text-white"
                    >
                      {['1K', '2K', '4K'].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{imageSource ? `Source: ${imageSource.name}` : 'Optional Source Image (Edit)'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const { base64, mimeType } = await fileToBase64(f);
                        setImageSource({ base64, mimeType, name: f.name });
                      }}
                    />
                  </label>
                  {imageSource && (
                    <button
                      type="button"
                      onClick={() => setImageSource(null)}
                      className="text-[11px] text-rose-300 hover:underline cursor-pointer"
                    >
                      Remove Source
                    </button>
                  )}
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={imageSearchGrounding}
                    onChange={(e) => setImageSearchGrounding(e.target.checked)}
                    className="rounded border-white/20"
                  />
                  Ground with Google Web & Image Search
                </label>

                <button
                  type="submit"
                  disabled={mediaBusy || !imagePrompt.trim()}
                  className="w-full h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer"
                >
                  {mediaBusy ? 'Rendering Image...' : imageSource ? 'Edit Image' : 'Generate Image'}
                </button>
              </form>

              <div className="nexora-surface rounded-2xl p-5 border border-white/10 flex flex-col items-center justify-center min-h-[300px]">
                {imageResult ? (
                  <div className="space-y-3 w-full">
                    <img
                      src={imageResult.dataUrl}
                      alt="Generated output"
                      className="w-full max-h-[380px] object-contain rounded-xl border border-white/10 bg-[#060913]"
                    />
                    {imageResult.caption && (
                      <p className="text-xs text-slate-300">{imageResult.caption}</p>
                    )}
                    <a
                      href={imageResult.dataUrl}
                      download={`nexora-image-${Date.now()}.png`}
                      className="inline-flex items-center gap-1.5 text-xs text-cyan-300 hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Image
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Generated or edited image will appear here.</p>
                )}
              </div>
            </div>
          )}

          {mediaTool === 'video' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <form
                onSubmit={handleGenerateVideo}
                className="nexora-surface rounded-2xl p-5 border border-white/10 space-y-4"
              >
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Video Studio (gemini-omni-1.2-flash)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Generate video from text or upload an image to animate it into motion.
                  </p>
                </div>

                <textarea
                  rows={4}
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  placeholder="Describe camera motion, lighting, and subject action..."
                  className="w-full rounded-xl bg-[#090d1c] border border-white/15 p-3 text-xs text-white focus:outline-none focus:border-cyan-400/60"
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Aspect Ratio</label>
                    <select
                      value={videoAspect}
                      onChange={(e) => setVideoAspect(e.target.value as '16:9' | '9:16')}
                      className="w-full h-9 rounded-xl bg-[#090d1c] border border-white/15 px-2.5 text-xs text-white"
                    >
                      <option value="16:9">16:9 (Widescreen)</option>
                      <option value="9:16">9:16 (Vertical)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Duration</label>
                    <select
                      value={videoDuration}
                      onChange={(e) => setVideoDuration(e.target.value)}
                      className="w-full h-9 rounded-xl bg-[#090d1c] border border-white/15 px-2.5 text-xs text-white"
                    >
                      <option value="5s">5 seconds</option>
                      <option value="8s">8 seconds</option>
                      <option value="10s">10 seconds</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>
                      {videoSourceImage
                        ? `Animate Image: ${videoSourceImage.name}`
                        : 'Optional Starting Photo (Animate Image)'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const { base64, mimeType } = await fileToBase64(f);
                        setVideoSourceImage({ base64, mimeType, name: f.name });
                      }}
                    />
                  </label>
                  {videoSourceImage && (
                    <button
                      type="button"
                      onClick={() => setVideoSourceImage(null)}
                      className="text-[11px] text-rose-300 hover:underline cursor-pointer"
                    >
                      Clear Photo
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={mediaBusy || !videoPrompt.trim()}
                  className="w-full h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer"
                >
                  {mediaBusy
                    ? 'Synthesizing Video (may take ~30-90s)...'
                    : videoSourceImage
                      ? 'Animate Image into Video'
                      : 'Generate Video from Text'}
                </button>
              </form>

              <div className="nexora-surface rounded-2xl p-5 border border-white/10 flex flex-col items-center justify-center min-h-[300px]">
                {videoResultUrl ? (
                  <div className="space-y-3 w-full">
                    <video
                      src={videoResultUrl}
                      controls
                      autoPlay
                      loop
                      className="w-full max-h-[380px] rounded-xl border border-white/10 bg-black"
                    />
                    <a
                      href={videoResultUrl}
                      download={`nexora-video-${Date.now()}.mp4`}
                      className="inline-flex items-center gap-1.5 text-xs text-cyan-300 hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Video
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Generated MP4 video will play here.</p>
                )}
              </div>
            </div>
          )}

          {mediaTool === 'music' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <form
                onSubmit={handleGenerateMusic}
                className="nexora-surface rounded-2xl p-5 border border-white/10 space-y-4"
              >
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Lyria Music Generator
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Compose original 30s clips or full tracks from style prompts, instruments, and optional cover art.
                  </p>
                </div>

                <textarea
                  rows={4}
                  value={musicPrompt}
                  onChange={(e) => setMusicPrompt(e.target.value)}
                  placeholder="e.g., Atmospheric synthwave with warm analog bass, crisp arpeggios, 108 BPM..."
                  className="w-full rounded-xl bg-[#090d1c] border border-white/15 p-3 text-xs text-white focus:outline-none focus:border-cyan-400/60"
                />

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Music Model</label>
                  <select
                    value={musicModel}
                    onChange={(e) =>
                      setMusicModel(e.target.value as 'lyria-3-clip-preview' | 'lyria-3-pro-preview')
                    }
                    className="w-full h-9 rounded-xl bg-[#090d1c] border border-white/15 px-2.5 text-xs text-white"
                  >
                    <option value="lyria-3-clip-preview">Lyria 3 Clip (30s High-Fidelity)</option>
                    <option value="lyria-3-pro-preview">Lyria 3 Pro (Full Track + Lyrics)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>
                      {musicCoverImage
                        ? `Inspiration Image: ${musicCoverImage.name}`
                        : 'Optional Visual Mood Image'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const { base64, mimeType } = await fileToBase64(f);
                        setMusicCoverImage({ base64, mimeType, name: f.name });
                      }}
                    />
                  </label>
                  {musicCoverImage && (
                    <button
                      type="button"
                      onClick={() => setMusicCoverImage(null)}
                      className="text-[11px] text-rose-300 hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={mediaBusy || !musicPrompt.trim()}
                  className="w-full h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer"
                >
                  {mediaBusy ? 'Composing Audio Track...' : 'Compose Music'}
                </button>
              </form>

              <div className="nexora-surface rounded-2xl p-5 border border-white/10 flex flex-col justify-center min-h-[260px] space-y-4">
                {musicResult ? (
                  <>
                    <audio src={musicResult.dataUrl} controls className="w-full" />
                    {musicResult.lyrics && (
                      <div className="rounded-xl bg-[#090d1c] border border-white/10 p-3 text-xs text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto">
                        {musicResult.lyrics}
                      </div>
                    )}
                    <a
                      href={musicResult.dataUrl}
                      download={`nexora-track-${Date.now()}.mp3`}
                      className="inline-flex items-center gap-1.5 text-xs text-cyan-300 hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Track
                    </a>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 text-center">
                    Generated music track & lyrics will appear here.
                  </p>
                )}
              </div>
            </div>
          )}

          {mediaTool === 'transcribe' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="nexora-surface rounded-2xl p-5 border border-white/10 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Audio Transcription (gemini-3.5-transcribe)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Record straight from your microphone or upload an audio file for accurate speech-to-text.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Transcription Instruction
                  </label>
                  <input
                    type="text"
                    value={transcribeInstruction}
                    onChange={(e) => setTranscribeInstruction(e.target.value)}
                    className="w-full h-9 rounded-xl bg-[#090d1c] border border-white/15 px-3 text-xs text-white"
                  />
                </div>

                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="button"
                    disabled={mediaBusy}
                    onClick={toggleMediaMicTranscribe}
                    className={`flex-1 h-10 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer ${
                      transcribeRecording
                        ? 'border-rose-500/60 bg-rose-500/20 text-rose-200'
                        : 'border-cyan-400/50 bg-cyan-500/15 text-white hover:bg-cyan-500/25'
                    }`}
                  >
                    {transcribeRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    {transcribeRecording ? 'Stop & Transcribe' : 'Record Microphone'}
                  </button>

                  <label className="flex-1 h-10 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 inline-flex items-center justify-center gap-2 cursor-pointer">
                    <Upload className="w-4 h-4 text-violet-400" />
                    Upload Audio File
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAudioTranscribeFile(f);
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="nexora-surface rounded-2xl p-5 border border-white/10 flex flex-col justify-between min-h-[240px]">
                {mediaBusy ? (
                  <p className="text-xs text-cyan-300 m-auto">Transcribing audio...</p>
                ) : transcriptResult ? (
                  <>
                    <p className="text-xs text-slate-100 whitespace-pre-wrap leading-relaxed">
                      {transcriptResult}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(transcriptResult)}
                      className="self-start mt-3 text-xs text-cyan-300 hover:underline cursor-pointer"
                    >
                      Copy Transcript
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 m-auto">
                    Transcribed text will appear here.
                  </p>
                )}
              </div>
            </div>
          )}

          {mediaTool === 'gallery' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {artifacts.length === 0 ? (
                <div className="col-span-full text-center py-12 text-xs text-slate-500">
                  No saved studio creations yet.
                </div>
              ) : (
                artifacts.map((art) => (
                  <div
                    key={art.id}
                    className="nexora-surface rounded-2xl p-4 border border-white/10 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono-tabular uppercase text-cyan-300">
                        {art.kind} · {art.model}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiRequest(`/api/v1/ai/artifacts/${art.id}`, { method: 'DELETE' });
                          loadArtifacts();
                        }}
                        className="text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-200 line-clamp-2">{art.prompt}</p>
                    {art.kind === 'image' && (
                      <img
                        src={art.dataUrl}
                        alt={art.prompt}
                        className="w-full h-44 object-cover rounded-xl border border-white/10"
                      />
                    )}
                    {art.kind === 'video' && (
                      <video
                        src={art.dataUrl}
                        controls
                        className="w-full h-44 rounded-xl border border-white/10 bg-black"
                      />
                    )}
                    {art.kind === 'music' && <audio src={art.dataUrl} controls className="w-full" />}
                    {art.kind === 'transcript' && (
                      <p className="text-xs text-slate-300 bg-[#090d1c] p-2.5 rounded-xl max-h-36 overflow-y-auto">
                        {art.dataUrl}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
