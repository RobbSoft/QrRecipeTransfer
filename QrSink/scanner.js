/**
 * Maps getUserMedia errors to user-friendly German messages.
 * @param {Error} error
 * @returns {string}
 */
function formatCameraError(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Kamera-Zugriff verweigert. Bitte in Safari unter Einstellungen > Safari > Kamera erlauben.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Keine Kamera gefunden.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Kamera wird bereits von einer anderen App verwendet.';
  }
  if (name === 'OverconstrainedError') {
    return 'Gewünschte Kamera ist nicht verfügbar.';
  }
  if (name === 'SecurityError') {
    return 'Kamera nur über HTTPS verfügbar.';
  }
  return error?.message || 'Kamera konnte nicht gestartet werden.';
}

/**
 * Ensures iOS Safari plays the inline video preview.
 * @param {HTMLVideoElement} videoElement
 */
async function ensureVideoPlayback(videoElement) {
  videoElement.setAttribute('playsinline', 'true');
  videoElement.setAttribute('webkit-playsinline', 'true');
  videoElement.muted = true;

  if (videoElement.paused) {
    try {
      await videoElement.play();
    } catch {
      await new Promise((resolve) => {
        videoElement.addEventListener('loadedmetadata', resolve, { once: true });
      });
      await videoElement.play();
    }
  }
}

/**
 * Continuous QR scanner using native BarcodeDetector or jsQR fallback.
 * Optimized for scanning QR sequences from a screen via iPhone camera.
 */
export class QrScanner {
  /**
   * @param {HTMLVideoElement} videoElement
   * @param {(text: string) => void} onScan
   * @param {(event: { type: string, engine?: string }) => void} [onActivity]
   */
  constructor(videoElement, onScan, onActivity = null) {
    this.videoElement = videoElement;
    this.onScan = onScan;
    this.onActivity = onActivity;
    this.devices = [];
    this.currentDeviceId = null;
    this.currentFacingMode = 'environment';
    this.isScanning = false;
    this.stream = null;
    this.animationFrameId = null;
    this.lastScannedText = '';
    this.lastScanTime = 0;
    this.lastFrameScanTime = 0;
    this.debounceMs = 200;
    this.frameIntervalMs = 80;
    this.engine = 'none';
    this.detector = null;
    this.jsQR = null;
    this.scanCanvas = document.createElement('canvas');
    this.scanContext = this.scanCanvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * @returns {string}
   */
  getEngineName() {
    return this.engine;
  }

  /**
   * Lists available video input devices (requires camera permission on iOS).
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.devices = [];
      return this.devices;
    }

    const allDevices = await navigator.mediaDevices.enumerateDevices();
    this.devices = allDevices.filter((device) => device.kind === 'videoinput');
    return this.devices;
  }

  /**
   * Builds getUserMedia constraints for the selected or default camera.
   * @param {string | null} deviceId
   * @returns {MediaStreamConstraints}
   */
  buildConstraints(deviceId = null) {
    if (deviceId) {
      return { video: { deviceId: { exact: deviceId } }, audio: false };
    }

    return {
      video: {
        facingMode: { ideal: this.currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
  }

  /**
   * Initializes the best available QR decoding engine.
   */
  async initEngine() {
    if ('BarcodeDetector' in globalThis) {
      try {
        this.detector = new BarcodeDetector({ formats: ['qr_code'] });
        this.engine = 'BarcodeDetector';
        return;
      } catch {
        this.detector = null;
      }
    }

    const jsQRModule = await import('https://esm.sh/jsqr@1.4.0');
    this.jsQR = jsQRModule.default;
    this.engine = 'jsQR';
  }

  /**
   * Starts scanning with the selected or default camera.
   * @param {string | null} deviceId
   */
  async start(deviceId = null) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamera-API nicht verfügbar. Bitte Safari verwenden.');
    }

    await this.stop();
    await this.initEngine();

    const constraints = this.buildConstraints(deviceId);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      await ensureVideoPlayback(this.videoElement);
      await this.listCameras();

      const track = this.stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings();
        if (settings.deviceId) {
          this.currentDeviceId = settings.deviceId;
        }
        if (settings.facingMode) {
          this.currentFacingMode = settings.facingMode;
        }
      } else if (deviceId) {
        this.currentDeviceId = deviceId;
      }

      this.isScanning = true;
      this.onActivity?.({ type: 'engine_ready', engine: this.engine });
      this.scanLoop();
    } catch (error) {
      this.isScanning = false;
      throw new Error(formatCameraError(error));
    }
  }

  /**
   * Runs the continuous scan loop.
   */
  scanLoop() {
    if (!this.isScanning) {
      return;
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.processFrame();
      this.scanLoop();
    });
  }

  /**
   * Processes one video frame for QR codes.
   */
  async processFrame() {
    const now = Date.now();
    if (now - this.lastFrameScanTime < this.frameIntervalMs) {
      return;
    }
    this.lastFrameScanTime = now;

    const video = this.videoElement;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    let text = null;

    try {
      if (this.detector) {
        const barcodes = await this.detector.detect(video);
        if (barcodes.length > 0) {
          text = barcodes[0].rawValue;
        }
      } else if (this.jsQR) {
        text = this.scanWithJsQR(video);
      }
    } catch {
      // Skip frame on transient decode errors.
    }

    if (!text) {
      return;
    }

    this.onActivity?.({ type: 'qr_detected', engine: this.engine });

    if (text === this.lastScannedText && now - this.lastScanTime < this.debounceMs) {
      return;
    }

    this.lastScannedText = text;
    this.lastScanTime = now;
    this.onScan(text);
  }

  /**
   * Decodes a QR code from a video frame using jsQR.
   * @param {HTMLVideoElement} video
   * @returns {string | null}
   */
  scanWithJsQR(video) {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      return null;
    }

    const maxWidth = 720;
    const scale = Math.min(1, maxWidth / sourceWidth);
    const width = Math.max(1, Math.floor(sourceWidth * scale));
    const height = Math.max(1, Math.floor(sourceHeight * scale));

    this.scanCanvas.width = width;
    this.scanCanvas.height = height;
    this.scanContext.drawImage(video, 0, 0, width, height);

    const imageData = this.scanContext.getImageData(0, 0, width, height);
    const result = this.jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });

    return result?.data || null;
  }

  /**
   * Stops the active camera stream.
   */
  async stop() {
    this.isScanning = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.videoElement.srcObject = null;
    this.detector = null;
    this.jsQR = null;
    this.engine = 'none';
  }

  /**
   * Switches to the next available camera.
   */
  async flipCamera() {
    await this.listCameras();

    const usableDevices = this.devices.filter((device) => device.deviceId);
    if (usableDevices.length >= 2 && this.currentDeviceId) {
      const currentIndex = usableDevices.findIndex((device) => device.deviceId === this.currentDeviceId);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % usableDevices.length : 0;
      await this.start(usableDevices[nextIndex].deviceId);
      return;
    }

    this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    await this.start(null);
  }
}
