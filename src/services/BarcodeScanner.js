/**
 * BarcodeScanner — Final Production Version
 * 
 * Strategy:
 * 1. Open ONE camera stream
 * 2. Android/Chrome: BarcodeDetector API (native, fastest)
 * 3. iOS/Safari: Canvas frame analysis with ZXing
 * 4. Fallback: Quagga on existing video element
 * 
 * No stream conflicts. No library version issues.
 */

let _active    = false;
let _callback  = null;
let _lastCode  = null;
let _debTimer  = null;
let _stream    = null;
let _video     = null;
let _canvas    = null;
let _ctx       = null;
let _rafId     = null;
let _flashOn   = false;

const DEBOUNCE = 1000;

// ── EAN/UPC Luhn checksum ──
const eanValid = (code) => {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((acc, n, i) => acc + (i % 2 === 0 ? n * 3 : n), 0);
  return (10 - sum % 10) % 10 === check;
};

// ── Open camera ──
const openCamera = async () => {
  // Try back camera with high resolution
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: 'environment' },
        width:  { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 60 },
      },
      audio: false,
    });
  } catch {}
  // Fallback: any back camera
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch {}
  // Last resort: any camera
  return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
};

// ── Boost camera settings ──
const boostCamera = async (stream) => {
  try {
    const track = stream?.getVideoTracks()?.[0];
    if (!track) return;
    const caps = track.getCapabilities?.() || {};
    const settings = {};
    if (caps.focusMode?.includes('continuous'))        settings.focusMode = 'continuous';
    if (caps.exposureMode?.includes('continuous'))     settings.exposureMode = 'continuous';
    if (caps.whiteBalanceMode?.includes('continuous')) settings.whiteBalanceMode = 'continuous';
    if (caps.sharpness)            settings.sharpness = caps.sharpness.max;
    if (caps.exposureCompensation) settings.exposureCompensation = Math.min(caps.exposureCompensation.max, 1.5);
    if (Object.keys(settings).length) {
      await track.applyConstraints({ advanced: [settings] });
    }
  } catch {}
};

  // ── Fire result ──
const fire = (code) => {
  console.log('[SCAN] detected:', code, 'last:', _lastCode);
  if (!code || code === _lastCode) return;
  _lastCode = code;
  clearTimeout(_debTimer);
  _debTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE);
  console.log('[SCAN] firing callback');
  _callback?.(code);
};

// ── Native BarcodeDetector (Chrome, Android, Edge) ──
const runNative = (dbg) => {
  const detector = new BarcodeDetector({
    formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code','data_matrix'],
  });
  const loop = async () => {
    if (!_active) return;
    try {
      if (_video?.readyState >= 2) {
        const results = await detector.detect(_video);
        if (results.length) {
          if (dbg) dbg.textContent = '✅ قرأ: ' + results[0].rawValue;
          fire(results[0].rawValue);
        }
      }
    } catch {}
    if (_active) _rafId = requestAnimationFrame(loop);
  };
  _rafId = requestAnimationFrame(loop);
};

const runZXing = async (onError, dbg) => {
  if (!window.ZXing) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  if (dbg) dbg.textContent = '🟡 ZXing loaded — scanning...';

  const hints = new Map([
    [ZXing.DecodeHintType.TRY_HARDER, true],
    [ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,  ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.QR_CODE,
    ]],
  ]);

  const reader = new ZXing.BrowserMultiFormatReader(hints);

  // استخدام decodeFromVideoElement مباشرة — أدق من Canvas
  try {
    reader.decodeFromStream(_stream, _video, (result, err) => {
      if (!_active) return;
      if (result) {
        const code = result.getText();
        if (dbg) dbg.textContent = '✅ قرأ: ' + code;
        fire(code);
      }
    });
  } catch {
    // Fallback to canvas loop
    const loop = () => {
      if (!_active) return;
      if (_video?.readyState >= 2 && _canvas && _ctx) {
        const w = _video.videoWidth  || 640;
        const h = _video.videoHeight || 480;
        _canvas.width = w; _canvas.height = h;
        _ctx.drawImage(_video, 0, 0, w, h);
        try {
          const lum    = new ZXing.HTMLCanvasElementLuminanceSource(_canvas);
          const bmp    = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
          const result = reader.decode(bmp);
          if (result) {
            if (dbg) dbg.textContent = '✅ قرأ: ' + result.getText();
            fire(result.getText());
          }
        } catch {}
      }
      if (_active) _rafId = requestAnimationFrame(loop);
    };
    _rafId = requestAnimationFrame(loop);
  }
};

// ── Quagga fallback (last resort) ──
const runQuagga = (el, onError) => {
  const init = () => {
    Quagga.init({
      inputStream: {
        type: 'LiveStream',
        target: el,
        constraints: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      locator: { patchSize: 'medium', halfSample: true },
      numOfWorkers: 2,
      frequency: 15,
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader', 'code_128_reader'],
        multiple: false,
      },
      locate: true,
    }, (err) => {
      if (err) { onError?.('خطأ في الكاميرا'); return; }
      Quagga.start();
      Quagga.onDetected((res) => {
        const code = res?.codeResult?.code;
        const fmt  = res?.codeResult?.format;
        if (!code || code.length < 4) return;
        const isEAN = ['ean_13','ean_8','upc_a','upc_e'].includes(fmt);
        if (isEAN && !eanValid(code)) return;
        fire(code);
      });
    });
  };

  if (window.Quagga) { init(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
  s.onload = init;
  s.onerror = () => onError?.('فشل تحميل الباركود');
  document.head.appendChild(s);
};

// ── Public API ──
export const BarcodeScanner = {

  isActive: () => _active,
  get _flashOn() { return _flashOn; },

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback = onSuccess;
    _lastCode = null;

    // Open camera
    try {
      _stream = await openCamera();
    } catch (e) {
      onError?.(e.name === 'NotAllowedError'
        ? 'يرجى السماح بالوصول للكاميرا'
        : 'لا يمكن فتح الكاميرا');
      return;
    }

    // Create video element
    el.innerHTML = '';
    _video = document.createElement('video');
    _video.setAttribute('autoplay', '');
    _video.setAttribute('playsinline', '');
    _video.setAttribute('muted', '');
    _video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    _video.srcObject = _stream;
    el.appendChild(_video);

    // Create hidden canvas for ZXing
    _canvas = document.createElement('canvas');
    _ctx    = _canvas.getContext('2d', { willReadFrequently: true });

    // Wait for video to be ready
    await new Promise(res => {
      if (_video.readyState >= 2) { res(); return; }
      _video.onloadeddata = res;
      setTimeout(res, 3000);
    });

    try { await _video.play(); } catch {}

    _active = true;
    boostCamera(_stream);

    // Pick engine
    const dbg = document.createElement('div');
    dbg.style.cssText = 'position:absolute;bottom:60px;left:0;right:0;text-align:center;color:#fff;font-size:12px;background:rgba(0,0,0,0.6);padding:4px;z-index:999;font-family:monospace;';
    document.getElementById('qs-scanner-container')?.parentElement?.appendChild(dbg);

    if ('BarcodeDetector' in window) {
      dbg.textContent = '🟢 Native BarcodeDetector';
      runNative(dbg);
    } else {
      dbg.textContent = '🟡 جاري تحميل ZXing...';
      try {
        await runZXing(onError, dbg);
      } catch (e) {
        dbg.textContent = '🔴 Quagga fallback';
        runQuagga(el, onError);
      }
    }
  },

  async toggleFlash() {
    try {
      const track = _stream?.getVideoTracks()?.[0];
      if (!track) { window.Notify?.error?.('الفلاش غير متاح'); return; }
      _flashOn = !_flashOn;
      await track.applyConstraints({ advanced: [{ torch: _flashOn }] });
      const btn = document.getElementById('qs-flash-btn');
      if (btn) {
        btn.style.background = _flashOn ? '#fbbf24' : 'rgba(0,0,0,0.5)';
        btn.style.color = _flashOn ? '#000' : '#fff';
      }
    } catch { window.Notify?.error?.('الفلاش غير مدعوم'); }
  },

  async stop() {
    _active = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    // Flash off
    try {
      if (_flashOn) {
        const t = _stream?.getVideoTracks()?.[0];
        await t?.applyConstraints({ advanced: [{ torch: false }] });
        _flashOn = false;
      }
    } catch {}
    // Stop Quagga
    try { if (window.Quagga) { Quagga.stop(); } } catch {}
    // Stop stream
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    _stream = null; _video = null; _canvas = null; _ctx = null;
    _callback = null; _lastCode = null;
    clearTimeout(_debTimer);
  },
};
