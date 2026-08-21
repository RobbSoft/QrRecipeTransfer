export const PROTOCOL_VERSION = 2;
export const APP_VERSION = '1.0.17';
export const CHUNK_SIZE = 200;
export const FILE_ID_LENGTH = 16;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;
export const PBKDF2_ITERATIONS = 100000;

/** Pre-filled AES-GCM password used by QrSource and QrSink. */
export const DEFAULT_ENCRYPTION_PASSWORD = 'QrRecipeTransfer';

export const QR_ERROR_CORRECTION = 'L';
export const QR_MARGIN = 4;
export const QR_CANVAS_SIZE = 640;

export const DEFAULT_INTERVAL_MS = 500;
export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 1000;
export const INTERVAL_STEP_MS = 100;
