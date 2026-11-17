# NEXORA Security & End-to-End Encryption Architecture

## 1. Cryptographic Primitives (Zero Homemade Cryptography)
All cryptographic operations execute client-side using the browser's native **Web Crypto API** (`window.crypto.subtle`) with standard NIST/IETF primitives:

- **Identity Key Pair**: ECDH P-256 (key agreement) + ECDSA P-256 (signing).
- **Key Derivation**: HKDF-SHA256 (`info = "nexora-e2ee-key-wrap-v1"` / `"nexora-group-epoch-v1"`).
- **Message & Media Content Encryption**: AES-256-GCM with fresh 96-bit random IVs and authenticated additional data (`AAD = conversationId:senderId:messageId`).
- **Password Key Backup**: PBKDF2-SHA256 (310,000 iterations, random 16-byte salt) + AES-256-GCM wrapping the user's private JWK locally before optional backup upload.
- **Password Hashing (Server)**: `crypto.scrypt` (`N=16384, r=8, p=1`, 16-byte random salt) with `crypto.timingSafeEqual` verification.
- **OTP & Session Tokens (Server)**: 6-digit CSPRNG OTPs hashed via HMAC-SHA256; session tokens generated via 32 random bytes and stored hashed.

## 2. Private 1-to-1 Messaging
1. Sender generates a random 256-bit AES-GCM content key per message.
2. Plaintext JSON payload (message text, reply preview, media decryption key/IV/SHA-256) is encrypted with AES-256-GCM + AAD.
3. Content key is wrapped separately for each recipient's ECDH P-256 public key using an ephemeral ECDH keypair (`epk`) + HKDF-SHA256 + AES-256-GCM.
4. The server persists only ciphertext, IV, AAD, and wrapped envelopes. The server never sees plaintext message bodies or private keys.

## 3. Group Encryption (Epoch Key Rotation, Max 25 Members)
- Each group maintains an integer `epoch` starting at `1`.
- An AES-256-GCM epoch key is wrapped individually for every active group member.
- **Member Addition**: Admin/owner increments `epoch + 1` and generates a new epoch key wrapped for the updated member list. Newly added members cannot decrypt historical messages encrypted under `epoch <= N`.
- **Member Removal / Departure**: Remaining admin/owner increments `epoch + 1` and distributes a fresh epoch key excluding the removed user. Removed members lose cryptographic access to all future group messages.

## 4. Encrypted Media & 24h Stories
- Photos, videos, voice notes, and documents are compressed (for images) and encrypted locally with AES-256-GCM before upload.
- The server stores opaque binary blobs in `uploads/encrypted/<uuid>.enc` with no public URL access; `/api/v1/media/:id` enforces participant/story authorization on every download.

## 5. Threat Model & Metadata Boundaries
- **Protected from Server**: Message text, attachments, voice recordings, story captions, story media, and user private keys.
- **Visible to Server (Metadata)**: Sender/recipient user IDs, conversation IDs, timestamps, group membership, message sizes, and connection IP addresses (necessary for routing and abuse prevention).
- **Disappearing Messages**: Server enforces expiration via `expires_at` and automated retention cleanup; however, no software can prevent a recipient from taking screenshots before expiration.
