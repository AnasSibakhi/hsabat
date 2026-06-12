/**
 * BarcodeScanner — Final Clean Version
 * 
 * Android Chrome/PWA: Native BarcodeDetector via getUserMedia
 * iOS Safari/Chrome: Quagga2 manages its own stream (no conflict)
 */

let _active  = false;
let _cb      = null;
let _last    = null;
let _timer   = null;
let _stream  = null;
let _video   = null;
let _raf     = null;
let _flashOn = false;
let _handler      = null;
let _pendingCode  = null;
let _pendingCount = 0;
let _liveCode     = null;
let _liveCount    = 0;
let _liveTimer    = null;

const DEBOUNCE = 900;

const eanOk = (code) => {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return true;
  const d = code.split('').map(Number);
  const c = d.pop();
  const s = d.reverse().reduce((a,n,i) => a + (i%2===0 ? n*3 : n), 0);
  return (10 - s%10) %10 === c;
};

const fire = (code) => {
  if (!code || code === _last) return;
  _last = code;
  clearTimeout(_timer);
  _timer = setTimeout(() => { _last = null; }, DEBOUNCE);
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
    el.innerHTML = '';

    if ('BarcodeDetector' in window) {
      // ── Android Chrome: Native API ──
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
        onError?.(e.name === 'NotAllowedError'
          ? 'يرجى السماح بالوصول للكاميرا'
          : 'لا يمكن فتح الكاميرا');
        return;
      }

      _video = document.createElement('video');
      _video.setAttribute('autoplay','');
      _video.setAttribute('playsinline','');
      _video.setAttribute('muted','');
      _video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      _video.srcObject = _stream;
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
        if (Object.keys(s).length) t.applyConstraints({ advanced:[s] }).catch(()=>{});
      } catch {}
    }, 800);
  },

  // ── Quagga manages its own stream ──
  _startQuagga(el, onError) {
    const run = () => {
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: el,
          constraints: {
            facingMode: 'environment',
            width:  { ideal: 1280 },
            height: { ideal: 720  },
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
        frequency: 15,
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
        if (err) {
          onError?.(err?.message?.includes('ermission')
            ? 'يرجى السماح بالوصول للكاميرا'
            : 'لا يمكن فتح الكاميرا');
          return;
        }
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
          // قراءتان متطابقتان للتأكد — reset بعد القبول
          if (_pendingCode === code) {
            _pendingCount++;
          } else {
            _pendingCode  = code;
            _pendingCount = 1;
          }
          if (_pendingCount >= 2) {
            _pendingCode = null; _pendingCount = 0;  // reset فوراً
            // عداد حي — debounce 800ms
            clearTimeout(_liveTimer);
            if (_liveCode === code) {
              _liveCount++;
            } else {
              _liveCode  = code;
              _liveCount = 1;
            }
            // تحديث الشاشة فوراً
            const lc = document.getElementById('qs-live-counter');
            if (lc) {
              const prod      = (window.State?.inventory || []).find(p => p.barcode === code);
              const name      = prod ? prod.name : '';
              const inCart    = window.QuickSale?._getCartQty?.(code) || 0;
              const stock     = prod ? prod.quantity : null;
              const remaining = stock !== null ? Math.max(0, stock - inCart) : null;
              lc.style.display = 'flex';
              lc.innerHTML = '<div style="text-align:center;padding:4px;">'
                + (name ? '<div style="font-size:15px;font-weight:700;margin-bottom:6px;opacity:0.95;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</div>' : '')
                + '<div style="font-size:56px;font-weight:900;line-height:1;">×' + _liveCount + '</div>'
                + (remaining !== null
                    ? '<div style="font-size:13px;opacity:0.85;margin-top:6px;">متبقي: ' + remaining + '</div>'
                    : '')
                + '</div>';
            }
            // إخفاء العداد بعد 1.5 ثانية من آخر قراءة
            _liveTimer = setTimeout(() => {
              _liveCode = null; _liveCount = 0;
              const e = document.getElementById('qs-live-counter');
              if (e) e.style.display = 'none';
            }, 1500);
            fire(code);
          }
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
      const btn = document.getElementById('qs-flash-btn');
      if (btn) {
        btn.style.background = _flashOn ? '#fbbf24' : 'rgba(0,0,0,0.5)';
        btn.style.color = _flashOn ? '#000' : '#fff';
      }
    } catch { window.Notify?.error?.('الفلاش غير مدعوم'); }
  },

  // ── Stop ──
  async stop() {
    _active = false;
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
    _stream = null; _video = null; _handler = null; _pendingCode = null; _pendingCount = 0;
    _cb = null; _last = null;
    clearTimeout(_timer);
  },
};
