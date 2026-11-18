import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    uid: text('uid').unique(),
    username: text('username').notNull(),
    usernameNormalized: text('username_normalized').notNull().unique(),
    displayName: text('display_name').notNull(),
    emailHash: text('email_hash').notNull().unique(),
    emailMasked: text('email_masked').notNull(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    bio: text('bio').notNull().default(''),
    statusText: text('status_text').notNull().default('Encrypted on NEXORA'),
    lastSeenAt: text('last_seen_at'),
    usernameChangedAt: text('username_changed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_users_username_norm').on(table.usernameNormalized)]
);

export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: text('id').primaryKey(),
    emailNormalized: text('email_normalized').notNull(),
    purpose: text('purpose').notNull(),
    otpHash: text('otp_hash').notNull(),
    salt: text('salt').notNull(),
    attempts: integer('attempts').notNull().default(0),
    verified: integer('verified').notNull().default(0),
    verificationTokenHash: text('verification_token_hash'),
    expiresAt: text('expires_at').notNull(),
    resendAvailableAt: text('resend_available_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_email_verifications_lookup').on(
      table.emailNormalized,
      table.purpose,
      table.createdAt
    ),
  ]
);

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name').notNull(),
  platform: text('platform').notNull(),
  lastActiveAt: text('last_active_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent').notNull().default(''),
    ipAddress: text('ip_address').notNull().default(''),
    lastActiveAt: text('last_active_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_user_sessions_user').on(table.userId)]
);

export const identityKeys = pgTable('identity_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull(),
  ecdhPublicJwk: text('ecdh_public_jwk').notNull(),
  ecdsaPublicJwk: text('ecdsa_public_jwk').notNull(),
  encryptedKeyBackup: text('encrypted_key_backup'),
  backupSalt: text('backup_salt'),
  backupIv: text('backup_iv'),
  fingerprint: text('fingerprint').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const preKeys = pgTable('pre_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  keyId: integer('key_id').notNull(),
  publicJwk: text('public_jwk').notNull(),
  signature: text('signature').notNull(),
  isOneTime: integer('is_one_time').notNull().default(1),
  consumed: integer('consumed').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const privacySettings = pgTable('privacy_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  showOnlineStatus: integer('show_online_status').notNull().default(1),
  showReadReceipts: integer('show_read_receipts').notNull().default(1),
  allowChatRequests: integer('allow_chat_requests').notNull().default(1),
  storyDefaultVisibility: text('story_default_visibility').notNull().default('friends'),
  allowDiscoveryByUsername: integer('allow_discovery_by_username').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const friendRequests = pgTable(
  'friend_requests',
  {
    id: text('id').primaryKey(),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    receiverId: text('receiver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_friend_requests_pair').on(table.senderId, table.receiverId)]
);

export const friendships = pgTable(
  'friendships',
  {
    id: text('id').primaryKey(),
    userAId: text('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: text('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_friendships_pair').on(table.userAId, table.userBId)]
);

export const userBlocks = pgTable(
  'user_blocks',
  {
    id: text('id').primaryKey(),
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_user_blocks_pair').on(table.blockerId, table.blockedId)]
);

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reportedUserId: text('reported_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  details: text('details').notNull().default(''),
  createdAt: text('created_at').notNull(),
});

export const streaks = pgTable(
  'streaks',
  {
    id: text('id').primaryKey(),
    userAId: text('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: text('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    streakCount: integer('streak_count').notNull().default(0),
    userALastActivityAt: text('user_a_last_activity_at'),
    userBLastActivityAt: text('user_b_last_activity_at'),
    lastCycleAt: text('last_cycle_at'),
    expiresAt: text('expires_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_streaks_pair').on(table.userAId, table.userBId)]
);

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatarUrl: text('avatar_url'),
  privacy: text('privacy').notNull().default('private'),
  maxMembers: integer('max_members').notNull().default(25),
  creatorId: text('creator_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  currentEpoch: integer('current_epoch').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    joinedEpoch: integer('joined_epoch').notNull().default(1),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [
    index('idx_group_members_group').on(table.groupId),
    uniqueIndex('idx_group_members_unique').on(table.groupId, table.userId),
  ]
);

export const groupEncryptionStates = pgTable(
  'group_encryption_states',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderUserId: text('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ephemeralPublicJwk: text('ephemeral_public_jwk').notNull(),
    wrappedEpochKey: text('wrapped_epoch_key').notNull(),
    iv: text('iv').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_group_enc_state_unique').on(table.groupId, table.epoch, table.userId),
  ]
);

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  groupId: text('group_id')
    .unique()
    .references(() => groups.id, { onDelete: 'cascade' }),
  privatePairKey: text('private_pair_key').unique(),
  disappearingSeconds: integer('disappearing_seconds').notNull().default(0),
  lastMessageAt: text('last_message_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    muted: integer('muted').notNull().default(0),
    archived: integer('archived').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    lastReadAt: text('last_read_at'),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [
    index('idx_conv_participants_user').on(table.userId),
    uniqueIndex('idx_conv_participants_unique').on(table.conversationId, table.userId),
  ]
);

export const messageAttachments = pgTable('message_attachments', {
  id: text('id').primaryKey(),
  uploaderId: text('uploader_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').references(() => conversations.id, {
    onDelete: 'cascade',
  }),
  storyId: text('story_id'),
  mimeType: text('mime_type').notNull(),
  originalSize: integer('original_size').notNull(),
  encryptedSize: integer('encrypted_size').notNull(),
  storagePath: text('storage_path').notNull(),
  sha256Ciphertext: text('sha256_ciphertext').notNull(),
  durationMs: integer('duration_ms'),
  width: integer('width'),
  height: integer('height'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at'),
});

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    replyToId: text('reply_to_id'),
    forwardedFromId: text('forwarded_from_id'),
    kind: text('kind').notNull().default('text'),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    aad: text('aad').notNull(),
    recipientEnvelopesJson: text('recipient_envelopes_json'),
    epoch: integer('epoch'),
    attachmentId: text('attachment_id').references(() => messageAttachments.id, {
      onDelete: 'set null',
    }),
    isPinned: integer('is_pinned').notNull().default(0),
    isEdited: integer('is_edited').notNull().default(0),
    deletedForEveryone: integer('deleted_for_everyone').notNull().default(0),
    deletedForUsersJson: text('deleted_for_users_json').notNull().default('[]'),
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_messages_conv_time').on(table.conversationId, table.createdAt)]
);

export const messageReceipts = pgTable(
  'message_receipts',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('sent'),
    signature: text('signature'),
    signedAt: text('signed_at'),
    encryptedPayloadJson: text('encrypted_payload_json'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_message_receipts_unique').on(table.messageId, table.userId)]
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_message_reactions_unique').on(table.messageId, table.userId, table.emoji),
  ]
);

export const stories = pgTable(
  'stories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaType: text('media_type').notNull(),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => messageAttachments.id, { onDelete: 'cascade' }),
    ciphertextMeta: text('ciphertext_meta').notNull(),
    iv: text('iv').notNull(),
    recipientEnvelopesJson: text('recipient_envelopes_json').notNull(),
    visibility: text('visibility').notNull().default('friends'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_stories_expires').on(table.expiresAt)]
);

export const storyViews = pgTable(
  'story_views',
  {
    id: text('id').primaryKey(),
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    viewerId: text('viewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: text('viewed_at').notNull(),
  },
  (table) => [uniqueIndex('idx_story_views_unique').on(table.storyId, table.viewerId)]
);

export const storyReactions = pgTable(
  'story_reactions',
  {
    id: text('id').primaryKey(),
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_story_reactions_unique').on(table.storyId, table.userId)]
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    entityId: text('entity_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    isRead: integer('is_read').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_notifications_user').on(table.userId, table.createdAt)]
);

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(userSessions),
  devices: many(devices),
  identityKey: one(identityKeys, {
    fields: [users.id],
    references: [identityKeys.userId],
  }),
  privacySetting: one(privacySettings, {
    fields: [users.id],
    references: [privacySettings.userId],
  }),
  notifications: many(notifications),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
  receipts: many(messageReceipts),
  reactions: many(messageReactions),
}));
