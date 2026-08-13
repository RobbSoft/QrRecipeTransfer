let pakoModule = null;

async function loadPako() {
  if (!pakoModule) {
    pakoModule = await import('https://esm.sh/pako@2.1.0');
  }
  return pakoModule;
}

/**
 * Compresses UTF-8 text using gzip.
 * @param {string} text
 * @returns {Promise<Uint8Array>}
 */
export async function compressText(text) {
  const pako = await loadPako();
  return pako.gzip(text);
}

/**
 * Decompresses gzip bytes back to UTF-8 text.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function decompressText(bytes) {
  const pako = await loadPako();
  return pako.ungzip(bytes, { to: 'string' });
}
