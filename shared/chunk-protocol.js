import { CHUNK_SIZE, PROTOCOL_VERSION } from './constants.js';
import { crc32 } from './crc32.js';

/**
 * Encodes bytes to base64.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Decodes base64 to bytes.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Normalizes v1 (verbose) and v2 (compact) chunk headers to a common shape.
 * @param {object} raw
 * @returns {object}
 */
export function normalizeHeader(raw) {
  if (raw.v === 1) {
    return {
      v: 1,
      fileId: raw.fileId,
      seq: raw.seq,
      total: raw.total,
      totalCrc: raw.totalCrc,
      chunkCrc: raw.chunkCrc,
      payload: raw.payload,
    };
  }

  if (raw.v === 2) {
    return {
      v: 2,
      fileId: raw.f,
      seq: raw.s,
      total: raw.n,
      totalCrc: raw.tc,
      chunkCrc: raw.c,
      payload: raw.p,
    };
  }

  throw new Error(`Unsupported protocol version: ${raw.v}`);
}

/**
 * Builds a compact v2 chunk record for QR encoding.
 * @param {object} params
 * @returns {object}
 */
function buildChunkRecord({ fileId, seq, total, totalCrc, chunkCrc, payload }) {
  return {
    v: PROTOCOL_VERSION,
    f: fileId,
    s: seq,
    n: total,
    tc: totalCrc,
    c: chunkCrc,
    p: payload,
  };
}

/**
 * Splits encrypted bytes into fixed-size chunks with metadata headers.
 * @param {Uint8Array} encryptedData
 * @param {string} fileId
 * @returns {{ headers: object[], totalCrc: number }}
 */
export function splitIntoChunks(encryptedData, fileId) {
  const totalCrc = crc32(encryptedData);
  const total = Math.ceil(encryptedData.length / CHUNK_SIZE) || 1;
  const headers = [];

  for (let index = 0; index < total; index += 1) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, encryptedData.length);
    const chunkBytes = encryptedData.slice(start, end);
    const chunkCrc = crc32(chunkBytes);

    headers.push(buildChunkRecord({
      fileId,
      seq: index + 1,
      total,
      totalCrc,
      chunkCrc,
      payload: bytesToBase64(chunkBytes),
    }));
  }

  return { headers, totalCrc };
}

/**
 * Serializes a chunk header to a compact JSON string for QR encoding.
 * @param {object} header
 * @returns {string}
 */
export function serializeChunkHeader(header) {
  return JSON.stringify(header);
}

/**
 * Parses and validates a scanned QR payload.
 * @param {string} rawText
 * @returns {{ header: object, chunkBytes: Uint8Array }}
 */
export function parseChunkPayload(rawText) {
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error('Invalid QR payload: not valid JSON.');
  }

  const header = normalizeHeader(raw);
  validateChunkHeader(header);

  const chunkBytes = base64ToBytes(header.payload);
  const computedCrc = crc32(chunkBytes);
  if (computedCrc !== header.chunkCrc) {
    const error = new Error(`CRC mismatch for chunk ${header.seq}.`);
    error.code = 'CHUNK_CRC_MISMATCH';
    error.seq = header.seq;
    throw error;
  }

  return { header, chunkBytes };
}

/**
 * Validates required chunk header fields.
 * @param {object} header
 */
export function validateChunkHeader(header) {
  const requiredFields = ['v', 'fileId', 'seq', 'total', 'totalCrc', 'chunkCrc', 'payload'];
  for (const field of requiredFields) {
    if (header[field] === undefined || header[field] === null) {
      throw new Error(`Invalid QR payload: missing field "${field}".`);
    }
  }

  if (header.v !== 1 && header.v !== 2) {
    throw new Error(`Unsupported protocol version: ${header.v}`);
  }

  if (!Number.isInteger(header.seq) || header.seq < 1 || header.seq > header.total) {
    throw new Error('Invalid chunk sequence number.');
  }

  if (!Number.isInteger(header.total) || header.total < 1) {
    throw new Error('Invalid total chunk count.');
  }
}

/**
 * Reassembles chunk bytes and verifies total CRC.
 * @param {Map<number, Uint8Array>} chunksBySeq
 * @param {number} total
 * @param {number} expectedTotalCrc
 * @returns {Uint8Array}
 */
export function reassembleChunks(chunksBySeq, total, expectedTotalCrc) {
  if (chunksBySeq.size !== total) {
    throw new Error(`Missing chunks: received ${chunksBySeq.size} of ${total}.`);
  }

  let totalLength = 0;
  for (let seq = 1; seq <= total; seq += 1) {
    const chunk = chunksBySeq.get(seq);
    if (!chunk) {
      throw new Error(`Missing chunk ${seq}.`);
    }
    totalLength += chunk.length;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (let seq = 1; seq <= total; seq += 1) {
    const chunk = chunksBySeq.get(seq);
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const computedCrc = crc32(combined);
  if (computedCrc !== expectedTotalCrc) {
    throw new Error('Total CRC mismatch. Transfer may be incomplete or corrupted.');
  }

  return combined;
}

/**
 * Creates a short session id from a SHA-256 hex digest.
 * @param {string} sha256HexDigest
 * @returns {string}
 */
export function shortFileId(sha256HexDigest) {
  return sha256HexDigest.slice(0, 16);
}
