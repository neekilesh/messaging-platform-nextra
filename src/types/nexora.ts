export type MessageKind = 'text' | 'image' | 'video' | 'voice' | 'file' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type GroupRole = 'owner' | 'admin' | 'member';

export type StoryVisibility = 'friends' | 'close_friends';

export type DisappearingInterval = 0 | 10 | 60 | 3600 | 86400 | 604800 | 2592000;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  statusText: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  ecdhPublicJwk: string | null;
  ecdsaPublicJwk: string | null;
  fingerprint: string | null;
}

export type NexoraThemeId =
  | 'cosmic-purple'
  | 'mystic-blue'
  | 'aurora-dream'
  | 'dark-nebula'
  | 'celestial-gold'
  | 'custom-nebula';

export interface CustomNebulaConfig {
  primaryColor: string;
  accentColor: string;
  gradientStart: string;
  gradientEnd: string;
  baseColor: string;
  angle: number;
}

export interface UserThemePreferences {
  theme: NexoraThemeId;
  customNebula: CustomNebulaConfig;
  reduceEffects?: boolean;
  soundEnabled?: boolean;
  soundPack?: 'celestial' | 'deep-space' | 'minimal';
}

export interface AuthUser extends PublicUser {
  maskedEmail: string;
  createdAt: string;
  themePreferences?: UserThemePreferences | null;
}

export interface EncryptedKeyBackup {
  encryptedPrivateKey: string;
  salt: string;
  iv: string;
  ecdhPublicJwk: string;
  ecdsaPublicJwk: string;
  fingerprint: string;
}

export interface PrivacySettings {
  showOnlineStatus: boolean;
  showReadReceipts: boolean;
  allowChatRequests: boolean;
  storyDefaultVisibility: StoryVisibility;
  allowDiscoveryByUsername: boolean;
  allowConnectionGameNotifications?: boolean;
}

export interface DeviceSession {
  id: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  ipAddress: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface RecipientEnvelope {
  ephemeralPublicJwk: string;
  wrappedKey: string;
  iv: string;
}

export interface DecryptedMessagePayload {
  text: string;
  replyToId?: string | null;
  replyPreview?: string | null;
  replySenderName?: string | null;
  mediaKey?: string | null;
  mediaIv?: string | null;
  mediaHash?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  durationMs?: number | null;
  originalSize?: number | null;
  waveform?: number[] | null;
  systemEvent?: string | null;
}

export interface MessageReactionItem {
  emoji: string;
  userIds: string[];
  count: number;
}

export interface EncryptedMessageReaction {
  userId: string;
  ciphertext: string;
  iv: string;
  aad: string;
  recipientEnvelopes: Record<string, RecipientEnvelope> | null;
  epoch: number | null;
  createdAt: string;
}

export interface SignedEncryptedReadReceipt {
  messageId: string;
  readerId: string;
  viewedAt: string;
  signature: string;
  ciphertext?: string | null;
  iv?: string | null;
  aad?: string | null;
  recipientEnvelopes?: Record<string, RecipientEnvelope> | null;
  epoch?: number | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarUrl: string | null;
  replyToId: string | null;
  forwardedFromId: string | null;
  kind: MessageKind;
  ciphertext: string;
  iv: string;
  aad: string;
  recipientEnvelopes: Record<string, RecipientEnvelope> | null;
  epoch: number | null;
  attachmentId: string | null;
  isPinned: boolean;
  isEdited: boolean;
  deletedForEveryone: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: MessageStatus;
  reactions: MessageReactionItem[];
  encryptedReactions?: EncryptedMessageReaction[];
  readReceipts?: SignedEncryptedReadReceipt[];
  verifiedRead?: boolean;
  verifiedReadAt?: string | null;
  localDecrypted?: DecryptedMessagePayload | null;
  localStatus?: MessageStatus;
}

export interface GroupMemberInfo {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: GroupRole;
  joinedEpoch: number;
  joinedAt: string;
  isOnline: boolean;
  ecdhPublicJwk: string | null;
  ecdsaPublicJwk?: string | null;
  fingerprint: string | null;
}

export interface GroupEpochEnvelope {
  epoch: number;
  senderUserId: string;
  ephemeralPublicJwk: string;
  wrappedEpochKey: string;
  iv: string;
}

export interface GroupDetails {
  id: string;
  conversationId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  privacy: 'private' | 'invite_only';
  maxMembers: number;
  creatorId: string;
  currentEpoch: number;
  memberCount: number;
  members: GroupMemberInfo[];
  myEpochEnvelopes: GroupEpochEnvelope[];
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  type: 'private' | 'group';
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  peerUser: PublicUser | null;
  groupId: string | null;
  groupMemberCount: number | null;
  groupMaxMembers: number | null;
  currentEpoch: number | null;
  disappearingSeconds: number;
  muted: boolean;
  archived: boolean;
  unreadCount: number;
  lastMessage: MessageRecord | null;
  lastMessageAt: string | null;
  myEpochEnvelopes?: GroupEpochEnvelope[];
}

export interface FriendItem {
  friendshipId: string;
  user: PublicUser;
  conversationId: string | null;
  createdAt: string;
}

export interface FriendRequestItem {
  id: string;
  sender: PublicUser;
  receiver: PublicUser;
  status: 'pending' | 'accepted' | 'rejected';
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

export interface StoryRecord {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  mediaType: 'image' | 'video';
  attachmentId: string;
  ciphertextMeta: string;
  iv: string;
  recipientEnvelopes: Record<string, RecipientEnvelope>;
  visibility: StoryVisibility;
  expiresAt: string;
  createdAt: string;
  viewedByMe: boolean;
  viewCount: number;
  viewers?: Array<{
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    viewedAt: string;
  }>;
  reactions: Array<{
    userId: string;
    username: string;
    emoji: string;
    createdAt: string;
  }>;
}

export interface NotificationItem {
  id: string;
  type: string;
  actorId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
  entityId: string | null;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface DeepTalkCategory {
  id: string;
  name: string;
  questionCount: number;
}

export interface DeepTalkQuestion {
  id: string;
  categoryId: string;
  categoryName: string;
  questionText: string;
  sortOrder: number;
}

export interface ConnectionGameReaction {
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface EncryptedConnectionAnswer {
  id: string;
  userId: string;
  ciphertext: string;
  iv: string;
  aad: string;
  recipientEnvelopes: Record<string, RecipientEnvelope>;
  reactions: ConnectionGameReaction[];
  replyMessageId: string | null;
  submittedAt: string;
  localText?: string;
}

export type DeepTalkSessionStatus =
  | 'invited'
  | 'active'
  | 'paused'
  | 'declined'
  | 'ended'
  | 'completed';

export interface DeepTalkQuestionState {
  questionIndex: number;
  question: DeepTalkQuestion;
  myAnswered: boolean;
  peerAnswered: boolean;
  bothAnswered: boolean;
  revealed: boolean;
  skipped: boolean;
  answers: EncryptedConnectionAnswer[];
}

export interface DeepTalkSession {
  id: string;
  conversationId: string;
  initiatorId: string;
  peerId: string;
  categoryId: string;
  categoryName: string;
  questionLimit: number | null;
  status: DeepTalkSessionStatus;
  currentQuestionIndex: number;
  totalLoadedQuestions: number;
  readyUserIds: string[];
  skippedQuestionIds: string[];
  revealedQuestionIds: string[];
  pausedByUserId: string | null;
  endedByUserId: string | null;
  currentCard: DeepTalkQuestionState | null;
  revealedHistory: DeepTalkQuestionState[];
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export type DailyChallengeUserState =
  | 'new_challenge'
  | 'waiting_for_you'
  | 'waiting_for_friend'
  | 'both_completed'
  | 'skipped'
  | 'missed'
  | 'expired';

export interface DailyChallengePrompt {
  id: string;
  categoryId: string;
  categoryName: string;
  promptText: string;
  symbolKey: string;
}

export interface DailyChallengeAssignment {
  id: string;
  conversationId: string;
  challengeDate: string;
  timezone: string;
  lifecycleStatus: 'pending' | 'both_completed' | 'skipped' | 'expired';
  userState: DailyChallengeUserState;
  expiresAt: string;
  completedAt: string | null;
  skippedByUserId: string | null;
  challenge: DailyChallengePrompt;
  myResponded: boolean;
  peerResponded: boolean;
  revealed: boolean;
  responses: EncryptedConnectionAnswer[];
  createdAt: string;
  updatedAt: string;
}

export interface DailyConnectionStreak {
  currentStreak: number;
  longestStreak: number;
  totalCompleted: number;
  lastCompletedDate: string | null;
  milestoneReached: number | null;
  nextMilestone: number | null;
}

export interface ConnectionGamesOverview {
  conversationId: string;
  timezone: string;
  todayDate: string;
  categories: DeepTalkCategory[];
  activeDeepTalkSession: DeepTalkSession | null;
  pastDeepTalkSessions: DeepTalkSession[];
  todayChallenge: DailyChallengeAssignment | null;
  challengeHistory: DailyChallengeAssignment[];
  connectionStreak: DailyConnectionStreak;
}
