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
    timezone: text('timezone').notNull().default('UTC'),
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
  allowConnectionGameNotifications: integer('allow_connection_game_notifications').notNull().default(1),
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
  chatThemeJson: text('chat_theme_json'),
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
    chatThemeJson: text('chat_theme_json'),
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
    ciphertext: text('ciphertext'),
    iv: text('iv'),
    aad: text('aad'),
    recipientEnvelopesJson: text('recipient_envelopes_json'),
    epoch: integer('epoch'),
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

export const aiThreads = pgTable(
  'ai_threads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    model: text('model').notNull(),
    persona: text('persona').notNull().default('General Assistant'),
    systemInstruction: text('system_instruction').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_ai_threads_user').on(table.userId, table.updatedAt)]
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => aiThreads.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    model: text('model').notNull(),
    groundingJson: text('grounding_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_ai_messages_thread').on(table.threadId, table.createdAt)]
);

export const aiArtifacts = pgTable(
  'ai_artifacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    model: text('model').notNull(),
    prompt: text('prompt').notNull(),
    mimeType: text('mime_type').notNull(),
    dataUrl: text('data_url').notNull(),
    metadataJson: text('metadata_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_ai_artifacts_user').on(table.userId, table.createdAt)]
);

export const gameScores = pgTable(
  'game_scores',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('arcade'),
    score: integer('score').notNull(),
    wave: integer('wave').notNull().default(1),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_game_scores_score').on(table.score)]
);

export const deepTalkQuestions = pgTable(
  'deep_talk_questions',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id').notNull(),
    categoryName: text('category_name').notNull(),
    questionText: text('question_text').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_deep_talk_q_cat').on(table.categoryId, table.isActive)]
);

export const deepTalkSessions = pgTable(
  'deep_talk_sessions',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    initiatorId: text('initiator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    peerId: text('peer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
    categoryName: text('category_name').notNull(),
    questionLimit: integer('question_limit'),
    status: text('status').notNull().default('invited'),
    questionIdsJson: text('question_ids_json').notNull().default('[]'),
    currentQuestionIndex: integer('current_question_index').notNull().default(0),
    currentQuestionId: text('current_question_id'),
    readyUserIdsJson: text('ready_user_ids_json').notNull().default('[]'),
    skippedQuestionIdsJson: text('skipped_question_ids_json').notNull().default('[]'),
    revealedQuestionIdsJson: text('revealed_question_ids_json').notNull().default('[]'),
    pausedByUserId: text('paused_by_user_id'),
    endedByUserId: text('ended_by_user_id'),
    lastActivityAt: text('last_activity_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_deep_talk_sessions_conv').on(table.conversationId, table.updatedAt),
    index('idx_deep_talk_sessions_status').on(table.conversationId, table.status),
  ]
);

export const deepTalkAnswers = pgTable(
  'deep_talk_answers',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => deepTalkSessions.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => deepTalkQuestions.id, { onDelete: 'cascade' }),
    questionIndex: integer('question_index').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    aad: text('aad').notNull(),
    recipientEnvelopesJson: text('recipient_envelopes_json').notNull(),
    reactionsJson: text('reactions_json').notNull().default('[]'),
    replyMessageId: text('reply_message_id'),
    submittedAt: text('submitted_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_deep_talk_answers_unique').on(table.sessionId, table.questionId, table.userId),
    index('idx_deep_talk_answers_session').on(table.sessionId, table.questionIndex),
    index('idx_deep_talk_answers_conv').on(table.conversationId, table.submittedAt),
  ]
);

export const dailyChallenges = pgTable(
  'daily_challenges',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id').notNull(),
    categoryName: text('category_name').notNull(),
    promptText: text('prompt_text').notNull(),
    symbolKey: text('symbol_key').notNull().default('sparkles'),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_daily_challenges_active').on(table.isActive, table.categoryId)]
);

export const dailyChallengeAssignments = pgTable(
  'daily_challenge_assignments',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    privatePairKey: text('private_pair_key').notNull(),
    challengeId: text('challenge_id')
      .notNull()
      .references(() => dailyChallenges.id, { onDelete: 'cascade' }),
    challengeDate: text('challenge_date').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    lifecycleStatus: text('lifecycle_status').notNull().default('pending'),
    expiresAt: text('expires_at').notNull(),
    completedAt: text('completed_at'),
    skippedByUserId: text('skipped_by_user_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_daily_challenge_conv_day').on(table.conversationId, table.challengeDate),
    index('idx_daily_challenge_conv_updated').on(table.conversationId, table.challengeDate),
  ]
);

export const dailyChallengeResponses = pgTable(
  'daily_challenge_responses',
  {
    id: text('id').primaryKey(),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => dailyChallengeAssignments.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    aad: text('aad').notNull(),
    recipientEnvelopesJson: text('recipient_envelopes_json').notNull(),
    reactionsJson: text('reactions_json').notNull().default('[]'),
    replyMessageId: text('reply_message_id'),
    submittedAt: text('submitted_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_daily_challenge_resp_unique').on(table.assignmentId, table.userId),
  ]
);

export const dailyConnectionStreaks = pgTable(
  'daily_connection_streaks',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .unique()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userAId: text('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: text('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    totalCompleted: integer('total_completed').notNull().default(0),
    lastCompletedDate: text('last_completed_date'),
    lastCelebratedMilestone: integer('last_celebrated_milestone').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_daily_conn_streak_pair').on(table.userAId, table.userBId)]
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

export const deepTalkQuestionsRelations = relations(deepTalkQuestions, ({ one, many }) => ({
  creator: one(users, {
    fields: [deepTalkQuestions.createdByUserId],
    references: [users.id],
  }),
  answers: many(deepTalkAnswers),
}));

export const deepTalkSessionsRelations = relations(deepTalkSessions, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [deepTalkSessions.conversationId],
    references: [conversations.id],
  }),
  initiator: one(users, {
    fields: [deepTalkSessions.initiatorId],
    references: [users.id],
  }),
  peer: one(users, {
    fields: [deepTalkSessions.peerId],
    references: [users.id],
  }),
  answers: many(deepTalkAnswers),
}));

export const deepTalkAnswersRelations = relations(deepTalkAnswers, ({ one }) => ({
  session: one(deepTalkSessions, {
    fields: [deepTalkAnswers.sessionId],
    references: [deepTalkSessions.id],
  }),
  conversation: one(conversations, {
    fields: [deepTalkAnswers.conversationId],
    references: [conversations.id],
  }),
  question: one(deepTalkQuestions, {
    fields: [deepTalkAnswers.questionId],
    references: [deepTalkQuestions.id],
  }),
  author: one(users, {
    fields: [deepTalkAnswers.userId],
    references: [users.id],
  }),
}));

export const dailyChallengesRelations = relations(dailyChallenges, ({ many }) => ({
  assignments: many(dailyChallengeAssignments),
}));

export const dailyChallengeAssignmentsRelations = relations(
  dailyChallengeAssignments,
  ({ one, many }) => ({
    conversation: one(conversations, {
      fields: [dailyChallengeAssignments.conversationId],
      references: [conversations.id],
    }),
    challenge: one(dailyChallenges, {
      fields: [dailyChallengeAssignments.challengeId],
      references: [dailyChallenges.id],
    }),
    responses: many(dailyChallengeResponses),
  })
);

export const dailyChallengeResponsesRelations = relations(dailyChallengeResponses, ({ one }) => ({
  assignment: one(dailyChallengeAssignments, {
    fields: [dailyChallengeResponses.assignmentId],
    references: [dailyChallengeAssignments.id],
  }),
  conversation: one(conversations, {
    fields: [dailyChallengeResponses.conversationId],
    references: [conversations.id],
  }),
  author: one(users, {
    fields: [dailyChallengeResponses.userId],
    references: [users.id],
  }),
}));

export const dailyConnectionStreaksRelations = relations(dailyConnectionStreaks, ({ one }) => ({
  conversation: one(conversations, {
    fields: [dailyConnectionStreaks.conversationId],
    references: [conversations.id],
  }),
  userA: one(users, {
    fields: [dailyConnectionStreaks.userAId],
    references: [users.id],
  }),
  userB: one(users, {
    fields: [dailyConnectionStreaks.userBId],
    references: [users.id],
  }),
}));

export type DeepTalkQuestion = typeof deepTalkQuestions.$inferSelect;
export type NewDeepTalkQuestion = typeof deepTalkQuestions.$inferInsert;
export type DeepTalkSession = typeof deepTalkSessions.$inferSelect;
export type NewDeepTalkSession = typeof deepTalkSessions.$inferInsert;
export type DeepTalkAnswer = typeof deepTalkAnswers.$inferSelect;
export type NewDeepTalkAnswer = typeof deepTalkAnswers.$inferInsert;
export type DailyChallenge = typeof dailyChallenges.$inferSelect;
export type NewDailyChallenge = typeof dailyChallenges.$inferInsert;
export type DailyChallengeAssignmentRecord = typeof dailyChallengeAssignments.$inferSelect;
export type NewDailyChallengeAssignmentRecord = typeof dailyChallengeAssignments.$inferInsert;
export type DailyChallengeResponseRecord = typeof dailyChallengeResponses.$inferSelect;
export type NewDailyChallengeResponseRecord = typeof dailyChallengeResponses.$inferInsert;
export type DailyConnectionStreakRecord = typeof dailyConnectionStreaks.$inferSelect;
export type NewDailyConnectionStreakRecord = typeof dailyConnectionStreaks.$inferInsert;
