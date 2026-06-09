/**
 * quicksale.js — Professional POS Module
 * Uses: BarcodeScanner, POSService, InventoryService
 */

import { State }            from '../core/state.js';
import { Notify }           from '../core/notify.js';
import * as DOM             from '../core/dom.js';
import * as Modal           from '../nav/modal.js';
import { escape }           from '../core/utils.js';
import { CONFIG }           from '../config/constants.js';
import { getDashboard, getDebts, getInventory } from '../core/registry.js';
import { BarcodeScanner }   from '../services/BarcodeScanner.js';
import { InventoryService } from '../services/InventoryService.js';
import { POSService }       from '../services/POSService.js';

export const QuickSale = {

  async init() {
    POSService.clearCart();
    await InventoryService.getAll().then(data => { State.inventory = data; });
    QuickSale._renderGrid();
    QuickSale._renderCart();
    const si = DOM.get('qs-search-input');
    if (si) si.value = '';
  },

  // ── Product Grid ──
  _renderGrid(filter = '') {
    const grid = DOM.get('qs-product-grid');
    if (!grid) return;

    let list = State.inventory;
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode || '').includes(q)
      );
    } else {
      list = list.filter(p => p.quantity > 0);
    }

    if (!list.length) {
      grid.innerHTML = '<div class="qs-empty">'
        + (filter ? 'لا توجد نتائج لـ "' + escape(filter) + '"' : 'لا يوجد مخزون متاح')
        + '</div>';
      return;
    }

    grid.innerHTML = list.slice(0, 30).map(p => {
      const low   = p.quantity <= p.low_stock_alert;
      const price = p.sale_price ? '&#x20AA;' + p.sale_price.toFixed(2) : '&mdash;';
      return '<button class="qs-product-btn" onclick="QuickSale.addToCart(\'' + p.id + '\')">'
        + '<div class="qs-p-name">' + escape(p.name) + '</div>'
        + '<div class="qs-p-price">' + price + '</div>'
        + '<div class="qs-p-qty ' + (low ? 'low' : '') + '">' + p.quantity + ' ' + escape(p.unit || '') + '</div>'
        + '</button>';
    }).join('');
  },

  search(val) { QuickSale._renderGrid(val); },

  // ── Cart ──
  addToCart(productId) {
    const product = State.inventory.find(p => p.id === productId);
    if (!product) return;
    if (!product.sale_price || product.sale_price <= 0) {
      Notify.error('هذا المنتج ليس له سعر بيع');
      return;
    }
    try {
      POSService.addItem(product);
      if (navigator.vibrate) navigator.vibrate(30);
      QuickSale._renderCart();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  removeItem(productId) {
    POSService.removeItem(productId);
    QuickSale._renderCart();
  },

  changeQty(productId, delta) {
    try {
      POSService.changeQty(productId, delta);
      QuickSale._renderCart();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  _renderCart() {
    const cart = POSService.getCart();
    const el   = DOM.get('qs-cart-items');
    if (!el) return;

    if (!cart.length) {
      el.innerHTML = '<div class="qs-cart-empty"><i class="ti ti-shopping-cart"></i><p>السلة فارغة</p></div>';
      DOM.setText('qs-items-count', '0 أصناف');
      DOM.setText('qs-total-display', '₪ 0.00');
      const s = DOM.get('qs-summary'); if (s) s.innerHTML = '';
      return;
    }

    el.innerHTML = cart.map(item => {
      const lineTotal = item.qty * item.price;
      return '<div class="qs-cart-item">'
        + '<div class="qs-ci-info">'
        + '<div class="qs-ci-name">' + escape(item.name) + '</div>'
        + '<div class="qs-ci-price">&#x20AA;' + item.price.toFixed(2) + ' × ' + item.qty
        + ' = <strong>&#x20AA;' + lineTotal.toFixed(2) + '</strong></div>'
        + '</div>'
        + '<div class="qs-ci-controls">'
        + '<button class="qs-qty-btn" onclick="QuickSale.changeQty(\'' + item.productId + '\',-1)">−</button>'
        + '<span class="qs-qty-num">' + item.qty + '</span>'
        + '<button class="qs-qty-btn" onclick="QuickSale.changeQty(\'' + item.productId + '\',1)">+</button>'
        + '<button class="qs-remove-btn" onclick="QuickSale.removeItem(\'' + item.productId + '\')"><i class="ti ti-x"></i></button>'
        + '</div>'
        + '</div>';
    }).join('');

    DOM.setText('qs-items-count', cart.length + ' ' + (cart.length === 1 ? 'صنف' : 'أصناف'));

    const { subtotal, discount, total } = POSService.getTotals();
    DOM.setText('qs-total-display', '₪ ' + total.toFixed(2));

    const s = DOM.get('qs-summary');
    if (s) {
      let html = '<div class="qs-sum-row"><span>المجموع</span><span>₪' + subtotal.toFixed(2) + '</span></div>';
      if (discount > 0) html += '<div class="qs-sum-row green"><span>خصم ' + POSService.getDiscount() + '%</span><span>−₪' + discount.toFixed(2) + '</span></div>';
      html += '<div class="qs-sum-row total"><span>الإجمالي</span><span>₪' + total.toFixed(2) + '</span></div>';
      s.innerHTML = html;
    }

    QuickSale.calcChange();
  },

  applyDiscount(pct) {
    POSService.setDiscount(pct);
    QuickSale._renderCart();
    Notify.show(pct > 0 ? 'خصم ' + pct + '%' : 'تم إلغاء الخصم');
  },

  calcChange() {
    const { total } = POSService.getTotals();
    const paid      = parseFloat(DOM.val('qs-paid')) || 0;
    const el        = DOM.get('qs-change');
    if (!el) return;
    if (paid <= 0) { el.textContent = '—'; el.style.color = 'var(--g4)'; return; }
    const change = paid - total;
    el.textContent = '₪ ' + Math.abs(change).toFixed(2) + (change >= 0 ? ' (باقي)' : ' (ناقص)');
    el.style.color = change >= 0 ? 'var(--s)' : 'var(--d)';
  },

  clearCart() {
    POSService.clearCart();
    QuickSale._renderCart();
    const si = DOM.get('qs-search-input');
    if (si) si.value = '';
    QuickSale._renderGrid();
    Notify.show('تم مسح السلة');
  },

  // ── Checkout ──
  openDebtModal() {
    DOM.setHTML('qs-debt-cust',
      '<option value="">-- اختر الزبون --</option>' +
      State.customers.map(c => '<option value="' + c.id + '">' + escape(c.name) + '</option>').join('')
    );
    Modal.open('m-qs-debt');
  },

  async sell(paymentType) {
    const cart = POSService.getCart();
    if (!cart.length) { Notify.error('السلة فارغة'); return; }

    let customerId = null;
    if (paymentType === 'defer') {
      customerId = DOM.val('qs-debt-cust');
      if (!customerId) { Notify.error('اختر الزبون'); return; }
      Modal.close('m-qs-debt');
    }

    State.isMutating = true;
    try {
      const { invNum, total } = await POSService.checkout(paymentType, customerId);
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      Notify.success(invNum + ' — ₪' + total.toFixed(2));
      QuickSale._renderCart();
      QuickSale._renderGrid();

      // Refresh data
      State.inventory = await InventoryService.getAll();
      await getDashboard()?.load();
      await getDebts()?.loadBadge();

      // Clear paid input
      const paid = DOM.get('qs-paid');
      if (paid) paid.value = '';
      const ch = DOM.get('qs-change');
      if (ch) { ch.textContent = '—'; ch.style.color = 'var(--g4)'; }

    } catch (err) {
      Notify.error(err.message);
    } finally {
      setTimeout(() => { State.isMutating = false; }, 500);
    }
  },

  // ── Barcode Scanner ──
  async startScanner() {
    const overlay = DOM.get('qs-scanner-overlay');
    if (overlay) overlay.style.display = 'flex';

    await BarcodeScanner.start(
      'qs-scanner-container',
      async (barcode) => {
        QuickSale.stopScanner();
        await QuickSale._onBarcode(barcode);
      },
      (err) => {
        QuickSale.stopScanner();
        Notify.error(err);
      }
    );
  },

  stopScanner() {
    BarcodeScanner.stop();
    const overlay = DOM.get('qs-scanner-overlay');
    if (overlay) overlay.style.display = 'none';
    const container = DOM.get('qs-scanner-container');
    if (container) container.innerHTML = '';
  },

  async _onBarcode(barcode) {
    // Search in current inventory
    const product = State.inventory.find(p => p.barcode === barcode)
      || await InventoryService.findByBarcode(barcode);

    if (product) {
      // Update state cache
      if (!State.inventory.find(p => p.id === product.id)) {
        State.inventory.push(product);
      }
      QuickSale.addToCart(product.id);
    } else {
      // Product not found — open add product modal
      const bc = DOM.get('qs-new-barcode');
      const nm = DOM.get('qs-new-name');
      if (bc) bc.value = barcode;
      if (nm) { nm.value = ''; setTimeout(() => nm.focus(), 300); }
      Modal.open('m-new-product');
    }
  },

  // ── Add new product from scanner ──
  async saveNewProduct() {
    const barcode = DOM.val('qs-new-barcode');
    const name    = DOM.val('qs-new-name');
    const sell    = parseFloat(DOM.val('qs-new-sell'));
    const qty     = parseFloat(DOM.val('qs-new-qty')) || 0;
    const cat     = DOM.get('qs-new-category')?.value || 'عام';
    const unit    = DOM.get('qs-new-unit')?.value || 'قطعة (pcs)';

    if (!name)              { Notify.error('أدخل اسم المنتج'); return; }
    if (!sell || sell <= 0) { Notify.error('أدخل سعر البيع');  return; }

    try {
      const product = await InventoryService.addProduct({
        name, barcode, sellPrice: sell, quantity: qty,
        category: cat, unit, minStock: 10,
      });

      State.inventory.push(product);
      Modal.close('m-new-product');
      QuickSale.addToCart(product.id);
      QuickSale._renderGrid();
      Notify.success('تم إضافة "' + name + '" وإضافته للسلة');

    } catch (err) {
      Notify.error(err.message);
    }
  },
};
