import pako from 'https://esm.sh/pako@2.1.0';

/**
 * Compresses UTF-8 text using gzip.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function compressText(text) {
  return pako.gzip(text);
}

/**
 * Decompresses gzip bytes back to UTF-8 text.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decompressText(bytes) {
  return pako.ungzip(bytes, { to: 'string' });
}
