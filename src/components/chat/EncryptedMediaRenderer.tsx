import React, { useEffect, useState } from 'react';
import { Download, FileText, Maximize2 } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { fetchEncryptedMediaBytes } from '../../lib/api';
import { decryptMediaBlob } from '../../lib/crypto';
import type { DecryptedMessagePayload, MessageKind } from '../../types/nexora';
import { VoicePlayer } from './VoicePlayer';
import { CosmicLoader } from '../ui/MagicalEffects';

interface EncryptedMediaRendererProps {
  attachmentId: string;
  kind: MessageKind;
  payload: DecryptedMessagePayload;
  isMine: boolean;
  onOpenLightbox: (url: string, mimeType: string, fileName?: string | null) => void;
}

export function EncryptedMediaRenderer({
  attachmentId,
  kind,
  payload,
  isMine,
  onOpenLightbox,
}: EncryptedMediaRendererProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    async function loadAndDecrypt() {
      if (!payload.mediaKey || !payload.mediaIv) {
        setError('Missing media decryption key.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const encryptedBuf = await fetchEncryptedMediaBytes(attachmentId);
        const blob = await decryptMediaBlob(
          encryptedBuf,
          payload.mediaKey,
          payload.mediaIv,
          payload.mimeType || 'application/octet-stream',
          payload.mediaHash
        );
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to decrypt media.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAndDecrypt();

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachmentId, payload.mediaKey, payload.mediaIv, payload.mimeType, payload.mediaHash]);

  if (loading) {
    return <CosmicLoader compact label="Decrypting media..." />;
  }

  if (error || !objectUrl) {
    return (
      <div className={`text-xs py-1 ${isMine ? 'text-rose-100' : 'text-rose-600 dark:text-rose-300'}`}>
        {error || 'Media unavailable'}
      </div>
    );
  }

  if (kind === 'voice') {
    return (
      <VoicePlayer
        audioUrl={objectUrl}
        durationMs={payload.durationMs}
        waveform={payload.waveform}
        isMine={isMine}
      />
    );
  }

  if (kind === 'image') {
    return (
      <div className="relative group overflow-hidden rounded-xl max-w-xs sm:max-w-sm border border-white/40 dark:border-cyan-400/20 shadow-[0_8px_22px_rgba(30,24,70,0.16)] transition-colors">
        <img
          src={objectUrl}
          alt={payload.fileName || 'Encrypted photo'}
          onClick={() => onOpenLightbox(objectUrl, payload.mimeType || 'image/webp', payload.fileName)}
          className="max-h-72 w-full object-cover cursor-pointer rounded-xl"
        />
        <button
          type="button"
          onClick={() => onOpenLightbox(objectUrl, payload.mimeType || 'image/webp', payload.fileName)}
          aria-label="Expand image"
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div className="relative max-w-xs sm:max-w-sm rounded-xl overflow-hidden bg-black/75 border border-violet-400/30 shadow-[0_8px_22px_rgba(30,24,70,0.18)]">
        <video src={objectUrl} controls className="max-h-72 w-full rounded-xl" />
        <button
          type="button"
          onClick={() => onOpenLightbox(objectUrl, payload.mimeType || 'video/mp4', payload.fileName)}
          className="mt-1.5 px-2.5 pb-2 text-[11px] text-cyan-200 hover:underline inline-flex items-center gap-1 cursor-pointer"
        >
          <Maximize2 className="w-3 h-3" />
          <span>Full screen</span>
        </button>
      </div>
    );
  }

  return (
    <a
      href={objectUrl}
      download={payload.fileName || 'encrypted-file'}
      onClick={() => audioManager.play('media.download')}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors max-w-xs ${
        isMine
          ? 'bg-black/20 hover:bg-black/30 border-white/20 text-white'
          : 'bg-white/55 hover:bg-white/80 dark:bg-black/25 dark:hover:bg-black/35 border-white/65 dark:border-white/10 text-[var(--nx-text-primary)]'
      }`}
    >
      <FileText
        className={`w-5 h-5 shrink-0 ${isMine ? 'text-cyan-200' : 'text-violet-600 dark:text-cyan-300'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{payload.fileName || 'Document'}</div>
        {payload.originalSize && (
          <div className="text-[11px] opacity-75 font-mono-tabular">
            {(payload.originalSize / 1024).toFixed(1)} KB
          </div>
        )}
      </div>
      <Download className="w-4 h-4 shrink-0 opacity-80" />
    </a>
  );
}
