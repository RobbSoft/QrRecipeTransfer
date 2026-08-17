import { compressText } from '../shared/compression.js';
import { encrypt, sha256Hex } from '../shared/crypto.js';
import { splitIntoChunks, shortFileId } from '../shared/chunk-protocol.js';
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_ENCRYPTION_PASSWORD,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  INTERVAL_STEP_MS,
} from '../shared/constants.js';
import { DEFAULT_TEST_CSV_NAME, DEFAULT_TEST_CSV_TEXT } from './default-test-csv.js';

const state = {
  headers: [],
  canvases: [],
  currentIndex: 0,
  intervalMs: DEFAULT_INTERVAL_MS,
  loopEnabled: true,
  timerId: null,
  isPlaying: false,
  fileName: '',
};

const elements = {
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  passwordInput: document.getElementById('encryption-key'),
  intervalSlider: document.getElementById('interval-slider'),
  intervalLabel: document.getElementById('interval-label'),
  startBtn: document.getElementById('btn-start'),
  pauseBtn: document.getElementById('btn-pause'),
  prevBtn: document.getElementById('btn-prev'),
  nextBtn: document.getElementById('btn-next'),
  resetBtn: document.getElementById('btn-reset'),
  loopToggle: document.getElementById('loop-toggle'),
  statusText: document.getElementById('status-text'),
  progressBar: document.getElementById('progress-bar'),
  qrCanvas: document.getElementById('qr-canvas'),
  fileInfo: document.getElementById('file-info'),
  errorBox: document.getElementById('error-box'),
};

function setError(message) {
  elements.errorBox.textContent = message || '';
  elements.errorBox.hidden = !message;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function updateProgress() {
  const total = state.headers.length;
  if (total === 0) {
    elements.progressBar.style.width = '0%';
    setStatus('Keine Datei geladen');
    return;
  }

  const current = state.currentIndex + 1;
  const percent = Math.round((current / total) * 100);
  elements.progressBar.style.width = `${percent}%`;
  setStatus(`Chunk ${current} / ${total}`);
}

function updateControls() {
  const hasData = state.canvases.length > 0;
  elements.startBtn.disabled = !hasData || state.isPlaying;
  elements.pauseBtn.disabled = !state.isPlaying;
  elements.prevBtn.disabled = !hasData;
  elements.nextBtn.disabled = !hasData;
  elements.resetBtn.disabled = !hasData;
}

function showCurrentQr() {
  if (!state.canvases.length) {
    return;
  }

  drawQrToDisplay(elements.qrCanvas, state.canvases[state.currentIndex]);
  updateProgress();
}

function stopTimer() {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  state.isPlaying = false;
  updateControls();
}

function advanceFrame() {
  if (!state.canvases.length) {
    return;
  }

  const lastIndex = state.canvases.length - 1;
  if (state.currentIndex >= lastIndex) {
    if (state.loopEnabled) {
      state.currentIndex = 0;
    } else {
      stopTimer();
      return;
    }
  } else {
    state.currentIndex += 1;
  }

  showCurrentQr();
}

function startPlayback() {
  if (!state.canvases.length) {
    return;
  }

  stopTimer();
  state.isPlaying = true;
  updateControls();
  state.timerId = window.setInterval(advanceFrame, state.intervalMs);
}

/**
 * Checks whether a file looks like CSV by extension or MIME type.
 * @param {File} file
 * @returns {boolean}
 */
function isCsvFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    return true;
  }

  const mime = (file.type || '').toLowerCase();
  return mime.includes('csv') || mime === 'text/plain' || mime === 'application/vnd.ms-excel';
}

/**
 * Resolves a dropped or selected file from drag event or input.
 * @param {DragEvent | null} event
 * @returns {File | null}
 */
function getFileFromDropEvent(event) {
  const dataTransfer = event?.dataTransfer;
  if (!dataTransfer) {
    return null;
  }

  if (dataTransfer.files?.length) {
    return dataTransfer.files[0];
  }

  const item = dataTransfer.items?.[0];
  if (item?.kind === 'file') {
    return item.getAsFile();
  }

  return null;
}

async function processCsvFile(file) {
  setError('');
  stopTimer();
  state.currentIndex = 0;

  if (!file) {
    setError('Keine Datei erkannt.');
    return;
  }

  if (!isCsvFile(file)) {
    setError('Bitte eine CSV-Datei auswählen (.csv).');
    return;
  }

  const password = elements.passwordInput.value || DEFAULT_ENCRYPTION_PASSWORD;
  if (!password) {
    setError('Bitte zuerst ein Passwort eingeben.');
    return;
  }

  setStatus('Verarbeite Datei...');
  elements.fileInfo.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;

  try {
    const { preRenderQrCodes, drawQrToDisplay: drawQr } = await import('./qr-renderer.js');
    // Keep draw helper available for playback methods.
    drawQrToDisplay = drawQr;

    const csvText = await file.text();
    const compressed = await compressText(csvText);
    const encrypted = await encrypt(compressed, password);
    const fileId = shortFileId(await sha256Hex(encrypted));
    const { headers } = splitIntoChunks(encrypted, fileId);

    state.headers = headers;
    state.fileName = file.name;
    setStatus(`Rendere ${headers.length} QR-Codes...`);

    state.canvases = await preRenderQrCodes(headers);
    showCurrentQr();
    updateControls();
    setError('');
  } catch (error) {
    setError(error.message || 'Fehler bei der Verarbeitung.');
    state.headers = [];
    state.canvases = [];
    updateProgress();
    updateControls();
  }
}

let drawQrToDisplay = (displayCanvas, sourceCanvas) => {
  const context = displayCanvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  context.drawImage(sourceCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
};

function bindFileHandlers() {
  elements.fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) {
      processCsvFile(file);
    }
    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      elements.dropZone.classList.add('drag-over');
    });
  });

  elements.dropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!elements.dropZone.contains(event.relatedTarget)) {
      elements.dropZone.classList.remove('drag-over');
    }
  });

  elements.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    elements.dropZone.classList.remove('drag-over');
    processCsvFile(getFileFromDropEvent(event));
  });
}

function bindControls() {
  elements.intervalSlider.addEventListener('input', (event) => {
    state.intervalMs = Number(event.target.value);
    elements.intervalLabel.textContent = `${state.intervalMs} ms`;
    if (state.isPlaying) {
      startPlayback();
    }
  });

  elements.loopToggle.addEventListener('change', (event) => {
    state.loopEnabled = event.target.checked;
  });

  elements.startBtn.addEventListener('click', startPlayback);
  elements.pauseBtn.addEventListener('click', stopTimer);

  elements.prevBtn.addEventListener('click', () => {
    if (!state.canvases.length) {
      return;
    }
    state.currentIndex = state.currentIndex > 0
      ? state.currentIndex - 1
      : state.canvases.length - 1;
    showCurrentQr();
  });

  elements.nextBtn.addEventListener('click', () => {
    if (!state.canvases.length) {
      return;
    }
    state.currentIndex = (state.currentIndex + 1) % state.canvases.length;
    showCurrentQr();
  });

  elements.resetBtn.addEventListener('click', () => {
    stopTimer();
    state.currentIndex = 0;
    showCurrentQr();
  });
}

async function loadDefaultTestCsv() {
  setStatus('Lade Test-CSV...');
  elements.fileInfo.textContent = 'Lade Test-CSV...';

  try {
    const file = new File([DEFAULT_TEST_CSV_TEXT], DEFAULT_TEST_CSV_NAME, { type: 'text/csv' });
    await processCsvFile(file);
  } catch (error) {
    setError(error.message || 'Test-CSV konnte nicht geladen werden.');
    elements.fileInfo.textContent = 'Keine Datei ausgewählt';
    updateProgress();
    updateControls();
  }
}

function init() {
  if (!elements.dropZone || !elements.fileInput) {
    setError('Upload-Bereich konnte nicht initialisiert werden.');
    return;
  }

  elements.passwordInput.value = DEFAULT_ENCRYPTION_PASSWORD;
  elements.intervalSlider.min = String(MIN_INTERVAL_MS);
  elements.intervalSlider.max = String(MAX_INTERVAL_MS);
  elements.intervalSlider.step = String(INTERVAL_STEP_MS);
  elements.intervalSlider.value = String(state.intervalMs);
  elements.intervalLabel.textContent = `${state.intervalMs} ms`;
  elements.loopToggle.checked = state.loopEnabled;
  bindFileHandlers();
  bindControls();
  updateProgress();
  updateControls();
  loadDefaultTestCsv();
}

init();
