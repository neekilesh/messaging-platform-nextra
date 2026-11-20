import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  Archive,
  ArrowLeft,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Edit3,
  FileUp,
  Flag,
  Forward,
  Info,
  Lock,
  MoreVertical,
  Paperclip,
  Pin,
  Reply,
  Search,
  Send,
  ShieldBan,
  ShieldCheck,
  Smile,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, uploadEncryptedMedia } from '../../lib/api';
import {
  decryptAndVerifyReadReceipt,
  decryptGroupMessage,
  decryptMessageReaction,
  decryptPrivateMessage,
  encryptGroupMessage,
  encryptMediaBlob,
  encryptMessageReaction,
  encryptPrivateMessage,
  signAndEncryptReadReceipt,
  unwrapGroupEpochKey,
  type StoredLocalKeyBundle,
} from '../../lib/crypto';
import { getSocket } from '../../lib/socket';
import { playMagicalSound } from '../../lib/audio';
import { useVisualPrefs } from '../../lib/theme';
import type {
  ConversationSummary,
  DecryptedMessagePayload,
  EncryptedMessageReaction,
  GroupDetails,
  MessageKind,
  MessageReactionItem,
  MessageRecord,
  SignedEncryptedReadReceipt,
  StreakInfo,
} from '../../types/nexora';
import { Avatar } from '../ui/Avatar';
import {
  CosmicLoader,
  DeliveryWarningIcon,
  EncryptionShieldBadge,
  ReactionParticleBurst,
} from '../ui/MagicalEffects';
import { EncryptedMediaRenderer } from './EncryptedMediaRenderer';
import { MediaLightbox } from './MediaLightbox';
import { SafetyNumberModal } from './SafetyNumberModal';
import { ForwardModal } from './ForwardModal';
import { VoiceRecorder } from './VoiceRecorder';
import { GroupInfoDrawer } from '../group/GroupInfoDrawer';
import { StreakCounter } from './StreakCounter';

interface ChatWindowProps {
  conversation: ConversationSummary;
  allConversations: ConversationSummary[];
  currentUserId: string;
  myKeys: StoredLocalKeyBundle;
  onBackMobile?: () => void;
  onConversationUpdated: () => void;
}

const REACTION_EMOJIS = ['❤️', '🔥', '😂', '😮', '😢', '👍', '✨', '🙏'];

const DISAPPEARING_OPTIONS = [
  { label: 'Off', seconds: 0 },
  { label: '10 seconds', seconds: 10 },
  { label: '1 minute', seconds: 60 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
];

const STREAK_MILESTONE_DAYS = new Set([3, 7, 10, 14, 25, 30, 50, 100, 365]);

export function ChatWindow({
  conversation,
  allConversations,
  currentUserId,
  myKeys,
  onBackMobile,
  onConversationUpdated,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [liveArrivalIds, setLiveArrivalIds] = useState<Set<string>>(() => new Set());
  const { effectiveReducedMotion: prefersReducedMotion, soundEnabled, soundPack } = useVisualPrefs();
  const soundPrefsRef = useRef({ soundEnabled, soundPack });
  soundPrefsRef.current = { soundEnabled, soundPack };
  const [liveStreak, setLiveStreak] = useState<StreakInfo | null>(conversation.streak);
  const streakTrackerRef = useRef<{
    conversationId: string;
    lastCount: number;
    celebrated: Set<number>;
  }>({
    conversationId: conversation.id,
    lastCount: conversation.streak?.isActive ? conversation.streak.streakCount : 0,
    celebrated: new Set(
      conversation.streak?.isActive && conversation.streak.streakCount > 0
        ? [conversation.streak.streakCount]
        : []
    ),
  });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [sendConfirmBurstKey, setSendConfirmBurstKey] = useState<number | null>(null);
  const [lastConfirmedMsgId, setLastConfirmedMsgId] = useState<string | null>(null);
  const [reactionBurst, setReactionBurst] = useState<{ key: string; ts: number } | null>(null);

  const [replyTarget, setReplyTarget] = useState<MessageRecord | null>(null);
  const [editTarget, setEditTarget] = useState<MessageRecord | null>(null);
  const [forwardTarget, setForwardTarget] = useState<MessageRecord | null>(null);
  const [activeMenuMsgId, setActiveMenuMsgId] = useState<string | null>(null);
  const [reactMsgId, setReactMsgId] = useState<string | null>(null);
  const [pressingMsgId, setPressingMsgId] = useState<string | null>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showGroupDrawer, setShowGroupDrawer] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; mimeType: string; fileName?: string | null } | null>(null);

  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const groupDetailsRef = useRef<GroupDetails | null>(null);
  const epochKeysRef = useRef<Map<number, Uint8Array>>(new Map());
  const sentReceiptIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<MessageRecord[]>([]);
  messagesRef.current = messages;

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number; msgId: string } | null>(null);
  const suppressNextCloseRef = useRef<number>(0);

  const getSignerEcdsaKey = (readerId: string): string | null => {
    if (conversation.type === 'private') {
      return conversation.peerUser?.id === readerId ? conversation.peerUser.ecdsaPublicJwk : null;
    }
    const member = groupDetailsRef.current?.members.find((m) => m.userId === readerId);
    return member?.ecdsaPublicJwk || null;
  };

  const verifyMessageReadReceipts = async (msg: MessageRecord): Promise<MessageRecord> => {
    if (msg.senderId !== currentUserId || !msg.readReceipts || msg.readReceipts.length === 0) {
      return msg;
    }
    for (const receipt of msg.readReceipts) {
      const signerKey = getSignerEcdsaKey(receipt.readerId);
      const epochKeyRaw = typeof receipt.epoch === 'number' ? epochKeysRef.current.get(receipt.epoch) : null;
      const result = await decryptAndVerifyReadReceipt({
        conversationId: conversation.id,
        receipt,
        myUserId: currentUserId,
        myEcdhPrivateJwk: myKeys.ecdhPrivateJwk,
        signerEcdsaPublicJwk: signerKey,
        groupEpochKeyRaw: epochKeyRaw,
      });
      if (result.verified) {
        return {
          ...msg,
          status: 'read',
          verifiedRead: true,
          verifiedReadAt: result.viewedAt,
        };
      }
    }
    return msg;
  };

  const sendSignedReadReceipts = async (targetMessages: MessageRecord[]) => {
    const candidates = targetMessages.filter(
      (m) => m.senderId !== currentUserId && !sentReceiptIdsRef.current.has(m.id)
    );
    if (candidates.length === 0) {
      await apiRequest(`/api/v1/conversations/${conversation.id}/read`, { method: 'POST' }).catch(() => {});
      return;
    }

    candidates.forEach((m) => sentReceiptIdsRef.current.add(m.id));
    try {
      const receipts: SignedEncryptedReadReceipt[] = [];
      const viewedAtBase = Date.now();
      const currentEpoch = groupDetailsRef.current?.currentEpoch || conversation.currentEpoch || 1;
      const epochKeyRaw = conversation.type === 'group' ? epochKeysRef.current.get(currentEpoch) || null : null;

      for (let i = 0; i < candidates.length; i++) {
        const msg = candidates[i];
        const viewedAt = new Date(viewedAtBase + i).toISOString();

        if (conversation.type === 'private' && conversation.peerUser?.ecdhPublicJwk) {
          const signed = await signAndEncryptReadReceipt({
            conversationId: conversation.id,
            messageId: msg.id,
            readerId: currentUserId,
            viewedAt,
            ecdsaPrivateJwk: myKeys.ecdsaPrivateJwk,
            recipients: [
              { userId: conversation.peerUser.id, ecdhPublicJwk: conversation.peerUser.ecdhPublicJwk },
              { userId: currentUserId, ecdhPublicJwk: JSON.stringify(myKeys.ecdhPublicJwk) },
            ],
          });
          receipts.push(signed);
        } else if (conversation.type === 'group' && epochKeyRaw) {
          const signed = await signAndEncryptReadReceipt({
            conversationId: conversation.id,
            messageId: msg.id,
            readerId: currentUserId,
            viewedAt,
            ecdsaPrivateJwk: myKeys.ecdsaPrivateJwk,
            groupEpochKeyRaw: epochKeyRaw,
            groupEpoch: currentEpoch,
          });
          receipts.push(signed);
        } else {
          const signed = await signAndEncryptReadReceipt({
            conversationId: conversation.id,
            messageId: msg.id,
            readerId: currentUserId,
            viewedAt,
            ecdsaPrivateJwk: myKeys.ecdsaPrivateJwk,
          });
          receipts.push(signed);
        }
      }

      await apiRequest(`/api/v1/conversations/${conversation.id}/read`, {
        method: 'POST',
        body: JSON.stringify({ receipts }),
      });
    } catch {
      candidates.forEach((m) => sentReceiptIdsRef.current.delete(m.id));
    }
  };

  const resolveMessageReactions = async (
    messageId: string,
    legacyReactions: MessageReactionItem[],
    encryptedReactions?: EncryptedMessageReaction[]
  ): Promise<MessageReactionItem[]> => {
    const emojiUsers = new Map<string, Set<string>>();

    for (const item of legacyReactions || []) {
      if (!item.emoji || item.emoji === '__e2ee__') continue;
      const set = emojiUsers.get(item.emoji) || new Set<string>();
      for (const uid of item.userIds) set.add(uid);
      emojiUsers.set(item.emoji, set);
    }

    if (encryptedReactions && encryptedReactions.length > 0) {
      if (
        conversation.type === 'group' &&
        encryptedReactions.some((r) => typeof r.epoch === 'number' && !epochKeysRef.current.has(r.epoch))
      ) {
        await loadGroupEpochKeys();
      }

      for (const encItem of encryptedReactions) {
        const epochKeyRaw =
          typeof encItem.epoch === 'number' ? epochKeysRef.current.get(encItem.epoch) || null : null;
        const emojis = await decryptMessageReaction({
          conversationId: conversation.id,
          messageId,
          reaction: encItem,
          myUserId: currentUserId,
          myEcdhPrivateJwk: myKeys.ecdhPrivateJwk,
          groupEpochKeyRaw: epochKeyRaw,
        });
        for (const em of emojis) {
          const set = emojiUsers.get(em) || new Set<string>();
          set.add(encItem.userId);
          emojiUsers.set(em, set);
        }
      }
    }

    return Array.from(emojiUsers.entries())
      .map(([emoji, usersSet]) => ({
        emoji,
        userIds: Array.from(usersSet),
        count: usersSet.size,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const ia = REACTION_EMOJIS.indexOf(a.emoji);
        const ib = REACTION_EMOJIS.indexOf(b.emoji);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.emoji.localeCompare(b.emoji);
      });
  };

  const decryptMessageItem = async (msg: MessageRecord): Promise<MessageRecord> => {
    let resolved: MessageRecord;
    if (msg.deletedForEveryone) {
      resolved = { ...msg, reactions: [], encryptedReactions: [], localDecrypted: { text: '' } };
    } else {
      try {
        if (conversation.type === 'private') {
          const myEnv = msg.recipientEnvelopes?.[currentUserId];
          if (!myEnv) {
            resolved = { ...msg, localDecrypted: { text: '[Encrypted for another device]' } };
          } else {
            const dec = await decryptPrivateMessage(
              msg.ciphertext,
              msg.iv,
              msg.aad,
              myEnv,
              myKeys.ecdhPrivateJwk
            );
            resolved = { ...msg, localDecrypted: dec };
          }
        } else {
          const epoch = msg.epoch || 1;
          const epochKey = epochKeysRef.current.get(epoch);
          if (!epochKey) {
            resolved = {
              ...msg,
              localDecrypted: { text: `[Encrypted under group epoch ${epoch} before you joined]` },
            };
          } else {
            const dec = await decryptGroupMessage(msg.ciphertext, msg.iv, msg.aad, epochKey);
            resolved = { ...msg, localDecrypted: dec };
          }
        }
      } catch {
        resolved = { ...msg, localDecrypted: { text: '[Unable to decrypt with current key]' } };
      }

      if (resolved.encryptedReactions && resolved.encryptedReactions.length > 0) {
        const mergedReactions = await resolveMessageReactions(
          resolved.id,
          resolved.reactions || [],
          resolved.encryptedReactions
        );
        resolved = { ...resolved, reactions: mergedReactions };
      }
    }
    return verifyMessageReadReceipts(resolved);
  };

  const loadGroupEpochKeys = async () => {
    if (conversation.type !== 'group' || !conversation.groupId) return;
    try {
      const res = await apiRequest<{ group: GroupDetails }>(`/api/v1/groups/${conversation.groupId}`);
      setGroupDetails(res.group);
      groupDetailsRef.current = res.group;
      const map = new Map<number, Uint8Array>();
      for (const env of res.group.myEpochEnvelopes) {
        try {
          const raw = await unwrapGroupEpochKey(env, myKeys.ecdhPrivateJwk);
          map.set(env.epoch, raw);
        } catch {
          // skip unreadable epoch
        }
      }
      epochKeysRef.current = map;
    } catch {
      // handled gracefully
    }
  };

  const loadMessages = async (beforeCursor?: string) => {
    try {
      if (beforeCursor) setLoadingMore(true);
      else setLoading(true);

      if (!beforeCursor && conversation.type === 'group') {
        await loadGroupEpochKeys();
      }

      const qs = beforeCursor ? `?limit=40&before=${encodeURIComponent(beforeCursor)}` : '?limit=40';
      const res = await apiRequest<{ messages: MessageRecord[]; hasMore: boolean }>(
        `/api/v1/conversations/${conversation.id}/messages${qs}`
      );

      const decrypted = await Promise.all(res.messages.map(decryptMessageItem));
      setHasMore(res.hasMore);

      if (beforeCursor) {
        setMessages((prev) => [...decrypted, ...prev]);
      } else {
        setMessages(decrypted);
        await sendSignedReadReceipts(decrypted);
        onConversationUpdated();
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 40);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load conversation.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const evaluateStreakMilestone = (nextStreak: StreakInfo | null | undefined) => {
    if (nextStreak === undefined) return;
    setLiveStreak(nextStreak);

    if (!nextStreak || !nextStreak.isActive || nextStreak.streakCount <= 0) {
      if (streakTrackerRef.current.conversationId === conversation.id) {
        streakTrackerRef.current.lastCount = 0;
      }
      return;
    }

    const tracker = streakTrackerRef.current;
    if (tracker.conversationId !== conversation.id) return;

    const prevCount = tracker.lastCount;
    const nextCount = nextStreak.streakCount;
    const milestoneDay =
      nextStreak.milestoneReached ?? (STREAK_MILESTONE_DAYS.has(nextCount) ? nextCount : null);

    if (
      milestoneDay &&
      nextCount > prevCount &&
      !tracker.celebrated.has(milestoneDay)
    ) {
      tracker.celebrated.add(milestoneDay);
      playMagicalSound(
        'streak-milestone',
        soundPrefsRef.current.soundPack,
        soundPrefsRef.current.soundEnabled
      );
    }

    tracker.lastCount = nextCount;
  };

  useEffect(() => {
    const initialCount = conversation.streak?.isActive ? conversation.streak.streakCount : 0;
    streakTrackerRef.current = {
      conversationId: conversation.id,
      lastCount: initialCount,
      celebrated: new Set(initialCount > 0 ? [initialCount] : []),
    };
    setLiveStreak(conversation.streak);
    setMessages([]);
    setLiveArrivalIds(new Set());
    sentReceiptIdsRef.current = new Set();
    groupDetailsRef.current = null;
    setReplyTarget(null);
    setEditTarget(null);
    setReactMsgId(null);
    setActiveMenuMsgId(null);
    setPressingMsgId(null);
    setShowGroupDrawer(false);
    setShowSearch(false);
    setSearchQuery('');
    setErrorBanner(null);

    const sock = getSocket();
    sock?.emit('conversation:join', conversation.id);
    loadMessages();
  }, [conversation.id]);

  useEffect(() => {
    if (!reactMsgId && !activeMenuMsgId) return;
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (Date.now() < suppressNextCloseRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-reaction-tray], [data-reaction-trigger]')) return;
      setReactMsgId(null);
      setActiveMenuMsgId(null);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setReactMsgId(null);
        setActiveMenuMsgId(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [reactMsgId, activeMenuMsgId]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (streakTrackerRef.current.conversationId !== conversation.id) return;
    evaluateStreakMilestone(conversation.streak);
  }, [conversation.id, conversation.streak]);

  // Live Socket.IO event wiring
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;

    const handleNewMessage = async (data: {
      conversationId: string;
      message: MessageRecord;
      streak?: StreakInfo | null;
    }) => {
      if (data.conversationId !== conversation.id) return;
      if (data.streak !== undefined) {
        evaluateStreakMilestone(data.streak);
      }
      if (conversation.type === 'group' && data.message.epoch && !epochKeysRef.current.has(data.message.epoch)) {
        await loadGroupEpochKeys();
      }
      const decrypted = await decryptMessageItem(data.message);
      let isFreshInsertion = false;
      setMessages((prev) => {
        if (prev.some((m) => m.id === decrypted.id)) {
          return prev.map((m) => (m.id === decrypted.id ? decrypted : m));
        }
        isFreshInsertion = true;
        return [...prev, decrypted];
      });
      if (isFreshInsertion && !prefersReducedMotion) {
        setLiveArrivalIds((prev) => {
          const next = new Set(prev);
          next.add(decrypted.id);
          return next;
        });
        window.setTimeout(() => {
          setLiveArrivalIds((prev) => {
            if (!prev.has(decrypted.id)) return prev;
            const next = new Set(prev);
            next.delete(decrypted.id);
            return next;
          });
        }, 1200);
      }
      if (data.message.senderId !== currentUserId) {
        if (isFreshInsertion) {
          playMagicalSound(
            'receive-message',
            soundPrefsRef.current.soundPack,
            soundPrefsRef.current.soundEnabled
          );
        }
        sock.emit('message:delivered', { messageId: data.message.id, conversationId: conversation.id });
        sendSignedReadReceipts([decrypted]).catch(() => {});
      }
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    };

    const handleEdited = async (data: { conversationId: string; message: MessageRecord }) => {
      if (data.conversationId !== conversation.id) return;
      const decrypted = await decryptMessageItem(data.message);
      setMessages((prev) => prev.map((m) => (m.id === decrypted.id ? decrypted : m)));
    };

    const handleUpdated = (data: {
      conversationId: string;
      messageId: string;
      deletedForEveryone?: boolean;
      isPinned?: boolean;
    }) => {
      if (data.conversationId !== conversation.id) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== data.messageId) return m;
          return {
            ...m,
            ...(data.deletedForEveryone ? { deletedForEveryone: true, localDecrypted: { text: '' } } : {}),
            ...(typeof data.isPinned === 'boolean' ? { isPinned: data.isPinned } : {}),
          };
        })
      );
    };

    const handleExpired = (data: { conversationId: string; messageId: string }) => {
      if (data.conversationId !== conversation.id) return;
      setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
    };

    const handleReactions = async (data: {
      conversationId: string;
      messageId: string;
      reactions: MessageRecord['reactions'];
      encryptedReactions?: EncryptedMessageReaction[];
    }) => {
      if (data.conversationId !== conversation.id) return;
      const resolved = await resolveMessageReactions(
        data.messageId,
        data.reactions || [],
        data.encryptedReactions
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? {
                ...m,
                reactions: resolved,
                encryptedReactions: data.encryptedReactions || [],
              }
            : m
        )
      );
    };

    const handleReceipt = (data: { conversationId: string; messageId: string; status: MessageRecord['status'] }) => {
      if (data.conversationId !== conversation.id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, status: data.status } : m))
      );
    };

    const handleReadBatch = async (data: {
      conversationId: string;
      messageIds: string[];
      receipts?: SignedEncryptedReadReceipt[];
    }) => {
      if (data.conversationId !== conversation.id) return;
      const setIds = new Set(data.messageIds);
      const receiptByMsgId = new Map<string, SignedEncryptedReadReceipt>();
      const verifiedByMsgId = new Map<string, { verified: boolean; viewedAt: string }>();

      if (data.receipts && data.receipts.length > 0) {
        for (const r of data.receipts) {
          receiptByMsgId.set(r.messageId, r);
          const signerKey = getSignerEcdsaKey(r.readerId);
          const epochKeyRaw = typeof r.epoch === 'number' ? epochKeysRef.current.get(r.epoch) : null;
          const res = await decryptAndVerifyReadReceipt({
            conversationId: conversation.id,
            receipt: r,
            myUserId: currentUserId,
            myEcdhPrivateJwk: myKeys.ecdhPrivateJwk,
            signerEcdsaPublicJwk: signerKey,
            groupEpochKeyRaw: epochKeyRaw,
          });
          if (res.verified) {
            verifiedByMsgId.set(r.messageId, { verified: true, viewedAt: res.viewedAt });
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (!setIds.has(m.id)) return m;
          const receipt = receiptByMsgId.get(m.id);
          const verif = verifiedByMsgId.get(m.id);
          return {
            ...m,
            status: 'read',
            ...(receipt ? { readReceipts: [...(m.readReceipts || []), receipt] } : {}),
            ...(verif ? { verifiedRead: true, verifiedReadAt: verif.viewedAt } : {}),
          };
        })
      );
    };

    const handleTyping = (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (data.conversationId !== conversation.id || data.userId === currentUserId) return;
      setTypingUsers((prev) => ({ ...prev, [data.userId]: data.isTyping }));
    };

    const handleGroupUpdated = (data: { conversationId: string }) => {
      if (data.conversationId !== conversation.id) return;
      loadGroupEpochKeys();
    };

    sock.on('message:new', handleNewMessage);
    sock.on('message:edited', handleEdited);
    sock.on('message:updated', handleUpdated);
    sock.on('message:expired', handleExpired);
    sock.on('message:reactions', handleReactions);
    sock.on('message:receipt', handleReceipt);
    sock.on('message:read_batch', handleReadBatch);
    sock.on('typing:update', handleTyping);
    sock.on('group:updated', handleGroupUpdated);

    return () => {
      sock.off('message:new', handleNewMessage);
      sock.off('message:edited', handleEdited);
      sock.off('message:updated', handleUpdated);
      sock.off('message:expired', handleExpired);
      sock.off('message:reactions', handleReactions);
      sock.off('message:receipt', handleReceipt);
      sock.off('message:read_batch', handleReadBatch);
      sock.off('typing:update', handleTyping);
      sock.off('group:updated', handleGroupUpdated);
    };
  }, [conversation.id, currentUserId]);

  const encryptPayloadForConversation = async (
    payload: DecryptedMessagePayload,
    msgId: string
  ) => {
    const aad = `${conversation.id}:${currentUserId}:${msgId}`;
    if (conversation.type === 'private') {
      const recipients: Array<{ userId: string; ecdhPublicJwk: string }> = [
        { userId: currentUserId, ecdhPublicJwk: JSON.stringify(myKeys.ecdhPublicJwk) },
      ];
      if (conversation.peerUser?.ecdhPublicJwk) {
        recipients.push({
          userId: conversation.peerUser.id,
          ecdhPublicJwk: conversation.peerUser.ecdhPublicJwk,
        });
      }
      const enc = await encryptPrivateMessage(payload, aad, recipients);
      return { ...enc, epoch: null };
    } else {
      const currentEpoch = groupDetails?.currentEpoch || conversation.currentEpoch || 1;
      let epochKey = epochKeysRef.current.get(currentEpoch);
      if (!epochKey) {
        await loadGroupEpochKeys();
        epochKey = epochKeysRef.current.get(currentEpoch);
      }
      if (!epochKey) {
        throw new Error('Missing group epoch encryption key.');
      }
      const enc = await encryptGroupMessage(payload, aad, epochKey);
      return { ...enc, recipientEnvelopes: null, epoch: currentEpoch };
    }
  };

  const sendEncryptedMessage = async (
    kind: MessageKind,
    payload: DecryptedMessagePayload,
    attachmentId: string | null = null,
    forwardedFromId: string | null = null
  ) => {
    const msgId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const optimistic: MessageRecord = {
      id: msgId,
      conversationId: conversation.id,
      senderId: currentUserId,
      senderUsername: 'you',
      senderDisplayName: 'You',
      senderAvatarUrl: null,
      replyToId: payload.replyToId || null,
      forwardedFromId,
      kind,
      ciphertext: '',
      iv: '',
      aad: '',
      recipientEnvelopes: null,
      epoch: null,
      attachmentId,
      isPinned: false,
      isEdited: false,
      deletedForEveryone: false,
      expiresAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'sending',
      reactions: [],
      localDecrypted: payload,
      localStatus: 'sending',
    };

    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);

    try {
      const encrypted = await encryptPayloadForConversation(payload, msgId);
      const res = await apiRequest<{ message: MessageRecord; streak?: StreakInfo | null }>(
        `/api/v1/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            id: msgId,
            kind,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            aad: encrypted.aad,
            recipientEnvelopes: encrypted.recipientEnvelopes,
            epoch: encrypted.epoch,
            replyToId: payload.replyToId || null,
            forwardedFromId,
            attachmentId,
          }),
        }
      );

      const hydrated = { ...res.message, localDecrypted: payload };
      setMessages((prev) => prev.map((m) => (m.id === msgId ? hydrated : m)));
      playMagicalSound('send-message', soundPrefsRef.current.soundPack, soundPrefsRef.current.soundEnabled);
      if (res.streak !== undefined) {
        evaluateStreakMilestone(res.streak);
      }
      if (!prefersReducedMotion) {
        setSendConfirmBurstKey(Date.now());
        setLastConfirmedMsgId(msgId);
        window.setTimeout(() => {
          setLastConfirmedMsgId((cur) => (cur === msgId ? null : cur));
        }, 900);
      }
      onConversationUpdated();
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: 'failed', localStatus: 'failed' } : m))
      );
      setErrorBanner(err instanceof Error ? err.message : 'Failed to send message.');
    }
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setErrorBanner(null);
    getSocket()?.emit('typing:stop', { conversationId: conversation.id });

    try {
      if (editTarget) {
        const nextPayload: DecryptedMessagePayload = {
          ...(editTarget.localDecrypted || { text: '' }),
          text: trimmed,
        };
        const encrypted = await encryptPayloadForConversation(nextPayload, editTarget.id);
        await apiRequest(`/api/v1/conversations/messages/${editTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            aad: encrypted.aad,
            recipientEnvelopes: encrypted.recipientEnvelopes,
          }),
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editTarget.id ? { ...m, isEdited: true, localDecrypted: nextPayload } : m
          )
        );
        setEditTarget(null);
        setText('');
      } else {
        const payload: DecryptedMessagePayload = {
          text: trimmed,
          ...(replyTarget
            ? {
                replyToId: replyTarget.id,
                replyPreview: replyTarget.localDecrypted?.text || replyTarget.kind,
                replySenderName: replyTarget.senderDisplayName,
              }
            : {}),
        };
        setText('');
        setReplyTarget(null);
        await sendEncryptedMessage('text', payload);
      }
    } finally {
      setSending(false);
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorBanner(null);
    setUploadProgress(`Encrypting ${file.name}...`);
    try {
      const encResult = await encryptMediaBlob(file);
      setUploadProgress(`Uploading encrypted media...`);
      const uploadRes = await uploadEncryptedMedia(encResult.encryptedBytes, {
        conversationId: conversation.id,
        mimeType: encResult.mimeType,
        originalSize: encResult.originalSize,
      });

      let kind: MessageKind = 'file';
      if (encResult.mimeType.startsWith('image/')) kind = 'image';
      else if (encResult.mimeType.startsWith('video/')) kind = 'video';
      else if (encResult.mimeType.startsWith('audio/')) kind = 'voice';

      await sendEncryptedMessage(
        kind,
        {
          text: '',
          mediaKey: encResult.keyB64,
          mediaIv: encResult.ivB64,
          mediaHash: encResult.sha256CiphertextB64,
          fileName: file.name,
          mimeType: encResult.mimeType,
          originalSize: encResult.originalSize,
        },
        uploadRes.attachmentId
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Media encryption/upload failed.');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleSendVoice = async (blob: Blob, durationMs: number, waveform: number[]) => {
    setErrorBanner(null);
    setUploadProgress('Encrypting voice note...');
    try {
      const encResult = await encryptMediaBlob(blob);
      const uploadRes = await uploadEncryptedMedia(encResult.encryptedBytes, {
        conversationId: conversation.id,
        mimeType: encResult.mimeType,
        originalSize: encResult.originalSize,
        durationMs,
      });

      await sendEncryptedMessage(
        'voice',
        {
          text: '',
          mediaKey: encResult.keyB64,
          mediaIv: encResult.ivB64,
          mediaHash: encResult.sha256CiphertextB64,
          fileName: 'voice-message.webm',
          mimeType: encResult.mimeType,
          durationMs,
          waveform,
        },
        uploadRes.attachmentId
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Voice message upload failed.');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleForwardTo = async (targetConv: ConversationSummary) => {
    if (!forwardTarget?.localDecrypted) return;
    setForwardTarget(null);
    try {
      const msgId = crypto.randomUUID();
      const aad = `${targetConv.id}:${currentUserId}:${msgId}`;
      const payload = forwardTarget.localDecrypted;

      if (targetConv.type === 'private') {
        const recipients: Array<{ userId: string; ecdhPublicJwk: string }> = [
          { userId: currentUserId, ecdhPublicJwk: JSON.stringify(myKeys.ecdhPublicJwk) },
        ];
        if (targetConv.peerUser?.ecdhPublicJwk) {
          recipients.push({
            userId: targetConv.peerUser.id,
            ecdhPublicJwk: targetConv.peerUser.ecdhPublicJwk,
          });
        }
        const enc = await encryptPrivateMessage(payload, aad, recipients);
        await apiRequest(`/api/v1/conversations/${targetConv.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            id: msgId,
            kind: forwardTarget.kind,
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            aad: enc.aad,
            recipientEnvelopes: enc.recipientEnvelopes,
            forwardedFromId: forwardTarget.id,
          }),
        });
      } else if (targetConv.groupId) {
        const grp = await apiRequest<{ group: GroupDetails }>(`/api/v1/groups/${targetConv.groupId}`);
        const env = grp.group.myEpochEnvelopes.find((e) => e.epoch === grp.group.currentEpoch);
        if (!env) throw new Error('Cannot access target group epoch key.');
        const epochKey = await unwrapGroupEpochKey(env, myKeys.ecdhPrivateJwk);
        const enc = await encryptGroupMessage(payload, aad, epochKey);
        await apiRequest(`/api/v1/conversations/${targetConv.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            id: msgId,
            kind: forwardTarget.kind,
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            aad: enc.aad,
            epoch: grp.group.currentEpoch,
            forwardedFromId: forwardTarget.id,
          }),
        });
      }
      onConversationUpdated();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Forwarding failed.');
    }
  };

  const handleTypingChange = (val: string) => {
    setText(val);
    const sock = getSocket();
    if (!sock) return;
    sock.emit('typing:start', { conversationId: conversation.id });
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      sock.emit('typing:stop', { conversationId: conversation.id });
    }, 1500);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
    setPressingMsgId(null);
  };

  const handleBubblePointerDown = (e: React.PointerEvent<HTMLDivElement>, msg: MessageRecord) => {
    if (msg.deletedForEveryone) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, audio, video, [data-no-longpress]')) return;

    cancelLongPress();
    longPressStartRef.current = { x: e.clientX, y: e.clientY, msgId: msg.id };
    setPressingMsgId(msg.id);

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStartRef.current = null;
      setPressingMsgId(null);
      setActiveMenuMsgId(null);
      suppressNextCloseRef.current = Date.now() + 400;
      setReactMsgId(msg.id);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    }, 430);
  };

  const handleBubblePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = longPressStartRef.current;
    if (!start) return;
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (dist > 10) {
      cancelLongPress();
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    setReactMsgId(null);
    setActiveMenuMsgId(null);
    const targetMsg = messagesRef.current.find((m) => m.id === messageId);
    if (!targetMsg || targetMsg.deletedForEveryone) return;

    const prevReactions = targetMsg.reactions;
    const currentUserEmojis = prevReactions
      .filter((r) => r.userIds.includes(currentUserId))
      .map((r) => r.emoji);
    const alreadyHas = currentUserEmojis.includes(emoji);
    const nextUserEmojis = alreadyHas
      ? currentUserEmojis.filter((e) => e !== emoji)
      : [...currentUserEmojis, emoji];

    // Optimistic UI update
    const optimisticReactions: MessageReactionItem[] = prevReactions
      .map((r) => {
        if (r.emoji !== emoji) return r;
        const nextUsers = alreadyHas
          ? r.userIds.filter((id) => id !== currentUserId)
          : Array.from(new Set([...r.userIds, currentUserId]));
        return { ...r, userIds: nextUsers, count: nextUsers.length };
      })
      .filter((r) => r.count > 0);
    if (!alreadyHas && !optimisticReactions.some((r) => r.emoji === emoji)) {
      optimisticReactions.push({ emoji, userIds: [currentUserId], count: 1 });
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions: optimisticReactions } : m))
    );
    playMagicalSound('reaction', soundPrefsRef.current.soundPack, soundPrefsRef.current.soundEnabled);
    if (!prefersReducedMotion && !alreadyHas) {
      setReactionBurst({ key: `${messageId}:${emoji}`, ts: Date.now() });
    }

    try {
      let bodyPayload: Record<string, unknown>;
      if (nextUserEmojis.length === 0) {
        bodyPayload = { remove: true };
      } else if (conversation.type === 'private') {
        const recipients: Array<{ userId: string; ecdhPublicJwk: string }> = [
          { userId: currentUserId, ecdhPublicJwk: JSON.stringify(myKeys.ecdhPublicJwk) },
        ];
        if (conversation.peerUser?.ecdhPublicJwk) {
          recipients.push({
            userId: conversation.peerUser.id,
            ecdhPublicJwk: conversation.peerUser.ecdhPublicJwk,
          });
        }
        bodyPayload = await encryptMessageReaction({
          conversationId: conversation.id,
          messageId,
          userId: currentUserId,
          emojis: nextUserEmojis,
          recipients,
        });
      } else {
        const currentEpoch = groupDetailsRef.current?.currentEpoch || conversation.currentEpoch || 1;
        let epochKey = epochKeysRef.current.get(currentEpoch);
        if (!epochKey) {
          await loadGroupEpochKeys();
          epochKey = epochKeysRef.current.get(currentEpoch);
        }
        if (!epochKey) {
          throw new Error('Missing group epoch encryption key.');
        }
        bodyPayload = await encryptMessageReaction({
          conversationId: conversation.id,
          messageId,
          userId: currentUserId,
          emojis: nextUserEmojis,
          groupEpochKeyRaw: epochKey,
          groupEpoch: currentEpoch,
        });
      }

      const res = await apiRequest<{
        reactions: MessageReactionItem[];
        encryptedReactions?: EncryptedMessageReaction[];
      }>(`/api/v1/conversations/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
      });

      const resolved = await resolveMessageReactions(
        messageId,
        res.reactions || [],
        res.encryptedReactions
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: resolved, encryptedReactions: res.encryptedReactions || [] }
            : m
        )
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions: prevReactions } : m))
      );
      setErrorBanner(err instanceof Error ? err.message : 'Failed to send encrypted reaction.');
    }
  };

  const togglePin = async (msg: MessageRecord) => {
    setActiveMenuMsgId(null);
    await apiRequest(`/api/v1/conversations/messages/${msg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPinned: !msg.isPinned }),
    }).catch(() => {});
  };

  const deleteMessage = async (msgId: string, scope: 'delete_for_me' | 'delete_for_everyone') => {
    setActiveMenuMsgId(null);
    await apiRequest(`/api/v1/conversations/messages/${msgId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: scope }),
    });
    if (scope === 'delete_for_me') {
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    }
  };

  const updateDisappearing = async (seconds: number) => {
    setShowTimerMenu(false);
    await apiRequest(`/api/v1/conversations/${conversation.id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ disappearingSeconds: seconds }),
    });
    onConversationUpdated();
  };

  const toggleMuteOrArchive = async (patch: { muted?: boolean; archived?: boolean }) => {
    setShowHeaderMenu(false);
    await apiRequest(`/api/v1/conversations/${conversation.id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    onConversationUpdated();
  };

  const handleBlockPeer = async () => {
    if (!conversation.peerUser) return;
    setShowHeaderMenu(false);
    await apiRequest(`/api/v1/users/${conversation.peerUser.id}/block`, { method: 'POST' });
    onConversationUpdated();
    onBackMobile?.();
  };

  const handleReportPeer = async () => {
    if (!conversation.peerUser) return;
    setShowHeaderMenu(false);
    await apiRequest(`/api/v1/users/${conversation.peerUser.id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Inappropriate behavior' }),
    });
    setErrorBanner('Report submitted for review.');
  };

  const pinnedMessages = useMemo(() => messages.filter((m) => m.isPinned && !m.deletedForEveryone), [messages]);
  const visibleMessages = useMemo(() => {
    if (!showSearch || !searchQuery.trim()) return messages;
    const q = searchQuery.trim().toLowerCase();
    return messages.filter((m) => (m.localDecrypted?.text || '').toLowerCase().includes(q));
  }, [messages, showSearch, searchQuery]);

  const activeTyping = Object.values(typingUsers).some(Boolean);
  const timerLabel =
    DISAPPEARING_OPTIONS.find((o) => o.seconds === conversation.disappearingSeconds)?.label || 'Off';

  return (
    <motion.div
      key={conversation.id}
      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.968, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.98 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full w-full overflow-hidden relative"
    >
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Conversation Header */}
        <header className="relative overflow-hidden px-4 sm:px-6 py-3 border-b border-white/10 bg-[#0b0f1f]/80 backdrop-blur-md flex items-center justify-between gap-3 shrink-0">
          {!prefersReducedMotion && (
            <motion.div
              key={`aurora-${conversation.id}`}
              initial={{ x: '-100%', opacity: 0.65 }}
              animate={{ x: '120%', opacity: 0 }}
              transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-violet-500/20 to-cyan-400/15"
            />
          )}
          <div className="flex items-center gap-3 min-w-0 relative z-10">
            {onBackMobile && (
              <button
                type="button"
                onClick={onBackMobile}
                aria-label="Back to conversations"
                className="md:hidden p-2 -ml-2 text-slate-300 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <Avatar
              src={conversation.avatarUrl}
              name={conversation.title}
              size="md"
              isOnline={conversation.peerUser?.isOnline}
              isGroup={conversation.type === 'group'}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-display font-semibold text-white truncate">
                  {conversation.title}
                </h2>
                <StreakCounter streak={liveStreak} variant="header" />
              </div>
              <div className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                {activeTyping ? (
                  <span className="text-cyan-300 font-medium">Typing...</span>
                ) : (
                  <>
                    <span>{conversation.subtitle}</span>
                    <span aria-hidden="true">·</span>
                    <EncryptionShieldBadge
                      conversationId={conversation.id}
                      isGroup={conversation.type === 'group'}
                      peerId={conversation.peerUser?.id}
                      peerFingerprint={conversation.peerUser?.fingerprint}
                      hasKeyMaterial={
                        conversation.type === 'private'
                          ? Boolean(conversation.peerUser?.ecdhPublicJwk)
                          : Boolean(groupDetails?.currentEpoch || conversation.currentEpoch)
                      }
                      onClickVerify={
                        conversation.type === 'private' && conversation.peerUser
                          ? () => setShowSafetyModal(true)
                          : undefined
                      }
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 relative">
            <button
              type="button"
              onClick={() => setShowSearch((s) => !s)}
              title="Search in conversation"
              aria-label="Search in conversation"
              className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                showSearch ? 'bg-violet-600/25 text-violet-200' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTimerMenu((v) => !v)}
                title="Disappearing messages timer"
                aria-label="Disappearing messages timer"
                className={`min-h-[40px] px-2.5 rounded-xl flex items-center gap-1.5 text-xs transition-colors cursor-pointer ${
                  conversation.disappearingSeconds > 0
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Timer className="w-4 h-4" />
                {conversation.disappearingSeconds > 0 && <span className="font-mono-tabular">{timerLabel}</span>}
              </button>

              {showTimerMenu && (
                <div className="absolute right-0 mt-2 w-64 nexora-glass rounded-xl p-3 shadow-2xl z-30 space-y-2">
                  <div className="text-xs font-medium text-white">Disappearing Messages</div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Expired messages are permanently removed from the server. Recipients can still screenshot or capture messages before expiration.
                  </p>
                  <div className="space-y-1 pt-1">
                    {DISAPPEARING_OPTIONS.map((opt) => (
                      <button
                        key={opt.seconds}
                        type="button"
                        onClick={() => updateDisappearing(opt.seconds)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                          conversation.disappearingSeconds === opt.seconds
                            ? 'bg-violet-600 text-white'
                            : 'text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {conversation.type === 'private' && conversation.peerUser && (
              <button
                type="button"
                onClick={() => setShowSafetyModal(true)}
                title="Verify encryption safety number"
                aria-label="Verify encryption safety number"
                className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-cyan-300 hover:bg-white/5 flex items-center justify-center transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
              </button>
            )}

            {conversation.type === 'group' && (
              <button
                type="button"
                onClick={() => setShowGroupDrawer((v) => !v)}
                title="Group information"
                aria-label="Group information"
                className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                  showGroupDrawer ? 'bg-violet-600/25 text-violet-200' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Info className="w-4 h-4" />
              </button>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowHeaderMenu((v) => !v)}
                aria-label="More conversation actions"
                className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center transition-colors cursor-pointer"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showHeaderMenu && (
                <div className="absolute right-0 mt-2 w-48 nexora-glass rounded-xl p-1.5 shadow-2xl z-30 space-y-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => toggleMuteOrArchive({ muted: !conversation.muted })}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-200 hover:bg-white/5 cursor-pointer"
                  >
                    <BellOff className="w-3.5 h-3.5" />
                    <span>{conversation.muted ? 'Unmute conversation' : 'Mute conversation'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMuteOrArchive({ archived: !conversation.archived })}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-200 hover:bg-white/5 cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>{conversation.archived ? 'Unarchive' : 'Archive conversation'}</span>
                  </button>
                  {conversation.type === 'private' && conversation.peerUser && (
                    <>
                      <button
                        type="button"
                        onClick={handleBlockPeer}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <ShieldBan className="w-3.5 h-3.5" />
                        <span>Block user</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleReportPeer}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        <span>Report user</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Search in chat bar */}
        {showSearch && (
          <div className="px-4 py-2 border-b border-white/10 bg-slate-900/70 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search decrypted messages in this chat..."
              className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
              }}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Pinned message banner */}
        {pinnedMessages.length > 0 && (
          <div className="px-4 py-2 border-b border-white/10 bg-violet-950/35 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Pin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-slate-300 truncate">
                Pinned: {pinnedMessages[pinnedMessages.length - 1].localDecrypted?.text || 'Encrypted attachment'}
              </span>
            </div>
            <span className="text-[11px] font-mono-tabular text-slate-400 shrink-0">
              {pinnedMessages.length} pinned
            </span>
          </div>
        )}

        {errorBanner && (
          <div className="mx-4 mt-2 rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-200 flex items-center justify-between">
            <span>{errorBanner}</span>
            <button type="button" onClick={() => setErrorBanner(null)} className="p-1 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Message List */}
        <LayoutGroup id={`chat-messages-${conversation.id}`}>
          <div className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
            {hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => messages[0] && loadMessages(messages[0].createdAt)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                >
                  {loadingMore ? 'Loading...' : 'Load earlier messages'}
                </button>
              </div>
            )}

            {loading ? (
              <CosmicLoader
                label="Decrypting conversation..."
                sublabel="Verifying keys & loading end-to-end encrypted messages"
              />
            ) : (
              <AnimatePresence initial={false} mode="popLayout">
                {visibleMessages.length === 0 && !activeTyping ? (
                  <motion.div
                    key="empty-channel-state"
                    initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.2 }}
                    className="h-full flex flex-col items-center justify-center text-center py-12 space-y-3"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-violet-600/15 border border-violet-500/25 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-violet-300" />
                    </div>
                    <div className="text-sm font-medium text-white">End-to-end encrypted channel ready</div>
                    <p className="text-xs text-slate-400 max-w-xs">
                      Messages, photos, videos, and voice notes are encrypted on your device with AES-256-GCM before leaving your browser.
                    </p>
                  </motion.div>
                ) : null}
                {visibleMessages.map((msg, idx) => {
                  const isMine = msg.senderId === currentUserId;
                  const dec = msg.localDecrypted;
                  const isLiveArrival = liveArrivalIds.has(msg.id);
                  const placeTrayBelow = idx === 0;

                  return (
                    <motion.div
                      key={msg.id}
                      layout={prefersReducedMotion ? false : 'position'}
                      initial={
                        prefersReducedMotion
                          ? false
                          : {
                              opacity: 0,
                              x: isMine ? 22 : -22,
                              y: 18,
                              scale: 0.92,
                              filter: 'blur(4px)',
                            }
                      }
                      animate={{
                        opacity: 1,
                        x: 0,
                        y: 0,
                        scale: 1,
                        filter: 'blur(0px)',
                      }}
                      exit={
                        prefersReducedMotion
                          ? undefined
                          : {
                              opacity: 0,
                              scale: 0.9,
                              y: -8,
                              filter: 'blur(4px)',
                              transition: { duration: 0.18, ease: 'easeOut' },
                            }
                      }
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : {
                              layout: { type: 'spring', stiffness: 360, damping: 30, mass: 0.85 },
                              opacity: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                              filter: { duration: 0.28 },
                              default: { type: 'spring', stiffness: 380, damping: 26, mass: 0.8 },
                            }
                      }
                      style={{ transformOrigin: isMine ? 'bottom right' : 'bottom left' }}
                      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} group relative ${
                        reactMsgId === msg.id || activeMenuMsgId === msg.id ? 'z-30' : ''
                      }`}
                    >
                      {conversation.type === 'group' && !isMine && (
                        <span className="text-[11px] text-slate-400 ml-1 mb-1">
                          @{msg.senderUsername}
                        </span>
                      )}

                      <div className={`relative flex items-end gap-2 max-w-[85%] sm:max-w-[70%] ${isMine ? 'flex-row-reverse' : ''}`}>
                        <AnimatePresence>
                          {reactMsgId === msg.id && !msg.deletedForEveryone && (
                            <motion.div
                              data-reaction-tray="true"
                              initial={
                                prefersReducedMotion
                                  ? false
                                  : { opacity: 0, y: placeTrayBelow ? -8 : 8, scale: 0.92 }
                              }
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={
                                prefersReducedMotion
                                  ? undefined
                                  : { opacity: 0, y: placeTrayBelow ? -6 : 6, scale: 0.94 }
                              }
                              transition={{ type: 'spring', stiffness: 460, damping: 28 }}
                              className={`absolute ${
                                placeTrayBelow ? 'top-full mt-2' : 'bottom-full mb-2'
                              } ${
                                isMine ? 'right-0' : 'left-0'
                              } nexora-glass rounded-2xl px-2 py-1.5 flex items-center gap-1 z-30 shadow-[0_12px_32px_rgba(3,7,18,0.65)] border border-violet-400/30`}
                            >
                              {REACTION_EMOJIS.map((em) => {
                                const isSelected = msg.reactions.some(
                                  (r) => r.emoji === em && r.userIds.includes(currentUserId)
                                );
                                return (
                                  <motion.button
                                    key={em}
                                    type="button"
                                    whileTap={prefersReducedMotion ? undefined : { scale: 0.85 }}
                                    whileHover={prefersReducedMotion ? undefined : { scale: 1.18, y: -2 }}
                                    onClick={() => toggleReaction(msg.id, em)}
                                    aria-label={`React with ${em}`}
                                    aria-pressed={isSelected}
                                    className={`w-8 h-8 rounded-xl text-base flex items-center justify-center transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'bg-violet-500/35 ring-1 ring-violet-300/60 shadow-[0_0_10px_rgba(139,92,246,0.35)]'
                                        : 'hover:bg-white/10'
                                    }`}
                                  >
                                    {em}
                                  </motion.button>
                                );
                              })}
                              <span
                                title="Reactions are end-to-end encrypted"
                                aria-label="End-to-end encrypted reactions"
                                className="pl-1 pr-0.5 text-cyan-300/80 flex items-center"
                              >
                                <Lock className="w-3 h-3" />
                              </span>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div
                          data-cursor-interactive={msg.deletedForEveryone ? undefined : 'true'}
                          onPointerDown={(e) => handleBubblePointerDown(e, msg)}
                          onPointerMove={handleBubblePointerMove}
                          onPointerUp={cancelLongPress}
                          onPointerCancel={cancelLongPress}
                          onContextMenu={(e) => {
                            if (msg.deletedForEveryone) return;
                            if ((e.target as HTMLElement | null)?.closest('a, input')) return;
                            e.preventDefault();
                            cancelLongPress();
                            setActiveMenuMsgId(null);
                            setReactMsgId((cur) => (cur === msg.id ? null : msg.id));
                          }}
                          title={msg.deletedForEveryone ? undefined : 'Long-press or click smile to add an encrypted reaction'}
                          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed relative overflow-hidden transition-[box-shadow,transform] duration-150 select-none sm:select-text touch-pan-y ${
                            msg.deletedForEveryone
                              ? 'bg-slate-900/60 border border-white/10 text-slate-500 italic'
                              : isMine
                              ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-sm'
                              : 'bg-[#141a33] border border-white/10 text-slate-100'
                          } ${
                            pressingMsgId === msg.id
                              ? 'scale-[0.97] ring-2 ring-cyan-400/60 shadow-[0_0_20px_rgba(34,211,238,0.28)]'
                              : replyTarget?.id === msg.id
                              ? 'ring-2 ring-violet-400/65 shadow-[0_0_18px_rgba(139,92,246,0.28)]'
                              : msg.isPinned && !msg.deletedForEveryone
                              ? 'ring-1 ring-cyan-400/45 shadow-[0_0_16px_rgba(34,211,238,0.16)]'
                              : ''
                          }`}
                        >
                          {(isLiveArrival || lastConfirmedMsgId === msg.id) &&
                            !prefersReducedMotion &&
                            !msg.deletedForEveryone && (
                              <motion.span
                                initial={{ x: '-120%', opacity: 0.8 }}
                                animate={{ x: '140%', opacity: 0 }}
                                transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
                                aria-hidden="true"
                                className={`pointer-events-none absolute inset-y-0 w-2/3 bg-gradient-to-r from-transparent ${
                                  isMine ? 'via-white/30' : 'via-cyan-300/25'
                                } to-transparent`}
                              />
                            )}
                      {msg.forwardedFromId && !msg.deletedForEveryone && (
                        <div className="text-[11px] opacity-75 inline-flex items-center gap-1 mb-1">
                          <Forward className="w-3 h-3" />
                          <span>Forwarded</span>
                        </div>
                      )}

                      {dec?.replyToId && !msg.deletedForEveryone && (
                        <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-black/25 border border-white/10 text-xs">
                          <div className="font-medium opacity-85">{dec.replySenderName || 'Reply'}</div>
                          <div className="opacity-70 truncate max-w-[220px]">{dec.replyPreview}</div>
                        </div>
                      )}

                      {msg.deletedForEveryone ? (
                        <span>This message was deleted</span>
                      ) : (
                        <div className="space-y-2">
                          {msg.attachmentId && dec && (
                            <EncryptedMediaRenderer
                              attachmentId={msg.attachmentId}
                              kind={msg.kind}
                              payload={dec}
                              isMine={isMine}
                              onOpenLightbox={(url, mimeType, fileName) =>
                                setLightbox({ url, mimeType, fileName })
                              }
                            />
                          )}
                          {dec?.text && <div className="whitespace-pre-wrap break-words">{dec.text}</div>}
                        </div>
                      )}

                      <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[10px] opacity-75 font-mono-tabular">
                        {msg.isPinned && <Pin className="w-2.5 h-2.5" />}
                        {msg.expiresAt && <Timer className="w-2.5 h-2.5 text-cyan-300" />}
                        {msg.isEdited && <span>Edited</span>}
                        <span>
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {isMine && (
                          <span
                            className="inline-flex items-center gap-0.5"
                            title={
                              msg.status === 'read'
                                ? msg.verifiedRead
                                  ? `Read · Cryptographically signed & verified${
                                      msg.verifiedReadAt
                                        ? ` (${new Date(msg.verifiedReadAt).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })})`
                                        : ''
                                    }`
                                  : 'Read'
                                : msg.status === 'delivered'
                                ? 'Delivered'
                                : msg.status === 'sent'
                                ? 'Sent'
                                : msg.status === 'sending'
                                ? 'Encrypting & sending'
                                : 'Failed'
                            }
                            aria-label={
                              msg.status === 'read'
                                ? msg.verifiedRead
                                  ? 'Read and cryptographically verified'
                                  : 'Read'
                                : `Status: ${msg.status}`
                            }
                          >
                            {msg.status === 'sending' && <Clock className="w-3 h-3" />}
                            {msg.status === 'sent' && <Check className="w-3 h-3 text-slate-200/80" />}
                            {msg.status === 'delivered' && (
                              <CheckCheck className="w-3.5 h-3.5 text-slate-200/85" />
                            )}
                            {msg.status === 'read' && (
                              <motion.span
                                initial={prefersReducedMotion ? false : { scale: 0.75, opacity: 0.6 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: 'spring', stiffness: 460, damping: 22 }}
                                className="inline-flex items-center"
                              >
                                <CheckCheck
                                  className={`w-3.5 h-3.5 text-cyan-300 ${
                                    msg.verifiedRead
                                      ? 'drop-shadow-[0_0_6px_rgba(34,211,238,0.7)]'
                                      : ''
                                  }`}
                                />
                              </motion.span>
                            )}
                            {msg.status === 'failed' && <DeliveryWarningIcon />}
                          </span>
                        )}
                      </div>
                    </div>

                    {!msg.deletedForEveryone && (
                      <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5">
                        <button
                          type="button"
                          data-reaction-trigger="true"
                          onClick={() => {
                            setActiveMenuMsgId(null);
                            setReactMsgId(reactMsgId === msg.id ? null : msg.id);
                          }}
                          aria-label="React to message"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          data-reaction-trigger="true"
                          onClick={() => {
                            setReactMsgId(null);
                            setActiveMenuMsgId(activeMenuMsgId === msg.id ? null : msg.id);
                          }}
                          aria-label="Message options"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>

                        {activeMenuMsgId === msg.id && (
                          <div className="absolute bottom-8 right-0 w-44 nexora-glass rounded-xl p-1.5 z-20 shadow-2xl text-xs space-y-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setReplyTarget(msg);
                                setEditTarget(null);
                                setActiveMenuMsgId(null);
                              }}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/5 cursor-pointer"
                            >
                              <Reply className="w-3.5 h-3.5" />
                              <span>Reply</span>
                            </button>
                            {dec?.text && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(dec.text);
                                  setActiveMenuMsgId(null);
                                }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/5 cursor-pointer"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy text</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setForwardTarget(msg);
                                setActiveMenuMsgId(null);
                              }}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/5 cursor-pointer"
                            >
                              <Forward className="w-3.5 h-3.5" />
                              <span>Forward</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => togglePin(msg)}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/5 cursor-pointer"
                            >
                              <Pin className="w-3.5 h-3.5" />
                              <span>{msg.isPinned ? 'Unpin' : 'Pin message'}</span>
                            </button>
                            {isMine && msg.kind === 'text' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditTarget(msg);
                                  setReplyTarget(null);
                                  setText(dec?.text || '');
                                  setActiveMenuMsgId(null);
                                }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/5 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteMessage(msg.id, 'delete_for_me')}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-300 hover:bg-white/5 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete for me</span>
                            </button>
                            {isMine && (
                              <button
                                type="button"
                                onClick={() => deleteMessage(msg.id, 'delete_for_everyone')}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete for everyone</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {msg.reactions.length > 0 && (
                    <motion.div
                      layout={!prefersReducedMotion}
                      className="flex flex-wrap gap-1 mt-1 px-1"
                    >
                      {msg.reactions.map((r) => (
                        <motion.button
                          key={r.emoji}
                          layout={!prefersReducedMotion}
                          initial={prefersReducedMotion ? false : { scale: 0.7, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
                          transition={{ type: 'spring', stiffness: 450, damping: 24 }}
                          type="button"
                          onClick={() => toggleReaction(msg.id, r.emoji)}
                          className={`relative px-2 py-0.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                            r.userIds.includes(currentUserId)
                              ? 'bg-violet-600/30 border-violet-400/50 text-white shadow-[0_0_10px_rgba(139,92,246,0.22)]'
                              : 'bg-slate-900/80 border-white/10 text-slate-300'
                          }`}
                        >
                          {r.emoji} <span className="font-mono-tabular text-[11px]">{r.count}</span>
                          <ReactionParticleBurst
                            burstKey={
                              reactionBurst?.key === `${msg.id}:${r.emoji}` ? reactionBurst.ts : null
                            }
                          />
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </motion.div>
                  );
                })}
                {activeTyping && (
                  <motion.div
                    key="typing-indicator-bubble"
                    layout={prefersReducedMotion ? false : 'position'}
                    initial={prefersReducedMotion ? false : { opacity: 0, x: -16, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.88, y: 6 }}
                    transition={
                      prefersReducedMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 380, damping: 26 }
                    }
                    className="flex items-start"
                  >
                    <div className="rounded-2xl px-3.5 py-2.5 bg-[#141a33]/90 border border-cyan-400/20 inline-flex items-center gap-1.5">
                      {[0, 1, 2].map((dot) => (
                        <motion.span
                          key={dot}
                          animate={
                            prefersReducedMotion
                              ? undefined
                              : { y: [0, -4, 0], opacity: [0.45, 1, 0.45] }
                          }
                          transition={{
                            duration: 0.9,
                            repeat: Infinity,
                            delay: dot * 0.16,
                            ease: 'easeInOut',
                          }}
                          className="w-1.5 h-1.5 rounded-full bg-cyan-300"
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
            <div ref={bottomRef} />
          </div>
        </LayoutGroup>

        {/* Composer */}
        <footer className="relative px-4 sm:px-6 py-3 border-t border-white/10 bg-[#0b0f1f]/85 backdrop-blur-md space-y-2 shrink-0">
          <AnimatePresence>
            {uploadProgress && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: 4 }}
                className="space-y-1.5"
              >
                <div className="text-xs text-cyan-300 flex items-center gap-2">
                  <FileUp className="w-3.5 h-3.5 animate-pulse" />
                  <span>{uploadProgress}</span>
                </div>
                <div className="h-1 w-full rounded-full bg-slate-800/80 overflow-hidden">
                  <motion.div
                    initial={{ x: '-100%' }}
                    animate={prefersReducedMotion ? { x: '0%' } : { x: ['-60%', '100%'] }}
                    transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                    className="h-full w-1/2 rounded-full bg-gradient-to-r from-violet-500 via-cyan-400 to-violet-500"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {(replyTarget || editTarget) && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-900/90 border border-violet-500/35 text-xs shadow-[0_0_16px_rgba(124,58,237,0.16)]"
              >
                <div className="min-w-0">
                  <div className="font-medium text-violet-300">
                    {editTarget ? 'Editing encrypted message' : `Replying to ${replyTarget?.senderDisplayName}`}
                  </div>
                  <div className="text-slate-400 truncate">
                    {(editTarget || replyTarget)?.localDecrypted?.text || 'Attachment'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReplyTarget(null);
                    setEditTarget(null);
                    setText('');
                  }}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSendText} className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.txt,.zip"
              onChange={handleFilePicked}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach encrypted photo, video, or file"
              aria-label="Attach media or document"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-slate-800/75 hover:bg-slate-700 border border-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <input
              type="text"
              value={text}
              onChange={(e) => handleTypingChange(e.target.value)}
              placeholder={editTarget ? 'Update message...' : 'Write an encrypted message...'}
              className="flex-1 h-10 px-4 rounded-xl bg-slate-900/85 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
            />

            {text.trim() ? (
              <div className="relative shrink-0">
                {sendConfirmBurstKey && !prefersReducedMotion && (
                  <motion.span
                    key={sendConfirmBurstKey}
                    initial={{ scale: 0.7, opacity: 0.75 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-xl border border-cyan-300/80"
                  />
                )}
                <motion.button
                  type="submit"
                  disabled={sending}
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.94 }}
                  aria-label="Send encrypted message"
                  className="relative z-10 min-h-[40px] px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-1.5 shadow-[0_0_16px_rgba(124,58,237,0.3)] transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">{editTarget ? 'Save' : 'Send'}</span>
                </motion.button>
              </div>
            ) : (
              <div className="relative shrink-0">
                {sendConfirmBurstKey && !prefersReducedMotion && (
                  <motion.span
                    key={sendConfirmBurstKey}
                    initial={{ scale: 0.7, opacity: 0.75 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-xl border border-cyan-300/80"
                  />
                )}
                <VoiceRecorder onSendVoice={handleSendVoice} disabled={Boolean(uploadProgress)} />
              </div>
            )}
          </form>
        </footer>
      </div>

      {showGroupDrawer && conversation.type === 'group' && conversation.groupId && (
        <GroupInfoDrawer
          groupId={conversation.groupId}
          currentUserId={currentUserId}
          myKeys={myKeys}
          messages={messages}
          onClose={() => setShowGroupDrawer(false)}
          onRefresh={() => {
            loadGroupEpochKeys();
            onConversationUpdated();
          }}
          onLeftOrDeleted={() => {
            setShowGroupDrawer(false);
            onConversationUpdated();
            onBackMobile?.();
          }}
        />
      )}

      <AnimatePresence>
        {lightbox && (
          <MediaLightbox
            url={lightbox.url}
            mimeType={lightbox.mimeType}
            fileName={lightbox.fileName}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>

      {showSafetyModal && conversation.peerUser && (
        <SafetyNumberModal
          myPublicJwk={JSON.stringify(myKeys.ecdhPublicJwk)}
          peer={conversation.peerUser}
          onClose={() => setShowSafetyModal(false)}
        />
      )}

      {forwardTarget && (
        <ForwardModal
          conversations={allConversations.filter((c) => c.id !== conversation.id)}
          onSelectConversation={handleForwardTo}
          onClose={() => setForwardTarget(null)}
        />
      )}
    </motion.div>
  );
}
