/**
 * BarcodeScanner.js — ZXing Professional Barcode Scanner
 * High sensitivity, fast, works in low light
 */

let _active    = false;
let _callback  = null;
let _lastCode  = null;
let _debTimer  = null;
let _controls  = null;
let _stream    = null;

const DEBOUNCE_MS = 700;

export const BarcodeScanner = {

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    try {
      // تحميل ZXing
      if (!window.ZXing) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://unpkg.com/@zxing/browser@0.1.5/umd/index.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('load_failed'));
          document.head.appendChild(s);
        });
      }

      _callback = onSuccess;
      _lastCode = null;

      // إعداد الكاميرا بأعلى جودة
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          frameRate: { ideal: 60, min: 30 },
          focusMode: 'continuous',
          exposureMode: 'continuous',
          whiteBalanceMode: 'continuous',
        }
      });

      // عرض الفيديو
      let video = el.querySelector('video');
      if (!video) {
        video = document.createElement('video');
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        el.appendChild(video);
      }
      video.srcObject = _stream;
      video.setAttribute('playsinline', true);
      await video.play();

      // تحسين الكاميرا
      await BarcodeScanner._enhanceCamera(_stream);

      // ZXing reader
      const hints = new Map();
      const formats = [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.QR_CODE,
        ZXing.BarcodeFormat.DATA_MATRIX,
      ];
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      hints.set(ZXing.DecodeHintType.CHARACTER_SET, 'UTF-8');

      const reader = new ZXing.BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 30,   // 30ms بين كل محاولة — سريع جداً
        delayBetweenScanSuccess: DEBOUNCE_MS,
      });

      _controls = await reader.decodeFromStream(_stream, video, (result, error) => {
        if (result) BarcodeScanner._onDetected(result.getText());
      });

      _active = true;

    } catch (err) {
      const msg = (err?.message || '').toLowerCase().includes('permission')
        ? 'يرجى السماح بالوصول للكاميرا'
        : 'لا يمكن فتح الكاميرا: ' + (err?.message || '');
      onError?.(msg);
    }
  },

  async _enhanceCamera(stream) {
    try {
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      const caps = track.getCapabilities?.() || {};
      const settings = {};
      if (caps.focusMode?.includes?.('continuous'))       settings.focusMode = 'continuous';
      if (caps.exposureMode?.includes?.('continuous'))    settings.exposureMode = 'continuous';
      if (caps.whiteBalanceMode?.includes?.('continuous')) settings.whiteBalanceMode = 'continuous';
      if (caps.exposureCompensation) settings.exposureCompensation = Math.min(caps.exposureCompensation.max, 1);
      if (caps.brightness) settings.brightness = Math.round((caps.brightness.max + caps.brightness.min) / 2 + caps.brightness.max * 0.2);
      if (caps.sharpness) settings.sharpness = caps.sharpness.max;
      if (Object.keys(settings).length) await track.applyConstraints({ advanced: [settings] });
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
    try { _controls?.stop?.(); } catch {}
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    _active = false; _callback = null;
    _lastCode = null; _controls = null; _stream = null;
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
