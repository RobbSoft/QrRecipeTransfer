import { decrypt } from '../shared/crypto.js';
import { decompressText } from '../shared/compression.js';
import {
  parseChunkPayload,
  reassembleChunks,
} from '../shared/chunk-protocol.js';
import { QrScanner } from './scanner.js';
import { downloadCsv, parseCsv, sendToGoogleSheet } from './sheets-client.js';

const STORAGE_KEYS = {
  webAppUrl: 'qrsink.webAppUrl',
  spreadsheetId: 'qrsink.spreadsheetId',
  sheetName: 'qrsink.sheetName',
  secret: 'qrsink.secret',
};

const state = {
  chunks: new Map(),
  chunkStates: new Map(),
  total: 0,
  fileId: null,
  totalCrc: null,
  csvText: null,
  failedSeqs: new Set(),
};

const elements = {
  video: document.getElementById('video-preview'),
  passwordInput: document.getElementById('password'),
  cameraSelect: document.getElementById('camera-select'),
  flipCameraBtn: document.getElementById('btn-flip-camera'),
  startCameraBtn: document.getElementById('btn-start-camera'),
  chunkMatrix: document.getElementById('chunk-matrix'),
  statusBox: document.getElementById('status-box'),
  webAppUrl: document.getElementById('web-app-url'),
  spreadsheetId: document.getElementById('spreadsheet-id'),
  sheetName: document.getElementById('sheet-name'),
  secret: document.getElementById('shared-secret'),
  uploadBtn: document.getElementById('btn-upload-sheet'),
  downloadBtn: document.getElementById('btn-download-csv'),
};

const scanner = new QrScanner(elements.video, handleScan);

function setStatus(message, type = 'info') {
  elements.statusBox.textContent = message;
  elements.statusBox.dataset.type = type;
}

function loadSettings() {
  elements.webAppUrl.value = localStorage.getItem(STORAGE_KEYS.webAppUrl) || '';
  elements.spreadsheetId.value = localStorage.getItem(STORAGE_KEYS.spreadsheetId) || '';
  elements.sheetName.value = localStorage.getItem(STORAGE_KEYS.sheetName) || 'Sheet1';
  elements.secret.value = localStorage.getItem(STORAGE_KEYS.secret) || '';
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.webAppUrl, elements.webAppUrl.value.trim());
  localStorage.setItem(STORAGE_KEYS.spreadsheetId, elements.spreadsheetId.value.trim());
  localStorage.setItem(STORAGE_KEYS.sheetName, elements.sheetName.value.trim() || 'Sheet1');
  localStorage.setItem(STORAGE_KEYS.secret, elements.secret.value.trim());
}

function resetTransfer() {
  state.chunks.clear();
  state.chunkStates.clear();
  state.total = 0;
  state.fileId = null;
  state.totalCrc = null;
  state.csvText = null;
  state.failedSeqs.clear();
  elements.uploadBtn.disabled = true;
  elements.downloadBtn.disabled = true;
  renderChunkMatrix();
}

function renderChunkMatrix() {
  elements.chunkMatrix.innerHTML = '';

  if (!state.total) {
    const placeholder = document.createElement('p');
    placeholder.className = 'matrix-placeholder';
    placeholder.textContent = 'Warte auf QR-Sequenz...';
    elements.chunkMatrix.appendChild(placeholder);
    return;
  }

  for (let seq = 1; seq <= state.total; seq += 1) {
    const tile = document.createElement('div');
    tile.className = 'chunk-tile';
    tile.textContent = String(seq);

    const chunkState = state.chunkStates.get(seq) || 'missing';
    tile.dataset.state = chunkState;
    elements.chunkMatrix.appendChild(tile);
  }
}

function updateActionButtons() {
  const ready = Boolean(state.csvText);
  elements.uploadBtn.disabled = !ready;
  elements.downloadBtn.disabled = !ready;
}

async function finalizeTransfer() {
  try {
    const password = elements.passwordInput.value;
    if (!password) {
      setStatus('Bitte Passwort eingeben.', 'error');
      return;
    }

    setStatus('Setze Chunks zusammen und entschlüssele...', 'info');
    const encrypted = reassembleChunks(state.chunks, state.total, state.totalCrc);
    const compressed = await decrypt(encrypted, password);
    state.csvText = decompressText(compressed);

    setStatus(`Transfer abgeschlossen (${state.total} Chunks).`, 'success');
    updateActionButtons();
  } catch (error) {
    state.csvText = null;
    updateActionButtons();
    setStatus(error.message || 'Entschlüsselung fehlgeschlagen.', 'error');
  }
}

function handleScan(rawText) {
  try {
    const { header, chunkBytes } = parseChunkPayload(rawText);

    if (state.fileId && header.fileId !== state.fileId) {
      resetTransfer();
    }

    if (!state.fileId) {
      state.fileId = header.fileId;
      state.total = header.total;
      state.totalCrc = header.totalCrc;
      renderChunkMatrix();
      setStatus(`Session erkannt: ${state.total} Chunks erwartet.`, 'info');
    }

    if (header.total !== state.total || header.totalCrc !== state.totalCrc) {
      setStatus('Inkonsistente Header-Daten erkannt.', 'error');
      return;
    }

    if (state.chunks.has(header.seq)) {
      return;
    }

    state.chunks.set(header.seq, chunkBytes);
    state.chunkStates.set(header.seq, 'received');
    state.failedSeqs.delete(header.seq);
    renderChunkMatrix();

    setStatus(`Chunk ${header.seq} / ${state.total} empfangen.`, 'info');

    if (state.chunks.size === state.total) {
      finalizeTransfer();
    }
  } catch (error) {
    if (error.code === 'CHUNK_CRC_MISMATCH' && error.seq) {
      state.chunkStates.set(error.seq, 'error');
      state.failedSeqs.add(error.seq);
      renderChunkMatrix();
      setStatus(`CRC-Fehler bei Chunk ${error.seq}.`, 'error');
      return;
    }

    // Ignore unrelated QR codes in the camera view.
  }
}

async function populateCameras() {
  const devices = await scanner.listCameras();
  elements.cameraSelect.innerHTML = '';

  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Kamera ${index + 1}`;
    elements.cameraSelect.appendChild(option);
  });
}

async function startCamera() {
  try {
    await scanner.start(elements.cameraSelect.value || null);
    setStatus('Kamera aktiv — QR-Sequenz scannen.', 'info');
  } catch (error) {
    setStatus(error.message || 'Kamera konnte nicht gestartet werden.', 'error');
  }
}

async function uploadToSheet() {
  saveSettings();

  if (!state.csvText) {
    setStatus('Noch keine CSV-Daten verfügbar.', 'error');
    return;
  }

  try {
    setStatus('Sende Daten an Google Sheet...', 'info');
    const rows = parseCsv(state.csvText);
    await sendToGoogleSheet(elements.webAppUrl.value.trim(), {
      spreadsheetId: elements.spreadsheetId.value.trim(),
      sheetName: elements.sheetName.value.trim() || 'Sheet1',
      secret: elements.secret.value.trim() || undefined,
      rows,
    });
    setStatus('Daten erfolgreich in Google Sheet eingetragen.', 'success');
  } catch (error) {
    setStatus(error.message || 'Upload fehlgeschlagen.', 'error');
  }
}

function bindEvents() {
  elements.startCameraBtn.addEventListener('click', startCamera);
  elements.flipCameraBtn.addEventListener('click', () => scanner.flipCamera());
  elements.cameraSelect.addEventListener('change', startCamera);

  [elements.webAppUrl, elements.spreadsheetId, elements.sheetName, elements.secret].forEach((input) => {
    input.addEventListener('change', saveSettings);
  });

  elements.uploadBtn.addEventListener('click', uploadToSheet);
  elements.downloadBtn.addEventListener('click', () => {
    if (!state.csvText) {
      return;
    }
    downloadCsv(state.csvText, 'qr-transfer.csv');
    setStatus('CSV-Download gestartet.', 'success');
  });
}

async function init() {
  loadSettings();
  bindEvents();
  renderChunkMatrix();
  updateActionButtons();

  try {
    await populateCameras();
  } catch (error) {
    setStatus(error.message || 'Kameras konnten nicht geladen werden.', 'error');
  }
}

init();
