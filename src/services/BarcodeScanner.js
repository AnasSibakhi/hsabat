/**
 * BarcodeScanner — Final Clean Version
 * 
 * Android Chrome/PWA: Native BarcodeDetector via getUserMedia
 * iOS Safari/Chrome: Quagga2 manages its own stream (no conflict)
 */

let _active   = false;
let _starting = false; // true فقط أثناء انتظار صلاحية الكاميرا — يمنع الضغط المزدوج
let _paused   = false;
let _cb      = null;
let _last    = null;
let _timer   = null;
let _stream  = null;
let _video   = null;
let _raf     = null;
let _flashOn = false;
let _handler = null;

// نظام التأكيد المزدوج — يمنع القراءات الخاطئة
let _pendingCode  = null;
let _pendingCount = 0;
const CONFIRM_NEEDED = 1; // قراءة واحدة تكفي — الـ checksum يتحقق

const DEBOUNCE = 1200;

const eanOk = (code) => {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return true;
  const d = code.split('').map(Number);
  const c = d.pop();
  const s = d.reverse().reduce((a,n,i) => a + (i%2===0 ? n*3 : n), 0);
  return (10 - s%10) %10 === c;
};

const fire = (code) => {
  if (_paused) return; // متوقف مؤقتاً — تجاهل كل القراءات
  if (!code || code === _last) return;
  // التأكيد المزدوج
  if (code === _pendingCode) {
    _pendingCount++;
    if (_pendingCount < CONFIRM_NEEDED) return;
  } else {
    _pendingCode  = code;
    _pendingCount = 1;
    return;
  }
  // قُبلت القراءة
  _pendingCode  = null;
  _pendingCount = 0;
  _last = code;
  clearTimeout(_timer);
  _timer = setTimeout(() => { _last = null; }, DEBOUNCE);
  _cb?.(code);
};

export const BarcodeScanner = {
  isActive: () => _active,
  get _flashOn() { return _flashOn; },

  // ── Pause/Resume — للمسح المتتالي (Bulk Scan) ──
  // الكاميرا تبقى شغالة، فقط معالجة القراءات تتوقف مؤقتاً
  pause() {
    _paused = true;
    _last = null;
    _pendingCode  = null;
    _pendingCount = 0;
  },
  resume() {
    _paused = false;
    _last = null;
    _pendingCode  = null;
    _pendingCount = 0;
  },

  async start(containerId, onSuccess, onError) {
    if (_starting) return; // فتح سابق لسا قيد الانتظار — تجاهل الضغط المزدوج
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }
    _cb = onSuccess; _last = null;
    el.innerHTML = '';

    // مؤشر تحميل واضح بدل الشاشة السودا أثناء انتظار صلاحية الكاميرا
    el.innerHTML = `
      <div id="bc-loading-${containerId}" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;gap:14px;z-index:1;">
        <div style="width:42px;height:42px;border:3px solid rgba(255,255,255,0.2);border-top-color:#6366f1;border-radius:50%;animation:bc-spin 0.8s linear infinite;"></div>
        <span style="color:#fff;font-size:14px;font-family:Cairo,sans-serif;opacity:0.85;">جاري فتح الكاميرا...</span>
      </div>
      <style>@keyframes bc-spin{to{transform:rotate(360deg)}}</style>
    `;

    if ('BarcodeDetector' in window) {
      // ── Android Chrome: Native API ──
      _starting = true;
      // أمان: لو استغرق طلب صلاحية الكاميرا أكثر من المعتاد، حرر القفل تلقائياً
      const safetyRelease = setTimeout(() => { _starting = false; }, 12000);
      try {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch(e) {
        clearTimeout(safetyRelease);
        _starting = false;
        onError?.(e.name === 'NotAllowedError'
          ? 'يرجى السماح بالوصول للكاميرا'
          : 'لا يمكن فتح الكاميرا');
        return;
      }
      clearTimeout(safetyRelease);
      _starting = false;

      _video = document.createElement('video');
      _video.setAttribute('autoplay','');
      _video.setAttribute('playsinline','');
      _video.setAttribute('muted','');
      _video.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;background:#000;';
      _video.srcObject = _stream;
      document.getElementById(`bc-loading-${containerId}`)?.remove(); // امسح مؤشر التحميل
      el.appendChild(_video);
      try { await _video.play(); } catch {}

      _active = true;
      BarcodeScanner._boostNative();
      BarcodeScanner._nativeLoop();

    } else {
      // ── iOS / Quagga: let Quagga manage its own stream ──
      BarcodeScanner._startQuagga(el, onError);
    }
  },

  // ── Native BarcodeDetector loop ──
  _nativeLoop() {
    const det = new BarcodeDetector({
      formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code','data_matrix','itf'],
    });
    const loop = async () => {
      if (!_active) return;
      if (_video?.readyState >= 2) {
        try {
          const r = await det.detect(_video);
          if (r.length) fire(r[0].rawValue);
        } catch {}
      }
      if (_active) _raf = requestAnimationFrame(loop);
    };
    _raf = requestAnimationFrame(loop);
  },

  _boostNative() {
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
        if (c.zoom && c.zoom.min) s.zoom = Math.min(c.zoom.min * 1.5, c.zoom.max || 2);
        if (Object.keys(s).length) t.applyConstraints({ advanced:[s] }).catch(()=>{});
      } catch {}
    }, 800);
  },

  // ── Quagga manages its own stream ──
  _startQuagga(el, onError) {
    _starting = true;
    const safetyRelease = setTimeout(() => { _starting = false; }, 12000);
    const run = () => {
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: el,
          constraints: {
            facingMode: 'environment',
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
          },
          area: {
            top:    '25%',
            right:  '3%',
            left:   '3%',
            bottom: '25%',
          },
        },
        locator: { patchSize: 'medium', halfSample: true },
        numOfWorkers: 2,
        frequency: 20,
        decoder: {
          readers: [
            'ean_reader',
            'upc_reader',
            'upc_e_reader',
            'code_128_reader',
          ],
          multiple: false,
        },
        locate: true,
      }, (err) => {
        clearTimeout(safetyRelease);
        _starting = false;
        if (err) {
          onError?.(err?.message?.includes('ermission')
            ? 'يرجى السماح بالوصول للكاميرا'
            : 'لا يمكن فتح الكاميرا');
          return;
        }
        // امسح مؤشر التحميل قبل ظهور فيديو Quagga
        document.getElementById(`bc-loading-${el.id}`)?.remove();

        Quagga.start();
        _active = true;

        // احفظ stream للفلاش
        setTimeout(() => {
          try {
            const v = el.querySelector('video');
            if (v?.srcObject) _stream = v.srcObject;
            BarcodeScanner._boostQuagga(el);
          } catch {}
        }, 800);

        _handler = (res) => {
          const code = res?.codeResult?.code;
          const fmt  = res?.codeResult?.format;
          if (!code || code.length < 8) return;
          if (fmt === 'ean_13' && code.length !== 13) return;
          if (fmt === 'ean_8'  && code.length !== 8)  return;
          const isEAN = ['ean_13','ean_8','upc_a','upc_e'].includes(fmt);
          if (isEAN && !eanOk(code)) return;
          if (fmt === 'code_128' && code.length < 4) return;
          fire(code);
        };
        Quagga.onDetected(_handler);
      });
    };

    if (window.Quagga) { run(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
    s.onload = run;
    s.onerror = () => onError?.('فشل تحميل الباركود');
    document.head.appendChild(s);
  },

  _boostQuagga(el) {
    try {
      const v = el.querySelector('video');
      const t = v?.srcObject?.getVideoTracks()?.[0];
      if (!t) return;
      const c = t.getCapabilities?.() || {};
      const s = {};
      if (c.focusMode?.includes('continuous'))        s.focusMode = 'continuous';
      if (c.exposureMode?.includes('continuous'))     s.exposureMode = 'continuous';
      if (c.whiteBalanceMode?.includes('continuous')) s.whiteBalanceMode = 'continuous';
      if (c.sharpness) s.sharpness = c.sharpness.max;
      if (Object.keys(s).length) t.applyConstraints({ advanced:[s] }).catch(()=>{});
    } catch {}
  },

  // ── Flash ──
  async toggleFlash() {
    try {
      const t = _stream?.getVideoTracks()?.[0];
      if (!t) { window.Notify?.error?.('الفلاش غير متاح'); return; }
      _flashOn = !_flashOn;
      await t.applyConstraints({ advanced: [{ torch: _flashOn }] });
      // يبحث عن أي زر فلاش ظاهر حالياً (qs أو inv) بدون الاعتماد على صفحة معينة
      const btn = document.getElementById('qs-flash-btn') || document.getElementById('inv-flash-btn');
      if (btn) {
        btn.style.background = _flashOn ? '#fbbf24' : 'rgba(0,0,0,0.5)';
        btn.style.color = _flashOn ? '#000' : '#fff';
      }
    } catch { window.Notify?.error?.('الفلاش غير مدعوم'); }
  },

  // ── Stop ──
  async stop() {
    _active   = false;
    _starting = false;
    _paused   = false;
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    try {
      if (_flashOn) {
        const t = _stream?.getVideoTracks()?.[0];
        await t?.applyConstraints({ advanced: [{ torch: false }] });
        _flashOn = false;
      }
    } catch {}
    try { if (_handler && window.Quagga) { Quagga.offDetected(_handler); Quagga.stop(); } } catch {}
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    _stream = null; _video = null; _handler = null;
    _pendingCode = null; _pendingCount = 0;
    _cb = null; _last = null;
    clearTimeout(_timer);
  },
};
