import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Eye, Send, Trash2, X } from 'lucide-react';
import { apiRequest, fetchEncryptedMediaBytes } from '../../lib/api';
import {
  decryptMediaBlob,
  decryptPrivateMessage,
  encryptPrivateMessage,
  type StoredLocalKeyBundle,
} from '../../lib/crypto';
import { useVisualPrefs } from '../../lib/theme';
import type { PublicUser, StoryRecord } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';
import { CosmicLoader, ReactionParticleBurst } from '../ui/MagicalEffects';

interface StoryViewerProps {
  stories: StoryRecord[];
  initialIndex: number;
  currentUserId: string;
  myKeys: StoredLocalKeyBundle;
  onClose: () => void;
  onRefresh: () => void;
  onReplySent?: (conversationId: string) => void;
}

const STORY_REACTIONS = ['❤️', '🔥', '😮', '👏', '✨'];

export function StoryViewer({
  stories,
  initialIndex,
  currentUserId,
  myKeys,
  onClose,
  onRefresh,
  onReplySent,
}: StoryViewerProps) {
  const { effectiveReducedMotion } = useVisualPrefs();
  const [index, setIndex] = useState(initialIndex);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [showViewers, setShowViewers] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reactBurst, setReactBurst] = useState<{ emoji: string; ts: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const story = stories[index];

  useEffect(() => {
    if (!story) {
      onClose();
      return;
    }

    let active = true;
    let objUrl: string | null = null;

    async function loadStory() {
      setLoading(true);
      setMediaUrl(null);
      setCaption('');
      setShowViewers(false);

      try {
        const myEnv = story.recipientEnvelopes?.[currentUserId];
        if (!myEnv) {
          setLoading(false);
          return;
        }
        const meta = await decryptPrivateMessage(
          story.ciphertextMeta,
          story.iv,
          `story:${story.userId}:${story.attachmentId}`,
          myEnv,
          myKeys.ecdhPrivateJwk
        );
        const encBuf = await fetchEncryptedMediaBytes(story.attachmentId);
        const blob = await decryptMediaBlob(
          encBuf,
          meta.mediaKey || '',
          meta.mediaIv || '',
          meta.mimeType || (story.mediaType === 'video' ? 'video/mp4' : 'image/webp'),
          meta.mediaHash
        );
        if (!active) return;
        objUrl = URL.createObjectURL(blob);
        setMediaUrl(objUrl);
        setCaption(meta.text || '');

        if (story.userId !== currentUserId) {
          apiRequest(`/api/v1/stories/${story.id}/view`, { method: 'POST' }).catch(() => {});
        }
      } catch {
        // handled cleanly
      } finally {
        if (active) setLoading(false);
      }
    }

    loadStory();

    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [story?.id]);

  if (!story) return null;

  const isOwner = story.userId === currentUserId;

  const handleReact = async (emoji: string) => {
    setReactBurst({ emoji, ts: Date.now() });
    await apiRequest(`/api/v1/stories/${story.id}/react`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
    setFeedback(`Reacted ${emoji}`);
    setTimeout(() => setFeedback(null), 1500);
    onRefresh();
  };

  const handlePrivateReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || isOwner) return;
    try {
      const convRes = await apiRequest<{ conversationId: string }>('/api/v1/conversations/private', {
        method: 'POST',
        body: JSON.stringify({ userId: story.userId }),
      });
      const peerRes = await apiRequest<{ user: PublicUser }>(`/api/v1/users/profile/${story.username}`);
      const msgId = crypto.randomUUID();
      const recipients: Array<{ userId: string; ecdhPublicJwk: string }> = [
        { userId: currentUserId, ecdhPublicJwk: JSON.stringify(myKeys.ecdhPublicJwk) },
      ];
      if (peerRes.user.ecdhPublicJwk) {
        recipients.push({ userId: peerRes.user.id, ecdhPublicJwk: peerRes.user.ecdhPublicJwk });
      }
      const enc = await encryptPrivateMessage(
        { text: `Replied to your story: ${replyText.trim()}` },
        `${convRes.conversationId}:${currentUserId}:${msgId}`,
        recipients
      );
      await apiRequest(`/api/v1/conversations/${convRes.conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          id: msgId,
          kind: 'text',
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          aad: enc.aad,
          recipientEnvelopes: enc.recipientEnvelopes,
        }),
      });
      setReplyText('');
      setFeedback('Encrypted reply sent');
      setTimeout(() => {
        setFeedback(null);
        onReplySent?.(convRes.conversationId);
      }, 600);
    } catch {
      setFeedback('Could not send reply');
    }
  };

  const handleDelete = async () => {
    await apiRequest(`/api/v1/stories/${story.id}`, { method: 'DELETE' });
    onRefresh();
    onClose();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Only navigate when swipe is clearly horizontal so vertical drawers never conflict
    if (Math.abs(dx) > 48 && Math.abs(dy) < 40) {
      if (dx < 0 && index < stories.length - 1) {
        setIndex((i) => Math.min(stories.length - 1, i + 1));
      } else if (dx > 0 && index > 0) {
        setIndex((i) => Math.max(0, i - 1));
      }
    }
  };

  return (
    <motion.div
      initial={effectiveReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={effectiveReducedMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center p-2 sm:p-6"
    >
      {/* Portal circular light aura on open */}
      {!effectiveReducedMotion && (
        <motion.div
          initial={{ scale: 0.35, opacity: 0.55 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
          aria-hidden="true"
          className="pointer-events-none fixed w-72 h-72 rounded-full bg-radial from-cyan-400/25 via-violet-500/20 to-transparent"
        />
      )}

      <motion.div
        initial={effectiveReducedMotion ? false : { scale: 0.88, opacity: 0, filter: 'blur(6px)' }}
        animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
        exit={effectiveReducedMotion ? undefined : { scale: 0.9, opacity: 0, filter: 'blur(4px)' }}
        transition={
          effectiveReducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 320, damping: 28 }
        }
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="relative w-full max-w-md h-[88vh] bg-[#0b0f1f] border border-violet-400/25 rounded-3xl overflow-hidden flex flex-col shadow-[0_0_40px_rgba(124,58,237,0.28)]"
      >
        {/* Segmented Progress Bars */}
        <div className="absolute top-0 inset-x-0 z-20 p-3 space-y-3 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex gap-1">
            {stories.map((s, idx) => {
              const filled = idx < index;
              const current = idx === index;
              return (
                <div key={s.id} className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden">
                  <motion.div
                    initial={false}
                    animate={{ width: filled || current ? '100%' : '0%' }}
                    transition={
                      effectiveReducedMotion
                        ? { duration: 0 }
                        : { duration: current ? 0.45 : 0.2, ease: [0.16, 1, 0.3, 1] }
                    }
                    className={`h-full rounded-full ${
                      current
                        ? 'bg-gradient-to-r from-violet-400 to-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.65)]'
                        : 'bg-cyan-400'
                    }`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar src={story.avatarUrl} name={story.displayName} size="sm" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{story.displayName}</div>
                <div className="text-[11px] text-slate-300">
                  @{story.username} · {new Date(story.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {isOwner && (
                <button
                  type="button"
                  onClick={handleDelete}
                  aria-label="Delete story"
                  className="p-2 text-rose-300 hover:text-rose-200 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close story viewer"
                className="p-2 text-slate-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Story Media Viewport (zero CSS camera filters on user photos/videos) */}
        <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key={`loader-${story.id}`}
                initial={effectiveReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={effectiveReducedMotion ? undefined : { opacity: 0 }}
                className="px-4"
              >
                <CosmicLoader
                  label="Decrypting 24h story..."
                  sublabel="Unwrapping story envelope locally"
                />
              </motion.div>
            ) : mediaUrl ? (
              <motion.div
                key={story.id}
                initial={effectiveReducedMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={effectiveReducedMotion ? undefined : { opacity: 0, scale: 1.03 }}
                transition={{ duration: effectiveReducedMotion ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex items-center justify-center"
              >
                {story.mediaType === 'video' ? (
                  <video src={mediaUrl} autoPlay controls className="w-full h-full object-contain" />
                ) : (
                  <img src={mediaUrl} alt={caption || 'Story'} className="w-full h-full object-contain" />
                )}
              </motion.div>
            ) : (
              <motion.div
                key={`missing-${story.id}`}
                initial={effectiveReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-slate-400"
              >
                Encrypted story unavailable.
              </motion.div>
            )}
          </AnimatePresence>

          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              aria-label="Previous story"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 border border-white/10 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {index < stories.length - 1 && (
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(stories.length - 1, i + 1))}
              aria-label="Next story"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 border border-white/10 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Caption & Interactive Footer */}
        <div className="p-4 bg-gradient-to-t from-black/95 via-black/80 to-black/40 space-y-3">
          {caption && <p className="text-sm text-white text-center">{caption}</p>}

          {feedback && (
            <div className="text-center text-xs text-cyan-300 font-medium">{feedback}</div>
          )}

          {isOwner ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowViewers((v) => !v)}
                className="w-full h-10 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                <Eye className="w-4 h-4 text-cyan-300" />
                <span>{story.viewCount} {story.viewCount === 1 ? 'Viewer' : 'Viewers'}</span>
              </button>
              {showViewers && (
                <div className="max-h-36 overflow-y-auto space-y-1.5 pt-1">
                  {(!story.viewers || story.viewers.length === 0) ? (
                    <div className="text-xs text-slate-400 text-center py-2">No views yet.</div>
                  ) : (
                    story.viewers.map((v) => (
                      <div key={v.userId} className="flex items-center justify-between text-xs text-slate-200 px-2">
                        <span>@{v.username}</span>
                        <span className="text-slate-400 font-mono-tabular">
                          {new Date(v.viewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-center gap-2">
                {STORY_REACTIONS.map((em) => (
                  <motion.button
                    key={em}
                    type="button"
                    whileHover={effectiveReducedMotion ? undefined : { scale: 1.12 }}
                    whileTap={effectiveReducedMotion ? undefined : { scale: 0.9 }}
                    onClick={() => handleReact(em)}
                    className="relative w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-base flex items-center justify-center transition-colors cursor-pointer"
                  >
                    {em}
                    <ReactionParticleBurst
                      burstKey={reactBurst?.emoji === em ? reactBurst.ts : null}
                    />
                  </motion.button>
                ))}
              </div>
              <form onSubmit={handlePrivateReply} className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply privately to @${story.username}...`}
                  className="flex-1 h-10 px-3.5 rounded-xl bg-white/10 border border-white/15 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-violet-400"
                />
                <button
                  type="submit"
                  aria-label="Send story reply"
                  className="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
