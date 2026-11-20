import React, { useState } from 'react';
import { Image as ImageIcon, Lock, Upload } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import { apiRequest, uploadEncryptedMedia } from '../../lib/api';
import { encryptMediaBlob, encryptPrivateMessage, type StoredLocalKeyBundle } from '../../lib/crypto';
import type { PublicUser, StoryVisibility } from '../../types/nexora';
import { GlassButton, GlassInput, GlassModal } from '../ui/LiquidGlass';

interface CreateStoryModalProps {
  currentUserId: string;
  myKeys: StoredLocalKeyBundle;
  friends: PublicUser[];
  onCreated: () => void;
  onClose: () => void;
}

export function CreateStoryModal({
  currentUserId,
  myKeys,
  friends,
  onCreated,
  onClose,
}: CreateStoryModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<StoryVisibility>('friends');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      setError('Select a photo or video for your 24-hour story.');
      return;
    }
    audioManager.play('media.select');
    setError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Select a photo or video first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const encMedia = await encryptMediaBlob(file);
      const uploadRes = await uploadEncryptedMedia(encMedia.encryptedBytes, {
        isStory: true,
        mimeType: encMedia.mimeType,
        originalSize: encMedia.originalSize,
      });

      const targetFriends =
        visibility === 'close_friends'
          ? friends.filter((f) => selectedFriends.includes(f.id))
          : friends;

      const recipients: Array<{ userId: string; ecdhPublicJwk: string }> = [
        { userId: currentUserId, ecdhPublicJwk: JSON.stringify(myKeys.ecdhPublicJwk) },
      ];
      for (const f of targetFriends) {
        if (f.ecdhPublicJwk) {
          recipients.push({ userId: f.id, ecdhPublicJwk: f.ecdhPublicJwk });
        }
      }

      const metaEnc = await encryptPrivateMessage(
        {
          text: caption.trim(),
          mediaKey: encMedia.keyB64,
          mediaIv: encMedia.ivB64,
          mediaHash: encMedia.sha256CiphertextB64,
          mimeType: encMedia.mimeType,
        },
        `story:${currentUserId}:${uploadRes.attachmentId}`,
        recipients
      );

      await apiRequest('/api/v1/stories', {
        method: 'POST',
        body: JSON.stringify({
          mediaType: file.type.startsWith('video/') ? 'video' : 'image',
          attachmentId: uploadRes.attachmentId,
          ciphertextMeta: metaEnc.ciphertext,
          iv: metaEnc.iv,
          recipientEnvelopes: metaEnc.recipientEnvelopes,
          visibility,
        }),
      });

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish encrypted story.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassModal title="Create 24h Story" onClose={onClose} maxWidthClass="max-w-md">
      <div className="max-h-[78vh] overflow-y-auto space-y-4 pr-0.5">
        {error && (
          <div className="rounded-[16px] bg-rose-500/12 border border-rose-500/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block cursor-pointer">
            {previewUrl ? (
              <div className="relative rounded-[18px] overflow-hidden bg-black/60 max-h-64 flex items-center justify-center border border-white/40 dark:border-white/[0.1]">
                {file?.type.startsWith('video/') ? (
                  <video src={previewUrl} controls className="max-h-64 w-full object-contain" />
                ) : (
                  <img src={previewUrl} alt="Story preview" className="max-h-64 w-full object-cover" />
                )}
              </div>
            ) : (
              <div className="h-44 rounded-[18px] border border-dashed border-violet-500/40 dark:border-white/20 bg-white/45 dark:bg-white/[0.04] flex flex-col items-center justify-center gap-2 text-[var(--nx-text-secondary)] hover:border-violet-500 transition-colors">
                <Upload className="w-6 h-6 text-violet-600 dark:text-violet-300" />
                <span className="text-xs font-medium text-[var(--nx-text-primary)] flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />
                  <span>Choose photo or video</span>
                </span>
                <span className="text-[11px] text-[var(--nx-text-muted)]">Encrypted locally · Expires in 24 hours</span>
              </div>
            )}
            <input type="file" accept="image/*,video/*" onChange={handleFile} className="hidden" />
          </label>

          <GlassInput
            type="text"
            maxLength={140}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add an encrypted caption (optional)"
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--nx-text-secondary)]">Visibility</span>
              <div className="flex items-center gap-1 p-1 nexora-glass-subtle rounded-[14px]">
                <button
                  type="button"
                  onClick={() => {
                    audioManager.play('ui.tab_switch');
                    setVisibility('friends');
                  }}
                  className={`px-2.5 py-1 rounded-[10px] cursor-pointer transition-colors ${
                    visibility === 'friends'
                      ? 'bg-white/80 dark:bg-white/[0.16] text-slate-900 dark:text-white shadow-sm'
                      : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                  }`}
                >
                  All Friends
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioManager.play('ui.tab_switch');
                    setVisibility('close_friends');
                  }}
                  className={`px-2.5 py-1 rounded-[10px] cursor-pointer transition-colors ${
                    visibility === 'close_friends'
                      ? 'bg-white/80 dark:bg-white/[0.16] text-slate-900 dark:text-white shadow-sm'
                      : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                  }`}
                >
                  Selected Friends
                </button>
              </div>
            </div>

            {visibility === 'close_friends' && (
              <div className="max-h-32 overflow-y-auto space-y-1 p-2.5 rounded-[16px] nexora-glass-subtle">
                {friends.length === 0 ? (
                  <div className="text-xs text-[var(--nx-text-secondary)] text-center py-2">Add friends first to select viewers.</div>
                ) : (
                  friends.map((f) => {
                    const checked = selectedFriends.includes(f.id);
                    return (
                      <label key={f.id} className="flex items-center gap-2.5 text-xs text-[var(--nx-text-primary)] cursor-pointer p-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedFriends((prev) =>
                              checked ? prev.filter((id) => id !== f.id) : [...prev, f.id]
                            )
                          }
                          className="accent-violet-500"
                        />
                        <span>@{f.username}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]">
            <Lock className="w-3.5 h-3.5 text-violet-600 dark:text-sky-300 shrink-0" />
            <span>Media &amp; caption are encrypted with AES-256-GCM only for authorized viewers.</span>
          </div>

          <GlassButton
            type="submit"
            variant="primary"
            size="lg"
            soundEvent={false}
            disabled={loading || !file}
            className="w-full"
          >
            {loading ? 'Encrypting & Publishing...' : 'Share 24h Story'}
          </GlassButton>
        </form>
      </div>
    </GlassModal>
  );
}
