/**
 * BarcodeScanner — Simple, Reliable, Fast
 * Android: Native BarcodeDetector (instant)
 * iOS: Quagga2 with existing video stream via canvas hack
 */

let _active  = false;
let _cb      = null;
let _last    = null;
let _timer   = null;
let _stream  = null;
let _video   = null;
let _raf     = null;
let _flashOn = false;

const DEBOUNCE = 900;

const eanOk = (code) => {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return true;
  const d = code.split('').map(Number);
  const c = d.pop();
  const s = d.reverse().reduce((a,n,i) => a + (i%2===0 ? n*3 : n), 0);
  return (10 - s%10) %10 === c;
};

const fire = (code, dbg) => {
  if (!code || code === _last) return;
  _last = code;
  clearTimeout(_timer);
  _timer = setTimeout(() => { _last = null; }, DEBOUNCE);
  if (dbg) dbg.textContent = '✅ ' + code;
  _cb?.(code);
};

export const BarcodeScanner = {
  isActive: () => _active,
  get _flashOn() { return _flashOn; },

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();
    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }
    _cb = onSuccess; _last = null;

    // فتح الكاميرا
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720  },
        },
        audio: false,
      });
    } catch(e) {
      onError?.(e.name==='NotAllowedError' ? 'يرجى السماح بالوصول للكاميرا' : 'لا يمكن فتح الكاميرا');
      return;
    }

    // عرض الفيديو
    el.innerHTML = '';
    _video = document.createElement('video');
    _video.setAttribute('autoplay','');
    _video.setAttribute('playsinline','');
    _video.setAttribute('muted','');
    _video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    _video.srcObject = _stream;
    el.appendChild(_video);
    try { await _video.play(); } catch {}

    // تحسين الكاميرا
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
    }, 1000);

    _active = true;

    // مؤشر debug
    const dbg = document.createElement('div');
    dbg.style.cssText = 'position:absolute;bottom:55px;left:0;right:0;text-align:center;color:#fff;font-size:11px;background:rgba(0,0,0,0.55);padding:3px;z-index:10;font-family:monospace;pointer-events:none;';
    el.parentElement?.appendChild(dbg);

    // اختيار المحرك
    if ('BarcodeDetector' in window) {
      dbg.textContent = '🟢 Native';
      BarcodeScanner._native(dbg);
    } else {
      dbg.textContent = '🟡 Loading Quagga...';
      BarcodeScanner._quagga(el, dbg, onError);
    }
  },

  // ── Native BarcodeDetector ──
  _native(dbg) {
    const det = new BarcodeDetector({
      formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code','data_matrix','itf'],
    });
    const loop = async () => {
      if (!_active) return;
      if (_video?.readyState >= 2) {
        try {
          const r = await det.detect(_video);
          if (r.length) fire(r[0].rawValue, dbg);
        } catch {}
      }
      if (_active) _raf = requestAnimationFrame(loop);
    };
    _raf = requestAnimationFrame(loop);
  },

  // ── Quagga on existing video via canvas ──
  _quagga(el, dbg, onError) {
    const init = () => {
      // نستخدم الـ video element الموجود مباشرة
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: _video,  // الفيديو الموجود مباشرة
          constraints: {
            facingMode: 'environment',
            width:  { ideal: 1280 },
            height: { ideal: 720  },
          },
        },
        locator: { patchSize: 'medium', halfSample: true },
        numOfWorkers: 2,
        frequency: 15,
        decoder: {
          readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'],
          multiple: false,
        },
        locate: true,
      }, (err) => {
        if (err) {
          // LiveStream فشل — نجرب Canvas loop
          dbg.textContent = '🟡 Canvas mode...';
          BarcodeScanner._canvasLoop(dbg, onError);
          return;
        }
        dbg.textContent = '🟢 Quagga ready';
        Quagga.start();
        Quagga.onDetected((res) => {
          const code = res?.codeResult?.code;
          const fmt  = res?.codeResult?.format;
          if (!code || code.length < 4) return;
          const isEAN = ['ean_13','ean_8','upc_a','upc_e'].includes(fmt);
          if (isEAN && !eanOk(code)) return;
          fire(code, dbg);
        });
      });
    };

    if (window.Quagga) { init(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
    s.onload = () => { dbg.textContent = '🟢 Quagga loaded'; init(); };
    s.onerror = () => {
      dbg.textContent = '🟡 Canvas fallback...';
      BarcodeScanner._canvasLoop(dbg, onError);
    };
    document.head.appendChild(s);
  },

  // ── Canvas + Quagga ImageReader loop ──
  _canvasLoop(dbg, onError) {
    // نستخدم canvas لالتقاط frames وQuagga لتحليلها
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const scan = () => {
      if (!_active) return;
      if (_video?.readyState >= 2) {
        canvas.width  = _video.videoWidth  || 640;
        canvas.height = _video.videoHeight || 480;
        ctx.drawImage(_video, 0, 0, canvas.width, canvas.height);

        if (window.Quagga) {
          Quagga.decodeSingle({
            decoder: {
              readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'],
            },
            locate: true,
            src: canvas.toDataURL(),
          }, (res) => {
            if (!_active) return;
            const code = res?.codeResult?.code;
            const fmt  = res?.codeResult?.format;
            if (!code || code.length < 4) { if (_active) _raf = requestAnimationFrame(scan); return; }
            const isEAN = ['ean_13','ean_8','upc_a','upc_e'].includes(fmt);
            if (isEAN && !eanOk(code)) { if (_active) _raf = requestAnimationFrame(scan); return; }
            fire(code, dbg);
            if (_active) setTimeout(() => { if (_active) _raf = requestAnimationFrame(scan); }, 500);
          });
        } else {
          _raf = requestAnimationFrame(scan);
        }
      } else {
        _raf = requestAnimationFrame(scan);
      }
    };

    dbg.textContent = '🟢 Canvas ready';
    _raf = requestAnimationFrame(scan);
  },

  // ── Flash ──
  async toggleFlash() {
    try {
      const t = _stream?.getVideoTracks()?.[0];
      if (!t) { window.Notify?.error?.('الفلاش غير متاح'); return; }
      _flashOn = !_flashOn;
      await t.applyConstraints({ advanced: [{ torch: _flashOn }] });
      const btn = document.getElementById('qs-flash-btn');
      if (btn) { btn.style.background = _flashOn ? '#fbbf24' : 'rgba(0,0,0,0.5)'; btn.style.color = _flashOn ? '#000' : '#fff'; }
    } catch { window.Notify?.error?.('الفلاش غير مدعوم'); }
  },

  // ── Stop ──
  async stop() {
    _active = false;
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    try { if (_flashOn) { const t=_stream?.getVideoTracks()?.[0]; await t?.applyConstraints({advanced:[{torch:false}]}); _flashOn=false; } } catch {}
    try { if (window.Quagga) Quagga.stop(); } catch {}
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    _stream=null; _video=null; _cb=null; _last=null;
    clearTimeout(_timer);
  },
};
