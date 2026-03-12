/**
 * Server-side encryption/decryption using Node.js crypto (AES-GCM 256-bit).
 * Mirrors the client-side Web Crypto API implementation.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function importKeyFromBase64(base64Key: string): Buffer {
  return Buffer.from(base64Key, "base64");
}

export function encryptServer(data: string, base64Key: string): string {
  const key = importKeyFromBase64(base64Key);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv + ciphertext + authTag (matches Web Crypto AES-GCM output)
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString("base64");
}

export function decryptServer(encryptedBase64: string, base64Key: string): string {
  const key = importKeyFromBase64(base64Key);
  const combined = Buffer.from(encryptedBase64, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
