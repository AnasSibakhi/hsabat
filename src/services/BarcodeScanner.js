/**
 * BarcodeScanner.js — Fast & Simple Quagga2 Scanner
 */

let _active    = false;
let _callback  = null;
let _lastCode  = null;
let _debTimer  = null;

const DEBOUNCE_MS = 800;

export const BarcodeScanner = {

  async _loadLib() {
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

    try { await BarcodeScanner._loadLib(); }
    catch { onError?.('فشل تحميل مكتبة الباركود'); return; }

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback = onSuccess;
    _lastCode = null;

    await new Promise((resolve) => {
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: el,
          constraints: {
            facingMode: 'environment',
            width:  { ideal: 1280 },
            height: { ideal: 720 },
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
          Quagga.onDetected(BarcodeScanner._onDetected);
          _active = true;
        }
        resolve();
      });
    });
  },

  _onDetected(result) {
    const code  = result?.codeResult?.code;
    const error = result?.codeResult?.startInfo?.error;
    if (!code || code.length < 4) return;
    if (error > 0.2) return;
    if (code === _lastCode) return;

    _lastCode = code;
    clearTimeout(_debTimer);
    _debTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE_MS);

    if (navigator.vibrate) navigator.vibrate(50);
    _callback?.(code);
  },

  async stop() {
    if (!_active) return;
    try {
      Quagga.offDetected(BarcodeScanner._onDetected);
      Quagga.stop();
    } catch {}
    _active = false; _callback = null;
    _lastCode = null;
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
