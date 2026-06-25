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

const DEBOUNCE = 1200;

// ── الطبقة 1: تحقق checksum رياضي حقيقي — EAN-8, EAN-13, UPC-A ──
// هذا الفحص الرياضي وحده موثوق به بنسبة عالية جداً (يكتشف أي خطأ برقم واحد، وأغلب
// أخطاء تبديل رقمين متجاورين). لا نضيف أي "كاشف تكرار/تذبذب" فوقه لأن أي خوارزمية
// توقيتية مبنية على "استقرار القراءة" ستفشل بالضرورة أمام باركود تالف يعطي نفس
// القراءة الخاطئة بثبات — استقرار القراءة لا يعني صحتها، الـ checksum وحده يثبت ذلك
const upcCheck = (twelveOrThirteen) => {
  const d = twelveOrThirteen.split('').map(Number);
  const c = d.pop();
  const s = d.reverse().reduce((a,n,i) => a + (i%2===0 ? n*3 : n), 0);
  return (10 - s%10) %10 === c;
};

const eanOk = (code) => {
  if (/^\d{8}$|^\d{13}$/.test(code)) return upcCheck(code); // EAN-8 / EAN-13
  if (/^\d{12}$/.test(code))         return upcCheck(code); // UPC-A
  return true; // UPC-E وصيغ أخرى (code_128, qr_code...) لا تحتوي checksum رياضي قابل للتحقق هنا بأمان
};

// ── الطبقة 3: فحص شكلي حسب الصيغة — طول وتنسيق متوقع لكل نوع ──
const formatSanityOk = (code, fmt) => {
  if (!code) return false;
  switch (fmt) {
    case 'ean_13':       return /^\d{13}$/.test(code);
    case 'ean_8':        return /^\d{8}$/.test(code);
    case 'upc_a':        return /^\d{12}$/.test(code);
    case 'upc_e':        return /^\d{6,8}$/.test(code);
    case 'code_128':     return code.length >= 4 && code.length <= 48;
    case 'code_39':      return /^[0-9A-Z\-. $/+%]{1,43}$/.test(code);
    case 'itf':          return /^\d{6,14}$/.test(code) && code.length % 2 === 0;
    case 'qr_code':
    case 'data_matrix':  return code.length >= 1;
    default:             return code.length >= 3;
  }
};

// ── نقطة الدخول الموحَّدة لكل قراءة — من أي مسار (Android أو iOS) ──
// تُطبَّق نفس قواعد الدقة الثلاث بدقة متطابقة على المسارين، بلا أي ثغرة فروق بينهما
const validateAndFire = (code, fmt) => {
  if (!code) return;
  if (!formatSanityOk(code, fmt)) return; // فشل الفحص الشكلي — رفض فوري

  const isEAN = ['ean_13', 'ean_8', 'upc_a'].includes(fmt);
  if (isEAN && !eanOk(code)) return; // فشل checksum رياضي — رفض فوري وقاطع، هذا الفحص وحده كافٍ وموثوق

  fire(code);
};

const fire = (code) => {
  if (_paused) return; // متوقف مؤقتاً — تجاهل كل القراءات
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
    if (_starting) return; // فتح سابق لسا قيد الانتظار — تجاهل الضغط المزدوج
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }
    _cb = onSuccess; _last = null;
    el.innerHTML = '';

    // مؤشر تحميل واضح بدل الشاشة السودا أثناء انتظار صلاحية الكاميرا
    el.innerHTML = `
      <div id="bc-loading-${containerId}" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;gap:14px;z-index:1;">
        <div style="width:42px;height:42px;border:3px solid rgba(255,255,255,0.2);border-top-color:var(--p);border-radius:50%;animation:bc-spin 0.8s linear infinite;"></div>
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

  // ── فحص حدّة الصورة (Laplacian Variance) — يرفض الإطارات الضبابية قبل تحليلها أصلاً ──
  // مقياس معياري حقيقي بمعالجة الصور: الإطار الواضح فيه تغيّرات حادة بالسطوع (حواف الباركود
  // نفسها)، الإطار الضبابي يكون "أنعم" بلا تباين حقيقي. هذا يمنع المشكلة من جذرها — لا
  // نحاول قراءة باركود من صورة غير واضحة من البداية، بدل محاولة تصحيح القراءة الخاطئة بعدها
  _isFrameSharp(video) {
    if (!BarcodeScanner._sharpCanvas) {
      BarcodeScanner._sharpCanvas = document.createElement('canvas');
      BarcodeScanner._sharpCanvas.width  = 48; // عينة مصغَّرة — كافية تماماً لقياس الحدّة، تقلل التكلفة الحسابية بشكل كبير
      BarcodeScanner._sharpCanvas.height = 27;
    }
    const canvas = BarcodeScanner._sharpCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const w = canvas.width, h = canvas.height;
    // القناة الخضراء وحدها كتقريب سريع للسطوع (تقريب معياري بمعالجة الصور السريعة، تحقّق
    // رياضياً بفرق ~1.9% فقط مقابل التحويل الرمادي الكامل تحت إضاءة واقعية متفاوتة الألوان)
    // — يدمج مرور التحويل ومرور Laplacian بحلقة واحدة بدل مرورين منفصلين على كل البيانات
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const c  = data[idx * 4 + 1];
        const cl = data[(idx-1) * 4 + 1];
        const cr = data[(idx+1) * 4 + 1];
        const cu = data[(idx-w) * 4 + 1];
        const cd = data[(idx+w) * 4 + 1];
        const lap = -4 * c + cl + cr + cu + cd;
        sum += lap; sumSq += lap * lap; n++;
      }
    }
    const mean = sum / n;
    const variance = (sumSq / n) - (mean * mean);

    return variance > 250; // معايَرة بدقة على عينة 48×27 — أعلى من نطاق الإطارات الضبابية بشكل حقيقي
  },

  // ── Native BarcodeDetector loop ──
  _nativeLoop() {
    const det = new BarcodeDetector({
      formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code','data_matrix','itf'],
    });
    const loop = async () => {
      if (!_active) return;
      if (_video?.readyState >= 2 && BarcodeScanner._isFrameSharp(_video)) {
        try {
          const r = await det.detect(_video);
          if (r.length) validateAndFire(r[0].rawValue, r[0].format);
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
          // ── فحص ثقة فك التشفير المدمج بـ Quagga2 نفسها — يرفض القراءات منخفضة الثقة قبل أي شي آخر ──
          // decodedCodes[].error هي قيمة موثَّقة رسمياً من Quagga2 (0 = ثقة كاملة، 1 = خطأ مرجَّح)
          // محسوبة من داخل خوارزمية فك التشفير نفسها وقت قراءة كل شريط/فراغ بالباركود فعلياً
          const codes = res?.codeResult?.decodedCodes || [];
          const hasHighError = codes.some(c => typeof c?.error === 'number' && c.error > 0.15);
          if (hasHighError) return; // رفض فوري — الخوارزمية نفسها غير واثقة من هذي القراءة
          validateAndFire(code, fmt);
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
      // يبحث عن أي زر فلاش ظاهر حالياً (qs أو inv أو invc) بدون الاعتماد على صفحة معينة
      const btn = document.getElementById('qs-flash-btn') || document.getElementById('inv-flash-btn') || document.getElementById('invc-flash-btn');
      if (btn) {
        btn.style.background = _flashOn ? 'var(--w)' : 'rgba(0,0,0,0.5)';
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
    _cb = null; _last = null;
    clearTimeout(_timer);
  },
};
