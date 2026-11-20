import { sql } from 'drizzle-orm';
import type { PgDatabase } from './index.ts';

let schemaReadyPromise: Promise<boolean> | null = null;

export function ensureDatabaseSchema(database: PgDatabase): Promise<boolean> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      try {
        await database.execute(sql`
          CREATE TABLE IF NOT EXISTS users (
            id text PRIMARY KEY,
            uid text UNIQUE,
            username text NOT NULL,
            username_normalized text NOT NULL UNIQUE,
            display_name text NOT NULL,
            email_hash text NOT NULL UNIQUE,
            email_masked text NOT NULL,
            password_hash text NOT NULL,
            avatar_url text,
            bio text NOT NULL DEFAULT '',
            status_text text NOT NULL DEFAULT 'Encrypted on NEXORA',
            last_seen_at text,
            username_changed_at text,
            created_at text NOT NULL,
            updated_at text NOT NULL
          );
          ALTER TABLE users ADD COLUMN IF NOT EXISTS uid text UNIQUE;
          CREATE INDEX IF NOT EXISTS idx_users_username_norm ON users (username_normalized);

          CREATE TABLE IF NOT EXISTS email_verifications (
            id text PRIMARY KEY,
            email_normalized text NOT NULL,
            purpose text NOT NULL,
            otp_hash text NOT NULL,
            salt text NOT NULL,
            attempts integer NOT NULL DEFAULT 0,
            verified integer NOT NULL DEFAULT 0,
            verification_token_hash text,
            expires_at text NOT NULL,
            resend_available_at text NOT NULL,
            created_at text NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_email_verifications_lookup ON email_verifications (email_normalized, purpose, created_at);

          CREATE TABLE IF NOT EXISTS devices (
            id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_name text NOT NULL,
            platform text NOT NULL,
            last_active_at text NOT NULL,
            created_at text NOT NULL
          );

          CREATE TABLE IF NOT EXISTS user_sessions (
            id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_id text NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            token_hash text NOT NULL UNIQUE,
            user_agent text NOT NULL DEFAULT '',
            ip_address text NOT NULL DEFAULT '',
            last_active_at text NOT NULL,
            expires_at text NOT NULL,
            revoked_at text,
            created_at text NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);

          CREATE TABLE IF NOT EXISTS identity_keys (
            id text PRIMARY KEY,
            user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            device_id text NOT NULL,
            ecdh_public_jwk text NOT NULL,
            ecdsa_public_jwk text NOT NULL,
            encrypted_key_backup text,
            backup_salt text,
            backup_iv text,
            fingerprint text NOT NULL,
            created_at text NOT NULL,
            updated_at text NOT NULL
          );

          CREATE TABLE IF NOT EXISTS pre_keys (
            id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key_id integer NOT NULL,
            public_jwk text NOT NULL,
            signature text NOT NULL,
            is_one_time integer NOT NULL DEFAULT 1,
            consumed integer NOT NULL DEFAULT 0,
            created_at text NOT NULL
          );

          CREATE TABLE IF NOT EXISTS privacy_settings (
            user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            show_online_status integer NOT NULL DEFAULT 1,
            show_read_receipts integer NOT NULL DEFAULT 1,
            allow_chat_requests integer NOT NULL DEFAULT 1,
            story_default_visibility text NOT NULL DEFAULT 'friends',
            allow_discovery_by_username integer NOT NULL DEFAULT 1,
            updated_at text NOT NULL
          );

          CREATE TABLE IF NOT EXISTS friend_requests (
            id text PRIMARY KEY,
            sender_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            receiver_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'pending',
            created_at text NOT NULL,
            updated_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pair ON friend_requests (sender_id, receiver_id);

          CREATE TABLE IF NOT EXISTS friendships (
            id text PRIMARY KEY,
            user_a_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair ON friendships (user_a_id, user_b_id);

          CREATE TABLE IF NOT EXISTS user_blocks (
            id text PRIMARY KEY,
            blocker_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_user_blocks_pair ON user_blocks (blocker_id, blocked_id);

          CREATE TABLE IF NOT EXISTS reports (
            id text PRIMARY KEY,
            reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reported_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reason text NOT NULL,
            details text NOT NULL DEFAULT '',
            created_at text NOT NULL
          );

          CREATE TABLE IF NOT EXISTS streaks (
            id text PRIMARY KEY,
            user_a_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            streak_count integer NOT NULL DEFAULT 0,
            user_a_last_activity_at text,
            user_b_last_activity_at text,
            last_cycle_at text,
            expires_at text,
            updated_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_streaks_pair ON streaks (user_a_id, user_b_id);

          CREATE TABLE IF NOT EXISTS groups (
            id text PRIMARY KEY,
            name text NOT NULL,
            description text NOT NULL DEFAULT '',
            avatar_url text,
            privacy text NOT NULL DEFAULT 'private',
            max_members integer NOT NULL DEFAULT 25,
            creator_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            current_epoch integer NOT NULL DEFAULT 1,
            created_at text NOT NULL,
            updated_at text NOT NULL
          );

          CREATE TABLE IF NOT EXISTS group_members (
            id text PRIMARY KEY,
            group_id text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role text NOT NULL DEFAULT 'member',
            joined_epoch integer NOT NULL DEFAULT 1,
            joined_at text NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_unique ON group_members (group_id, user_id);

          CREATE TABLE IF NOT EXISTS group_encryption_states (
            id text PRIMARY KEY,
            group_id text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            epoch integer NOT NULL,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sender_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ephemeral_public_jwk text NOT NULL,
            wrapped_epoch_key text NOT NULL,
            iv text NOT NULL,
            created_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_group_enc_state_unique ON group_encryption_states (group_id, epoch, user_id);

          CREATE TABLE IF NOT EXISTS conversations (
            id text PRIMARY KEY,
            type text NOT NULL,
            group_id text UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
            private_pair_key text UNIQUE,
            disappearing_seconds integer NOT NULL DEFAULT 0,
            last_message_at text,
            created_at text NOT NULL,
            updated_at text NOT NULL
          );

          CREATE TABLE IF NOT EXISTS conversation_participants (
            id text PRIMARY KEY,
            conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            muted integer NOT NULL DEFAULT 0,
            archived integer NOT NULL DEFAULT 0,
            unread_count integer NOT NULL DEFAULT 0,
            last_read_at text,
            joined_at text NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants (user_id);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_participants_unique ON conversation_participants (conversation_id, user_id);

          CREATE TABLE IF NOT EXISTS message_attachments (
            id text PRIMARY KEY,
            uploader_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            conversation_id text REFERENCES conversations(id) ON DELETE CASCADE,
            story_id text,
            mime_type text NOT NULL,
            original_size integer NOT NULL,
            encrypted_size integer NOT NULL,
            storage_path text NOT NULL,
            sha256_ciphertext text NOT NULL,
            duration_ms integer,
            width integer,
            height integer,
            created_at text NOT NULL,
            expires_at text
          );

          CREATE TABLE IF NOT EXISTS messages (
            id text PRIMARY KEY,
            conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            sender_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reply_to_id text,
            forwarded_from_id text,
            kind text NOT NULL DEFAULT 'text',
            ciphertext text NOT NULL,
            iv text NOT NULL,
            aad text NOT NULL,
            recipient_envelopes_json text,
            epoch integer,
            attachment_id text REFERENCES message_attachments(id) ON DELETE SET NULL,
            is_pinned integer NOT NULL DEFAULT 0,
            is_edited integer NOT NULL DEFAULT 0,
            deleted_for_everyone integer NOT NULL DEFAULT 0,
            deleted_for_users_json text NOT NULL DEFAULT '[]',
            expires_at text,
            created_at text NOT NULL,
            updated_at text NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages (conversation_id, created_at);

          CREATE TABLE IF NOT EXISTS message_receipts (
            id text PRIMARY KEY,
            message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'sent',
            signature text,
            signed_at text,
            encrypted_payload_json text,
            updated_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_message_receipts_unique ON message_receipts (message_id, user_id);

          CREATE TABLE IF NOT EXISTS message_reactions (
            id text PRIMARY KEY,
            message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emoji text NOT NULL,
            created_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reactions_unique ON message_reactions (message_id, user_id, emoji);

          CREATE TABLE IF NOT EXISTS stories (
            id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            media_type text NOT NULL,
            attachment_id text NOT NULL REFERENCES message_attachments(id) ON DELETE CASCADE,
            ciphertext_meta text NOT NULL,
            iv text NOT NULL,
            recipient_envelopes_json text NOT NULL,
            visibility text NOT NULL DEFAULT 'friends',
            expires_at text NOT NULL,
            created_at text NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories (expires_at);

          CREATE TABLE IF NOT EXISTS story_views (
            id text PRIMARY KEY,
            story_id text NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
            viewer_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            viewed_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_story_views_unique ON story_views (story_id, viewer_id);

          CREATE TABLE IF NOT EXISTS story_reactions (
            id text PRIMARY KEY,
            story_id text NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emoji text NOT NULL,
            created_at text NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_story_reactions_unique ON story_reactions (story_id, user_id);

          CREATE TABLE IF NOT EXISTS notifications (
            id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type text NOT NULL,
            actor_id text REFERENCES users(id) ON DELETE SET NULL,
            entity_id text,
            title text NOT NULL,
            body text NOT NULL,
            is_read integer NOT NULL DEFAULT 0,
            created_at text NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at);
        `);
        return true;
      } catch (err) {
        console.error('Database schema initialization skipped/failed:', err instanceof Error ? err.message : err);
        schemaReadyPromise = null;
        return false;
      }
    })();
  }
  return schemaReadyPromise;
}
