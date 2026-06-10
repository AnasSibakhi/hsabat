/**
 * quicksale.js — Professional POS Module
 * Production-ready: barcode, camera scan, cart, payment
 */

import { DB, sb, sbAdmin } from '../core/db.js';
import { State }           from '../core/state.js';
import { Notify }          from '../core/notify.js';
import * as DOM            from '../core/dom.js';
import * as Utils          from '../core/utils.js';
import { escape, today }   from '../core/utils.js';
import { CONFIG, PAYMENT } from '../config/constants.js';
import * as Modal          from '../nav/modal.js';
import { getDashboard, getDebts, getInventory } from '../core/registry.js';

// ── State ──
let _cart     = [];   // [{id, name, barcode, unit, price, cost, qty, maxQty}]
let _discount = 0;
let _scanner  = null;
let _lastScan = null;
let _scanTimer = null;

export const QuickSale = {

  // ── Init ──
  async init() {
    _cart     = [];
    _discount = 0;
    QuickSale._renderCart();
    QuickSale._renderGrid();
    QuickSale._loadStats();
    const si = DOM.get('qs-search-input');
    if (si) si.value = '';
    // Physical barcode scanner support (keyboard input)
    QuickSale._initPhysicalScanner();
    // Auto-focus barcode input for physical scanner
    const bi = DOM.get('qs-barcode-input');
    if (bi) setTimeout(() => bi.focus(), 200);
  },

  // ── Physical Scanner (USB/Bluetooth barcode reader) ──
  _initPhysicalScanner() {
    const input = DOM.get('qs-barcode-input');
    if (!input) return;
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const code = input.value.trim();
        input.value = '';
        if (code) await QuickSale._onBarcode(code);
        // Re-focus for next scan
        setTimeout(() => input.focus(), 100);
      }
    });
  },

  // ── Product Grid ──
  async _renderGrid(filter = '') {
    const grid = DOM.get('qs-product-grid');
    if (!grid) return;

    // Always use State.inventory - loadList() populates it in place
    if (!State.inventory.length) {
      const inv = getInventory();
      if (inv) await inv.loadList();
    }
    let list = State.inventory;

    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode || '').includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    } else {
      list = list.filter(p => p.quantity > 0 && p.sale_price > 0);
    }

    if (!list.length) {
      grid.innerHTML = '<div class="qs-empty">' +
        (filter ? '🔍 لا توجد نتائج لـ "' + escape(filter) + '"' : 'لا يوجد مخزون متاح للبيع') +
        '</div>';
      return;
    }

    grid.innerHTML = list.slice(0, 40).map(p => {
      const low   = p.quantity <= p.low_stock_alert;
      const zero  = p.quantity <= 0;
      return '<button class="qs-product-btn' + (zero ? ' qs-out' : '') + '" ' +
        (zero ? 'disabled' : 'onclick="QuickSale.addToCart(\'' + p.id + '\')"') + '>' +
        '<div class="qs-p-name">' + escape(p.name) + '</div>' +
        '<div class="qs-p-price">₪' + (p.sale_price || 0).toFixed(2) + '</div>' +
        '<div class="qs-p-stock ' + (low ? 'low' : zero ? 'out' : '') + '">' +
          (zero ? 'نفد' : p.quantity + ' ' + escape(p.unit || '')) +
        '</div>' +
        '</button>';
    }).join('');
  },

  search(val) {
    clearTimeout(QuickSale._searchTimer);
    QuickSale._searchTimer = setTimeout(() => QuickSale._renderGrid(val), 200);
  },

  // ── Cart ──
  addToCart(productId) {
    const p = State.inventory.find(x => x.id === productId);
    if (!p) return;
    if (!p.sale_price || p.sale_price <= 0) {
      Notify.error('"' + p.name + '" ليس له سعر بيع');
      return;
    }
    if (p.quantity <= 0) {
      Notify.error('نفد المخزون لـ "' + p.name + '"');
      return;
    }

    const existing = _cart.find(c => c.id === productId);
    if (existing) {
      if (existing.qty >= p.quantity) {
        Notify.error('المخزون غير كافٍ — المتبقي: ' + p.quantity);
        return;
      }
      existing.qty++;
    } else {
      _cart.push({
        id:     p.id,
        name:   p.name,
        barcode: p.barcode || '',
        unit:   p.unit || '',
        price:  p.sale_price,
        cost:   0,
        qty:    1,
        maxQty: p.quantity,
      });
    }

    if (navigator.vibrate) navigator.vibrate(30);
    QuickSale._beep();
    QuickSale._renderCart();
  },

  removeFromCart(id) {
    _cart = _cart.filter(c => c.id !== id);
    QuickSale._renderCart();
  },

  changeQty(id, delta) {
    const item = _cart.find(c => c.id === id);
    if (!item) return;
    // Sync maxQty from latest inventory
    const inv = State.inventory.find(p => p.id === id);
    if (inv) item.maxQty = inv.quantity;
    const newQty = item.qty + delta;
    if (newQty <= 0) { QuickSale.removeFromCart(id); return; }
    if (newQty > item.maxQty) { Notify.error('المخزون غير كافٍ — المتبقي: ' + item.maxQty); return; }
    item.qty = newQty;
    QuickSale._renderCart();
  },

  _renderCart() {
    const el = DOM.get('qs-cart-items');
    if (!el) return;

    if (!_cart.length) {
      el.innerHTML = '<div class="pos-cart-empty"><i class="ti ti-shopping-cart"></i><p>السلة فارغة<br>اختر منتجاً أو امسح باركود</p></div>';
      DOM.setText('qs-items-count', '0');
      DOM.setText('qs-total-display', '₪ 0.00');
      const s = DOM.get('qs-summary-box'); if (s) s.innerHTML = '';
      return;
    }

    const subtotal = _cart.reduce((s, c) => s + c.qty * c.price, 0);
    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);

    el.innerHTML = _cart.map(item => {
      const line = item.qty * item.price;
      return '<div class="qs-cart-item" id="ci-' + item.id + '">' +
        '<div class="qs-ci-main">' +
          '<div class="qs-ci-name">' + escape(item.name) + '</div>' +
          '<div class="qs-ci-meta">₪' + item.price.toFixed(2) + ' × ' + item.qty +
            ' = <strong>₪' + line.toFixed(2) + '</strong></div>' +
        '</div>' +
        '<div class="qs-ci-ctrl">' +
          '<button class="qs-qb" onclick="QuickSale.changeQty(\'' + item.id + '\',-1)">−</button>' +
          '<span class="qs-qn">' + item.qty + '</span>' +
          '<button class="qs-qb" onclick="QuickSale.changeQty(\'' + item.id + '\',1)">+</button>' +
          '<button class="qs-rm" onclick="QuickSale.removeFromCart(\'' + item.id + '\')"><i class="ti ti-x"></i></button>' +
        '</div>' +
        '</div>';
    }).join('');

    DOM.setText('qs-items-count', _cart.length + ' صنف');
    DOM.setText('qs-total-display', '₪ ' + total.toFixed(2));

    const s = DOM.get('qs-summary-box');
    if (s) {
      let h = '<div class="pos-sum-row"><span>المجموع الفرعي</span><span>₪' + subtotal.toFixed(2) + '</span></div>';
      if (discount > 0) h += '<div class="pos-sum-row"><span>خصم ' + _discount + '%</span><span class="disc">−₪' + discount.toFixed(2) + '</span></div>';
      h += '<div class="pos-sum-row pos-total"><span>الإجمالي</span><span>₪' + total.toFixed(2) + '</span></div>';
      s.innerHTML = h;
    }

    QuickSale.calcChange();
  },

  applyDiscount(pct) {
    _discount = pct;
    QuickSale._renderCart();
    Notify.show(pct > 0 ? 'خصم ' + pct + '%' : 'تم إلغاء الخصم');
    document.querySelectorAll('.pos-disc').forEach(b => b.classList.remove('active'));
    const active = document.querySelector('.pos-disc[data-pct="' + pct + '"]');
    if (active) active.classList.add('active');
  },

  calcChange() {
    const subtotal = _cart.reduce((s, c) => s + c.qty * c.price, 0);
    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);
    const paid     = parseFloat(DOM.val('qs-paid')) || 0;
    const el       = DOM.get('qs-change');
    if (!el) return;
    if (paid <= 0) { el.textContent = '—'; el.style.color = 'var(--g4)'; return; }
    const change = paid - total;
    el.textContent = '₪ ' + Math.abs(change).toFixed(2) + (change >= 0 ? ' (باقي)' : ' (ناقص)');
    el.style.color = change >= 0 ? 'var(--s)' : 'var(--d)';
  },

  clearCart() {
    _cart = []; _discount = 0;
    QuickSale._renderCart();
    const si = DOM.get('qs-search-input'); if (si) { si.value = ''; }
    const bi = DOM.get('qs-barcode-input'); if (bi) { bi.value = ''; bi.focus(); }
    const pi = DOM.get('qs-paid'); if (pi) pi.value = '';
    const ch = DOM.get('qs-change'); if (ch) { ch.textContent = '—'; ch.style.color = 'var(--g4)'; }
document.querySelectorAll('.pos-disc').forEach(b => b.classList.remove('active'));
    QuickSale._renderGrid();
  },

  // ── Barcode ──
  async _onBarcode(code) {
    // Debounce
    if (code === _lastScan) return;
    _lastScan = code;
    clearTimeout(_scanTimer);
    _scanTimer = setTimeout(() => { _lastScan = null; }, 1500);

    // Search in cached inventory first
    let product = State.inventory.find(p => p.barcode === code);

    // If not found, search DB
    if (!product) {
      const { data } = await DB.inventory().select('*').eq('barcode', code).maybeSingle();
      if (data) {
        product = data;
        // Add to cache
        if (!State.inventory.find(p => p.id === data.id)) State.inventory.push(data);
      }
    }

    if (product) {
      QuickSale.addToCart(product.id);
      QuickSale._beep('success');
    } else {
      // Open add product modal
      const bc = DOM.get('qs-new-barcode'); if (bc) bc.value = code;
      const nm = DOM.get('qs-new-name');   if (nm) { nm.value = ''; setTimeout(() => nm.focus(), 200); }
      Modal.open('m-new-product');
      Notify.error('المنتج غير موجود — أضفه الآن');
      QuickSale._beep('error');
    }

    const bi = DOM.get('qs-barcode-input'); if (bi) setTimeout(() => bi.focus(), 200);
  },

  // ── Camera Scanner ──
  async startScanner() {
    if (_scanner) return; // already running

    const overlay = DOM.get('qs-scanner-overlay');
    if (overlay) overlay.style.display = 'flex';

    // Load Quagga2 if not loaded
    if (!window.Quagga) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('failed'));
          document.head.appendChild(s);
        });
      } catch {
        Notify.error('فشل تحميل مكتبة الباركود');
        QuickSale.stopScanner();
        return;
      }
    }

    const container = DOM.get('qs-scanner-container');
    if (!container) return;

    // Named handler so we can remove it correctly
    const counts = {};
    const _handler = (result) => {
      const code = result?.codeResult?.code;
      if (!code || code.length < 4) return;
      counts[code] = (counts[code] || 0) + 1;
      if (counts[code] >= 3) {
        QuickSale.stopScanner();
        QuickSale._onBarcode(code);
      }
    };

    await new Promise((resolve) => {
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: container,
          constraints: {
            facingMode: 'environment',
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        locator:   { patchSize: 'medium', halfSample: true },
        frequency: 10,
        decoder: {
          readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'],
        },
        locate: true,
      }, (err) => {
        if (err) {
          const msg = (err?.message || '').includes('ermission')
            ? 'يرجى السماح بالوصول للكاميرا'
            : 'لا يمكن فتح الكاميرا';
          Notify.error(msg);
          QuickSale.stopScanner();
        } else {
          Quagga.start();
          _scanner = _handler; // store named handler reference
          Quagga.onDetected(_handler);
        }
        resolve();
      });
    });
  },

  stopScanner() {
    try {
      if (_scanner && window.Quagga) {
        Quagga.offDetected(_scanner); // remove named handler
        Quagga.stop();
      }
    } catch {}
    _scanner = null;
    const overlay = DOM.get('qs-scanner-overlay'); if (overlay) overlay.style.display = 'none';
    const container = DOM.get('qs-scanner-container'); if (container) container.innerHTML = '';
    const bi = DOM.get('qs-barcode-input'); if (bi) bi.focus();
  },

  // ── Add new product from scanner ──
  async saveNewProduct() {
    const toNum = s => parseFloat((s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const name  = DOM.val('qs-new-name');
    const sell  = toNum(DOM.val('qs-new-sell'));
    const qty   = toNum(DOM.val('qs-new-qty'))  || 0;
    const bc    = DOM.val('qs-new-barcode');

    if (!name)              { Notify.error('أدخل اسم المنتج'); return; }
    if (!sell || sell <= 0) { Notify.error('أدخل سعر البيع');  return; }

    // Check barcode uniqueness
    if (bc) {
      const { data: existing } = await DB.inventory().select('id,name').eq('barcode', bc).maybeSingle();
      if (existing) { Notify.error('الباركود موجود مسبقاً لـ "' + existing.name + '"'); return; }
    }

    try {
      const { data, error } = await DB.inventory().insert({
        store_id:        State.user.id,
        name,
        barcode:         bc || null,
        category:        DOM.get('qs-new-cat')?.value  || 'عام',
        unit:            DOM.get('qs-new-unit')?.value || 'قطعة (pcs)',
        quantity:        qty,
        sale_price:      sell,
        low_stock_alert: 10,
      }).select().single();
      if (error) throw error;

      State.inventory.push(data);
      Modal.close('m-new-product');
      QuickSale.addToCart(data.id);
      QuickSale._renderGrid();
      Notify.success('تم إضافة "' + name + '" للمخزون وللسلة');
    } catch (err) { Notify.error(err.message); }
  },

  // ── Debt modal ──
  openDebtModal() {
    DOM.setHTML('qs-debt-cust',
      '<option value="">-- اختر الزبون --</option>' +
      State.customers.map(c => '<option value="' + c.id + '">' + escape(c.name) + '</option>').join('')
    );
    Modal.open('m-qs-debt');
  },

  // ── Checkout ──
  async sell(paymentType) {
    if (!_cart.length) { Notify.error('السلة فارغة'); return; }

    const subtotal = _cart.reduce((s, c) => s + c.qty * c.price, 0);
    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);
    let   custId   = null, custName = 'زبون عادي';

    if (paymentType === PAYMENT.DEFER) {
      custId = DOM.val('qs-debt-cust');
      if (!custId) { Notify.error('اختر الزبون'); return; }
      const c = State.customers.find(x => x.id === custId);
      custName = c?.name || '';
      Modal.close('m-qs-debt');
    }

    State.isMutating = true;
    try {
      const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
      const invNum = 'INV-' + String((count || 0) + 1).padStart(4, '0');

      const { data: inv, error } = await DB.invoices().insert({
        store_id: State.user.id, customer_id: custId || null,
        customer_name: custName, total, subtotal, discount,
        payment_type: paymentType,
        invoice_date: Utils.today(),
        sale_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        invoice_number: invNum,
      }).select().single();
      if (error) throw error;

      // Save line items
      await sb.from('invoice_items').insert(_cart.map(c => ({
        invoice_id: inv.id, product_name: c.name,
        inventory_id: c.id, quantity: c.qty, price: c.price,
      })));

      // Deduct inventory
      for (const item of _cart) {
        const p = State.inventory.find(x => x.id === item.id);
        if (p) {
          const newQty = Math.max(0, p.quantity - item.qty);
          await DB.inventory().update({ quantity: newQty }).eq('id', item.id);
          p.quantity = newQty;
          if (newQty <= p.low_stock_alert && newQty > 0) Notify.warn('"' + p.name + '" — المخزون منخفض: ' + newQty);
        }
      }

      // Create debt if needed
      if (paymentType === PAYMENT.DEFER && custId) {
        await DB.debts().insert({ store_id: State.user.id, customer_id: custId, amount: total, paid: 0, debt_date: Utils.today(), notes: 'فاتورة ' + invNum });
        await getDebts()?.loadBadge();
      }

      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      QuickSale._beep();
      Notify.success(invNum + ' — ₪' + total.toFixed(2));
      QuickSale.clearCart();
      await getDashboard()?.load();
      await QuickSale._loadStats();
      // Sync maxQty for cart after inventory update
      const invSvc = getInventory(); if (invSvc) await invSvc.loadList();
      QuickSale._renderGrid();
    } catch (err) {
      Notify.error(err.message);
    } finally {
      setTimeout(() => { State.isMutating = false; }, 500);
    }
  },

  // ── Daily Stats ──
  async _loadStats() {
    const el = DOM.get('qs-stats');
    if (!el) return;
    try {
      const { data } = await DB.invoices().select('total,payment_type').eq('invoice_date', Utils.today());
      const list   = data || [];
      const total  = list.reduce((s, r) => s + r.total, 0);
      const cash   = list.filter(r => r.payment_type === 'cash').reduce((s, r) => s + r.total, 0);
      const count  = list.length;
      el.innerHTML =
        '<div class="pos-stat-item"><span>مبيعات اليوم</span><strong class="green">₪' + total.toFixed(0) + '</strong></div>' +
        '<div class="pos-stat-item"><span>نقدي</span><strong>₪' + cash.toFixed(0) + '</strong></div>' +
        '<div class="pos-stat-item"><span>فواتير</span><strong>' + count + '</strong></div>';
    } catch {}
  },

  _beep(type = 'success') {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      if (type === 'success') {
        osc.frequency.value = 1200; osc.type = 'sine';
        gain.gain.setValueAtTime(0.7, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25);
      } else {
        osc.frequency.value = 300; osc.type = 'square';
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
      }
    } catch {}
  },
};
