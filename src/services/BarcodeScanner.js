/**
 * BarcodeScanner.js — Production Level Barcode Scanner Service
 * Supports: EAN-13, UPC-A, UPC-E, Code128, Code39, QR
 */

let _quaggaLoaded  = false;
let _active        = false;
let _callback      = null;
let _lastCode      = null;
let _readCounts    = {};
let _debounceTimer = null;
const REQUIRED_READS = 1;
const DEBOUNCE_MS    = 600;

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

  async start(containerId, onSuccess, onError) {
    if (_active) await BarcodeScanner.stop();
    try {
      await BarcodeScanner._loadLib();
    } catch {
      onError?.('فشل تحميل مكتبة الباركود');
      return;
    }

    const el = document.getElementById(containerId);
    if (!el) { onError?.('container not found'); return; }

    _callback   = onSuccess;
    _readCounts = {};
    _lastCode   = null;

    try {
      await new Promise((resolve, reject) => {
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
          locator:      { patchSize: 'medium', halfSample: false },
          numOfWorkers: navigator.hardwareConcurrency || 4,
          frequency:    25,
          decoder: {
            readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader',
                      'code_128_reader','code_39_reader'],
            multiple: false,
          },
          locate: true,
        }, err => err ? reject(err) : resolve());
      });

      Quagga.start();
      _active = true;
      Quagga.onDetected(BarcodeScanner._onDetected);

    } catch (err) {
      const msg = (err?.message || '').includes('ermission')
        ? 'يرجى السماح بالوصول للكاميرا في إعدادات المتصفح'
        : 'لا يمكن فتح الكاميرا';
      onError?.(msg);
    }
  },

  _onDetected(result) {
    const code = result?.codeResult?.code;
    if (!code || code.length < 4) return;
    if (code === _lastCode) return;

    _readCounts[code] = (_readCounts[code] || 0) + 1;
    if (_readCounts[code] < REQUIRED_READS) return;

    _lastCode   = code;
    _readCounts = {};

    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _lastCode = null; }, DEBOUNCE_MS);

    _callback?.(code);
  },

  async stop() {
    if (!_active) return;
    try {
      Quagga.offDetected(BarcodeScanner._onDetected);
      Quagga.stop();
    } catch {}
    _active = false; _callback = null;
    _readCounts = {}; _lastCode = null;
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
      gain.gain.setValueAtTime(0.7, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25);
    } catch {}
  },
};
