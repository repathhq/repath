//! Encryption for tenant-held secrets.
//!
//! Some things a tenant gives us genuinely have to be recoverable, not hashed:
//! their provider API keys (we must send them upstream), webhook signing
//! secrets, and Slack URLs. Those are encrypted at rest with AES-256-GCM.
//!
//! This is deliberately *not* how API keys are handled. A Repath API key is
//! only ever compared, never replayed, so it is hashed one-way and cannot be
//! recovered even by us — see [`crate::tenant::hash_key`]. Reach for this
//! module only when the plaintext must come back.
//!
//! # Key management
//!
//! The master key comes from `REPATH_ENCRYPTION_KEY`: 64 hex characters, i.e.
//! 32 bytes. Generate one with `openssl rand -hex 32`.
//!
//! Application-level encryption rather than KMS so a self-hosted install needs
//! no cloud dependency. The trade-off is that the master key sits in the
//! environment; in the hosted deployment it comes from SSM Parameter Store as
//! a SecureString, so it is encrypted at rest there too.
//!
//! # Format
//!
//! Ciphertext is stored as `nonce (12 bytes) || ciphertext || tag (16 bytes)`,
//! base64-encoded. The nonce is random per encryption — reusing a nonce under
//! the same key breaks GCM catastrophically, so it is never derived from the
//! plaintext or a counter.
//!
//! # Rotation
//!
//! Changing the master key makes existing ciphertext undecryptable. Rotating
//! means re-encrypting every stored secret under the new key; until that
//! tooling exists, treat the master key as permanent for a deployment.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use std::sync::OnceLock;

/// Length of the master key in bytes.
const KEY_LEN: usize = 32;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error(
        "REPATH_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` \
         and set it before storing tenant secrets."
    )]
    MissingKey,

    #[error("REPATH_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes), got {0}")]
    BadKeyLength(usize),

    #[error("REPATH_ENCRYPTION_KEY is not valid hex")]
    BadKeyEncoding,

    #[error("Failed to encrypt value")]
    EncryptFailed,

    #[error("Failed to decrypt value — wrong key, or the stored data is corrupt")]
    DecryptFailed,

    #[error("Stored ciphertext is malformed")]
    MalformedCiphertext,
}

/// Cached master key. Read once: pulling and decoding it per request would be
/// wasted work on a path that runs for every proxied call.
static MASTER_KEY: OnceLock<Option<[u8; KEY_LEN]>> = OnceLock::new();

fn master_key() -> Result<&'static [u8; KEY_LEN], CryptoError> {
    let cached = MASTER_KEY.get_or_init(|| {
        let hex = std::env::var("REPATH_ENCRYPTION_KEY").ok()?;
        decode_hex_key(&hex).ok()
    });

    match cached {
        Some(k) => Ok(k),
        // Distinguish "not configured" from "configured badly" for the operator.
        None => match std::env::var("REPATH_ENCRYPTION_KEY") {
            Err(_) => Err(CryptoError::MissingKey),
            Ok(hex) => Err(decode_hex_key(&hex).unwrap_err()),
        },
    }
}

fn decode_hex_key(hex: &str) -> Result<[u8; KEY_LEN], CryptoError> {
    let hex = hex.trim();
    if hex.len() != KEY_LEN * 2 {
        return Err(CryptoError::BadKeyLength(hex.len()));
    }

    let mut out = [0u8; KEY_LEN];
    for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
        let s = std::str::from_utf8(chunk).map_err(|_| CryptoError::BadKeyEncoding)?;
        out[i] = u8::from_str_radix(s, 16).map_err(|_| CryptoError::BadKeyEncoding)?;
    }
    Ok(out)
}

/// Whether a usable master key is configured.
///
/// Lets callers fail with a clear setup message before a tenant tries to save
/// a secret, rather than at the moment of saving.
pub fn is_configured() -> bool {
    master_key().is_ok()
}

/// Encrypt a secret. Returns base64 of `nonce || ciphertext || tag`.
pub fn encrypt(plaintext: &str) -> Result<String, CryptoError> {
    let key_bytes = master_key()?;
    let unbound =
        UnboundKey::new(&AES_256_GCM, key_bytes).map_err(|_| CryptoError::EncryptFailed)?;
    let key = LessSafeKey::new(unbound);

    // A fresh random nonce per encryption. Never reuse one under the same key.
    let mut nonce_bytes = [0u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| CryptoError::EncryptFailed)?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = plaintext.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| CryptoError::EncryptFailed)?;

    let mut combined = Vec::with_capacity(NONCE_LEN + in_out.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&in_out);

    Ok(BASE64.encode(combined))
}

/// Decrypt a value produced by [`encrypt`].
pub fn decrypt(encoded: &str) -> Result<String, CryptoError> {
    let key_bytes = master_key()?;
    let combined = BASE64
        .decode(encoded)
        .map_err(|_| CryptoError::MalformedCiphertext)?;

    // Must hold at least a nonce and a GCM tag.
    if combined.len() < NONCE_LEN + AES_256_GCM.tag_len() {
        return Err(CryptoError::MalformedCiphertext);
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let mut nonce_arr = [0u8; NONCE_LEN];
    nonce_arr.copy_from_slice(nonce_bytes);

    let unbound =
        UnboundKey::new(&AES_256_GCM, key_bytes).map_err(|_| CryptoError::DecryptFailed)?;
    let key = LessSafeKey::new(unbound);

    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_arr),
            Aad::empty(),
            &mut in_out,
        )
        .map_err(|_| CryptoError::DecryptFailed)?;

    String::from_utf8(plaintext.to_vec()).map_err(|_| CryptoError::DecryptFailed)
}

/// A short, non-reversible hint so a stored secret is recognisable in the UI.
///
/// Shows only the last four characters, the convention users already know from
/// card and key displays. Anything shorter than eight characters is masked
/// entirely rather than leaking half of a short secret.
pub fn hint(secret: &str) -> String {
    let n = secret.chars().count();
    if n < 8 {
        return "••••".to_string();
    }
    let tail: String = secret.chars().skip(n - 4).collect();
    format!("••••{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tests share one process, so the key is set once and left in place.
    fn with_key() {
        std::env::set_var(
            "REPATH_ENCRYPTION_KEY",
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        );
    }

    #[test]
    fn round_trips_a_secret() {
        with_key();
        let secret = "sk-proj-abc123";
        let sealed = encrypt(secret).expect("encrypt");
        assert_eq!(decrypt(&sealed).expect("decrypt"), secret);
    }

    #[test]
    fn ciphertext_does_not_contain_the_plaintext() {
        with_key();
        let sealed = encrypt("sk-proj-supersecret").unwrap();
        assert!(!sealed.contains("supersecret"));
        let raw = BASE64.decode(&sealed).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("supersecret"));
    }

    #[test]
    fn same_plaintext_encrypts_differently_each_time() {
        with_key();
        // A fixed nonce would make identical secrets produce identical
        // ciphertext, leaking which tenants share a key.
        let a = encrypt("same-value").unwrap();
        let b = encrypt("same-value").unwrap();
        assert_ne!(a, b, "nonce must be random per encryption");
        assert_eq!(decrypt(&a).unwrap(), decrypt(&b).unwrap());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        with_key();
        let sealed = encrypt("sk-proj-abc").unwrap();
        let mut raw = BASE64.decode(&sealed).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0xff; // flip a bit in the tag
        let tampered = BASE64.encode(raw);
        assert!(
            decrypt(&tampered).is_err(),
            "GCM must reject modified ciphertext"
        );
    }

    #[test]
    fn truncated_ciphertext_is_rejected() {
        with_key();
        assert!(matches!(
            decrypt("c2hvcnQ="),
            Err(CryptoError::MalformedCiphertext)
        ));
    }

    #[test]
    fn non_base64_is_rejected() {
        with_key();
        assert!(decrypt("not base64 at all !!!").is_err());
    }

    #[test]
    fn empty_string_round_trips() {
        with_key();
        let sealed = encrypt("").unwrap();
        assert_eq!(decrypt(&sealed).unwrap(), "");
    }

    #[test]
    fn unicode_round_trips() {
        with_key();
        let secret = "clé-secrète-🔑";
        assert_eq!(decrypt(&encrypt(secret).unwrap()).unwrap(), secret);
    }

    #[test]
    fn rejects_a_short_key() {
        assert!(matches!(
            decode_hex_key("abc"),
            Err(CryptoError::BadKeyLength(3))
        ));
    }

    #[test]
    fn rejects_non_hex_key() {
        let bad = "z".repeat(64);
        assert!(matches!(
            decode_hex_key(&bad),
            Err(CryptoError::BadKeyEncoding)
        ));
    }

    #[test]
    fn decodes_a_valid_key() {
        let k = decode_hex_key("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
            .unwrap();
        assert_eq!(k[0], 0x00);
        assert_eq!(k[31], 0x1f);
    }

    #[test]
    fn hint_shows_only_the_tail() {
        assert_eq!(hint("sk-proj-abcd1234"), "••••1234");
    }

    #[test]
    fn hint_fully_masks_short_secrets() {
        assert_eq!(hint("abc"), "••••");
        assert_eq!(hint(""), "••••");
    }

    #[test]
    fn hint_never_reveals_most_of_a_secret() {
        let secret = "sk-proj-verylongsecretvalue";
        let h = hint(secret);
        assert!(h.len() < secret.len());
        assert!(!h.contains("verylong"));
    }
}
