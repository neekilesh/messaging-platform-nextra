import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  CircleDot,
  Lock,
  MessageSquare,
  Settings,
  Users,
} from 'lucide-react';
import { apiRequest, getStoredToken, setStoredToken } from './lib/api';
import {
  decryptGroupMessage,
  decryptPrivateMessage,
  loadLocalKeyBundle,
  unwrapGroupEpochKey,
  type StoredLocalKeyBundle,
} from './lib/crypto';
import { connectSocket, disconnectSocket } from './lib/socket';
import { playMagicalSound } from './lib/audio';
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
import { Avatar } from './components/ui/Avatar';
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

type NavTab = 'chats' | 'groups' | 'stories' | 'people' | 'notifications' | 'settings';

export default function App() {
  const { effectiveReducedMotion, soundEnabled, soundPack } = useVisualPrefs();
  const soundPrefsRef = React.useRef({ soundEnabled, soundPack });
  soundPrefsRef.current = { soundEnabled, soundPack };
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = React.useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;
  const prevActiveConversationIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (activeConversationId && activeConversationId !== prevActiveConversationIdRef.current) {
      playMagicalSound(
        'portal-activation',
        soundPrefsRef.current.soundPack,
        soundPrefsRef.current.soundEnabled
      );
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

  const loadWorkspaceData = useCallback(async (currentUser: AuthUser, keys: StoredLocalKeyBundle) => {
    const [convRes, friendsRes, reqRes, storiesRes, notifRes] = await Promise.all([
      apiRequest<{ conversations: ConversationSummary[] }>('/api/v1/conversations'),
      apiRequest<{ friends: FriendItem[] }>('/api/v1/friends'),
      apiRequest<{ requests: FriendRequestItem[] }>('/api/v1/friends/requests'),
      apiRequest<{ stories: StoryRecord[] }>('/api/v1/stories'),
      apiRequest<{ notifications: NotificationItem[] }>('/api/v1/notifications'),
    ]);

    const hydratedConvs = await decryptConversationLastMessages(convRes.conversations, currentUser.id, keys);
    setConversations(hydratedConvs);
    setFriends(friendsRes.friends);
    setFriendRequests(reqRes.requests);
    setStories(storiesRes.stories);
    setNotifications(notifRes.notifications);
  }, [decryptConversationLastMessages]);

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
        playMagicalSound(
          'receive-message',
          soundPrefsRef.current.soundPack,
          soundPrefsRef.current.soundEnabled
        );
      }
      refreshAll();
    };

    const handleNotificationEvent = () => {
      playMagicalSound(
        'notification',
        soundPrefsRef.current.soundPack,
        soundPrefsRef.current.soundEnabled
      );
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
    sock.on('friend:request', handleNotificationEvent);
    sock.on('friend:accepted', handleNotificationEvent);
    sock.on('story:new', refreshAll);
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
      sock.off('friend:request', handleNotificationEvent);
      sock.off('friend:accepted', handleNotificationEvent);
      sock.off('story:new', refreshAll);
      sock.off('notification:new', handleNotificationEvent);
    };
  }, [user, myKeys, loadWorkspaceData]);

  const handleAuthenticated = async (authUser: AuthUser, keys: StoredLocalKeyBundle) => {
    setUser(authUser);
    setMyKeys(keys);
    await loadWorkspaceData(authUser, keys);
  };

  const handleLogout = async () => {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    disconnectSocket();
    setStoredToken(null);
    setUser(null);
    setMyKeys(null);
    setActiveConversationId(null);
  };

  const handleStartPrivateChat = async (peerUserId: string) => {
    if (!user || !myKeys) return;
    const res = await apiRequest<{ conversationId: string }>('/api/v1/conversations/private', {
      method: 'POST',
      body: JSON.stringify({ userId: peerUserId }),
    });
    await loadWorkspaceData(user, myKeys);
    setNavTab('chats');
    setChatFilter('all');
    setActiveConversationId(res.conversationId);
  };

  if (booting) {
    return (
      <div className="min-h-screen w-full nexora-cosmos flex items-center justify-center relative overflow-hidden">
        <CosmicBackdrop />
        <div className="relative z-10 flex flex-col items-center gap-2">
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

  const navItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    { id: 'chats', label: 'Chats', icon: MessageSquare, badge: totalUnreadMsgs },
    { id: 'groups', label: 'Groups', icon: Users },
    { id: 'stories', label: 'Stories', icon: CircleDot },
    { id: 'people', label: 'People', icon: Users, badge: pendingReqCount },
    { id: 'notifications', label: 'Alerts', icon: Bell, badge: unreadNotifs },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const isChatView = navTab === 'chats' || navTab === 'groups';
  const sectionKey = isChatView ? 'chats-groups' : navTab;

  return (
    <div className="h-screen w-screen overflow-hidden nexora-cosmos flex flex-col md:flex-row relative">
      <CosmicBackdrop />
      <ConnectionStatusBanner isOnline={isOnline} socketStatus={socketStatus} />

      {/* Desktop Left Navigation Rail */}
      <aside className="relative z-10 hidden md:flex w-[76px] border-r border-white/10 bg-[#090d1c]/85 backdrop-blur-xl flex-col items-center justify-between py-5 shrink-0">
        <div className="flex flex-col items-center gap-6 w-full">
          <button
            type="button"
            onClick={() => {
              setNavTab('chats');
              setChatFilter('all');
            }}
            aria-label="NEXORA Home"
            className="cursor-pointer"
          >
            <NexoraLogo size={38} />
          </button>

          <nav className="flex flex-col items-center gap-2 w-full px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = navTab === item.id;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  whileHover={effectiveReducedMotion ? undefined : { scale: 1.03 }}
                  whileTap={effectiveReducedMotion ? undefined : { scale: 0.94 }}
                  onClick={() => {
                    setNavTab(item.id);
                    if (item.id === 'chats') setChatFilter('all');
                    if (item.id === 'groups') setChatFilter('groups');
                  }}
                  title={item.label}
                  className={`relative w-full py-2.5 rounded-xl flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                    active ? 'text-cyan-300' : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={effectiveReducedMotion ? undefined : 'nav-rail-pill'}
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-violet-600/25 border border-violet-500/45 shadow-[0_0_18px_rgba(124,58,237,0.28)]"
                    />
                  )}
                  <Icon
                    className={`w-5 h-5 relative z-10 transition-all ${
                      active ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.65)]' : ''
                    }`}
                  />
                  <span className="text-[10px] font-medium relative z-10">{item.label}</span>
                  {item.badge && item.badge > 0 ? (
                    <span className="absolute top-1.5 right-2 z-10 min-w-[16px] h-4 px-1 rounded-full bg-violet-600 text-white text-[10px] font-mono-tabular flex items-center justify-center shadow-[0_0_8px_rgba(124,58,237,0.6)]">
                      {item.badge}
                    </span>
                  ) : null}
                </motion.button>
              );
            })}
          </nav>
        </div>

        <button
          type="button"
          onClick={() => setNavTab('settings')}
          title={`@${user.username}`}
          className="cursor-pointer"
        >
          <Avatar src={user.avatarUrl} name={user.displayName} size="sm" isOnline />
        </button>
      </aside>

      {/* Main Responsive Workspace with Portal Section Transitions */}
      <main className="relative z-10 flex-1 flex min-w-0 min-h-0 pb-16 md:pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={sectionKey}
            initial={
              effectiveReducedMotion
                ? false
                : { opacity: 0, scale: 0.985, filter: 'blur(4px)' }
            }
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={
              effectiveReducedMotion
                ? undefined
                : { opacity: 0, scale: 0.99, filter: 'blur(2px)' }
            }
            transition={{
              duration: effectiveReducedMotion ? 0 : 0.22,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="flex-1 flex min-w-0 min-h-0"
          >
            {isChatView ? (
              <>
                {/* Conversation List + Stories Strip */}
                <section
                  className={`w-full md:w-88 lg:w-96 border-r border-white/10 bg-[#0a0e1d]/80 backdrop-blur-md flex flex-col shrink-0 ${
                    activeConversation ? 'hidden md:flex' : 'flex'
                  }`}
                >
                  <StoriesStrip
                    currentUser={user}
                    stories={stories}
                    onOpenCreate={() => setShowCreateStory(true)}
                    onOpenUserStories={(uid) => {
                      const idx = stories.findIndex((s) => s.userId === uid);
                      if (idx >= 0) setStoryViewerIndex(idx);
                    }}
                  />
                  <div className="flex-1 min-h-0">
                    <ConversationList
                      conversations={conversations}
                      activeId={activeConversationId}
                      filterTab={chatFilter}
                      onFilterTabChange={setChatFilter}
                      onSelect={(conv) => setActiveConversationId(conv.id)}
                      onOpenCreateGroup={() => setShowCreateGroup(true)}
                      onOpenPeopleSearch={() => setNavTab('people')}
                    />
                  </div>
                </section>

                {/* Active Chat Viewport */}
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
                        myKeys={myKeys}
                        onBackMobile={() => setActiveConversationId(null)}
                        onConversationUpdated={() => loadWorkspaceData(user, myKeys)}
                      />
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-5">
                        <NexoraLogo size={64} />
                        <div className="space-y-2 max-w-md">
                          <h1 className="text-2xl font-display font-bold text-white">
                            Welcome, @{user.username}
                          </h1>
                          <p className="text-sm text-slate-400 leading-relaxed">
                            Select an encrypted conversation or search for friends by their @username to start messaging privately with real-time delivery, voice notes, stories, and streaks.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setNavTab('people')}
                            className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer shadow-[0_0_16px_rgba(124,58,237,0.3)] transition-colors"
                          >
                            Find @username
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowCreateGroup(true)}
                            className="h-10 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer transition-colors"
                          >
                            Create 25-Member Group
                          </button>
                        </div>
                        <div className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Identity Key Fingerprint: <span className="font-mono-tabular text-slate-400">{myKeys.fingerprint}</span></span>
                        </div>
                      </div>
                    )}
                  </AnimatePresence>
                </section>
              </>
            ) : navTab === 'stories' ? (
              <StoriesDashboard
                currentUser={user}
                stories={stories}
                onOpenCreate={() => setShowCreateStory(true)}
                onOpenStoryIndex={(idx) => setStoryViewerIndex(idx)}
              />
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
                onUserUpdated={(updated) => setUser(updated)}
                onLogout={handleLogout}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Tab Bar (Thumb-zone ergonomic, compact height) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-[#090d1c]/95 backdrop-blur-lg border-t border-white/10 grid grid-cols-5 items-center">
        {navItems
          .filter((n) => n.id !== 'groups')
          .map((item) => {
            const Icon = item.icon;
            const active = navTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setNavTab(item.id);
                  if (item.id === 'chats') setChatFilter('all');
                }}
                className={`relative flex flex-col items-center justify-center h-full gap-1 cursor-pointer transition-colors ${
                  active ? 'text-cyan-300' : 'text-slate-400'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={effectiveReducedMotion ? undefined : 'mobile-nav-pill'}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-x-2 inset-y-1.5 rounded-xl bg-violet-600/20 border border-violet-500/35 pointer-events-none"
                  />
                )}
                <Icon
                  className={`w-5 h-5 relative z-10 ${
                    active ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.65)]' : ''
                  }`}
                />
                <span className="text-[10px] font-medium relative z-10">{item.label}</span>
                {item.badge && item.badge > 0 ? (
                  <span className="absolute top-2 right-4 z-10 min-w-[15px] h-4 px-1 rounded-full bg-violet-600 text-white text-[9px] font-mono-tabular flex items-center justify-center">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
      </nav>

      {/* Modals & Viewers */}
      {showCreateGroup && (
        <CreateGroupModal
          currentUserId={user.id}
          myKeys={myKeys}
          friends={friends.map((f) => f.user)}
          onCreated={async (convId) => {
            setShowCreateGroup(false);
            await loadWorkspaceData(user, myKeys);
            setNavTab('chats');
            setChatFilter('all');
            setActiveConversationId(convId);
          }}
          onClose={() => setShowCreateGroup(false)}
        />
      )}

      {showCreateStory && (
        <CreateStoryModal
          currentUserId={user.id}
          myKeys={myKeys}
          friends={friends.map((f) => f.user)}
          onCreated={async () => {
            setShowCreateStory(false);
            await loadWorkspaceData(user, myKeys);
          }}
          onClose={() => setShowCreateStory(false)}
        />
      )}

      <AnimatePresence>
        {storyViewerIndex !== null && (
          <StoryViewer
            stories={stories}
            initialIndex={storyViewerIndex}
            currentUserId={user.id}
            myKeys={myKeys}
            onClose={() => setStoryViewerIndex(null)}
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
