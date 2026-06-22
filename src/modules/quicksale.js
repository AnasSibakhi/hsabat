/**
 * quicksale.js — Professional POS Module
 * Production-ready: barcode, camera scan, cart, payment
 */

import { DB, sb }          from '../core/db.js';
import { State }           from '../core/state.js';
import { Notify }          from '../core/notify.js';
import * as DOM            from '../core/dom.js';
import * as Utils          from '../core/utils.js';
import { escape, today }   from '../core/utils.js';
import { CONFIG, PAYMENT } from '../config/constants.js';
import * as Modal          from '../nav/modal.js';
import { getDashboard, getDebts, getInventory } from '../core/registry.js';
import { Customers }       from './customers.js';
import { FIFOService }     from '../services/FIFOService.js';
import { rateGuard }       from '../core/ratelimit.js';
import { BarcodeScanner }  from '../services/BarcodeScanner.js';

// ── State ──
let _cart     = [];   // [{id, name, barcode, unit, price, cost, qty, maxQty}]
let _discount = 0;
let _scanner  = null;
let _lastScan = null;
let _scanTimer = null;
let _active   = false;
let _transferEntities = [];
let _selectedTransferEntity = null;

export const QuickSale = {

  // ── Init ──
  async init() {
    _cart     = [];
    _discount = 0;
    _active   = true;
    QuickSale._renderCart();
    DOM.get('qs-product-grid') && (DOM.get('qs-product-grid').style.display='none');
    // ── Physical barcode scanner (USB/BT) ──
    QuickSale._initPhysicalScanner();
    const grid = DOM.get('qs-product-grid');
    if (grid) grid.style.display = 'none';
    QuickSale._loadSmartCards();
    // load stats and best selling
    QuickSale._loadStats();
  },

  // ── Physical Scanner ──
  _barcodeBuffer: '',
  _barcodeTimer:  null,

  _initPhysicalScanner() {
    // Close search dropdown on outside click
    document.addEventListener('click', (e) => {
      const grid = DOM.get('qs-product-grid');
      const input = DOM.get('qs-barcode-input');
      if (grid && !grid.contains(e.target) && e.target !== input) {
        grid.style.display = 'none';
      }
    });

  },

  // Called on every input change
  onBarcodeInput(val) {
    const grid  = DOM.get('qs-product-grid');
    const right = document.querySelector('.pos-right');
    if (!val || !val.trim()) {
      if (grid)  { grid.style.display = 'none'; grid.innerHTML = ''; }
      if (right) right.style.removeProperty('display');
      return;
    }
    // على mobile ما نخفي السلة — النتائج تظهر فوق كل شي (position:fixed)
    QuickSale._showSearchResults(val.trim());
  },

  // Called on keydown
  onBarcodeKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const input = DOM.get('qs-barcode-input');
    const code  = input?.value?.trim();
    if (!code) return;

    clearTimeout(QuickSale._barcodeTimer);

    // لو القيمة باركود رقمي بحت — استخدم مسار الباركود السريع (دقيق ومباشر)
    if (/^\d+$/.test(code)) {
      input.value = '';
      QuickSale.onBarcodeInput('');
      QuickSale._onBarcode(code);
      return;
    }

    // غير ذلك (اسم منتج) — طابقي بنفس منطق البحث المباشر (الاسم أو الباركود)
    const low     = code.toLowerCase();
    const matches = State.inventory.filter(p =>
      (p.name    || '').toLowerCase().includes(low) ||
      (p.barcode || '').includes(low)
    );

    if (matches.length === 1) {
      // تطابق وحيد واضح — أضيفيه مباشرة، نفس سلوك الضغط على نتيجة البحث
      QuickSale.selectFromSearch(matches[0].id);
    } else if (matches.length > 1) {
      // أكثر من تطابق — لا تخمّني، اعرضي القائمة لتختار المستخدمة بنفسها (نفس نتائج onBarcodeInput)
      QuickSale._showSearchResults(code);
    } else {
      // لا يوجد تطابق فعلاً
      input.value = '';
      QuickSale.onBarcodeInput('');
      QuickSale._showNotFound(code);
    }
  },

  // ── Product Grid ──
  async _showSearchResults(q) {
    const grid = DOM.get('qs-product-grid');
    if (!grid) return;

    // موضع تحت شريط البحث
    const bar = document.getElementById('qs-search-wrap');
    if (bar) {
      const r = bar.getBoundingClientRect();
      grid.style.top   = r.bottom + 'px';
      grid.style.left  = '0';
      grid.style.right = '0';
    }

    if (!State.inventory.length) {
      const inv = getInventory();
      if (inv) await inv.loadList();
    }

    const low = q.toLowerCase();
    const res = State.inventory.filter(p =>
      (p.name  || '').toLowerCase().includes(low) ||
      (p.barcode || '').includes(low)
    ).slice(0, 12);

    if (!res.length) {
      grid.style.display = 'block';
      grid.innerHTML = `
        <div style="padding:16px;text-align:center;">
          <div style="font-size:13px;color:#94a3b8;margin-bottom:10px;">المنتج غير موجود في المخزون</div>
          <button onclick="
            const bc=document.getElementById('qs-barcode-input').value.trim();
            document.getElementById('qs-product-grid').style.display='none';
            document.getElementById('qs-barcode-input').value='';
            Nav.goTo('inventory');
            setTimeout(()=>{Modal.open('m-inv');const el=document.getElementById('inb');if(el){el.value=bc;Inventory.onBarcodeInput(bc);}},300);
          " style="background:#6366f1;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-family:Cairo,sans-serif;font-weight:700;font-size:13px;cursor:pointer;width:100%;">
            ➕ إضافة للمخزون
          </button>
        </div>`;
      return;
    }

    const rows = res.map(p => {
      const zero = p.quantity <= 0;
      const dot  = zero ? '🔴' : p.quantity <= (p.low_stock_alert || 5) ? '🟡' : '🟢';
      return `
        <div data-id="${p.id}" class="qs-search-row" style="display:flex;align-items:center;padding:13px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;${zero ? 'opacity:0.45;' : ''}">
          <div style="flex:1;">
            <div style="font-weight:700;color:#1e293b;font-size:14px;">${p.name}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${dot} ${p.quantity} ${p.unit || ''}${p.barcode ? ' · ' + p.barcode : ''}</div>
          </div>
          <div style="font-size:15px;font-weight:900;color:#6366f1;">₪${(p.sale_price || 0).toFixed(2)}</div>
        </div>`;
    }).join('');

    grid.style.display = 'block';
    grid.innerHTML = rows;

    // event delegation — أفضل من onclick inline
    grid.querySelectorAll('.qs-search-row:not([style*="opacity:0.4"])').forEach(el => {
      el.addEventListener('click', () => QuickSale.selectFromSearch(el.dataset.id));
      el.addEventListener('mouseover', () => el.style.background = '#f8fafc');
      el.addEventListener('mouseout',  () => el.style.background = '');
    });
  },





  search(val) {
    clearTimeout(QuickSale._searchTimer);
    QuickSale._searchTimer = setTimeout(() => QuickSale._showSearchResults(val), 200);
  },

  // ── Smart Cards ──
  _bestSellingData: [],
  _noBarcodeData:   [],

  async _loadSmartCards() {
    if (!State.inventory.length) {
      const inv = getInventory();
      if (inv) await inv.loadList();
    }

    // بدون باركود
    const nobc = State.inventory.filter(p => !p.barcode);
    QuickSale._noBarcodeData = nobc;
    const nbEl = DOM.get('qs-nobc-count');
    if (nbEl) nbEl.textContent = nobc.length + ' منتج';

    // الأكثر مبيعاً — من الفواتير
    const { data: invData } = await DB.invoices()
      .select('items')
      .gte('invoice_date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);

    const counts = {};
    (invData || []).forEach(inv => {
      (Array.isArray(inv.items) ? inv.items : []).forEach(it => {
        if (it.product_id) counts[it.product_id] = (counts[it.product_id] || 0) + (it.qty || 1);
      });
    });

    const best = State.inventory
      .filter(p => counts[p.id])
      .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
      .slice(0, 20)
      .map(p => ({ ...p, sold: counts[p.id] || 0 }));

    QuickSale._bestSellingData = best;
    const bsEl = DOM.get('qs-bestsell-count');
    if (bsEl) bsEl.textContent = best.length + ' منتج · آخر 30 يوم';
  },

  _productRow(p, extra = '') {
    const zero = p.quantity <= 0;
    const dot  = zero ? '🔴' : p.quantity <= (p.low_stock_alert || 5) ? '🟡' : '🟢';
    return `<div data-id="${p.id}" class="qs-smart-row" style="display:flex;align-items:center;padding:13px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;${zero ? 'opacity:0.45;pointer-events:none;' : ''}">
      <div style="flex:1;">
        <div style="font-weight:700;color:#1e293b;font-size:14px;">${p.name}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${dot} ${p.quantity} ${p.unit || ''}${extra}</div>
      </div>
      <div style="text-align:left;">
        <div style="font-size:16px;font-weight:900;color:#6366f1;">₪${(p.sale_price || 0).toFixed(2)}</div>
        ${extra ? '<div style="font-size:10px;color:#94a3b8;">' + extra + '</div>' : ''}
      </div>
    </div>`;
  },

  _bindSmartRows(containerId, modalId) {
    const container = DOM.get(containerId);
    if (!container) return;
    container.querySelectorAll('.qs-smart-row').forEach(el => {
      el.addEventListener('click', () => {
        Modal.close(modalId);
        setTimeout(() => QuickSale.addToCart(el.dataset.id), 100);
      });
      el.addEventListener('mouseover', () => el.style.background = '#f8fafc');
      el.addEventListener('mouseout',  () => el.style.background = '');
    });
  },

  async openBestSelling() {
    await QuickSale._loadSmartCards();
    const list = QuickSale._bestSellingData;
    const el   = DOM.get('qs-bestsell-list');
    if (!el) return;
    const inp = DOM.get('qs-bestsell-search'); if (inp) inp.value = '';
    el.innerHTML = list.length
      ? list.map(p => QuickSale._productRow(p, '· مبيع ' + p.sold + ' مرة')).join('')
      : '<div style="padding:20px;text-align:center;color:#94a3b8;">لا توجد بيانات مبيعات بعد</div>';
    Modal.open('m-qs-bestsell');
    QuickSale._bindSmartRows('qs-bestsell-list', 'm-qs-bestsell');
  },

  filterBestSelling(q) {
    const list = QuickSale._bestSellingData.filter(p =>
      p.name.toLowerCase().includes(q.toLowerCase())
    );
    const el = DOM.get('qs-bestsell-list');
    if (!el) return;
    el.innerHTML = list.map(p => QuickSale._productRow(p, '· مبيع ' + p.sold + ' مرة')).join('');
    QuickSale._bindSmartRows('qs-bestsell-list', 'm-qs-bestsell');
  },

  async openNoBarcode() {
    if (!State.inventory.length) {
      const inv = getInventory(); if (inv) await inv.loadList();
    }
    const list = State.inventory.filter(p => !p.barcode);
    QuickSale._noBarcodeData = list;
    const el  = DOM.get('qs-nobc-list');
    const inp = DOM.get('qs-nobc-search'); if (inp) inp.value = '';
    if (!el) return;
    el.innerHTML = list.length
      ? list.map(p => QuickSale._productRow(p)).join('')
      : '<div style="padding:20px;text-align:center;color:#94a3b8;">لا توجد منتجات بدون باركود</div>';
    Modal.open('m-qs-nobc');
    QuickSale._bindSmartRows('qs-nobc-list', 'm-qs-nobc');
  },

  filterNoBarcode(q) {
    const list = QuickSale._noBarcodeData.filter(p =>
      p.name.toLowerCase().includes(q.toLowerCase())
    );
    const el = DOM.get('qs-nobc-list');
    if (!el) return;
    el.innerHTML = list.map(p => QuickSale._productRow(p)).join('');
    QuickSale._bindSmartRows('qs-nobc-list', 'm-qs-nobc');
  },
  selectFromSearch(id) {
    const grid  = DOM.get('qs-product-grid');
    const input = DOM.get('qs-barcode-input');
    const right = document.querySelector('.pos-right');
    if (grid)  { grid.style.display = 'none'; grid.innerHTML = ''; }
    if (input) input.value = '';
    if (right) right.style.removeProperty('display');
    setTimeout(() => QuickSale.addToCart(id), 50);
  },

  addToCart(productId) {
    const p = State.inventory.find(x => x.id === productId);
    if (!p) { Notify.error('المنتج غير موجود'); return; }
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

    const invoiceBtn = DOM.get('pos-invoice-btn');

    if (!_cart.length) {
      el.innerHTML = '<div class="pos-cart-empty"><i class="ti ti-shopping-cart"></i><p>السلة فارغة<br>اختر منتجاً أو امسح باركود</p></div>';
      DOM.setText('qs-items-count', '0');
      DOM.setText('qs-total-display', '₪ 0.00');
      const s = DOM.get('qs-summary-box'); if (s) s.innerHTML = '';
      if (invoiceBtn) invoiceBtn.disabled = true;
      return;
    }

    if (invoiceBtn) invoiceBtn.disabled = false;

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

  // ── إتاحة قراءة محتوى السلة من خارج الملف (مثلاً موديل الفاتورة المباشرة) ──
  getCart() {
    return _cart.map(c => ({ ...c }));
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
    DOM.get('qs-product-grid') && (DOM.get('qs-product-grid').style.display='none');
  },

  // ── Barcode ──
  async _beepAndAdd(code) {
    await QuickSale._onBarcode(code);
  },

  _getCartQty(barcode) {
    const p = State.inventory.find(i => i.barcode === barcode);
    if (!p) return 0;
    const item = _cart.find(c => c.id === p.id);
    return item ? item.qty : 0;
  },

  async _onBarcode(code) {
    if (!code) return;

    // ١. ابحث في الـ cache أولاً (فوري)
    let product = State.inventory.find(p => p.barcode === code);

    // ٢. لو مش موجود — ابحث في DB
    if (!product) {
      const { data } = await DB.inventory()
        .select('id,name,barcode,sale_price,quantity,unit,category')
        .eq('barcode', code)
        .maybeSingle();
      if (data) {
        product = data;
        if (!State.inventory.find(p => p.id === data.id)) State.inventory.push(data);
      }
    }

    if (product) {
      QuickSale.addToCart(product.id);
      QuickSale._beep('success');
      const c = DOM.get('qs-scanner-container');
      if (c) { c.style.transition='transform .15s'; c.style.transform='scale(1.15)'; setTimeout(()=>c.style.transform='scale(1)',200); }
    } else {
      QuickSale._beep('error');
      QuickSale.stopScanner();
      // رسالة + زر إضافة في المخزون
      QuickSale._showNotFound(code);
    }

    // Re-focus للصنف التالي
    setTimeout(() => DOM.get('qs-barcode-input')?.focus(), 150);
  },

  // ── Camera Scanner ──
  async toggleFlash() {
    await BarcodeScanner.toggleFlash();
  },

  async startScanner() {
    if (BarcodeScanner.isActive()) return;

    const overlay = DOM.get('qs-scanner-overlay');
    if (overlay) overlay.style.display = 'flex';

    const container = DOM.get('qs-scanner-container');
    if (!container) return;
    container.innerHTML = '';
    container.style.height = (window.innerHeight - 50) + 'px';

    await BarcodeScanner.start(
      'qs-scanner-container',
      (code) => QuickSale._beepAndAdd(code),
      (err)  => { Notify.error(err || 'لا يمكن فتح الكاميرا'); QuickSale.stopScanner(); }
    );
  },

  stopScanner() {
    BarcodeScanner.stop();
    const overlay = DOM.get('qs-scanner-overlay');
    if (overlay) overlay.style.display = 'none';
    const container = DOM.get('qs-scanner-container');
    if (container) { container.innerHTML = ''; container.style.height = ''; }
    DOM.get('qs-barcode-input')?.focus();
  },

  // ── Add new product from scanner ──

  _showNotFound(barcode) {
    // نشيل أي رسالة سابقة
    document.getElementById('qs-not-found-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'qs-not-found-toast';
    toast.style.cssText = `
      position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
      background:#1e293b;color:#fff;border-radius:14px;padding:14px 18px;
      z-index:999;min-width:280px;max-width:340px;text-align:center;
      box-shadow:0 8px 24px rgba(0,0,0,0.3);
      animation:fadeInUp .2s ease;
    `;
    toast.innerHTML = `
      <div style="font-size:22px;margin-bottom:6px;">❌</div>
      <div style="font-weight:800;font-size:15px;margin-bottom:4px;">المنتج غير موجود</div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:12px;font-family:monospace;">${barcode || ''}</div>
      <button onclick="
        document.getElementById('qs-not-found-toast').remove();
        Nav.goTo('inventory');
        setTimeout(() => {
          Modal.open('m-inv');
          const el = document.getElementById('inb');
          if(el){ el.value='${barcode || ''}'; Inventory.onBarcodeInput('${barcode || ''}'); }
        }, 300);
      " style="background:#6366f1;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-family:Cairo,sans-serif;font-weight:700;font-size:14px;cursor:pointer;width:100%;">
        ➕ إضافة للمخزون
      </button>
      <button onclick="document.getElementById('qs-not-found-toast').remove();"
        style="background:transparent;color:#94a3b8;border:none;font-family:Cairo,sans-serif;font-size:12px;cursor:pointer;margin-top:8px;width:100%;">
        إغلاق
      </button>
    `;
    document.body.appendChild(toast);

    // يختفي تلقائياً بعد 8 ثواني
    setTimeout(() => toast.remove(), 8000);
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
    // إزالة الـ focus من كل الأزرار
    document.querySelectorAll('.qs-pay-opt').forEach(b => b.blur());
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
      DOM.get('qs-debt-pay-name').value  = '';
      DOM.get('qs-debt-pay-phone').value = '';
      DOM.get('qs-debt-pay-note').value  = '';
      const amountEl = DOM.get('qs-debt-pay-amount');
      if (amountEl) amountEl.value = total.toFixed(2);
      const dateEl = DOM.get('qs-debt-pay-date');
      if (dateEl) dateEl.value = Utils.today();
      DOM.get('qs-debt-pay-dd').style.display = 'none';
      QuickSale._debtRemindDays = 0;
      document.querySelectorAll('.debt-remind-btn2').forEach((b, i) =>
        b.classList.toggle('active', i === 0)
      );
      QuickSale._deferData = null;
      if (!State.customers?.length) {
        sb.from('customers').select('id,name,phone')
          .eq('store_id', State.user.id).order('name')
          .then(({ data }) => { State.customers = data || []; });
      }
      Modal.open('m-qs-pay-debt');
      setTimeout(() => DOM.get('qs-debt-pay-name')?.focus(), 150);

    } else if (type === 'transfer2defer') {
      DOM.setText('qs-defer-total', '₪' + total.toFixed(2));
      DOM.get('qs-buyer-name-df').value  = '';
      DOM.get('qs-buyer-phone-df').value = '';
      const sel = DOM.get('qs-defer-pay-method');
      if (sel) sel.value = 'cash';
      QuickSale._deferDays = 0;
      document.querySelectorAll('[data-defer-days]').forEach((b, i) =>
        b.classList.toggle('active', i === 0)
      );
      if (!State.customers?.length) {
        sb.from('customers').select('id,name,phone')
          .eq('store_id', State.user.id).order('name')
          .then(({ data }) => { State.customers = data || []; });
      }
      Modal.open('m-qs-pay-defer');
      setTimeout(() => DOM.get('qs-buyer-name-df')?.focus(), 150);
    }
  },

  _positionDropdown(dd, inputId) {
    const inp = document.getElementById(inputId);
    if (!inp || !dd) return;
    const r = inp.getBoundingClientRect();
    const top = r.bottom + window.scrollY;
    dd.style.top    = r.bottom + 'px';
    dd.style.left   = r.left + 'px';
    dd.style.right  = 'auto';
    dd.style.width  = r.width + 'px';
    dd.style.maxWidth = '340px';
  },

  showAllCustomers(nameId, phoneId, ddId) {
    if (!State.customers?.length) {
      sb.from('customers').select('id,name,phone').eq('store_id', State.user.id).order('name')
        .then(({ data }) => { State.customers = data || []; QuickSale.showAllCustomers(nameId, phoneId, ddId); });
      return;
    }
    const dd = DOM.get(ddId);
    if (!dd) return;
    QuickSale._positionDropdown(dd, nameId);
    dd.innerHTML = (State.customers || []).slice(0, 8).map(c =>
      `<div class="dc-opt" data-cid="${c.id}"
        onclick="QuickSale.selectBuyerById('${nameId}','${phoneId}','${ddId}',this.dataset.cid)">
        <b>${escape(c.name)}</b>${c.phone ? ' — ' + c.phone : ''}
      </div>`
    ).join('') || `<div class="dc-opt" style="color:var(--g4);">لا يوجد زبائن مسجّلين</div>`;
    dd.style.display = 'block';
  },

  searchBuyerField(nameId, phoneId, ddId, val) {
    const dd = DOM.get(ddId);
    if (!dd) return;

    if (!val.trim()) {
      dd.style.display = 'none';
      return;
    }

    if (!State.customers?.length) {
      sb.from('customers').select('id,name,phone').eq('store_id', State.user.id).order('name')
        .then(({ data }) => { State.customers = data || []; QuickSale.searchBuyerField(nameId, phoneId, ddId, val); });
      return;
    }

    const q = val.trim().toLowerCase();
    const matches = (State.customers || []).filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)
    ).slice(0, 8);

    // لو مطابق تماماً — عبّي الحقل مباشرة بدون dropdown
    const exact = matches.find(c => c.name.toLowerCase() === q);
    if (exact) {
      const nameEl  = DOM.get(nameId);
      const phoneEl = DOM.get(phoneId);
      if (nameEl)  nameEl.value  = exact.name;
      if (phoneEl && exact.phone) phoneEl.value = exact.phone;
      dd.style.display = 'none';
      return;
    }

    QuickSale._positionDropdown(dd, nameId);
    dd.innerHTML = [
      ...matches.map(c =>
        `<div class="dc-opt" data-cid="${c.id}"
          onclick="QuickSale.selectBuyerById('${nameId}','${phoneId}','${ddId}',this.dataset.cid)">
          <b>${escape(c.name)}</b>${c.phone ? ' — ' + c.phone : ''}
        </div>`
      ),
      `<div class="dc-opt" style="color:var(--p);border-top:1px solid var(--br);padding-top:8px;"
        onclick="document.getElementById('${ddId}').style.display='none'">
        ✏️ استخدم "<b>${escape(val.trim())}</b>" كما هو
      </div>`
    ].join('');
    dd.style.display = 'block';
  },

  useName(nameId, ddId) {
    const dd = DOM.get(ddId);
    dd.style.display = 'none';
    DOM.get(nameId)?.focus();
  },

  selectBuyerById(nameId, phoneId, ddId, customerId) {
    // ابحث في State.customers
    let c = (State.customers || []).find(x => x.id === customerId);
    
    // لو ما لقيناه — ابحث في الـ dropdown نفسه
    if (!c) {
      const dd = DOM.get(ddId);
      const opt = dd?.querySelector(`[data-cid="${customerId}"]`);
      if (opt) {
        const nameEl  = DOM.get(nameId);
        const phoneEl = DOM.get(phoneId);
        if (nameEl)  nameEl.value  = opt.textContent.trim().split(' — ')[0].trim();
        if (phoneEl) phoneEl.value = '';
        if (dd)      dd.style.display = 'none';
        return;
      }
      return;
    }

    const nameEl  = DOM.get(nameId);
    const phoneEl = DOM.get(phoneId);
    const dd      = DOM.get(ddId);
    if (nameEl)  nameEl.value  = c.name;
    if (phoneEl) phoneEl.value = c.phone || '';
    if (dd)      dd.style.display = 'none';
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

  setDeferDate(days) {
    QuickSale._deferDays = days;
    document.querySelectorAll('[data-defer-days]').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.deferDays) === days)
    );
  },

  setDeferPayMethod(method) {
    QuickSale._deferPayMethod = method;
  },

  confirmDefer() {
    const name      = (DOM.val('qs-buyer-name-df') || '').trim();
    const phone     = DOM.val('qs-buyer-phone-df') || '';
    const payMethod = DOM.val('qs-defer-pay-method') || 'cash';
    const days      = QuickSale._deferDays || 0;
    const date      = days > 0
      ? new Date(Date.now() + days * 86400000).toISOString().split('T')[0]
      : null;

    if (!name) { Notify.error('أدخل اسم الزبون'); return; }

    QuickSale._deferData = { name, phone, date, payMethod };

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
    const row   = DOM.get('qs-cash-change-row');
    const val   = DOM.get('qs-cash-change-val');
    const label = document.querySelector('#qs-cash-change-row span:first-child');
    if (row && val) {
      row.style.display = received > 0 ? 'flex' : 'none';
      val.textContent = '₪' + Math.abs(change).toFixed(2);
      val.style.color = change >= 0 ? 'var(--s)' : 'var(--d)';
      if (label) label.textContent = change >= 0 ? 'الباقي للزبون' : 'الباقي كدين على الزبون';
    }
  },

  async searchBuyer(val) {
    const dd = DOM.get('qs-buyer-dropdown');
    if (!val.trim()) { if(dd) dd.style.display = 'none'; return; }

    // جيب الزبائن لو ما محمّلين
    if (!State.customers?.length) {
      const { data } = await sb.from('customers').select('id,name,phone').eq('store_id', State.user.id).order('name');
      State.customers = data || [];
    }

    const q = val.trim().toLowerCase();
    const matches = (State.customers || []).filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
    ).slice(0, 6);

    if (!dd) return;
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
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { _transferEntities = []; return; }

      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/get-transfer-entities`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      _transferEntities = res.ok ? (json.data || []) : [];
    } catch (e) {
      console.warn('[loadTransferEntities] فشل الاتصال بالخدمة:', e.message);
      _transferEntities = [];
    }
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

  async confirmDebtPay() {
    const name  = DOM.val('qs-debt-pay-name').trim();
    const phone = DOM.val('qs-debt-pay-phone').trim();
    const note  = DOM.val('qs-debt-pay-note').trim();
    if (!name) { Notify.error('أدخل اسم الزبون'); return; }
    QuickSale._deferData = { name, phone, note, remindDays: QuickSale._debtRemindDays || 0 };
    Modal.close('m-qs-pay-debt');
    await QuickSale.sell('defer');
  },

  setDebtRemind(days) {
    QuickSale._debtRemindDays = days;
    document.querySelectorAll('.debt-remind-btn2').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.days) === days)
    );
  },

  async openDebtFromPOS() {
    const name  = DOM.val('qs-debt-pay-name').trim();
    const phone = DOM.val('qs-debt-pay-phone').trim();
    if (!name) { Notify.error('أدخل اسم الزبون'); return; }

    const total = _cart.reduce((s, c) => s + c.price * c.qty, 0) * (1 - _discount / 100);

    // حفظ بيانات البيع للاستخدام بعد تأكيد الدين
    QuickSale._deferData = { name, phone };
    QuickSale._pendingDebtTotal = total;

    Modal.close('m-qs-pay-debt');

    // تحميل الزبائن إذا لم تكن محملة
    if (!State.customers?.length) {
      const { data } = await sb.from('customers')
        .select('id,name,phone').eq('store_id', State.user.id).order('name');
      State.customers = data || [];
    }

    // ملء حقول m-debt مسبقاً
    const searchEl = DOM.get('dc-search');
    const amountEl = DOM.get('da');
    const phoneEl  = DOM.get('dc-new-phone');
    const dateEl   = DOM.get('dd');
    const noteEl   = DOM.get('dn');
    const dcEl     = DOM.get('dc');
    const newWrap  = DOM.get('dc-new-wrap');
    const dd       = DOM.get('dc-dropdown');

    if (searchEl) searchEl.value = name;
    if (amountEl) amountEl.value = total.toFixed(2);
    if (dateEl)   dateEl.value   = Utils.today();
    if (noteEl)   noteEl.value   = '';
    if (dcEl)     dcEl.value     = '';

    // البحث عن زبون موجود بنفس الاسم
    const existing = (State.customers || []).find(c =>
      c.name.toLowerCase() === name.toLowerCase()
    );

    if (existing) {
      if (dcEl)     dcEl.value     = existing.id;
      if (phoneEl)  phoneEl.value  = existing.phone || phone || '';
      if (newWrap)  newWrap.style.display = 'none';
      if (dd)       dd.style.display      = 'none';
    } else {
      // زبون جديد
      if (phoneEl)  phoneEl.value  = phone || '';
      if (newWrap)  newWrap.style.display = 'block';
      if (dd)       dd.style.display      = 'none';
      // اجعل debts.js يعرف إنه اسم جديد
      window._debtFromPOSNewName = name;
    }

    // علامة أن الـ modal قادم من POS
    window._debtFromPOS = true;

    // إعادة ضبط أزرار التذكير
    document.querySelectorAll('.debt-remind-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0)
    );

    Modal.open('m-debt');
    setTimeout(() => amountEl?.focus(), 200);
  },

  initDebtModal() {
    // reset
    DOM.get('qs-debt-search').value    = '';
    DOM.get('qs-debt-cust').value      = '';
    DOM.get('qs-debt-new-phone').value = '';
    DOM.get('qs-debt-note').value      = '';
    DOM.get('qs-debt-new-wrap').style.display  = 'none';
    DOM.get('qs-debt-dropdown').style.display  = 'none';
    QuickSale._debtNewCust = null;
    QuickSale._deferData   = null;
    // preload customers
    if (!State.customers?.length) {
      sb.from('customers').select('id,name,phone')
        .eq('store_id', State.user.id).order('name')
        .then(({ data }) => { State.customers = data || []; });
    }
    setTimeout(() => DOM.get('qs-debt-search')?.focus(), 150);
  },

  closeDebtModal() {
    Modal.close('m-qs-debt');
    const dd = DOM.get('qs-debt-dropdown');
    if (dd) dd.style.display = 'none';
    DOM.get('qs-debt-search').value  = '';
    DOM.get('qs-debt-cust').value    = '';
    DOM.get('qs-debt-new-phone').value = '';
    DOM.get('qs-debt-note').value    = '';
    DOM.get('qs-debt-new-wrap').style.display = 'none';
    QuickSale._debtNewCust = null;
  },

  async confirmDebtModal() {
    const name = DOM.val('qs-debt-search');
    const custId = DOM.val('qs-debt-cust');

    if (!name) { Notify.error('أدخل اسم الزبون'); return; }

    const payType = document.querySelector('input[name="qsdt"]:checked')?.value || 'full';
    let partialAmount = 0;

    if (payType === 'partial') {
      partialAmount = parseFloat(DOM.val('qs-debt-partial-amount')) || 0;
      const total = _cart.reduce((s, c) => s + c.qty * c.price, 0) * (1 - _discount / 100);
      if (partialAmount <= 0) { Notify.error('أدخل المبلغ المدفوع'); return; }
      if (partialAmount >= total) { Notify.error('المبلغ المدفوع يجب أن يكون أقل من الإجمالي — استخدمي "كاش" لو دفع كامل'); return; }
    }

    // حفظ البيانات
    QuickSale._deferData = {
      name,
      custId,
      phone: DOM.val('qs-debt-new-phone'),
      note:  DOM.val('qs-debt-note'),
      isPartial: payType === 'partial',
      partialAmount,
    };

    QuickSale.closeDebtModal();
    await QuickSale.sell(payType === 'partial' ? 'partial' : 'defer');
  },

  // ── تبديل عرض حقل الدفعة الجزئية حسب نوع الدفع المختار ──
  toggleDebtPartial(radio) {
    const wrap = DOM.get('qs-debt-partial-wrap');
    if (wrap) wrap.classList.toggle('hidden', radio.value !== 'partial');
    if (radio.value === 'partial') QuickSale.calcDebtRemaining();
  },

  // ── حساب الباقي كدين فور كتابة المبلغ المدفوع ──
  calcDebtRemaining() {
    const total   = _cart.reduce((s, c) => s + c.qty * c.price, 0) * (1 - _discount / 100);
    const paid    = parseFloat(DOM.val('qs-debt-partial-amount')) || 0;
    const el      = DOM.get('qs-debt-remaining');
    if (el) el.textContent = '₪' + Math.max(0, total - paid).toFixed(2);
  },

  searchDebtCustomer(val) {
    const dd = DOM.get('qs-debt-dropdown');
    const nw = DOM.get('qs-debt-new-wrap');
    DOM.get('qs-debt-cust').value = '';
    QuickSale._debtNewCust = null;

    if (!State.customers?.length) {
      sb.from('customers').select('id,name,phone').eq('store_id', State.user.id).order('name')
        .then(({ data }) => {
          State.customers = data || [];
          QuickSale.searchDebtCustomer(val);
        });
      if (!val.trim()) { dd.style.display = 'none'; return; }
    }

    const inp = DOM.get('qs-debt-search');
    const r = inp?.getBoundingClientRect();
    if (r) {
      dd.style.top   = r.bottom + 4 + 'px';
      dd.style.left  = r.left + 'px';
      dd.style.width = r.width + 'px';
    }

    const q = val.trim().toLowerCase();
    const all = State.customers || [];
    const matches = q
      ? all.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q))
      : all.slice(0, 8);

    if (!val.trim() && !matches.length) { dd.style.display = 'none'; return; }

    // مطابقة تامة
    const exact = q ? matches.find(c => c.name.toLowerCase() === q) : null;
    if (exact) {
      DOM.get('qs-debt-cust').value   = exact.id;
      DOM.get('qs-debt-search').value = exact.name;
      dd.style.display = 'none';
      nw.style.display = 'none';
      return;
    }

    dd.innerHTML = [
      ...matches.slice(0,8).map(c =>
        `<div class="dc-opt" data-cid="${c.id}" data-name="${c.name.replace(/"/g,'&quot;')}"
          onclick="QuickSale.selectDebtCustomerById(this.dataset.cid, this.dataset.name)">
          <b>${escape(c.name)}</b>${c.phone ? ' — <span style=color:#94a3b8>' + c.phone + '</span>' : ''}
        </div>`
      ),
      val.trim() ? `<div class="dc-opt" style="color:var(--p);border-top:1px solid var(--br);margin-top:4px;"
        onclick="QuickSale.selectDebtNew('${val.trim().replace(/'/g,'\\\'')}')" >
        ➕ إضافة "<b>${escape(val.trim())}</b>" كزبون جديد
      </div>` : '',
    ].join('');

    dd.style.display = matches.length || val.trim() ? 'block' : 'none';
    nw.style.display = 'none';
  },

  selectDebtCustomerById(id, name) {
    DOM.get('qs-debt-cust').value   = id;
    DOM.get('qs-debt-search').value = name;
    DOM.get('qs-debt-dropdown').style.display = 'none';
    DOM.get('qs-debt-new-wrap').style.display = 'none';
    QuickSale._debtNewCust = null;
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
  // ── توليد رقم فاتورة فريد بشكل مضمون — يتحقق من عدم وجود تكرار فعلياً قبل الإرجاع ──
  // (السبب الجذري لتكرار أرقام الفواتير: العدّ فقط غير آمن لو حُفظت فاتورتان بنفس اللحظة تقريباً)
  async _generateUniqueInvoiceNumber() {
    const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
    let nextNum = (count || 0) + 1;

    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = 'INV-' + String(nextNum).padStart(4, '0');
      const { data: existing } = await DB.invoices().select('id').eq('invoice_number', candidate).maybeSingle();
      if (!existing) return candidate;
      nextNum++;
    }
    return 'INV-' + Date.now().toString().slice(-6);
  },

  async sell(paymentType) {
    // Rate limiting — منع 3 مبيعات في ثانية واحدة
    try {
      await rateGuard('sell', () => {}, 'الرجاء الانتظار قبل إتمام بيع آخر');
    } catch (e) {
      Notify.warn(e.message);
      return;
    }
    if (!_cart.length) { Notify.error('السلة فارغة'); return; }
    Modal.close('m-qs-checkout');

    const subtotal = _cart.reduce((s, c) => s + c.qty * c.price, 0);
    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);
    let   custId   = null, custName = 'زبون عادي';
    let   debtSnapshot = null; // نسخة محفوظة من _deferData قبل محوها — تُستخدم لاحقاً عند إنشاء الدين

    // ── كشف تلقائي: لو دفع كاش بمبلغ أقل من الإجمالي، هذي فعلياً دفعة جزئية وليست بيع نقدي كامل ──
    let isAutoPartialCash = false;
    if (paymentType === PAYMENT.CASH) {
      const received = parseFloat(DOM.val('qs-cash-received')) || 0;
      if (received > 0 && received < total) {
        const buyerNameForDebt = DOM.val('qs-buyer-name')?.trim();
        if (!buyerNameForDebt) {
          Notify.error('المبلغ المستلم أقل من الإجمالي — أدخلي اسم الزبون لتسجيل الباقي كدين عليه');
          return;
        }
        paymentType = PAYMENT.PARTIAL;
        isAutoPartialCash = true;
        custName = buyerNameForDebt;
        debtSnapshot = {
          name: buyerNameForDebt,
          phone: DOM.val('qs-buyer-phone') || '',
          partialAmount: received,
          note: '',
        };
      }
    }

    if (isAutoPartialCash) {
      // نفس منطق ربط/إنشاء الزبون المستخدم بحالة الدين العادي، لكن للكاش الجزئي
      const existing = (State.customers || []).find(c =>
        c.name.toLowerCase() === custName.toLowerCase()
      );
      if (existing) {
        custId = existing.id;
      } else {
        const { Customers } = await import('./customers.js');
        const newC = await Customers.createInline(custName, debtSnapshot.phone || '');
        if (newC?.id) custId = newC.id;
      }
    }

    if (!isAutoPartialCash && (paymentType === PAYMENT.DEFER || paymentType === PAYMENT.PARTIAL)) {
      const d        = QuickSale._deferData || {};
      const deferName = (d.name || '').trim();

      if (!deferName) { Notify.error('أدخل اسم الزبون'); return; }
      custName = deferName;
      debtSnapshot = { ...d };

      if (d.custId) {
        custId = d.custId;
      } else {
        const existing = (State.customers || []).find(c =>
          c.name.toLowerCase() === deferName.toLowerCase()
        );
        if (existing) {
          custId = existing.id;
        } else {
          const { Customers } = await import('./customers.js');
          const newC = await Customers.createInline(deferName, d.phone || '');
          if (newC?.id) custId = newC.id;
        }
      }
      QuickSale._deferData   = null;
      QuickSale._debtNewCust = null;
    }

    State.isMutating = true;
    try {
      const invNum = await QuickSale._generateUniqueInvoiceNumber();

      // Buyer info
      const buyerName  = DOM.val('qs-buyer-name') || custName || '';
      const custRecord = custId ? State.customers.find(x => x.id === custId) : null;
      const buyerPhone = DOM.val('qs-buyer-phone') || custRecord?.phone || '';

      // لو في اسم مشتري وما في customer_id — أضفه أو اربطه
      if (buyerName && buyerName !== 'زبون عادي' && !custId) {
        const { Customers } = await import('./customers.js');
        const saved = await Customers.createInline(buyerName, buyerPhone);
        if (saved?.id) custId = saved.id;
      }

      // حساب الدين (لو دفعة جزئية أو آجل كامل) — يُمرَّر جاهز للسيرفر
      let debtAmount = 0, debtNote = null, remindDate = null;
      if (paymentType === PAYMENT.DEFER || paymentType === PAYMENT.PARTIAL) {
        const debtData   = debtSnapshot || {};
        const remindDays = debtData.remindDays || 0;
        remindDate = remindDays > 0
          ? new Date(Date.now() + remindDays * 86400000).toISOString().split('T')[0]
          : null;
        const isPartial = paymentType === PAYMENT.PARTIAL;
        const paidNow    = isPartial ? (debtData.partialAmount || 0) : 0;
        debtAmount = Math.max(0, total - paidNow);
        debtNote   = debtData.note || null;
      }

      // ── استدعاء واحد فقط ينفّذ كل العملية (فاتورة + بنود + مخزون + FIFO + دين) على السيرفر دفعة وحدة ──
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/complete-sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          cart: _cart, subtotal, discount, total, paymentType,
          customerId: custId, customerName: custName, buyerName, buyerPhone,
          invoiceDate: Utils.today(),
          saleTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          invoiceNumber: invNum,
          transferEntityId:   _selectedTransferEntity?.id   || null,
          transferEntityName: _selectedTransferEntity?.name || null,
          debtAmount, debtNote, remindDate,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تنفيذ عملية البيع');
      const inv = json.data.invoice;

      // ── تحديث الكاش المحلي للمخزون فوراً (بدون أي طلب شبكي إضافي) — يعكس الكمية الجديدة بالواجهة مباشرة ──
      _cart.forEach(item => {
        const p = State.inventory.find(x => x.id === item.id);
        if (p) {
          const newQty = Math.max(0, p.quantity - item.qty);
          p.quantity = newQty;
          if (newQty <= p.low_stock_alert && newQty > 0)
            Notify.warn('"' + p.name + '" — المخزون منخفض: ' + newQty);
        }
      });

      if (debtAmount > 0) {
        // لو ما عنده customer_id — أضفه للـ customers
        if (!custId && custName && custName !== 'زبون عادي') {
          const { Customers } = await import('./customers.js');
          await Customers.createInline(custName, buyerPhone);
        }
        await getDebts()?.loadBadge();
      }

      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      QuickSale._beep('success');

      // إغلاق أي موديل دفع مفتوح فعلياً (كاش/تحويل/دين) قبل عرض الفاتورة
      Modal.close('m-qs-pay-cash');
      Modal.close('m-qs-pay-transfer');
      Modal.close('m-qs-debt');

      // احفظ نسخة من السلة قبل المسح
      const cartSnapshot = _cart.map(c => ({ ...c }));

      QuickSale.clearCart();
      DOM.get('qs-product-grid') && (DOM.get('qs-product-grid').style.display='none');

      // عرض الفاتورة فوراً — بدون انتظار أي طلب شبكي إضافي (المخزون محدّث محلياً أعلى، يكفي للعرض الفوري)
      QuickSale._showReceipt(inv, cartSnapshot, total, paymentType, custName, buyerPhone, debtAmount);

      // تحديث لوحة التحكم والمخزون بالخلفية (بدون انتظار، لا يؤخر ظهور الفاتورة للمستخدمة)
      getDashboard()?.load();
      getInventory()?.loadList();
    } catch (err) {
      Notify.error(err.message);
    } finally {
      setTimeout(() => { State.isMutating = false; }, 500);
    }
  },

  // ── Daily Stats ──
  _showReceipt(inv, cart, total, paymentType, custName, phone, debtAmount = 0) {
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
      (paymentType === 'partial'
        ? `المدفوع الآن: ₪${(total - debtAmount).toFixed(2)}\nالمتبقي كدين: ₪${debtAmount.toFixed(2)}\n`
        : '') +
      `طريقة الدفع: ${PAY[paymentType]||paymentType}`
    );
    const waUrl = phone
      ? `https://wa.me/${phone.replace(/[^0-9]/g,'')}?text=${waMsg}`
      : `https://wa.me/?text=${waMsg}`;

    const deferDate = DOM.val('qs-defer-date');
    const deferAcct = DOM.val('qs-defer-account');
    const el = DOM.get('qs-receipt-body');

    const msgConfig = {
      cash:     { icon: '✅', color: 'var(--s)',  text: 'تم البيع بنجاح' },
      transfer: { icon: '🏦', color: '#0ea5e9',  text: 'تم التحويل بنجاح' },
      defer:    { icon: '🕐', color: '#f59e0b',  text: 'تم تسجيل الدين بنجاح' },
      partial:  { icon: '💰', color: 'var(--s)', text: 'تم البيع (دفع جزئي)' },
    };
    const msg = msgConfig[paymentType] || msgConfig.cash;

    const paidNow = paymentType === 'partial' ? (total - debtAmount) : 0;

    const extraInfo = paymentType === 'defer'
      ? `<div style="margin-top:6px;font-size:12px;color:#92400e;background:#fef3c7;border-radius:8px;padding:8px 12px;">
          👤 ${escape(custName || '-')}
          ${deferDate ? ' · 📅 السداد: ' + deferDate : ''}
          ${deferAcct ? ' · ' + deferAcct : ''}
        </div>`
      : paymentType === 'partial'
      ? `<div style="margin-top:6px;background:#fef3c7;border-radius:8px;padding:8px 12px;">
          <div style="font-size:12px;color:#92400e;margin-bottom:4px;">👤 ${escape(custName || '-')}</div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#166534;">
            <span>المدفوع الآن</span><strong>₪${paidNow.toFixed(2)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#92400e;margin-top:2px;">
            <span>المتبقي كدين</span><strong>₪${debtAmount.toFixed(2)}</strong>
          </div>
        </div>`
      : '';
    if (el) {
      el.innerHTML = `
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-size:22px;">${msg.icon}</div>
          <div style="font-size:16px;font-weight:900;color:${msg.color};">${msg.text}</div>
          <div style="font-size:13px;color:var(--g5);">${inv.invoice_number} · ₪${total.toFixed(2)}</div>
          ${extraInfo}
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
<script>window.onload=()=>{window.print();window.onafterprint=()=>{window.close();}}<\/script>
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
