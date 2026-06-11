/**
 * BarcodeScanner.js — High Sensitivity Barcode Scanner
 * Optimized for low light, fast detection, all common formats
 */

let _quaggaLoaded  = false;
let _active        = false;
let _callback      = null;
let _lastCode      = null;
let _debounceTimer = null;
let _videoTrack    = null;

const DEBOUNCE_MS = 800;

export const BarcodeScanner = {

  async _loadLib() {
    if (_quaggaLoaded || window.Quagga) { _quaggaLoaded = true; return; }
    return new Promise((resolve, reject) => {
      const s   = document.createElement('script');
      s.src     = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
      s.onload  = () => { _quaggaLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('load_failed'));
      document.head.appendChild(s);
    });
  },

  // تحسين الكاميرا: رفع التعرض للضوء ومنع الاهتزاز
  async _enhanceCamera(track) {
    if (!track) return;
    try {
      const caps = track.getCapabilities();
      const settings = {};
      // رفع التعرض للضوء في الأماكن المظلمة
      if (caps.exposureMode?.includes('continuous')) settings.exposureMode = 'continuous';
      if (caps.exposureCompensation) {
        const max = caps.exposureCompensation.max;
        settings.exposureCompensation = Math.min(max, 1.5);
      }
      // تثبيت التركيز
      if (caps.focusMode?.includes('continuous')) settings.focusMode = 'continuous';
      // تثبيت البياض
      if (caps.whiteBalanceMode?.includes('continuous')) settings.whiteBalanceMode = 'continuous';
      // رفع السطوع
      if (caps.brightness) {
        const max = caps.brightness.max;
        settings.brightness = Math.min(max * 0.7, max);
      }
      if (Object.keys(settings).length) await track.applyConstraints({ advanced: [settings] });
    } catch {}
  },

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();
    try { await BarcodeScanner._loadLib(); }
    catch { onError?.('فشل تحميل مكتبة الباركود'); return; }

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback  = onSuccess;
    _lastCode  = null;

    try {
      await new Promise((resolve, reject) => {
        Quagga.init({
          inputStream: {
            type: 'LiveStream',
            target: el,
            constraints: {
              facingMode: 'environment',
              width:  { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              // طلب معدل إطارات عالٍ
              frameRate: { ideal: 60, min: 30 },
            },
          },
          locator: {
            patchSize: 'medium',
            halfSample: true,      // أسرع مع الحفاظ على الدقة
          },
          numOfWorkers: Math.min(navigator.hardwareConcurrency || 4, 4),
          frequency: 15,           // كل 15 إطار — أسرع بدون إثقال المعالج
          decoder: {
            readers: [
              { format: 'ean_reader',     config: { supplements: [] } },
              { format: 'ean_8_reader',   config: {} },
              { format: 'upc_reader',     config: {} },
              { format: 'upc_e_reader',   config: {} },
              { format: 'code_128_reader',config: {} },
              { format: 'code_39_reader', config: {} },
            ],
            multiple: false,
            debug: { drawBoundingBox: false, showFrequency: false },
          },
          locate: true,
        }, err => err ? reject(err) : resolve());
      });

      Quagga.start();
      _active = true;

      // الحصول على track الكاميرا وتحسينها
      const video = el.querySelector('video');
      if (video?.srcObject) {
        _videoTrack = video.srcObject.getVideoTracks()[0];
        await BarcodeScanner._enhanceCamera(_videoTrack);
      }

      Quagga.onDetected(BarcodeScanner._onDetected);
      // معالجة الصورة — رفع التباين
      Quagga.onProcessed(BarcodeScanner._onProcessed);

    } catch (err) {
      const msg = (err?.message || '').includes('ermission')
        ? 'يرجى السماح بالوصول للكاميرا في إعدادات المتصفح'
        : 'لا يمكن فتح الكاميرا';
      onError?.(msg);
    }
  },

  _onProcessed(result) {
    // رسم مربع الاكتشاف بلون أخضر واضح
    const canvas = Quagga.canvas.dom.overlay;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (result?.boxes) {
      result.boxes
        .filter(b => b !== result.box)
        .forEach(box => {
          Quagga.ImageDebug.drawPath(box, { x: 0, y: 1 }, ctx, { color: 'rgba(99,102,241,0.3)', lineWidth: 2 });
        });
    }
    if (result?.box) {
      Quagga.ImageDebug.drawPath(result.box, { x: 0, y: 1 }, ctx, { color: '#6366f1', lineWidth: 3 });
    }
    if (result?.codeResult?.code) {
      Quagga.ImageDebug.drawPath(result.line, { x: 'x', y: 'y' }, ctx, { color: '#22c55e', lineWidth: 4 });
    }
  },

  _onDetected(result) {
    const code  = result?.codeResult?.code;
    const score = result?.codeResult?.startInfo?.error;
    if (!code || code.length < 4) return;
    // فلترة النتائج ذات الثقة المنخفضة
    if (score > 0.25) return;
    if (code === _lastCode) return;

    _lastCode = code;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE_MS);

    // اهتزاز + صوت
    if (navigator.vibrate) navigator.vibrate(50);
    _callback?.(code);
  },

  async stop() {
    if (!_active) return;
    try {
      Quagga.offDetected(BarcodeScanner._onDetected);
      Quagga.offProcessed(BarcodeScanner._onProcessed);
      Quagga.stop();
    } catch {}
    _active = false; _callback = null;
    _lastCode = null; _videoTrack = null;
    clearTimeout(_debounceTimer);
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
