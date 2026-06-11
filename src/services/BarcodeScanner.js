/**
 * BarcodeScanner.js — html5-qrcode Professional Scanner
 * Best mobile barcode library, high sensitivity, low light support
 */

let _active   = false;
let _callback = null;
let _lastCode = null;
let _debTimer = null;
let _scanner  = null;

const DEBOUNCE_MS = 700;

export const BarcodeScanner = {

  async _loadLib() {
    if (window.Html5Qrcode) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();

    try {
      await BarcodeScanner._loadLib();
    } catch {
      onError?.('فشل تحميل مكتبة الباركود');
      return;
    }

    _callback = onSuccess;
    _lastCode = null;

    try {
      _scanner = new Html5Qrcode(containerId, {
        verbose: false,
        useBarCodeDetectorIfSupported: true, // استخدام API المدمج بالمتصفح لو متاح
      });

      const config = {
        fps: 30,
        qrbox: { width: 280, height: 160 },
        aspectRatio: 1.7,
        disableFlip: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
        // إعدادات الكاميرا
        videoConstraints: {
          facingMode: 'environment',
          width:  { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          frameRate: { ideal: 60, min: 30 },
          focusMode: 'continuous',
          exposureMode: 'continuous',
        },
        // كل الأنواع
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ],
      };

      await _scanner.start(
        { facingMode: 'environment' },
        config,
        (code) => BarcodeScanner._onDetected(code),
        () => {} // خطأ عادي — تجاهل
      );

      // تحسين الكاميرا بعد البدء
      setTimeout(() => BarcodeScanner._enhanceCamera(), 1000);

      _active = true;

    } catch (err) {
      const msg = (err?.message || '').toLowerCase().includes('permission')
        ? 'يرجى السماح بالوصول للكاميرا'
        : 'لا يمكن فتح الكاميرا';
      onError?.(msg);
    }
  },

  async _enhanceCamera() {
    try {
      const stream = _scanner?.getRunningTrackCameraCapabilities?.()
        || await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream?.getVideoTracks?.()[0];
      if (!track) return;
      const caps = track.getCapabilities?.() || {};
      const s = {};
      if (caps.focusMode?.includes('continuous'))        s.focusMode = 'continuous';
      if (caps.exposureMode?.includes('continuous'))     s.exposureMode = 'continuous';
      if (caps.whiteBalanceMode?.includes('continuous')) s.whiteBalanceMode = 'continuous';
      if (caps.sharpness) s.sharpness = caps.sharpness.max;
      if (caps.exposureCompensation) s.exposureCompensation = Math.min(caps.exposureCompensation.max, 1);
      if (Object.keys(s).length) await track.applyConstraints({ advanced: [s] });
    } catch {}
  },

  _onDetected(code) {
    if (!code || code.length < 3) return;
    if (code === _lastCode) return;

    _lastCode = code;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE_MS);

    if (navigator.vibrate) navigator.vibrate(50);
    _callback?.(code);
  },

  async stop() {
    if (!_active) return;
    try { await _scanner?.stop(); } catch {}
    try { _scanner?.clear(); } catch {}
    _active = false; _callback = null;
    _lastCode = null; _scanner = null;
    clearTimeout(_debTimer);
  },

  isActive: () => _active,

  _beep() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 1200; osc.type = 'sine';
      gain.gain.setValueAtTime(0.8, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
    } catch {}
  },
};
