import { IV_LENGTH, PBKDF2_ITERATIONS, SALT_LENGTH } from './constants.js';

function getCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is not available in this browser.');
  }
  return globalThis.crypto;
}

/**
 * Derives an AES-GCM key from a password and salt.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
  const cryptoApi = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data with AES-GCM. Output format: salt + iv + ciphertext (includes GCM tag).
 * @param {Uint8Array} data
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function encrypt(data, password) {
  const cryptoApi = getCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const ciphertext = new Uint8Array(
    await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  );

  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(ciphertext, SALT_LENGTH + IV_LENGTH);
  return result;
}

/**
 * Decrypts data produced by encrypt().
 * @param {Uint8Array} encryptedBlob
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function decrypt(encryptedBlob, password) {
  if (encryptedBlob.length < SALT_LENGTH + IV_LENGTH + 16) {
    throw new Error('Encrypted payload is too short.');
  }

  const cryptoApi = getCrypto();
  const salt = encryptedBlob.slice(0, SALT_LENGTH);
  const iv = encryptedBlob.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = encryptedBlob.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);

  try {
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('Decryption failed. Wrong password or corrupted data.');
  }
}

/**
 * Computes SHA-256 hex digest for session identification.
 * @param {Uint8Array} data
 * @returns {Promise<string>}
 */
export async function sha256Hex(data) {
  const cryptoApi = getCrypto();
  const hashBuffer = await cryptoApi.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
