import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'nexora.db');

export function createDatabase(dbPath: string = DEFAULT_DB_PATH): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  initializeSchema(db);
  return db;
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      email_hash TEXT NOT NULL UNIQUE,
      email_masked TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT NOT NULL DEFAULT '',
      status_text TEXT NOT NULL DEFAULT 'Encrypted on NEXORA',
      last_seen_at TEXT,
      username_changed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_username_norm ON users(username_normalized);

    CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL,
      purpose TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      verification_token_hash TEXT,
      expires_at TEXT NOT NULL,
      resend_available_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_verifications_lookup
      ON email_verifications(email_normalized, purpose, created_at);

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      last_active_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

    CREATE TABLE IF NOT EXISTS identity_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      ecdh_public_jwk TEXT NOT NULL,
      ecdsa_public_jwk TEXT NOT NULL,
      encrypted_key_backup TEXT,
      backup_salt TEXT,
      backup_iv TEXT,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pre_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_id INTEGER NOT NULL,
      public_jwk TEXT NOT NULL,
      signature TEXT NOT NULL,
      is_one_time INTEGER NOT NULL DEFAULT 1,
      consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS privacy_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      show_online_status INTEGER NOT NULL DEFAULT 1,
      show_read_receipts INTEGER NOT NULL DEFAULT 1,
      allow_chat_requests INTEGER NOT NULL DEFAULT 1,
      story_default_visibility TEXT NOT NULL DEFAULT 'friends',
      allow_discovery_by_username INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(sender_id, receiver_id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(user_a_id, user_b_id)
    );

    CREATE TABLE IF NOT EXISTS user_blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streaks (
      id TEXT PRIMARY KEY,
      user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      streak_count INTEGER NOT NULL DEFAULT 0,
      user_a_last_activity_at TEXT,
      user_b_last_activity_at TEXT,
      last_cycle_at TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(user_a_id, user_b_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      privacy TEXT NOT NULL DEFAULT 'private',
      max_members INTEGER NOT NULL DEFAULT 25,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      current_epoch INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_epoch INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT NOT NULL,
      UNIQUE(group_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

    CREATE TABLE IF NOT EXISTS group_encryption_states (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      epoch INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ephemeral_public_jwk TEXT NOT NULL,
      wrapped_epoch_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(group_id, epoch, user_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      group_id TEXT UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
      private_pair_key TEXT UNIQUE,
      disappearing_seconds INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      muted INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT,
      joined_at TEXT NOT NULL,
      UNIQUE(conversation_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);

    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      story_id TEXT,
      mime_type TEXT NOT NULL,
      original_size INTEGER NOT NULL,
      encrypted_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      sha256_ciphertext TEXT NOT NULL,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reply_to_id TEXT,
      forwarded_from_id TEXT,
      kind TEXT NOT NULL DEFAULT 'text',
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      aad TEXT NOT NULL,
      recipient_envelopes_json TEXT,
      epoch INTEGER,
      attachment_id TEXT REFERENCES message_attachments(id) ON DELETE SET NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_edited INTEGER NOT NULL DEFAULT 0,
      deleted_for_everyone INTEGER NOT NULL DEFAULT 0,
      deleted_for_users_json TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS message_receipts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'sent',
      signature TEXT,
      signed_at TEXT,
      encrypted_payload_json TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL,
      attachment_id TEXT NOT NULL REFERENCES message_attachments(id) ON DELETE CASCADE,
      ciphertext_meta TEXT NOT NULL,
      iv TEXT NOT NULL,
      recipient_envelopes_json TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'friends',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);

    CREATE TABLE IF NOT EXISTS story_views (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at TEXT NOT NULL,
      UNIQUE(story_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS story_reactions (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(story_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      entity_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
  `);

  // Safe schema migration for existing SQLite databases
  const receiptCols = db
    .prepare(`PRAGMA table_info(message_receipts)`)
    .all() as Array<{ name: string }>;
  const receiptColSet = new Set(receiptCols.map((c) => c.name));
  if (!receiptColSet.has('signature')) {
    db.exec(`ALTER TABLE message_receipts ADD COLUMN signature TEXT;`);
  }
  if (!receiptColSet.has('signed_at')) {
    db.exec(`ALTER TABLE message_receipts ADD COLUMN signed_at TEXT;`);
  }
  if (!receiptColSet.has('encrypted_payload_json')) {
    db.exec(`ALTER TABLE message_receipts ADD COLUMN encrypted_payload_json TEXT;`);
  }
}

export const db = createDatabase();
