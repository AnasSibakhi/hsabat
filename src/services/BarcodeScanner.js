/**
 * BarcodeScanner.js — Stable Quagga2 + Native BarcodeDetector
 */

let _active   = false;
let _callback = null;
let _lastCode = null;
let _debTimer = null;
let _handler  = null;

const DEBOUNCE_MS = 700;

export const BarcodeScanner = {

  async _loadQuagga() {
    if (window.Quagga) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback = onSuccess;
    _lastCode = null;

    try {
      await BarcodeScanner._loadQuagga();
    } catch {
      onError?.('فشل تحميل مكتبة الباركود');
      return;
    }

    _handler = (result) => {
      const code  = result?.codeResult?.code;
      const error = result?.codeResult?.startInfo?.error;
      if (!code || code.length < 4) return;
      if (error !== undefined && error > 0.25) return;
      BarcodeScanner._onDetected(code);
    };

    await new Promise((resolve) => {
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
        locator:      { patchSize: 'medium', halfSample: true },
        numOfWorkers: 2,
        frequency:    10,
        decoder: {
          readers: [
            'ean_reader', 'ean_8_reader',
            'upc_reader', 'upc_e_reader',
            'code_128_reader',
          ],
          multiple: false,
        },
        locate: true,
      }, (err) => {
        if (err) {
          const msg = (err?.message || '').includes('ermission')
            ? 'يرجى السماح بالوصول للكاميرا'
            : 'لا يمكن فتح الكاميرا';
          onError?.(msg);
        } else {
          Quagga.start();
          Quagga.onDetected(_handler);
          _active = true;
          // تحسين الكاميرا بعد ثانية
          setTimeout(() => BarcodeScanner._boost(), 1000);
        }
        resolve();
      });
    });
  },

  async _boost() {
    try {
      const video = document.querySelector('#qs-scanner-container video');
      const track = video?.srcObject?.getVideoTracks?.()?.[0];
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
  },

  _flashOn: false,
  async toggleFlash() {
    try {
      const video = document.querySelector('#qs-scanner-container video');
      const track = video?.srcObject?.getVideoTracks?.()?.[0];
      if (!track) { Notify?.error?.('الفلاش غير متاح'); return; }
      BarcodeScanner._flashOn = !BarcodeScanner._flashOn;
      await track.applyConstraints({ advanced: [{ torch: BarcodeScanner._flashOn }] });
      const btn = document.getElementById('qs-flash-btn');
      if (btn) {
        btn.style.background = BarcodeScanner._flashOn ? '#fbbf24' : 'rgba(0,0,0,0.6)';
        btn.style.color = BarcodeScanner._flashOn ? '#000' : '#fff';
      }
    } catch { Notify?.error?.('الفلاش غير مدعوم'); }
  },

  _onDetected(code) {
    if (!code || code === _lastCode) return;
    _lastCode = code;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE_MS);
    if (navigator.vibrate) navigator.vibrate(50);
    _callback?.(code);
  },

  async stop() {
    if (!_active) return;
    try {
      if (_handler) Quagga.offDetected(_handler);
      Quagga.stop();
    } catch {}
    // إطفاء الفلاش
    if (BarcodeScanner._flashOn) {
      try {
        const video = document.querySelector('#qs-scanner-container video');
        const track = video?.srcObject?.getVideoTracks?.()?.[0];
        await track?.applyConstraints({ advanced: [{ torch: false }] });
      } catch {}
      BarcodeScanner._flashOn = false;
    }
    _active = false; _callback = null;
    _lastCode = null; _handler = null;
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
