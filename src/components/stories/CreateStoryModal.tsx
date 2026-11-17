import React, { useState } from 'react';
import { Image as ImageIcon, Lock, Upload, X } from 'lucide-react';
import { apiRequest, uploadEncryptedMedia } from '../../lib/api';
import { encryptMediaBlob, encryptPrivateMessage, type StoredLocalKeyBundle } from '../../lib/crypto';
import type { PublicUser, StoryVisibility } from '../../types/nexora';

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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md nexora-glass rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-display font-semibold text-white">Create 24h Story</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block cursor-pointer">
            {previewUrl ? (
              <div className="relative rounded-xl overflow-hidden bg-black/40 max-h-64 flex items-center justify-center">
                {file?.type.startsWith('video/') ? (
                  <video src={previewUrl} controls className="max-h-64 w-full object-contain" />
                ) : (
                  <img src={previewUrl} alt="Story preview" className="max-h-64 w-full object-cover" />
                )}
              </div>
            ) : (
              <div className="h-44 rounded-xl border border-dashed border-slate-600 bg-slate-900/70 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-violet-400 transition-colors">
                <Upload className="w-6 h-6 text-violet-400" />
                <span className="text-xs font-medium text-slate-200">Choose photo or video</span>
                <span className="text-[11px] text-slate-500">Encrypted locally · Expires in 24 hours</span>
              </div>
            )}
            <input type="file" accept="image/*,video/*" onChange={handleFile} className="hidden" />
          </label>

          <input
            type="text"
            maxLength={140}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add an encrypted caption (optional)"
            className="w-full h-10 px-3.5 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Visibility</span>
              <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setVisibility('friends')}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    visibility === 'friends' ? 'bg-violet-600 text-white' : 'text-slate-400'
                  }`}
                >
                  All Friends
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('close_friends')}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    visibility === 'close_friends' ? 'bg-violet-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Selected Friends
                </button>
              </div>
            </div>

            {visibility === 'close_friends' && (
              <div className="max-h-32 overflow-y-auto space-y-1 p-2 rounded-xl bg-slate-900/70 border border-white/10">
                {friends.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-2">Add friends first to select viewers.</div>
                ) : (
                  friends.map((f) => {
                    const checked = selectedFriends.includes(f.id);
                    return (
                      <label key={f.id} className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer p-1">
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

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <Lock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>Media & caption are encrypted with AES-256-GCM only for authorized viewers.</span>
          </div>

          <button
            type="submit"
            disabled={loading || !file}
            className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer"
          >
            {loading ? 'Encrypting & Publishing...' : 'Share 24h Story'}
          </button>
        </form>
      </div>
    </div>
  );
}
