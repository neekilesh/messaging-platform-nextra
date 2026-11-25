import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Bell,
  CircleDot,
  Lock,
  MapPin,
  MessageCircle,
  Search,
  Settings,
  Sparkles,
  User,
  Users,
  X,
} from 'lucide-react';
import { globalSoundManager } from './audio/GlobalSoundManager';
import { apiRequest, getStoredToken, setStoredToken } from './lib/api';
import {
  decryptGroupMessage,
  decryptPrivateMessage,
  loadLocalKeyBundle,
  unwrapGroupEpochKey,
  type StoredLocalKeyBundle,
} from './lib/crypto';
import { connectSocket, disconnectSocket } from './lib/socket';
import { useVisualPrefs } from './lib/theme';
import type {
  AuthUser,
  ConversationSummary,
  FriendItem,
  FriendRequestItem,
  NotificationItem,
  StoryRecord,
} from './types/nexora';
import { AuthFlow } from './components/auth/AuthFlow';
import { NexoraLogo } from './components/ui/NexoraLogo';
import { CosmicBackdrop } from './components/ui/CosmicBackdrop';
import {
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassInput,
  GlassNavigation,
  ProfileAvatar,
  type GlassNavItem,
} from './components/ui/LiquidGlass';
import { ConnectionStatusBanner, CosmicLoader } from './components/ui/MagicalEffects';
import { ConversationList } from './components/chat/ConversationList';
import { ChatWindow } from './components/chat/ChatWindow';
import { CreateGroupModal } from './components/group/CreateGroupModal';
import { StoriesStrip } from './components/stories/StoriesStrip';
import { StoriesDashboard } from './components/stories/StoriesDashboard';
import { CreateStoryModal } from './components/stories/CreateStoryModal';
import { StoryViewer } from './components/stories/StoryViewer';
import { PeoplePanel } from './components/social/PeoplePanel';
import { NotificationsPanel } from './components/social/NotificationsPanel';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { AiStudioHub } from './components/ai/AiStudioHub';
import { MapsExplorerPanel } from './components/maps/MapsExplorerPanel';

type NavTab =
  | 'chats'
  | 'stories'
  | 'people'
  | 'notifications'
  | 'settings'
  | 'ai'
  | 'maps';

export default function App() {
  const { effectiveReducedMotion } = useVisualPrefs();
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [myKeys, setMyKeys] = useState<StoredLocalKeyBundle | null>(null);

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [socketStatus, setSocketStatus] = useState<'connected' | 'connecting' | 'disconnected'>(
    'connecting'
  );

  const [navTab, setNavTab] = useState<NavTab>('chats');
  const [chatFilter, setChatFilter] = useState<'all' | 'groups' | 'archived'>('all');
  const [homeSearch, setHomeSearch] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const conversationsRef = useRef<ConversationSummary[]>([]);
  conversationsRef.current = conversations;

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;
  const prevActiveConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeConversationId && activeConversationId !== prevActiveConversationIdRef.current) {
      globalSoundManager.playChatOpen();
    } else if (!activeConversationId && prevActiveConversationIdRef.current) {
      globalSoundManager.playChatClose();
    }
    prevActiveConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([]);
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [storyViewerIndex, setStoryViewerIndex] = useState<number | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const switchNavTab = useCallback(
    (next: NavTab) => {
      if (next !== navTab) {
        globalSoundManager.playTabSwitch();
      }
      setNavTab(next);
      if (next === 'chats') {
        setChatFilter('all');
      }
    },
    [navTab]
  );

  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const decryptConversationLastMessages = useCallback(
    async (list: ConversationSummary[], currentUserId: string, keys: StoredLocalKeyBundle) => {
      return Promise.all(
        list.map(async (conv) => {
          if (!conv.lastMessage || conv.lastMessage.deletedForEveryone) return conv;
          try {
            if (conv.type === 'private') {
              const myEnv = conv.lastMessage.recipientEnvelopes?.[currentUserId];
              if (!myEnv) return conv;
              const dec = await decryptPrivateMessage(
                conv.lastMessage.ciphertext,
                conv.lastMessage.iv,
                conv.lastMessage.aad,
                myEnv,
                keys.ecdhPrivateJwk
              );
              return { ...conv, lastMessage: { ...conv.lastMessage, localDecrypted: dec } };
            } else if (conv.myEpochEnvelopes && conv.lastMessage.epoch) {
              const env = conv.myEpochEnvelopes.find((e) => e.epoch === conv.lastMessage?.epoch);
              if (!env) return conv;
              const epochKey = await unwrapGroupEpochKey(env, keys.ecdhPrivateJwk);
              const dec = await decryptGroupMessage(
                conv.lastMessage.ciphertext,
                conv.lastMessage.iv,
                conv.lastMessage.aad,
                epochKey
              );
              return { ...conv, lastMessage: { ...conv.lastMessage, localDecrypted: dec } };
            }
          } catch {
            // fallback cleanly
          }
          return conv;
        })
      );
    },
    []
  );

  const loadWorkspaceData = useCallback(
    async (currentUser: AuthUser, keys: StoredLocalKeyBundle) => {
      const [convRes, friendsRes, reqRes, storiesRes, notifRes] = await Promise.all([
        apiRequest<{ conversations: ConversationSummary[] }>('/api/v1/conversations'),
        apiRequest<{ friends: FriendItem[] }>('/api/v1/friends'),
        apiRequest<{ requests: FriendRequestItem[] }>('/api/v1/friends/requests'),
        apiRequest<{ stories: StoryRecord[] }>('/api/v1/stories'),
        apiRequest<{ notifications: NotificationItem[] }>('/api/v1/notifications'),
      ]);

      const hydratedConvs = await decryptConversationLastMessages(
        convRes.conversations,
        currentUser.id,
        keys
      );
      setConversations(hydratedConvs);
      setFriends(friendsRes.friends);
      setFriendRequests(reqRes.requests);
      setStories(storiesRes.stories);
      setNotifications(notifRes.notifications);
    },
    [decryptConversationLastMessages]
  );

  // Restore session on startup
  useEffect(() => {
    async function restore() {
      const token = getStoredToken();
      if (!token) {
        setBooting(false);
        return;
      }
      try {
        const res = await apiRequest<{ user: AuthUser }>('/api/v1/auth/me');
        const keys = await loadLocalKeyBundle(res.user.id);
        if (!keys) {
          setStoredToken(null);
          setBooting(false);
          return;
        }
        setUser(res.user);
        setMyKeys(keys);
        await loadWorkspaceData(res.user, keys);
      } catch {
        setStoredToken(null);
      } finally {
        setBooting(false);
      }
    }
    restore();
  }, [loadWorkspaceData]);

  // Real-time Socket.IO connection & updates
  useEffect(() => {
    if (!user || !myKeys) return;
    const sock = connectSocket();
    if (!sock) return;

    setSocketStatus(sock.connected ? 'connected' : 'connecting');

    const handleConnect = () => setSocketStatus('connected');
    const handleDisconnect = () => setSocketStatus('disconnected');
    const handleConnectError = () => setSocketStatus('disconnected');
    const handleReconnectAttempt = () => setSocketStatus('connecting');

    const refreshAll = () => {
      loadWorkspaceData(user, myKeys).catch(() => {});
    };

    const handlePresence = (data: { userId: string; isOnline: boolean; lastSeenAt: string }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.peerUser && c.peerUser.id === data.userId
            ? { ...c, peerUser: { ...c.peerUser, isOnline: data.isOnline, lastSeenAt: data.lastSeenAt } }
            : c
        )
      );
      setFriends((prev) =>
        prev.map((f) =>
          f.user.id === data.userId
            ? { ...f, user: { ...f.user, isOnline: data.isOnline, lastSeenAt: data.lastSeenAt } }
            : f
        )
      );
    };

    const handleIncomingMessageEvent = (data?: {
      conversationId?: string;
      message?: { senderId?: string };
    }) => {
      if (
        data?.message?.senderId &&
        data.message.senderId !== user.id &&
        data.conversationId !== activeConversationIdRef.current
      ) {
        const conv = conversationsRef.current.find((c) => c.id === data.conversationId);
        if (conv?.type === 'group') {
          globalSoundManager.playNotificationGroup();
        } else {
          globalSoundManager.playNotificationPrivate();
        }
      }
      refreshAll();
    };

    const handleFriendRequestEvent = () => {
      globalSoundManager.playFriendRequest();
      refreshAll();
    };

    const handleFriendAcceptedEvent = () => {
      globalSoundManager.playFriendAccepted();
      refreshAll();
    };

    const handleStoryNewEvent = () => {
      globalSoundManager.playStoryNew();
      refreshAll();
    };

    const handleNotificationEvent = () => {
      globalSoundManager.playNotificationPrivate();
      refreshAll();
    };

    sock.on('connect', handleConnect);
    sock.on('disconnect', handleDisconnect);
    sock.on('connect_error', handleConnectError);
    sock.io.on('reconnect_attempt', handleReconnectAttempt);
    sock.on('presence:update', handlePresence);
    sock.on('message:new', handleIncomingMessageEvent);
    sock.on('conversation:new', refreshAll);
    sock.on('conversation:updated', refreshAll);
    sock.on('group:created', refreshAll);
    sock.on('group:updated', refreshAll);
    sock.on('group:removed', refreshAll);
    sock.on('group:deleted', refreshAll);
    sock.on('friend:request', handleFriendRequestEvent);
    sock.on('friend:accepted', handleFriendAcceptedEvent);
    sock.on('story:new', handleStoryNewEvent);
    sock.on('notification:new', handleNotificationEvent);

    return () => {
      sock.off('connect', handleConnect);
      sock.off('disconnect', handleDisconnect);
      sock.off('connect_error', handleConnectError);
      sock.io.off('reconnect_attempt', handleReconnectAttempt);
      sock.off('presence:update', handlePresence);
      sock.off('message:new', handleIncomingMessageEvent);
      sock.off('conversation:new', refreshAll);
      sock.off('conversation:updated', refreshAll);
      sock.off('group:created', refreshAll);
      sock.off('group:updated', refreshAll);
      sock.off('group:removed', refreshAll);
      sock.off('group:deleted', refreshAll);
      sock.off('friend:request', handleFriendRequestEvent);
      sock.off('friend:accepted', handleFriendAcceptedEvent);
      sock.off('story:new', handleStoryNewEvent);
      sock.off('notification:new', handleNotificationEvent);
    };
  }, [user, myKeys, loadWorkspaceData]);

  const handleAuthenticated = async (authUser: AuthUser, keys: StoredLocalKeyBundle) => {
    globalSoundManager.playSettingsSaved();
    setWorkspaceError(null);
    setUser(authUser);
    setMyKeys(keys);
    try {
      await loadWorkspaceData(authUser, keys);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Unable to load workspace conversations right now.'
      );
    }
  };

  const handleLogout = async () => {
    globalSoundManager.playLogout();
    await apiRequest('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    disconnectSocket();
    setStoredToken(null);
    setUser(null);
    setMyKeys(null);
    setActiveConversationId(null);
    setWorkspaceError(null);
  };

  const handleStartPrivateChat = async (peerUserId: string) => {
    if (!user || !myKeys) return;
    setWorkspaceError(null);
    try {
      const res = await apiRequest<{ conversationId: string }>('/api/v1/conversations/private', {
        method: 'POST',
        body: JSON.stringify({ userId: peerUserId }),
      });
      await loadWorkspaceData(user, myKeys);
      setNavTab('chats');
      setChatFilter('all');
      setActiveConversationId(res.conversationId);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Unable to start private conversation.'
      );
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen w-full nexora-cosmos flex items-center justify-center relative overflow-hidden">
        <CosmicBackdrop />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <NexoraLogo size={54} />
          <CosmicLoader
            label="Unlocking encrypted workspace..."
            sublabel="Restoring local E2EE keys & verifying session"
          />
        </div>
      </div>
    );
  }

  if (!user || !myKeys) {
    return <AuthFlow onAuthenticated={handleAuthenticated} />;
  }

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const unreadNotifs = notifications.filter((n) => !n.isRead).length;
  const pendingReqCount = friendRequests.filter((r) => r.direction === 'incoming').length;
  const totalUnreadMsgs = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  // 5 Primary Liquid Glass Destinations
  const primaryNavItems: GlassNavItem[] = [
    { id: 'chats', label: 'Chats', icon: MessageCircle, badge: totalUnreadMsgs },
    { id: 'stories', label: 'Stories', icon: CircleDot },
    { id: 'people', label: 'Friends', icon: Users, badge: pendingReqCount },
    { id: 'notifications', label: 'Activity', icon: Bell, badge: unreadNotifs },
    { id: 'settings', label: 'Profile', icon: User },
  ];

  // Secondary integrated modules for Desktop dock & Profile quick access
  const exploreNavItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'ai', label: 'AI Studio', icon: Sparkles },
    { id: 'maps', label: 'Maps', icon: MapPin },
  ];

  const isChatView = navTab === 'chats';

  return (
    <div className="h-screen w-screen overflow-hidden nexora-cosmos flex flex-col md:flex-row relative">
      <CosmicBackdrop />
      <ConnectionStatusBanner isOnline={isOnline} socketStatus={socketStatus} />

      {workspaceError && (
        <div
          role="alert"
          className="fixed top-3 left-1/2 -translate-x-1/2 w-[94%] max-w-xl z-50 nexora-glass-elevated rounded-2xl border border-rose-500/40 bg-rose-500/12 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-200"
        >
          <span className="truncate">{workspaceError}</span>
          <button
            type="button"
            onClick={() => setWorkspaceError(null)}
            className="font-semibold hover:underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {mapsQuotaExceeded && (
        <div
          role="alert"
          className="fixed top-3 left-1/2 -translate-x-1/2 w-[94%] max-w-2xl z-50 nexora-glass rounded-2xl border border-amber-500/40 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-100"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
            <span>
              The free Google Maps demo key reached its quota limit. Configure your own Google Cloud API key to continue uninterrupted.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-amber-700 dark:text-amber-300 underline hover:opacity-80"
            >
              Learn more
            </a>
            <button
              type="button"
              onClick={() => setMapsQuotaExceeded(false)}
              className="font-medium hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Desktop Floating Liquid Glass Navigation Rail */}
      <aside className="relative z-20 hidden md:flex p-3 pr-0 shrink-0">
        <div className="w-[82px] nexora-glass-dock rounded-[30px] flex flex-col items-center justify-between py-4 px-2">
          <div className="relative z-10 flex flex-col items-center gap-4 w-full">
            <button
              type="button"
              onClick={() => switchNavTab('chats')}
              aria-label="NEXORA Home"
              className="cursor-pointer transition-transform active:scale-95"
            >
              <NexoraLogo size={36} />
            </button>

            <nav aria-label="Primary navigation" className="flex flex-col items-center gap-1.5 w-full">
              {primaryNavItems.map((item) => {
                const Icon = item.icon;
                const active = navTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => switchNavTab(item.id as NavTab)}
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={`relative w-full py-2 rounded-[16px] flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                      active
                        ? 'text-violet-950 dark:text-white'
                        : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-surface-hover)]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={effectiveReducedMotion ? undefined : 'desktop-nav-pill'}
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-[16px] bg-white/70 dark:bg-gradient-to-b dark:from-white/[0.18] dark:to-white/[0.06] border border-white/85 dark:border-white/[0.18] shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_4px_12px_rgba(40,30,90,0.08)]"
                      />
                    )}
                    <Icon
                      className={`w-[18px] h-[18px] relative z-10 ${
                        active ? 'text-violet-600 dark:text-violet-200' : ''
                      }`}
                    />
                    <span className="text-[10px] font-medium relative z-10">{item.label}</span>
                    {item.badge && item.badge > 0 ? (
                      <span className="absolute top-1 right-2 z-10 min-w-[16px] h-4 px-1 rounded-full bg-[#7c5cf6] text-white text-[10px] font-mono-tabular font-semibold flex items-center justify-center shadow-sm">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="w-8 h-px bg-[var(--nx-hairline)] my-0.5" />

            <div className="flex flex-col items-center gap-1 w-full">
              {exploreNavItems.map((item) => {
                const Icon = item.icon;
                const active = navTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => switchNavTab(item.id)}
                    title={item.label}
                    className={`relative w-full py-1.5 rounded-[14px] flex flex-col items-center gap-0.5 transition-colors cursor-pointer ${
                      active
                        ? 'text-violet-700 dark:text-sky-200 bg-white/65 dark:bg-white/[0.12]'
                        : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-surface-hover)]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[9px] font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => switchNavTab('settings')}
            title={`@${user.username}`}
            className="relative z-10 cursor-pointer transition-transform active:scale-95"
          >
            <ProfileAvatar src={user.avatarUrl} name={user.displayName} size="sm" isOnline />
          </button>
        </div>
      </aside>

      {/* Main Responsive Workspace */}
      <main className="relative z-10 flex-1 flex min-w-0 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={navTab}
            initial={effectiveReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={effectiveReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: effectiveReducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`flex-1 flex min-w-0 min-h-0 ${
              isChatView && activeConversation ? 'pb-0' : 'pb-22 md:pb-0'
            }`}
          >
            {isChatView ? (
              <>
                {/* Home / Messaging Dashboard Column */}
                <section
                  className={`w-full md:w-[372px] lg:w-[412px] md:my-3 md:ml-3 md:rounded-[28px] overflow-hidden md:nexora-glass-subtle flex flex-col shrink-0 ${
                    activeConversation ? 'hidden md:flex' : 'flex'
                  }`}
                >
                  {/* Top Liquid Glass Header with Avatar, Greeting, Search & Settings */}
                  <GlassHeader variant="hero" className="pt-safe">
                    <div className="relative z-10 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => switchNavTab('settings')}
                          aria-label="Open profile"
                          className="cursor-pointer transition-transform active:scale-95 shrink-0"
                        >
                          <ProfileAvatar
                            src={user.avatarUrl}
                            name={user.displayName}
                            size="md"
                            isOnline
                            cosmicRing
                          />
                        </button>
                        <div className="space-y-0.5 min-w-0">
                          <div className="text-[11px] font-medium text-violet-700 dark:text-violet-200/85 tracking-wide truncate">
                            NEXORA · @{user.username}
                          </div>
                          <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[var(--nx-text-primary)] truncate">
                            Let&apos;s Stay Connected
                          </h1>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => switchNavTab('settings')}
                        aria-label="Open profile and settings"
                        title="Profile & Settings"
                        className="min-h-[44px] min-w-[44px] rounded-full bg-white/55 hover:bg-white/75 dark:bg-white/[0.1] dark:hover:bg-white/[0.18] border border-white/75 dark:border-white/[0.16] flex items-center justify-center text-[var(--nx-text-primary)] transition-colors cursor-pointer shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.45)]"
                      >
                        <Settings className="w-[18px] h-[18px]" />
                      </button>
                    </div>

                    <div className="relative z-10 mt-3.5">
                      <GlassInput
                        type="text"
                        value={homeSearch}
                        onChange={(e) => setHomeSearch(e.target.value)}
                        placeholder="Search messages or @handles..."
                        aria-label="Search conversations"
                        leadingIcon={<Search className="w-4 h-4" />}
                        trailingAction={
                          homeSearch ? (
                            <button
                              type="button"
                              onClick={() => setHomeSearch('')}
                              aria-label="Clear search"
                              className="p-1.5 rounded-full text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : undefined
                        }
                      />
                    </div>
                  </GlassHeader>

                  {/* Horizontal Stories Section */}
                  <StoriesStrip
                    currentUser={user}
                    stories={stories}
                    onOpenCreate={() => {
                      globalSoundManager.playFeatureOpen();
                      setShowCreateStory(true);
                    }}
                    onOpenUserStories={(uid) => {
                      const idx = stories.findIndex((s) => s.userId === uid);
                      if (idx >= 0) {
                        globalSoundManager.playStoryOpen();
                        setStoryViewerIndex(idx);
                      }
                    }}
                  />

                  {/* Conversation List */}
                  <div className="flex-1 min-h-0">
                    <ConversationList
                      conversations={conversations}
                      activeId={activeConversationId}
                      searchQuery={homeSearch}
                      filterTab={chatFilter}
                      onFilterTabChange={setChatFilter}
                      onSelect={(conv) => setActiveConversationId(conv.id)}
                      onOpenCreateGroup={() => {
                        globalSoundManager.playFeatureOpen();
                        setShowCreateGroup(true);
                      }}
                      onOpenPeopleSearch={() => switchNavTab('people')}
                    />
                  </div>
                </section>

                {/* Active Luxury Chat Viewport */}
                <section
                  className={`flex-1 min-w-0 h-full ${
                    activeConversation ? 'flex' : 'hidden md:flex'
                  }`}
                >
                  <AnimatePresence mode="wait">
                    {activeConversation ? (
                      <ChatWindow
                        key={activeConversation.id}
                        conversation={activeConversation}
                        allConversations={conversations}
                        currentUserId={user.id}
                        currentUserDisplayName={user.displayName}
                        currentUserAvatar={user.avatarUrl}
                        myKeys={myKeys}
                        onBackMobile={() => setActiveConversationId(null)}
                        onConversationUpdated={() => loadWorkspaceData(user, myKeys)}
                      />
                    ) : (
                      <div className="flex-1 flex items-center justify-center p-8">
                        <GlassCard
                          intensity="medium"
                          padding="lg"
                          className="max-w-md w-full text-center space-y-5 rounded-[30px]"
                        >
                          <div className="relative z-10 mx-auto w-fit">
                            <NexoraLogo size={58} />
                          </div>
                          <div className="relative z-10 space-y-2">
                            <h2 className="text-xl font-display font-bold text-[var(--nx-text-primary)]">
                              Welcome, {user.displayName}
                            </h2>
                            <p className="text-sm text-[var(--nx-text-secondary)] leading-relaxed">
                              Choose an encrypted conversation on the left or find friends by @username to start messaging privately.
                            </p>
                          </div>
                          <div className="relative z-10 flex items-center justify-center gap-2.5 flex-wrap">
                            <GlassButton
                              type="button"
                              variant="primary"
                              onClick={() => switchNavTab('people')}
                            >
                              Find @username
                            </GlassButton>
                            <GlassButton
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                globalSoundManager.playFeatureOpen();
                                setShowCreateGroup(true);
                              }}
                            >
                              New Group
                            </GlassButton>
                          </div>
                          <div className="relative z-10 pt-3 border-t border-[var(--nx-hairline)] text-xs text-[var(--nx-text-secondary)] inline-flex items-center justify-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-violet-600 dark:text-sky-300" />
                            <span>
                              Key Fingerprint:{' '}
                              <span className="font-mono-tabular text-[var(--nx-text-primary)]">
                                {myKeys.fingerprint}
                              </span>
                            </span>
                          </div>
                        </GlassCard>
                      </div>
                    )}
                  </AnimatePresence>
                </section>
              </>
            ) : navTab === 'stories' ? (
              <StoriesDashboard
                currentUser={user}
                stories={stories}
                onOpenCreate={() => {
                  globalSoundManager.playFeatureOpen();
                  setShowCreateStory(true);
                }}
                onOpenStoryIndex={(idx) => {
                  globalSoundManager.playStoryOpen();
                  setStoryViewerIndex(idx);
                }}
              />
            ) : navTab === 'ai' ? (
              <AiStudioHub />
            ) : navTab === 'maps' ? (
              <MapsExplorerPanel />
            ) : navTab === 'people' ? (
              <PeoplePanel
                friends={friends}
                requests={friendRequests}
                onStartChat={handleStartPrivateChat}
                onRefresh={() => loadWorkspaceData(user, myKeys)}
              />
            ) : navTab === 'notifications' ? (
              <NotificationsPanel
                notifications={notifications}
                onRefresh={() => loadWorkspaceData(user, myKeys)}
              />
            ) : (
              <SettingsPanel
                user={user}
                myKeys={myKeys}
                friendsCount={friends.length}
                onOpenExplore={(target) => switchNavTab(target)}
                onUserUpdated={(updated) => setUser(updated)}
                onLogout={handleLogout}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Floating Pill Bottom Navigation (5 Core Destinations) */}
      {!(isChatView && activeConversation) && (
        <GlassNavigation
          items={primaryNavItems}
          activeId={navTab}
          onSelect={(id) => switchNavTab(id as NavTab)}
        />
      )}

      {/* Modals & Viewers */}
      {showCreateGroup && (
        <CreateGroupModal
          currentUserId={user.id}
          myKeys={myKeys}
          friends={friends.map((f) => f.user)}
          onCreated={async (convId) => {
            globalSoundManager.playGroupCreate();
            setShowCreateGroup(false);
            await loadWorkspaceData(user, myKeys);
            setNavTab('chats');
            setChatFilter('all');
            setActiveConversationId(convId);
          }}
          onClose={() => {
            globalSoundManager.playGlassClose();
            setShowCreateGroup(false);
          }}
        />
      )}

      {showCreateStory && (
        <CreateStoryModal
          currentUserId={user.id}
          myKeys={myKeys}
          friends={friends.map((f) => f.user)}
          onCreated={async () => {
            globalSoundManager.playStoryUpload();
            setShowCreateStory(false);
            await loadWorkspaceData(user, myKeys);
          }}
          onClose={() => {
            globalSoundManager.playGlassClose();
            setShowCreateStory(false);
          }}
        />
      )}

      <AnimatePresence>
        {storyViewerIndex !== null && (
          <StoryViewer
            stories={stories}
            initialIndex={storyViewerIndex}
            currentUserId={user.id}
            myKeys={myKeys}
            onClose={() => {
              globalSoundManager.playStoryClose();
              setStoryViewerIndex(null);
            }}
            onRefresh={() => loadWorkspaceData(user, myKeys)}
            onReplySent={(convId) => {
              setStoryViewerIndex(null);
              setNavTab('chats');
              setActiveConversationId(convId);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
