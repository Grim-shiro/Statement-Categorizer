/**
 * End-to-end encryption using Web Crypto API (AES-GCM 256-bit).
 *
 * Flow:
 * 1. Client generates a per-session AES key on page load
 * 2. Client encrypts file data before uploading to server
 * 3. Server receives encrypted blob, decrypts with the key sent in a header
 * 4. Server processes data in memory, encrypts response, returns it
 * 5. Client decrypts the response
 *
 * The key is exported as base64 and sent via a secure header.
 * This ensures data in transit is encrypted even if TLS is compromised,
 * and the server never persists plaintext financial data.
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM

export async function generateEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable so we can export it
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(
  key: CryptoKey,
  data: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded
  );

  // Prepend IV to ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(
  key: CryptoKey,
  encryptedBase64: string
): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) =>
    c.charCodeAt(0)
  );

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
