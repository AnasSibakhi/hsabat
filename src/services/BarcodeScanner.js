/**
 * BarcodeScanner.js — Clean, Fast, Accurate
 * Single stream approach — no conflicts
 */

let _active   = false;
let _callback = null;
let _lastCode = null;
let _debTimer = null;
let _stream   = null;
let _video    = null;
let _rafId    = null;
let _detector = null;

export const BarcodeScanner = {

  _flashOn: false,
  isActive: () => _active,

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback = onSuccess;
    _lastCode = null;

    // ── فتح الكاميرا ──
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:      { ideal: 1280 },
          height:     { ideal: 720  },
        },
        audio: false,
      });
    } catch (e) {
      onError?.(e.name === 'NotAllowedError'
        ? 'يرجى السماح بالوصول للكاميرا'
        : 'لا يمكن فتح الكاميرا');
      return;
    }

    // ── عرض الفيديو ──
    el.innerHTML = '';
    _video = document.createElement('video');
    _video.setAttribute('autoplay', '');
    _video.setAttribute('playsinline', '');
    _video.setAttribute('muted', '');
    _video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    _video.srcObject = _stream;
    el.appendChild(_video);

    try { await _video.play(); } catch {}

    _active = true;

    // ── اختيار المحرك ──
    if ('BarcodeDetector' in window) {
      _detector = new BarcodeDetector({
        formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code'],
      });
      BarcodeScanner._nativeLoop();
    } else {
      // Quagga على نفس الـ stream بدون فتح stream جديد
      BarcodeScanner._quaggaOnStream(el, onError);
    }

    // تحسين الكاميرا بعد ثانية
    setTimeout(() => BarcodeScanner._boost(), 1000);
  },

  // ── Native loop ──
  _nativeLoop() {
    const loop = async () => {
      if (!_active) return;
      try {
        if (_video?.readyState >= 2) {
          const r = await _detector.detect(_video);
          if (r.length) BarcodeScanner._fire(r[0].rawValue);
        }
      } catch {}
      if (_active) _rafId = requestAnimationFrame(loop);
    };
    _rafId = requestAnimationFrame(loop);
  },

  // ── Quagga على stream موجود ──
  _quaggaOnStream(el, onError) {
    const run = () => {
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: el,
          constraints: { facingMode: 'environment', width: 1280, height: 720 },
        },
        locator:      { patchSize: 'medium', halfSample: true },
        numOfWorkers: 2,
        frequency:    15,
        decoder: {
          readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'],
          multiple: false,
        },
        locate: true,
      }, (err) => {
        if (err) { onError?.(err?.message?.includes('ermission') ? 'يرجى السماح بالوصول للكاميرا' : 'خطأ في الكاميرا'); return; }
        Quagga.start();
        Quagga.onDetected((res) => {
          const code   = res?.codeResult?.code;
          const fmt    = res?.codeResult?.format;
          const err    = res?.codeResult?.startInfo?.error ?? 1;
          if (!code || code.length < 4 || err > 0.4) return;
          const isEAN = ['ean_13','ean_8','upc_a','upc_e'].includes(fmt);
          if (isEAN) {
            // checksum validation
            const d = code.split('').map(Number);
            const c = d.pop();
            const s = d.reduce((acc, n, i) => acc + (d.length % 2 === i % 2 ? n * 3 : n), 0);
            if ((10 - s % 10) % 10 !== c) return;
          }
          BarcodeScanner._fire(code);
        });
      });
    };

    if (window.Quagga) { run(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
    s.onload = run;
    s.onerror = () => onError?.('فشل تحميل الباركود');
    document.head.appendChild(s);
  },

  _fire(code) {
    if (!code || code === _lastCode) return;
    _lastCode = code;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => { _lastCode = null; }, 800);
    _callback?.(code);
  },

  _boost() {
    try {
      const track = _stream?.getVideoTracks()?.[0];
      if (!track) return;
      const caps = track.getCapabilities?.() || {};
      const s = {};
      if (caps.focusMode?.includes('continuous'))        s.focusMode = 'continuous';
      if (caps.exposureMode?.includes('continuous'))     s.exposureMode = 'continuous';
      if (caps.whiteBalanceMode?.includes('continuous')) s.whiteBalanceMode = 'continuous';
      if (caps.sharpness) s.sharpness = caps.sharpness.max;
      if (Object.keys(s).length) track.applyConstraints({ advanced: [s] }).catch(() => {});
    } catch {}
  },

  async toggleFlash() {
    try {
      const track = _stream?.getVideoTracks()?.[0];
      if (!track) { window.Notify?.error?.('الفلاش غير متاح'); return; }
      BarcodeScanner._flashOn = !BarcodeScanner._flashOn;
      await track.applyConstraints({ advanced: [{ torch: BarcodeScanner._flashOn }] });
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
    // إطفاء الفلاش
    try {
      if (BarcodeScanner._flashOn) {
        const t = _stream?.getVideoTracks()?.[0];
        await t?.applyConstraints({ advanced: [{ torch: false }] });
        BarcodeScanner._flashOn = false;
      }
    } catch {}
    // إيقاف Quagga
    try { if (window.Quagga) Quagga.stop(); } catch {}
    // إيقاف الـ stream
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    _stream = null; _video = null; _detector = null;
    _callback = null; _lastCode = null;
    clearTimeout(_debTimer);
  },
};
