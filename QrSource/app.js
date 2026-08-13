import { compressText } from '../shared/compression.js';
import { encrypt, sha256Hex } from '../shared/crypto.js';
import { splitIntoChunks } from '../shared/chunk-protocol.js';
import { DEFAULT_INTERVAL_MS } from '../shared/constants.js';
import { drawQrToDisplay, preRenderQrCodes } from './qr-renderer.js';

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
  passwordInput: document.getElementById('password'),
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

async function processCsvFile(file) {
  setError('');
  stopTimer();
  state.currentIndex = 0;

  if (!file.name.toLowerCase().endsWith('.csv')) {
    setError('Bitte eine CSV-Datei auswählen.');
    return;
  }

  const password = elements.passwordInput.value;
  if (!password) {
    setError('Bitte ein Passwort eingeben.');
    return;
  }

  setStatus('Verarbeite Datei...');
  elements.fileInfo.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;

  try {
    const csvText = await file.text();
    const compressed = compressText(csvText);
    const encrypted = await encrypt(compressed, password);
    const fileId = await sha256Hex(encrypted);
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

function bindFileHandlers() {
  elements.fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) {
      processCsvFile(file);
    }
  });

  elements.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('drag-over');
  });

  elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('drag-over');
  });

  elements.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      processCsvFile(file);
    }
  });

  elements.dropZone.addEventListener('click', () => {
    elements.fileInput.click();
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

function init() {
  elements.intervalLabel.textContent = `${state.intervalMs} ms`;
  elements.loopToggle.checked = state.loopEnabled;
  bindFileHandlers();
  bindControls();
  updateProgress();
  updateControls();
}

init();
