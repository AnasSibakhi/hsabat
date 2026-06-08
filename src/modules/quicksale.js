/**
 * quicksale.js — Professional POS Module
 * Features: Product grid, search, barcode scanner, cart, quick checkout
 */

import { DB }          from '../core/db.js';
import { State }       from '../core/state.js';
import { Notify }      from '../core/notify.js';
import * as DOM        from '../core/dom.js';
import { sb }          from '../core/db.js';
import * as Utils      from '../core/utils.js';
import { escape, currency, today, invoiceNumber } from '../core/utils.js';
import { PAYMENT, CONFIG } from '../config/constants.js';
import * as Modal      from '../nav/modal.js';
import { getDashboard, getDebts, getInvoices, getInventory } from '../core/registry.js';

// ── Cart State ──
let _cart    = [];   // [{ product, qty, price }]
let _discount = 0;
let _scanner  = null;

export const QuickSale = {

  async init() {
    _cart     = [];
    _discount = 0;
    QuickSale._renderCart();
    await QuickSale._renderProductGrid();
    QuickSale._renderSummary();
    DOM.setHTML('qs-search-input', '');
    const si = DOM.get('qs-search-input');
    if (si) { si.value = ''; si.focus(); }
  },

  // ── Product Grid ──
  async _renderProductGrid(filter = '') {
    const grid = DOM.get('qs-product-grid');
    if (!grid) return;

    let products = State.inventory;
    if (!products.length) {
      await getInventory()?.loadList();
      products = State.inventory;
    }

    const filtered = filter
      ? products.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
      : products.filter(p => p.quantity > 0);

    if (!filtered.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--g4);font-size:14px;">
        \${filter ? 'لا توجد نتائج لـ "' + escape(filter) + '"' : 'لا يوجد مخزون متاح'}
      </div>`;
      return;
    }

    grid.innerHTML = filtered.slice(0, 24).map(p => `
      <button class="qs-product-btn" onclick="QuickSale.addToCart('\${p.id}')" \${p.quantity <= 0 ? 'disabled' : ''}>
        <div class="qs-product-name">\${escape(p.name)}</div>
        <div class="qs-product-price">₪\${p.sale_price ? p.sale_price.toFixed(2) : '—'}</div>
        <div class="qs-product-qty \${p.quantity <= p.low_stock_alert ? 'low' : ''}">\${p.quantity} \${escape(p.unit || '')}</div>
      </button>
    `).join('');
  },

  search(val) {
    QuickSale._renderProductGrid(val);
  },

  // ── Cart ──
  addToCart(productId) {
    const product = State.inventory.find(p => p.id === productId);
    if (!product) return;
    if (!product.sale_price || product.sale_price <= 0) {
      Notify.warn('هذا المنتج ليس له سعر — عدّله أولاً');
      return;
    }

    const existing = _cart.find(c => c.product.id === productId);
    if (existing) {
      if (existing.qty >= product.quantity) { Notify.error('لا يوجد مخزون كافٍ'); return; }
      existing.qty++;
    } else {
      _cart.push({ product, qty: 1, price: product.sale_price });
    }

    if (navigator.vibrate) navigator.vibrate(30);
    QuickSale._renderCart();
  },

  removeFromCart(productId) {
    _cart = _cart.filter(c => c.product.id !== productId);
    QuickSale._renderCart();
  },

  changeQty(productId, delta) {
    const item = _cart.find(c => c.product.id === productId);
    if (!item) return;
    item.qty = Math.max(1, item.qty + delta);
    if (item.qty > item.product.quantity) {
      item.qty = item.product.quantity;
      Notify.error('لا يوجد مخزون كافٍ');
    }
    QuickSale._renderCart();
  },

  _renderCart() {
    const el = DOM.get('qs-cart-items');
    if (!el) return;

    if (!_cart.length) {
      el.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--g4);">
        <i class="ti ti-shopping-cart" style="font-size:32px;display:block;margin-bottom:8px;"></i>
        السلة فارغة — اختر منتجاً
      </div>`;
      DOM.setText('qs-total-amount', '₪ 0.00');
      DOM.setText('qs-items-count', '0 أصناف');
      return;
    }

    let subtotal = 0;
    el.innerHTML = _cart.map(item => {
      const lineTotal = item.qty * item.price;
      subtotal += lineTotal;
      return `<div class="qs-cart-item">
        <div class="qs-cart-item-info">
          <div class="qs-cart-item-name">\${escape(item.product.name)}</div>
          <div class="qs-cart-item-price">₪\${item.price.toFixed(2)} × \${item.qty} = <strong>₪\${lineTotal.toFixed(2)}</strong></div>
        </div>
        <div class="qs-cart-item-controls">
          <button onclick="QuickSale.changeQty('\${item.product.id}',-1)" class="qs-qty-btn">−</button>
          <span class="qs-qty-val">\${item.qty}</span>
          <button onclick="QuickSale.changeQty('\${item.product.id}',1)"  class="qs-qty-btn">+</button>
          <button onclick="QuickSale.removeFromCart('\${item.product.id}')" class="qs-remove-btn"><i class="ti ti-x"></i></button>
        </div>
      </div>`;
    }).join('');

    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);

    DOM.setText('qs-total-amount', '₪ ' + total.toFixed(2));
    DOM.setText('qs-items-count',  _cart.length + ' ' + (_cart.length === 1 ? 'صنف' : 'أصناف'));

    QuickSale._renderSummary(subtotal, discount, total);
  },

  _renderSummary(subtotal = 0, discount = 0, total = 0) {
    const el = DOM.get('qs-summary');
    if (!el) return;
    if (!_cart.length) { el.innerHTML = ''; return; }

    el.innerHTML = `
      <div class="qs-summary-row"><span>المجموع الفرعي</span><span>₪\${subtotal.toFixed(2)}</span></div>
      <div class="qs-summary-row total"><span>الإجمالي</span><span>₪\${total.toFixed(2)}</span></div>
    `;
  },

  applyDiscount(pct) {
    _discount = pct;
    QuickSale._renderCart();
    Notify.show(pct > 0 ? 'خصم ' + pct + '%' : 'تم إلغاء الخصم');
  },

  clearCart() {
    _cart = [];
    _discount = 0;
    QuickSale._renderCart();
    const si = DOM.get('qs-search-input');
    if (si) si.value = '';
    QuickSale._renderProductGrid();
    Notify.show('تم مسح السلة');
  },

  calcChange() {
    const total  = _cart.reduce((s, c) => s + c.qty * c.price, 0) * (1 - _discount / 100);
    const paid   = parseFloat(DOM.val('qs-paid')) || 0;
    const change = paid - total;
    const el     = DOM.get('qs-change');
    if (!el) return;
    if (paid <= 0) { el.textContent = '—'; el.style.color = 'var(--g4)'; return; }
    el.textContent = '₪ ' + Math.abs(change).toFixed(2) + (change >= 0 ? ' (باقي)' : ' (ناقص)');
    el.style.color = change >= 0 ? 'var(--s)' : 'var(--d)';
  },

  openDebtModal() {
    DOM.setHTML('qs-debt-cust', '<option value="">-- اختر الزبون --</option>' +
      State.customers.map(c => `<option value="\${c.id}">\${escape(c.name)}</option>`).join(''));
    Modal.open('m-qs-debt');
  },

  // ── Checkout ──
  async sell(paymentType) {
    if (!_cart.length) { Notify.error('السلة فارغة'); return; }

    const subtotal = _cart.reduce((s, c) => s + c.qty * c.price, 0);
    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);
    let customerId = '';
    let customerName = 'زبون عادي';

    if (paymentType === PAYMENT.DEFER) {
      customerId = DOM.val('qs-debt-cust');
      if (!customerId) { Notify.error('اختر الزبون'); return; }
      const c = State.customers.find(x => x.id === customerId);
      customerName = c?.name || '';
      Modal.close('m-qs-debt');
    }

    State.isMutating = true;
    try {
      const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
      const invNum = 'INV-' + String((count || 0) + 1).padStart(4, '0');

      const { data: invoice, error } = await DB.invoices().insert({
        store_id:      State.user.id,
        customer_id:   customerId || null,
        customer_name: customerName,
        total, subtotal, discount,
        payment_type:  paymentType,
        invoice_date:  today(),
        sale_time:     new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        invoice_number: invNum,
      }).select().single();

      if (error) throw error;

      // Save items + deduct inventory
      await sb.from('invoice_items').insert(_cart.map(c => ({
        invoice_id:   invoice.id,
        product_name: c.product.name,
        inventory_id: c.product.id,
        quantity:     c.qty,
        price:        c.price,
      })));

      for (const item of _cart) {
        const newQty = Math.max(0, item.product.quantity - item.qty);
        await DB.inventory().update({ quantity: newQty }).eq('id', item.product.id);
        item.product.quantity = newQty;
      }

      if (paymentType === PAYMENT.DEFER && customerId) {
        await DB.debts().insert({ store_id: State.user.id, customer_id: customerId, amount: total, paid: 0, debt_date: today(), notes: 'فاتورة ' + invNum });
        await getDebts()?.loadBadge();
      }

      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      Notify.success(invNum + ' — ₪' + total.toFixed(2));
      QuickSale.clearCart();
      await getDashboard()?.load();
      await getInventory()?.loadList();

    } catch (err) {
      console.error('[QuickSale.sell]', err);
      Notify.error(err.message);
    } finally {
      setTimeout(() => { State.isMutating = false; }, 500);
    }
  },

  // ── Barcode Scanner (Quagga2 — more accurate) ──
  async startScanner() {
    const overlay = DOM.get('qs-scanner-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';

    try {
      // Load Quagga2
      if (!window.Quagga) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: document.getElementById('qs-scanner-container'),
          constraints: {
            facingMode: 'environment',
            width:  { min: 640, ideal: 1280 },
            height: { min: 480, ideal: 720 },
          },
        },
        locator: { patchSize: 'medium', halfSample: true },
        numOfWorkers: 2,
        frequency: 10,
        decoder: {
          readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader','code_39_reader'],
        },
        locate: true,
      }, (err) => {
        if (err) {
          Notify.error('لا يمكن الوصول للكاميرا');
          QuickSale.stopScanner();
          return;
        }
        Quagga.start();
        _scanner = true;
      });

      // Listen for successful scan
      Quagga.offDetected();
      const detectedCodes = {};
      Quagga.onDetected((result) => {
        const code = result?.codeResult?.code;
        if (!code) return;
        // Require 3 consistent reads for accuracy
        detectedCodes[code] = (detectedCodes[code] || 0) + 1;
        if (detectedCodes[code] >= 3) {
          QuickSale.stopScanner();
          QuickSale._onBarcodeDetected(code);
        }
      });

    } catch (err) {
      console.error('[Scanner]', err);
      Notify.error('لا يمكن الوصول للكاميرا — تأكد من الصلاحيات');
      QuickSale.stopScanner();
    }
  },

  stopScanner() {
    try {
      if (window.Quagga && _scanner) {
        Quagga.offDetected();
        Quagga.stop();
      }
    } catch(e) {}
    _scanner = null;
    const overlay = DOM.get('qs-scanner-overlay');
    if (overlay) overlay.style.display = 'none';
    // Clear container
    const container = DOM.get('qs-scanner-container');
    if (container) container.innerHTML = '';
  },

  async _onBarcodeDetected(barcode) {
    if (navigator.vibrate) navigator.vibrate(100);

    // Search inventory by barcode
    const { data } = await DB.inventory().select('*').eq('barcode', barcode);
    const product  = data?.[0];

    if (product) {
      // Found — add to cart
      State.inventory = State.inventory.map(p => p.id === product.id ? product : p);
      QuickSale.addToCart(product.id);
      Notify.success('تمت إضافة: ' + product.name);
    } else {
      // Not found — open add product modal
      DOM.get('qs-new-barcode').value  = barcode;
      DOM.get('qs-new-name').value     = '';
      DOM.get('qs-new-price').value    = '';
      DOM.get('qs-new-qty').value      = '1';
      Modal.open('m-new-product');
    }
  },

  // ── Add new product from scanner ──
  async saveNewProduct() {
    const barcode = DOM.val('qs-new-barcode');
    const name    = DOM.val('qs-new-name');
    const price   = parseFloat(DOM.val('qs-new-price'));
    const qty     = parseFloat(DOM.val('qs-new-qty')) || 0;

    if (!name)            { Notify.error('أدخل اسم المنتج'); return; }
    if (!price || price <= 0) { Notify.error('أدخل السعر'); return; }

    try {
      const { data: product, error } = await DB.inventory().insert({
        store_id:        State.user.id,
        name, barcode,
        sale_price:      price,
        quantity:        qty,
        category:        'عام',
        unit:            'قطعة',
        low_stock_alert: CONFIG.lowStockDefault,
      }).select().single();

      if (error) throw error;

      State.inventory.push(product);
      Modal.close('m-new-product');
      QuickSale.addToCart(product.id);
      Notify.success('تم إضافة المنتج وإضافته للسلة');
      await QuickSale._renderProductGrid();
    } catch (err) {
      Notify.error(err.message);
    }
  },
};
