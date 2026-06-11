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
import { Customers }       from './customers.js';

// ── State ──
let _cart     = [];   // [{id, name, barcode, unit, price, cost, qty, maxQty}]
let _discount = 0;
let _scanner  = null;
let _lastScan = null;
let _scanTimer = null;
let _transferEntities = [];
let _selectedTransferEntity = null;

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
        '<div class="qs-ci-top">' +
          '<div class="qs-ci-name">' + escape(item.name) + '</div>' +
          '<button class="qs-rm" onclick="QuickSale.removeFromCart(\'' + item.id + '\')"><i class="ti ti-x"></i></button>' +
        '</div>' +
        '<div class="qs-ci-bottom">' +
          '<div class="qs-ci-meta">₪' + item.price.toFixed(2) + ' × ' + item.qty +
            ' = <strong>₪' + line.toFixed(2) + '</strong></div>' +
          '<div class="qs-ci-ctrl">' +
            '<button class="qs-qb" onclick="QuickSale.changeQty(\'' + item.id + '\',-1)">−</button>' +
            '<span class="qs-qn">' + item.qty + '</span>' +
            '<button class="qs-qb" onclick="QuickSale.changeQty(\'' + item.id + '\',1)">+</button>' +
          '</div>' +
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
    _selectedTransferEntity = null;
    QuickSale._renderCart();
    const si = DOM.get('qs-search-input'); if (si) { si.value = ''; }
    const bi = DOM.get('qs-barcode-input'); if (bi) { bi.value = ''; bi.focus(); }
    const pi = DOM.get('qs-paid'); if (pi) pi.value = '';
    const ch = DOM.get('qs-change'); if (ch) { ch.textContent = '—'; ch.style.color = 'var(--g4)'; }
    const bn = DOM.get('qs-buyer-name');  if (bn) bn.value = '';
    const bp = DOM.get('qs-buyer-phone'); if (bp) bp.value = '';
    const bdd = DOM.get('qs-buyer-dropdown'); if (bdd) bdd.style.display = 'none';
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
    if (_scanner) return;

    const overlay = DOM.get('qs-scanner-overlay');
    if (overlay) overlay.style.display = 'flex';

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
    container.innerHTML = '';

    const seen = {};
    const handler = (result) => {
      const code  = result?.codeResult?.code;
      const err   = result?.codeResult?.startInfo?.error;
      if (!code || code.length < 4 || err > 0.2) return;
      seen[code] = (seen[code] || 0) + 1;
      if (seen[code] >= 1) {
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
        locator:      { patchSize: 'medium', halfSample: true },
        numOfWorkers: 2,
        frequency:    10,
        decoder: {
          readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'],
          multiple: false,
        },
        locate: true,
      }, (initErr) => {
        if (initErr) {
          const msg = (initErr?.message||'').includes('ermission')
            ? 'يرجى السماح بالوصول للكاميرا'
            : 'لا يمكن فتح الكاميرا';
          Notify.error(msg);
          QuickSale.stopScanner();
        } else {
          Quagga.start();
          Quagga.onDetected(handler);
          _scanner = handler;
        }
        resolve();
      });
    });
  },

  stopScanner() {
    try {
      if (_scanner && window.Quagga) {
        Quagga.offDetected(_scanner);
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
  // ── Checkout ──
  openCheckout() {
    if (!_cart.length) { Notify.error('السلة فارغة'); return; }
    State.isMutating = false;
    const bn = DOM.get('qs-buyer-name');  if (bn) bn.value = '';
    const bp = DOM.get('qs-buyer-phone'); if (bp) bp.value = '';
    const dd = DOM.get('qs-buyer-dropdown'); if (dd) dd.style.display = 'none';
    const cs = DOM.get('qs-cash-section'); if (cs) cs.style.display = 'none';
    const total = _cart.reduce((s, c) => s + c.price * c.qty, 0) * (1 - _discount / 100);
    DOM.setText('qs-checkout-total', '₪' + total.toFixed(2));
    Modal.open('m-qs-checkout');
  },

  _hideCheckoutSections() {},

  async openPayModal(type) {
    const total = _cart.reduce((s,c) => s + c.price*c.qty, 0) * (1 - _discount/100);
    Modal.close('m-qs-checkout');

    if (type === 'cash') {
      DOM.setText('qs-cash-total', '₪' + total.toFixed(2));
      DOM.get('qs-buyer-name').value = '';
      DOM.get('qs-buyer-phone').value = '';
      DOM.get('qs-cash-received').value = '';
      DOM.get('qs-cash-change-row').style.display = 'none';
      Modal.open('m-qs-pay-cash');
      setTimeout(() => DOM.get('qs-cash-received')?.focus(), 300);

    } else if (type === 'transfer') {
      DOM.setText('qs-transfer-total', '₪' + total.toFixed(2));
      DOM.get('qs-buyer-name-tr').value = '';
      DOM.get('qs-buyer-phone-tr').value = '';
      if (!_transferEntities.length) await QuickSale.loadTransferEntities();
      const sel = DOM.get('qs-checkout-transfer-entity');
      sel.innerHTML = '<option value="">-- اختر الجهة --</option>';
      _transferEntities.forEach(e => {
        const names = e.names && e.names.length ? e.names : [e.name];
        names.forEach(n => {
          const opt = document.createElement('option');
          opt.value = e.id + '::' + n;
          opt.textContent = n;
          sel.appendChild(opt);
        });
      });
      Modal.open('m-qs-pay-transfer');

    } else if (type === 'defer') {
      DOM.setText('qs-defer-total', '₪' + total.toFixed(2));
      DOM.get('qs-buyer-name-df').value = '';
      DOM.get('qs-buyer-phone-df').value = '';
      DOM.get('qs-defer-date').value = '';
      Modal.open('m-qs-pay-defer');
    }
  },

  searchBuyerField(nameId, phoneId, ddId, val) {
    const dd = DOM.get(ddId);
    if (!val.trim()) { dd.style.display = 'none'; return; }
    const q = val.trim().toLowerCase();
    const matches = (State.customers || []).filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)
    ).slice(0, 6);
    if (!matches.length) { dd.style.display = 'none'; return; }
    dd.innerHTML = matches.map(c =>
      `<div class="dc-opt" onclick="QuickSale.selectBuyerField('${nameId}','${phoneId}','${ddId}','${escape(c.name)}','${c.phone||''}')">
        ${escape(c.name)}${c.phone ? ' — ' + c.phone : ''}
      </div>`
    ).join('');
    dd.style.display = 'block';
  },

  selectBuyerField(nameId, phoneId, ddId, name, phone) {
    DOM.get(nameId).value  = name;
    DOM.get(phoneId).value = phone;
    DOM.get(ddId).style.display = 'none';
  },

  confirmCheckoutTransfer() {
    const sel = DOM.get('qs-checkout-transfer-entity');
    if (!sel.value) { Notify.error('اختر جهة التحويل'); return; }
    const [entityId, entityName] = sel.value.split('::');
    _selectedTransferEntity = { id: entityId, name: entityName };
    // sync buyer from transfer modal
    const n = DOM.val('qs-buyer-name-tr'); if (n) DOM.get('qs-buyer-name').value = n;
    const p = DOM.val('qs-buyer-phone-tr'); if (p) DOM.get('qs-buyer-phone').value = p;
    Modal.close('m-qs-pay-transfer');
    QuickSale.sell('transfer');
  },

  confirmDefer() {
    const name  = DOM.val('qs-buyer-name-df');
    const phone = DOM.val('qs-buyer-phone-df');
    // sync to main buyer fields
    DOM.get('qs-buyer-name').value  = name;
    DOM.get('qs-buyer-phone').value = phone;
    Modal.close('m-qs-pay-defer');
    QuickSale.sell('defer');
  },

  checkoutPay(type) { QuickSale.openPayModal(type); },
  checkoutTransfer() { QuickSale.openPayModal('transfer'); },
  checkoutDefer()    { QuickSale.openPayModal('defer'); },

  async checkoutDebt() {
    const total = _cart.reduce((s,c) => s + c.price*c.qty, 0) * (1 - _discount/100);
    Modal.close('m-qs-checkout');
    if (!State.customers?.length) await Customers.loadAll();
    DOM.setText('qs-debt-pay-total', '₪' + total.toFixed(2));
    DOM.get('qs-debt-pay-name').value  = '';
    DOM.get('qs-debt-pay-phone').value = '';
    DOM.get('qs-debt-pay-dd').style.display = 'none';
    Modal.open('m-qs-pay-debt');
  },

  confirmDebt() {
    const name  = DOM.val('qs-debt-pay-name');
    const phone = DOM.val('qs-debt-pay-phone');
    DOM.get('qs-buyer-name').value  = name;
    DOM.get('qs-buyer-phone').value = phone;
    Modal.close('m-qs-pay-debt');
    // open standard debt modal for customer selection
    QuickSale.openDebtModal();
  },

  calcCashChange() {
    const total    = _cart.reduce((s,c) => s + c.price * c.qty, 0) * (1 - _discount/100);
    const received = parseFloat(DOM.val('qs-cash-received')) || 0;
    const change   = received - total;
    const row = DOM.get('qs-cash-change-row');
    const val = DOM.get('qs-cash-change-val');
    if (row && val) {
      row.style.display = received > 0 ? 'flex' : 'none';
      val.textContent = '₪' + Math.abs(change).toFixed(2);
      val.style.color = change >= 0 ? 'var(--s)' : 'var(--d)';
    }
  },

  searchBuyer(val) {
    const dd = DOM.get('qs-buyer-dropdown');
    if (!val.trim()) { dd.style.display = 'none'; return; }
    const q = val.trim().toLowerCase();
    const matches = (State.customers || []).filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
    ).slice(0, 6);
    if (!matches.length) { dd.style.display = 'none'; return; }
    dd.innerHTML = matches.map(c =>
      `<div class="dc-opt" onclick="QuickSale.selectBuyer('${c.id}','${escape(c.name)}','${c.phone||''}')">
        ${escape(c.name)}${c.phone ? ' — ' + c.phone : ''}
      </div>`
    ).join('');
    dd.style.display = 'block';
  },

  selectBuyer(id, name, phone) {
    DOM.get('qs-buyer-name').value  = name;
    DOM.get('qs-buyer-phone').value = phone;
    DOM.get('qs-buyer-dropdown').style.display = 'none';
  },

  // ── Transfer Entity ──
  async loadTransferEntities() {
    const { data } = await sbAdmin.from('transfer_entities')
      .select('*').eq('store_id', State.user.id).eq('is_active', true).order('name');
    _transferEntities = data || [];
  },

  async openTransferModal() {
    if (!_cart.length) { Notify.error('السلة فارغة'); return; }
    if (!_transferEntities.length) await QuickSale.loadTransferEntities();
    const sel = DOM.get('qs-transfer-entity');
    sel.innerHTML = '<option value="">-- اختر --</option>';
    _transferEntities.forEach(e => {
      const names = e.names && e.names.length ? e.names : [e.name];
      names.forEach(n => {
        const opt = document.createElement('option');
        opt.value = e.id + '::' + n;
        opt.setAttribute('data-name', n);
        opt.textContent = n;
        sel.appendChild(opt);
      });
    });
    const rec = DOM.get('qs-transfer-receiver');
    const buyerName = DOM.val('qs-buyer-name');
    if (rec) rec.value = buyerName || '';
    Modal.open('m-qs-transfer');
  },

  confirmTransfer() {
    const sel = DOM.get('qs-transfer-entity');
    if (!sel.value) { Notify.error('اختر جهة التحويل'); return; }
    const [entityId, entityName] = sel.value.split('::');
    _selectedTransferEntity = {
      id:   entityId,
      name: entityName || sel.options[sel.selectedIndex]?.getAttribute('data-name') || '',
    };
    const rec = DOM.val('qs-transfer-receiver');
    if (rec) DOM.get('qs-buyer-name').value = rec;
    Modal.close('m-qs-transfer');
    QuickSale.sell('transfer');
  },

  async openDebtModal() {
    if (!State.customers?.length) await Customers.loadAll();
    // reset
    const s = DOM.get('qs-debt-search'); if (s) s.value = '';
    DOM.get('qs-debt-cust').value = '';
    const dd = DOM.get('qs-debt-dropdown'); if (dd) dd.style.display = 'none';
    const nw = DOM.get('qs-debt-new-wrap'); if (nw) nw.style.display = 'none';
    const ph = DOM.get('qs-debt-new-phone'); if (ph) ph.value = '';
    QuickSale._debtNewCust = null;
    Modal.open('m-qs-debt');
  },

  searchDebtCustomer(val) {
    const dd = DOM.get('qs-debt-dropdown');
    const nw = DOM.get('qs-debt-new-wrap');
    DOM.get('qs-debt-cust').value = '';
    QuickSale._debtNewCust = null;
    if (!val.trim()) { dd.style.display = 'none'; nw.style.display = 'none'; return; }
    const q = val.trim().toLowerCase();
    const matches = (State.customers || []).filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
    let html = matches.map(c =>
      `<div class="dc-opt" onclick="QuickSale.selectDebtCustomer('${c.id}','${escape(c.name)}')">${escape(c.name)}${c.phone ? ' — ' + c.phone : ''}</div>`
    ).join('');
    html += `<div class="dc-opt new" onclick="QuickSale.selectDebtNew('${escape(val.trim())}')">+ إضافة &quot;${escape(val.trim())}&quot; كزبون جديد</div>`;
    dd.innerHTML = html;
    dd.style.display = 'block';
    nw.style.display = 'none';
  },

  selectDebtCustomer(id, name) {
    DOM.get('qs-debt-cust').value = id;
    DOM.get('qs-debt-search').value = name;
    DOM.get('qs-debt-dropdown').style.display = 'none';
    DOM.get('qs-debt-new-wrap').style.display = 'none';
    QuickSale._debtNewCust = null;
  },

  selectDebtNew(name) {
    DOM.get('qs-debt-cust').value = '';
    DOM.get('qs-debt-search').value = name;
    DOM.get('qs-debt-dropdown').style.display = 'none';
    DOM.get('qs-debt-new-wrap').style.display = 'block';
    QuickSale._debtNewCust = name;
  },

  // ── Checkout ──
  async sell(paymentType) {
    if (!_cart.length) { Notify.error('السلة فارغة'); return; }
    Modal.close('m-qs-checkout');

    const subtotal = _cart.reduce((s, c) => s + c.qty * c.price, 0);
    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);
    let   custId   = null, custName = 'زبون عادي';

    if (paymentType === PAYMENT.DEFER) {
      custId = DOM.val('qs-debt-cust');
      // إذا زبون جديد
      if (!custId && QuickSale._debtNewCust) {
        const phone = DOM.val('qs-debt-new-phone');
        const newC  = await Customers.createInline(QuickSale._debtNewCust, phone);
        if (!newC?.id) { Notify.error('فشل إضافة الزبون'); return; }
        custId   = newC.id;
        custName = newC.name;
      }
      if (!custId) { Notify.error('اختر الزبون أو أدخل اسماً جديداً'); return; }
      const c = State.customers.find(x => x.id === custId);
      custName = c?.name || custName;
      Modal.close('m-qs-debt');
      QuickSale._debtNewCust = null;
    }

    State.isMutating = true;
    try {
      const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
      const invNum = 'INV-' + String((count || 0) + 1).padStart(4, '0');

      // Buyer info — للدين نجيب الجوال من بيانات الزبون إذا ما كان مكتوب يدوي
      const buyerName  = DOM.val('qs-buyer-name') || custName || 'زبون عادي';
      const custRecord = custId ? State.customers.find(x => x.id === custId) : null;
      const buyerPhone = DOM.val('qs-buyer-phone') || custRecord?.phone || '';

      const { data: inv, error } = await DB.invoices().insert({
        store_id: State.user.id, customer_id: custId || null,
        customer_name: buyerName, total, subtotal, discount,
        payment_type: paymentType,
        invoice_date: Utils.today(),
        sale_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        invoice_number: invNum,
        buyer_name:  buyerName,
        buyer_phone: buyerPhone,
        transfer_entity_id:   _selectedTransferEntity?.id   || null,
        transfer_entity_name: _selectedTransferEntity?.name || null,
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
      QuickSale._beep('success');

      // احفظ نسخة من السلة قبل المسح
      const cartSnapshot = _cart.map(c => ({ ...c }));

      QuickSale.clearCart();
      await getDashboard()?.load();
      await QuickSale._loadStats();
      const invSvc = getInventory(); if (invSvc) await invSvc.loadList();
      QuickSale._renderGrid();

      // عرض الفاتورة بعد البيع
      QuickSale._showReceipt(inv, cartSnapshot, total, paymentType, custName, buyerPhone);
    } catch (err) {
      Notify.error(err.message);
    } finally {
      setTimeout(() => { State.isMutating = false; }, 500);
    }
  },

  // ── Daily Stats ──
  _showReceipt(inv, cart, total, paymentType, custName, phone) {
    if (!inv) return;
    const PAY = { cash: 'نقدي', transfer: 'تحويل', defer: 'دين', partial: 'جزئي' };
    const store = State.user?.store_name || 'حسابات';
    const itemsHtml = cart.map(c =>
      `<tr>
        <td>${escape(c.name)}</td>
        <td style="text-align:center;">${c.qty}</td>
        <td style="text-align:left;">₪${c.price.toFixed(2)}</td>
        <td style="text-align:left;font-weight:700;">₪${(c.qty*c.price).toFixed(2)}</td>
      </tr>`
    ).join('');

    const waMsg = encodeURIComponent(
      `🧾 فاتورة من ${store}\n` +
      `رقم: ${inv.invoice_number}\n` +
      `التاريخ: ${inv.invoice_date} ${inv.sale_time||''}\n` +
      (custName && custName !== 'زبون عادي' ? `الزبون: ${custName}\n` : '') +
      `\nالمنتجات:\n` +
      cart.map(c => `• ${c.name} × ${c.qty} = ₪${(c.qty*c.price).toFixed(2)}`).join('\n') +
      `\n\nالإجمالي: ₪${total.toFixed(2)}\n` +
      `طريقة الدفع: ${PAY[paymentType]||paymentType}`
    );
    const waUrl = phone
      ? `https://wa.me/${phone.replace(/[^0-9]/g,'')}?text=${waMsg}`
      : `https://wa.me/?text=${waMsg}`;

    // بناء modal الإيصال
    const el = DOM.get('qs-receipt-body');
    if (el) {
      el.innerHTML = `
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-size:22px;">✅</div>
          <div style="font-size:16px;font-weight:900;color:var(--s);">تم البيع بنجاح</div>
          <div style="font-size:13px;color:var(--g5);">${inv.invoice_number} · ₪${total.toFixed(2)}</div>
        </div>
        <table class="dt" style="margin-bottom:.75rem;font-size:12px;">
          <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:900;background:var(--pl);border-radius:8px;padding:10px 14px;margin-bottom:12px;">
          <span>الإجمالي</span><span>₪${total.toFixed(2)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button class="btn btn-s" onclick="QuickSale._printReceipt()" style="justify-content:center;gap:6px;"><i class="ti ti-printer"></i> طباعة</button>
          <a href="${waUrl}" target="_blank" class="btn" style="background:#25d366;color:#fff;justify-content:center;gap:6px;text-decoration:none;display:flex;align-items:center;border-radius:10px;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;padding:10px;">
            <i class="ti ti-brand-whatsapp"></i> واتساب
          </a>
        </div>`;
      // حفظ بيانات الطباعة
      QuickSale._lastReceipt = { inv, cart, total, paymentType, custName, store };
    }
    Modal.open('m-qs-receipt');
  },

  _printReceipt() {
    const r = QuickSale._lastReceipt;
    if (!r) return;
    const PAY = { cash: 'نقدي', transfer: 'تحويل', defer: 'دين', partial: 'جزئي' };
    const itemsHtml = r.cart.map(c =>
      `<tr><td>${c.name}</td><td style="text-align:center;">${c.qty}</td><td>₪${c.price.toFixed(2)}</td><td style="font-weight:700;">₪${(c.qty*c.price).toFixed(2)}</td></tr>`
    ).join('');
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>فاتورة ${r.inv.invoice_number}</title>
<style>body{font-family:'Cairo',Arial,sans-serif;margin:0;padding:16px;max-width:320px;margin:auto;font-size:13px;}
.store{font-size:18px;font-weight:900;text-align:center;margin-bottom:4px;}
.meta{text-align:center;color:#666;font-size:11px;border-bottom:1px dashed #ccc;padding-bottom:8px;margin-bottom:10px;}
.row{display:flex;justify-content:space-between;margin-bottom:3px;font-size:12px;}
table{width:100%;border-collapse:collapse;margin:10px 0;}
th{background:#f5f5f5;padding:5px 6px;font-size:11px;text-align:right;}
td{padding:5px 6px;border-bottom:1px solid #f0f0f0;font-size:12px;}
.total{display:flex;justify-content:space-between;font-size:15px;font-weight:900;border-top:2px solid #111;padding-top:8px;margin-top:6px;}
.footer{text-align:center;font-size:11px;color:#999;margin-top:10px;}
@media print{body{padding:0;}}</style></head>
<body>
<div class="store">${r.store}</div>
<div class="meta">${r.inv.invoice_number} · ${r.inv.invoice_date} ${r.inv.sale_time||''}</div>
${r.custName && r.custName !== 'زبون عادي' ? `<div class="row"><span>الزبون</span><span>${r.custName}</span></div>` : ''}
<div class="row"><span>طريقة الدفع</span><span>${PAY[r.paymentType]||r.paymentType}</span></div>
<table><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
<tbody>${itemsHtml}</tbody></table>
<div class="total"><span>الإجمالي</span><span>₪${r.total.toFixed(2)}</span></div>
<div class="footer">شكراً لتعاملكم معنا</div>
<script>window.onload=()=>{window.print()}<\/script>
</body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
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
