import { BrowserMultiFormatReader } from 'https://esm.sh/@zxing/library@0.21.3';

/**
 * Wrapper around ZXing for continuous QR scanning from camera.
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
    this.currentDeviceId = null;
    this.devices = [];
    this.isScanning = false;
    this.lastScannedText = '';
    this.lastScanTime = 0;
    this.debounceMs = 150;
  }

  /**
   * Lists available video input devices.
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async listCameras() {
    this.devices = await this.reader.listVideoInputDevices();
    return this.devices;
  }

  /**
   * Starts scanning with the selected or default camera.
   * @param {string | null} deviceId
   */
  async start(deviceId = null) {
    if (this.isScanning) {
      await this.stop();
    }

    if (!this.devices.length) {
      await this.listCameras();
    }

    const preferred = deviceId
      || this.devices.find((device) => /back|rear|environment/i.test(device.label))?.deviceId
      || this.devices[0]?.deviceId;

    if (!preferred) {
      throw new Error('Keine Kamera gefunden.');
    }

    this.currentDeviceId = preferred;
    this.isScanning = true;

    await this.reader.decodeFromVideoDevice(
      preferred,
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
  }

  /**
   * Stops the active camera stream.
   */
  async stop() {
    this.isScanning = false;
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
    if (!this.devices.length) {
      return;
    }

    const currentIndex = this.devices.findIndex((device) => device.deviceId === this.currentDeviceId);
    const nextIndex = (currentIndex + 1) % this.devices.length;
    await this.start(this.devices[nextIndex].deviceId);
  }
}
