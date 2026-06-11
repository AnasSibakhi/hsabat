/**
 * BarcodeScanner.js — Native BarcodeDetector API
 * Falls back to Quagga2 if BarcodeDetector not supported
 * Professional grade: fast, accurate, low-light
 */

let _active    = false;
let _callback  = null;
let _lastCode  = null;
let _debTimer  = null;
let _stream    = null;
let _video     = null;
let _rafId     = null;
let _detector  = null;
let _useNative = false;

const DEBOUNCE_MS = 700;

export const BarcodeScanner = {

  // ── Check native support ──
  _supportsNative() {
    return 'BarcodeDetector' in window;
  },

  // ── Start ──
  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback = onSuccess;
    _lastCode = null;
    _useNative = BarcodeScanner._supportsNative();

    try {
      // طلب الكاميرا بأعلى جودة
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode:  { ideal: 'environment' },
          width:       { ideal: 1920, min: 640 },
          height:      { ideal: 1080, min: 480 },
          frameRate:   { ideal: 60,   min: 15  },
        },
        audio: false,
      });

      // إنشاء عنصر الفيديو
      _video = document.createElement('video');
      _video.srcObject      = _stream;
      _video.autoplay       = true;
      _video.playsInline    = true;
      _video.muted          = true;
      _video.style.cssText  = 'width:100%;height:100%;object-fit:cover;display:block;';
      el.appendChild(_video);
      await _video.play();

      // تحسين الكاميرا
      await BarcodeScanner._boost();

      _active = true;

      if (_useNative) {
        // ── Native BarcodeDetector ──
        _detector = new BarcodeDetector({
          formats: [
            'ean_13','ean_8','upc_a','upc_e',
            'code_128','code_39','code_93',
            'qr_code','data_matrix','itf',
          ],
        });
        BarcodeScanner._nativeLoop();
      } else {
        // ── Fallback: Quagga2 ──
        await BarcodeScanner._startQuagga(el);
      }

    } catch (err) {
      const msg = (err?.name === 'NotAllowedError' || (err?.message||'').includes('ermission'))
        ? 'يرجى السماح بالوصول للكاميرا'
        : 'لا يمكن فتح الكاميرا';
      onError?.(msg);
      await BarcodeScanner.stop();
    }
  },

  // ── Native scan loop ──
  _nativeLoop() {
    if (!_active || !_video || !_detector) return;

    const scan = async () => {
      if (!_active) return;
      try {
        if (_video.readyState === _video.HAVE_ENOUGH_DATA) {
          const codes = await _detector.detect(_video);
          if (codes.length > 0) {
            BarcodeScanner._onDetected(codes[0].rawValue);
          }
        }
      } catch {}
      if (_active) _rafId = requestAnimationFrame(scan);
    };

    _rafId = requestAnimationFrame(scan);
  },

  // ── Quagga2 fallback ──
  async _startQuagga(el) {
    if (!window.Quagga) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    // أوقف الفيديو اللي فتحناه وخلي Quagga يفتح كاميراه
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    if (_video)  { _video.remove(); _video = null; }

    await new Promise((resolve) => {
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: el,
          constraints: {
            facingMode: 'environment',
            width:  { ideal: 1280 },
            height: { ideal: 720  },
          },
        },
        locator:      { patchSize: 'medium', halfSample: true },
        numOfWorkers: 2,
        frequency:    10,
        decoder: {
          readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'],
          multiple: false,
        },
        locate: true,
      }, (err) => {
        if (!err) {
          Quagga.start();
          Quagga.onDetected((result) => {
            const code  = result?.codeResult?.code;
            const error = result?.codeResult?.startInfo?.error;
            if (code && code.length >= 4 && error <= 0.2) {
              BarcodeScanner._onDetected(code);
            }
          });
        }
        resolve();
      });
    });
  },

  // ── Camera boost ──
  async _boost() {
    try {
      const track = _stream?.getVideoTracks?.()?.[0];
      if (!track) return;
      const caps = track.getCapabilities?.() || {};
      const s = {};
      if (caps.focusMode?.includes('continuous'))        s.focusMode = 'continuous';
      if (caps.exposureMode?.includes('continuous'))     s.exposureMode = 'continuous';
      if (caps.whiteBalanceMode?.includes('continuous')) s.whiteBalanceMode = 'continuous';
      if (caps.sharpness)             s.sharpness = caps.sharpness.max;
      if (caps.exposureCompensation)  s.exposureCompensation = Math.min(caps.exposureCompensation.max, 1.5);
      if (caps.brightness)            s.brightness = Math.round((caps.brightness.max - caps.brightness.min) * 0.65 + caps.brightness.min);
      if (Object.keys(s).length) await track.applyConstraints({ advanced: [s] });
    } catch {}
  },

  // ── Flash toggle ──
  _flashOn: false,
  async toggleFlash() {
    try {
      const track = _stream?.getVideoTracks?.()?.[0];
      if (!track) { Notify.error('الفلاش غير متاح'); return; }
      BarcodeScanner._flashOn = !BarcodeScanner._flashOn;
      await track.applyConstraints({ advanced: [{ torch: BarcodeScanner._flashOn }] });
      const btn = document.getElementById('qs-flash-btn');
      if (btn) {
        btn.style.background = BarcodeScanner._flashOn ? '#fbbf24' : 'rgba(0,0,0,0.6)';
        btn.style.color = BarcodeScanner._flashOn ? '#000' : '#fff';
      }
    } catch { Notify.error('الفلاش غير مدعوم'); }
  },

  // ── Detection handler ──
  _onDetected(code) {
    if (!code || code.length < 3) return;
    if (code === _lastCode) return;
    _lastCode = code;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE_MS);
    if (navigator.vibrate) navigator.vibrate([30, 10, 30]);
    _callback?.(code);
  },

  // ── Stop ──
  async stop() {
    _active = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    // إطفاء الفلاش
    try {
      const track = _stream?.getVideoTracks?.()?.[0];
      if (track && BarcodeScanner._flashOn) {
        await track.applyConstraints({ advanced: [{ torch: false }] });
        BarcodeScanner._flashOn = false;
      }
    } catch {}
    // إيقاف الـ stream
    try { _stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { _video?.remove(); } catch {}
    _stream = null; _video = null; _detector = null;
    // إيقاف Quagga لو كان يعمل
    try { if (!_useNative && window.Quagga) Quagga.stop(); } catch {}
    _callback = null; _lastCode = null;
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
