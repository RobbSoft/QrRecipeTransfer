import { BrowserMultiFormatReader } from 'https://esm.sh/@zxing/library@0.21.3';

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
      // Retry once after metadata is ready (common on iOS).
      await new Promise((resolve) => {
        videoElement.addEventListener('loadedmetadata', resolve, { once: true });
      });
      await videoElement.play();
    }
  }
}

/**
 * Wrapper around ZXing for continuous QR scanning from camera.
 * Optimized for iOS Safari (facingMode fallback, explicit video.play).
 */
export class QrScanner {
  /**
   * @param {HTMLVideoElement} videoElement
   * @param {(text: string) => void} onScan
   */
  constructor(videoElement, onScan) {
    this.videoElement = videoElement;
    this.onScan = onScan;
    this.reader = new BrowserMultiFormatReader();
    this.devices = [];
    this.currentDeviceId = null;
    this.currentFacingMode = 'environment';
    this.isScanning = false;
    this.scanControls = null;
    this.lastScannedText = '';
    this.lastScanTime = 0;
    this.debounceMs = 150;
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
   * Starts scanning with the selected or default camera.
   * @param {string | null} deviceId
   */
  async start(deviceId = null) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamera-API nicht verfügbar. Bitte Safari verwenden.');
    }

    await this.stop();

    const constraints = this.buildConstraints(deviceId);

    try {
      this.isScanning = true;

      this.scanControls = await this.reader.decodeFromConstraints(
        constraints,
        this.videoElement,
        (result, error) => {
          if (result) {
            const text = result.getText();
            const now = Date.now();
            if (text === this.lastScannedText && now - this.lastScanTime < this.debounceMs) {
              return;
            }
            this.lastScannedText = text;
            this.lastScanTime = now;
            this.onScan(text);
          }

          if (error && error.name !== 'NotFoundException') {
            // Ignore "no QR in frame" errors during continuous scanning.
          }
        }
      );

      await ensureVideoPlayback(this.videoElement);
      await this.listCameras();

      const track = this.videoElement.srcObject?.getVideoTracks?.()[0];
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
    } catch (error) {
      this.isScanning = false;
      throw new Error(formatCameraError(error));
    }
  }

  /**
   * Stops the active camera stream.
   */
  async stop() {
    this.isScanning = false;

    if (this.scanControls?.stop) {
      this.scanControls.stop();
      this.scanControls = null;
    }

    this.reader.reset();

    const stream = this.videoElement.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    this.videoElement.srcObject = null;
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

    // iOS often hides device IDs until after permission — toggle facingMode instead.
    this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    await this.start(null);
  }
}
