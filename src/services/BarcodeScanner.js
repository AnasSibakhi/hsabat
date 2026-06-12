/**
 * BarcodeScanner — Production Grade
 * Android: Native BarcodeDetector API
 * iOS: ZXing-js (best iOS barcode library)
 */

let _active   = false;
let _callback = null;
let _lastCode = null;
let _debTimer = null;
let _stream   = null;
let _video    = null;
let _rafId    = null;
let _zxing    = null;

const DEBOUNCE = 1000;

// EAN/UPC checksum
const eanOk = (code) => {
  if (!/^\d+$/.test(code)) return true;
  const d = code.split('').map(Number);
  const c = d.pop();
  const s = d.reduce((a, n, i) => a + (d.length % 2 === i % 2 ? n * 3 : n), 0);
  return (10 - s % 10) % 10 === c;
};

export const BarcodeScanner = {

  _flashOn: false,
  isActive: () => _active,

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();
    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback = onSuccess;
    _lastCode = null;

    // فتح الكاميرا
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      onError?.(e.name === 'NotAllowedError' ? 'يرجى السماح بالوصول للكاميرا' : 'لا يمكن فتح الكاميرا');
      return;
    }

    // عرض الفيديو
    el.innerHTML = '';
    _video = document.createElement('video');
    _video.setAttribute('autoplay', '');
    _video.setAttribute('playsinline', '');
    _video.setAttribute('muted', '');
    _video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    _video.srcObject = _stream;
    el.appendChild(_video);

    await new Promise(res => {
      _video.onloadedmetadata = () => _video.play().then(res).catch(res);
      setTimeout(res, 3000); // timeout safety
    });

    _active = true;
    BarcodeScanner._boost();

    if ('BarcodeDetector' in window) {
      // Android Chrome - Native API
      BarcodeScanner._runNative();
    } else {
      // iOS Safari - ZXing
      BarcodeScanner._runZXing(el, onError);
    }
  },

  // Native BarcodeDetector - Android
  _runNative() {
    const det = new BarcodeDetector({
      formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code'],
    });
    const loop = async () => {
      if (!_active) return;
      try {
        if (_video?.readyState >= 2) {
          const r = await det.detect(_video);
          if (r.length) BarcodeScanner._fire(r[0].rawValue);
        }
      } catch {}
      if (_active) _rafId = requestAnimationFrame(loop);
    };
    _rafId = requestAnimationFrame(loop);
  },

  // ZXing - iOS Safari
  async _runZXing(el, onError) {
    try {
      if (!window.ZXing) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      const hints = new Map();
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E,
        ZXing.BarcodeFormat.CODE_128,
      ]);

      _zxing = new ZXing.BrowserMultiFormatReader(hints);
      const canvas  = document.createElement('canvas');
      const ctx     = canvas.getContext('2d');

      const scan = () => {
        if (!_active) return;
        if (_video?.readyState >= 2) {
          canvas.width  = _video.videoWidth  || 640;
          canvas.height = _video.videoHeight || 480;
          ctx.drawImage(_video, 0, 0, canvas.width, canvas.height);
          try {
            const r = _zxing.decodeFromCanvas(canvas);
            if (r) BarcodeScanner._fire(r.getText());
          } catch {}
        }
        if (_active) _rafId = requestAnimationFrame(scan);
      };
      _rafId = requestAnimationFrame(scan);

    } catch {
      // ZXing failed - fallback to Quagga
      BarcodeScanner._runQuagga(el, onError);
    }
  },

  // Quagga - last resort fallback
  _runQuagga(el, onError) {
    const load = (cb) => {
      if (window.Quagga) { cb(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
      s.onload = cb; s.onerror = () => onError?.('فشل تحميل الباركود');
      document.head.appendChild(s);
    };
    load(() => {
      Quagga.init({
        inputStream: { type:'LiveStream', target:el,
          constraints:{ facingMode:'environment', width:1280, height:720 } },
        locator: { patchSize:'medium', halfSample:true },
        numOfWorkers: 2, frequency: 15,
        decoder: { readers:['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'], multiple:false },
        locate: true,
      }, (err) => {
        if (err) { onError?.('خطأ في الكاميرا'); return; }
        Quagga.start();
        Quagga.onDetected((res) => {
          const code = res?.codeResult?.code;
          const fmt  = res?.codeResult?.format;
          if (!code || code.length < 4) return;
          const isEAN = ['ean_13','ean_8','upc_a','upc_e'].includes(fmt);
          if (isEAN && !eanOk(code)) return;
          BarcodeScanner._fire(code);
        });
      });
    });
  },

  _fire(code) {
    if (!code || code === _lastCode) return;
    _lastCode = code;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE);
    _callback?.(code);
  },

  _boost() {
    setTimeout(() => {
      try {
        const t = _stream?.getVideoTracks()?.[0];
        if (!t) return;
        const c = t.getCapabilities?.() || {};
        const s = {};
        if (c.focusMode?.includes('continuous'))        s.focusMode = 'continuous';
        if (c.exposureMode?.includes('continuous'))     s.exposureMode = 'continuous';
        if (c.whiteBalanceMode?.includes('continuous')) s.whiteBalanceMode = 'continuous';
        if (c.sharpness) s.sharpness = c.sharpness.max;
        if (Object.keys(s).length) t.applyConstraints({ advanced:[s] }).catch(()=>{});
      } catch {}
    }, 800);
  },

  async toggleFlash() {
    try {
      const t = _stream?.getVideoTracks()?.[0];
      if (!t) { window.Notify?.error?.('الفلاش غير متاح'); return; }
      BarcodeScanner._flashOn = !BarcodeScanner._flashOn;
      await t.applyConstraints({ advanced:[{ torch: BarcodeScanner._flashOn }] });
      const btn = document.getElementById('qs-flash-btn');
      if (btn) {
        btn.style.background = BarcodeScanner._flashOn ? '#fbbf24' : 'rgba(0,0,0,0.5)';
        btn.style.color = BarcodeScanner._flashOn ? '#000' : '#fff';
      }
    } catch { window.Notify?.error?.('الفلاش غير مدعوم'); }
  },

  async stop() {
    _active = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    try { if (BarcodeScanner._flashOn) { const t=_stream?.getVideoTracks()?.[0]; await t?.applyConstraints({advanced:[{torch:false}]}); BarcodeScanner._flashOn=false; } } catch {}
    try { if (window.Quagga) Quagga.stop(); } catch {}
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    _stream=null; _video=null; _zxing=null;
    _callback=null; _lastCode=null;
    clearTimeout(_debTimer);
  },
};
