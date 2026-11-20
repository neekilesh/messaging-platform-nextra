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

export interface StreakInfo {
  streakCount: number;
  expiresAt: string | null;
  expiringSoon: boolean;
  isActive: boolean;
  milestoneReached: number | null;
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
  streak: StreakInfo | null;
  lastMessage: MessageRecord | null;
  lastMessageAt: string | null;
  myEpochEnvelopes?: GroupEpochEnvelope[];
}

export interface FriendItem {
  friendshipId: string;
  user: PublicUser;
  streak: StreakInfo;
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
