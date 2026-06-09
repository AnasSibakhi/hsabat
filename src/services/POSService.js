/**
 * POSService.js — POS Cart & Checkout Service
 */

import { DB }               from '../core/db.js';
import { State }            from '../core/state.js';
import { InventoryService } from './InventoryService.js';
import { today }            from '../core/utils.js';
import { sb }               from '../core/db.js';

// Cart state
let _cart     = [];
let _discount = 0;
let _customer = null;

export const POSService = {

  // ── Cart ──
  getCart:     () => [..._cart],
  getDiscount: () => _discount,
  getCustomer: () => _customer,

  setCustomer(customer) { _customer = customer; },
  setDiscount(pct)      { _discount = Math.max(0, Math.min(100, pct)); },

  clearCart() {
    _cart     = [];
    _discount = 0;
    _customer = null;
  },

  addItem(product, qty = 1) {
    if (!product?.id) throw new Error('منتج غير صالح');
    if (product.quantity <= 0) throw new Error('المخزون فارغ لـ "' + product.name + '"');

    const existing = _cart.find(c => c.productId === product.id);
    if (existing) {
      const newQty = existing.qty + qty;
      if (newQty > product.quantity) throw new Error('المخزون غير كافٍ — المتبقي: ' + product.quantity);
      existing.qty = newQty;
    } else {
      _cart.push({
        productId: product.id,
        name:      product.name,
        barcode:   product.barcode || '',
        unit:      product.unit    || '',
        price:     product.sale_price || 0,
        qty,
        maxQty:    product.quantity,
      });
    }
  },

  removeItem(productId) {
    _cart = _cart.filter(c => c.productId !== productId);
  },

  changeQty(productId, delta) {
    const item = _cart.find(c => c.productId === productId);
    if (!item) return;
    const newQty = item.qty + delta;
    if (newQty <= 0)          { POSService.removeItem(productId); return; }
    if (newQty > item.maxQty) throw new Error('المخزون غير كافٍ — المتبقي: ' + item.maxQty);
    item.qty = newQty;
  },

  getTotals() {
    const subtotal = _cart.reduce((s, c) => s + c.qty * c.price, 0);
    const discount = _discount > 0 ? subtotal * (_discount / 100) : 0;
    const total    = Math.max(0, subtotal - discount);
    return { subtotal, discount, total };
  },

  // ── Checkout ──
  async checkout(paymentType, customerId = null) {
    if (!_cart.length) throw new Error('السلة فارغة');

    const { subtotal, discount, total } = POSService.getTotals();
    const timeNow  = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateNow  = today();
    const custName = _customer?.name || 'زبون عادي';

    // Generate invoice number
    const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
    const invNum = 'INV-' + String((count || 0) + 1).padStart(4, '0');

    // Create invoice
    const { data: invoice, error: invErr } = await DB.invoices().insert({
      store_id:       State.user.id,
      customer_id:    customerId || null,
      customer_name:  custName,
      total, subtotal, discount,
      payment_type:   paymentType,
      invoice_date:   dateNow,
      sale_time:      timeNow,
      invoice_number: invNum,
    }).select().single();

    if (invErr) throw invErr;

    // Save line items + deduct inventory
    await sb.from('invoice_items').insert(
      _cart.map(c => ({
        invoice_id:   invoice.id,
        product_name: c.name,
        inventory_id: c.productId,
        quantity:     c.qty,
        price:        c.price,
      }))
    );

    for (const item of _cart) {
      await InventoryService.deductStock(item.productId, item.qty);
    }

    // Add debt if needed
    if ((paymentType === 'defer' || paymentType === 'partial') && customerId) {
      const debtAmt = paymentType === 'partial'
        ? total - (parseFloat(arguments[2]) || 0)
        : total;
      if (debtAmt > 0) {
        await DB.debts().insert({
          store_id:    State.user.id,
          customer_id: customerId,
          amount:      debtAmt,
          paid:        0,
          debt_date:   dateNow,
          notes:       'فاتورة ' + invNum,
        });
      }
    }

    POSService.clearCart();
    return { invoice, invNum, total };
  },
};
