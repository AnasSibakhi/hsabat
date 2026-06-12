/**
 * BarcodeScanner.js
 * Native BarcodeDetector API (Chrome/Android) → fastest possible
 * Quagga2 fallback for Safari/iOS
 */

let _active    = false;
let _callback  = null;
let _lastCode  = null;
let _debTimer  = null;
let _stream    = null;
let _video     = null;
let _detector  = null;
let _rafId     = null;
let _quaggaCb  = null;

const DEBOUNCE = 800;

// ── EAN/UPC checksum ──
const validChecksum = (code) => {
  if (!/^\d+$/.test(code)) return true; // non-numeric — skip check
  const d = code.split('').map(Number);
  const check = d.pop();
  const sum = d.reduce((s, n, i) => s + (d.length % 2 === i % 2 ? n * 3 : n), 0);
  return (10 - (sum % 10)) % 10 === check;
};

export const BarcodeScanner = {

  _flashOn: false,

  isActive: () => _active,

  // ── Start ──
  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback = onSuccess;
    _lastCode = null;

    // طلب الكاميرا
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:      { ideal: 1280, min: 640 },
          height:     { ideal: 720,  min: 480 },
          frameRate:  { ideal: 60,   min: 30  },
        },
        audio: false,
      });
    } catch (err) {
      onError?.(err.name === 'NotAllowedError'
        ? 'يرجى السماح بالوصول للكاميرا'
        : 'لا يمكن فتح الكاميرا');
      return;
    }

    // إنشاء الفيديو
    _video = document.createElement('video');
    Object.assign(_video, { autoplay: true, playsInline: true, muted: true });
    _video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    _video.srcObject = _stream;
    el.innerHTML = '';
    el.appendChild(_video);

    await new Promise(res => {
      _video.onloadedmetadata = () => { _video.play().then(res).catch(res); };
    });

    // تحسين الكاميرا
    BarcodeScanner._boost();

    _active = true;

    // اختيار المحرك
    if ('BarcodeDetector' in window) {
      BarcodeScanner._startNative();
    } else {
      BarcodeScanner._startQuagga(el, onError);
    }
  },

  // ── Native BarcodeDetector (Chrome/Android) ──
  _startNative() {
    _detector = new BarcodeDetector({
      formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'],
    });

    const loop = async () => {
      if (!_active || !_video) return;
      if (_video.readyState >= 2) {
        try {
          const results = await _detector.detect(_video);
          for (const r of results) {
            if (r.rawValue) { BarcodeScanner._onDetected(r.rawValue); break; }
          }
        } catch {}
      }
      if (_active) _rafId = requestAnimationFrame(loop);
    };
    _rafId = requestAnimationFrame(loop);
  },

  // ── Quagga2 fallback ──
  async _startQuagga(el, onError) {
    if (!window.Quagga) {
      try {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      } catch { onError?.('فشل تحميل الباركود'); return; }
    }

    // Quagga يحتاج container بحجم فعلي — نعطيه الفيديو نفسه
    _quaggaCb = (result) => {
      const code   = result?.codeResult?.code;
      const format = result?.codeResult?.format;
      if (!code || code.length < 4) return;

      const isEAN = ['ean_13','ean_8','upc_a','upc_e'].includes(format);
      if (isEAN && !validChecksum(code)) return; // checksum فاشل — تجاهل

      BarcodeScanner._onDetected(code);
    };

    Quagga.init({
      inputStream: {
        type: 'LiveStream',
        target: el,
        constraints: {
          facingMode: 'environment',
          width:  { ideal: 1280, min: 640 },
          height: { ideal: 720,  min: 480 },
        },
      },
      locator:      { patchSize: 'medium', halfSample: false },
      numOfWorkers: 2,
      frequency:    20,
      decoder: {
        readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'],
        multiple: false,
      },
      locate: true,
    }, (err) => {
      if (err) { onError?.(err.message?.includes('ermission') ? 'يرجى السماح بالوصول للكاميرا' : 'خطأ في الكاميرا'); return; }
      Quagga.start();
      Quagga.onDetected(_quaggaCb);
      BarcodeScanner._boost();
    });
  },

  // ── Camera boost ──
  _boost() {
    setTimeout(async () => {
      try {
        const track = _stream?.getVideoTracks()?.[0];
        if (!track) return;
        const caps = track.getCapabilities?.() || {};
        const s = {};
        if (caps.focusMode?.includes('continuous'))        s.focusMode = 'continuous';
        if (caps.exposureMode?.includes('continuous'))     s.exposureMode = 'continuous';
        if (caps.whiteBalanceMode?.includes('continuous')) s.whiteBalanceMode = 'continuous';
        if (caps.sharpness)            s.sharpness = caps.sharpness.max;
        if (caps.exposureCompensation) s.exposureCompensation = Math.min(caps.exposureCompensation.max, 1);
        if (Object.keys(s).length) await track.applyConstraints({ advanced: [s] });
      } catch {}
    }, 800);
  },

  // ── Flash ──
  async toggleFlash() {
    try {
      const track = _stream?.getVideoTracks()?.[0];
      if (!track) { window.Notify?.error?.('الفلاش غير متاح'); return; }
      BarcodeScanner._flashOn = !BarcodeScanner._flashOn;
      await track.applyConstraints({ advanced: [{ torch: BarcodeScanner._flashOn }] });
      const btn = document.getElementById('qs-flash-btn');
      if (btn) { btn.style.background = BarcodeScanner._flashOn ? '#fbbf24' : 'rgba(0,0,0,0.5)'; btn.style.color = BarcodeScanner._flashOn ? '#000' : '#fff'; }
    } catch { window.Notify?.error?.('الفلاش غير مدعوم'); }
  },

  // ── Detection ──
  _onDetected(code) {
    if (!code || code === _lastCode) return;
    _lastCode = code;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE);
    _callback?.(code);
  },

  // ── Stop ──
  async stop() {
    _active = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    try { if (_quaggaCb && window.Quagga) { Quagga.offDetected(_quaggaCb); Quagga.stop(); } } catch {}
    try {
      if (BarcodeScanner._flashOn) {
        const track = _stream?.getVideoTracks()?.[0];
        await track?.applyConstraints({ advanced: [{ torch: false }] });
        BarcodeScanner._flashOn = false;
      }
    } catch {}
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    _stream = null; _video = null; _detector = null; _quaggaCb = null;
    _callback = null; _lastCode = null;
    clearTimeout(_debTimer);
  },

  _beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.frequency.value = 1200; osc.type = 'sine';
      g.gain.setValueAtTime(0.7, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch {}
  },
};
