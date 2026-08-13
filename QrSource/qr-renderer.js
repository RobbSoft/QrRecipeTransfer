import { QR_CANVAS_SIZE, QR_ERROR_CORRECTION, QR_MARGIN } from '../shared/constants.js';
import { serializeChunkHeader } from '../shared/chunk-protocol.js';

let qrcodeModule = null;

async function loadQrCode() {
  if (!qrcodeModule) {
    qrcodeModule = await import('https://esm.sh/qrcode@1.5.4');
  }
  return qrcodeModule.default;
}

/**
 * Pre-renders all chunk QR codes to canvas elements.
 * @param {object[]} headers
 * @returns {Promise<HTMLCanvasElement[]>}
 */
export async function preRenderQrCodes(headers) {
  const QRCode = await loadQrCode();
  const canvases = [];

  for (const header of headers) {
    const canvas = document.createElement('canvas');
    canvas.width = QR_CANVAS_SIZE;
    canvas.height = QR_CANVAS_SIZE;

    await QRCode.toCanvas(canvas, serializeChunkHeader(header), {
      errorCorrectionLevel: QR_ERROR_CORRECTION,
      margin: QR_MARGIN,
      width: QR_CANVAS_SIZE,
    });

    canvases.push(canvas);
  }

  return canvases;
}

/**
 * Draws a source canvas onto a display canvas with crisp scaling.
 * @param {HTMLCanvasElement} displayCanvas
 * @param {HTMLCanvasElement} sourceCanvas
 */
export function drawQrToDisplay(displayCanvas, sourceCanvas) {
  const context = displayCanvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  context.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
}
