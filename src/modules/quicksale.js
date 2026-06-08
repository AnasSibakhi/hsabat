/**
 * quicksale.js — QuickSale Module
 * Extracted from monolithic app.js into clean module
 */

import { DB }     from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM     from '../core/dom.js';
import { sb }     from '../core/db.js';
import { escape, currency, sumBy, daysSince, today, monthStart, daysAgo, periodStart, invoiceNumber, currentTime, formatDate } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal   from '../nav/modal.js';

// ─────────────────────────────────────────
// 24. QUICK SALE MODULE
// ─────────────────────────────────────────
const QuickSale = {
  _discount: 0,

  init() {
    const wrap = DOM.get('qs-items');
    if (wrap && !wrap.children.length) wrap.innerHTML = QuickSale._buildRow();
    QuickSale._discount = 0;
    QuickSale.loadSummary();
  },

  _buildRow() {
    const opts = State.inventory.map(i =>
      `<option value="${i.id}" data-price="${i.sale_price || 0}" data-name="${Utils.escape(i.name)}">${Utils.escape(i.name)} (${i.quantity} ${i.unit || ''})</option>`
    ).join('');
    return `<div class="qs-item" style="background:var(--g0);border-radius:10px;padding:10px;margin-bottom:8px;">
      <select class="inp" style="font-size:14px;margin-bottom:6px;" onchange="QuickSale._onProductSelect(this)"><option value="">-- اختر المنتج --</option>${opts}</select>
      <div style="display:flex;gap:6px;align-items:center;">
        <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
          <div style="display:flex;gap:4px;">
            <button onclick="QuickSale._stepQty(this,-1)" style="background:var(--g2);border:none;border-radius:6px;width:32px;height:32px;font-size:16px;cursor:pointer;">−</button>
            <input class="inp qs-qty" type="number" value="1" min="0.1" step="0.5" oninput="QuickSale.calcTotal()" style="font-size:15px;font-weight:700;text-align:center;width:60px;padding:4px;">
            <button onclick="QuickSale._stepQty(this,1)"  style="background:var(--g2);border:none;border-radius:6px;width:32px;height:32px;font-size:16px;cursor:pointer;">+</button>
          </div>
          <div style="display:flex;gap:3px;">
            ${[1,2,5,10].map(n => `<button onclick="QuickSale._setQty(this,${n})" style="background:var(--pl);color:var(--p);border:none;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;">${n}</button>`).join('')}
          </div>
        </div>
        <input class="inp qs-price" type="number" placeholder="₪" oninput="QuickSale.calcTotal()" style="font-size:14px;width:90px;text-align:center;">
        <button onclick="this.closest('.qs-item').remove();QuickSale.calcTotal()" style="background:var(--dl);color:var(--d);border:none;border-radius:6px;width:34px;height:34px;cursor:pointer;font-size:18px;">✕</button>
      </div>
      <div class="qs-line-total" style="text-align:left;font-size:12px;color:var(--g5);margin-top:4px;"></div>
    </div>`;
  },

  _onProductSelect(select) {
    const price = parseFloat(select.options[select.selectedIndex]?.getAttribute('data-price')) || 0;
    if (price > 0) select.closest('.qs-item').querySelector('.qs-price').value = price;
    QuickSale.calcTotal();
  },

  _stepQty(btn, delta) {
    const inp = btn.closest('.qs-item').querySelector('.qs-qty');
    inp.value = Math.max(0.5, (parseFloat(inp.value) || 1) + delta);
    QuickSale.calcTotal();
  },

  _setQty(btn, qty) {
    btn.closest('.qs-item').querySelector('.qs-qty').value = qty;
    QuickSale.calcTotal();
  },

  addRow() { DOM.get('qs-items')?.insertAdjacentHTML('beforeend', QuickSale._buildRow()); },

  calcTotal() {
    let subtotal = 0;
    document.querySelectorAll('.qs-item').forEach(row => {
      const qty = parseFloat(row.querySelector('.qs-qty')?.value) || 0;
      const prc = parseFloat(row.querySelector('.qs-price')?.value) || 0;
      const lt  = qty * prc;
      subtotal += lt;
      const label = row.querySelector('.qs-line-total');
      if (label) label.textContent = lt > 0 ? '= ₪ ' + lt.toFixed(2) : '';
    });
    const discount = QuickSale._discount > 0 ? subtotal * (QuickSale._discount / 100) : 0;
    DOM.setText('qs-total', '₪ ' + Math.max(0, subtotal - discount).toFixed(2));
    QuickSale.calcChange();
  },

  calcChange() {
    const paid  = parseFloat(DOM.val('qs-paid-amt')) || 0;
    const total = parseFloat(DOM.get('qs-total')?.textContent?.replace('₪', '').trim()) || 0;
    const el    = DOM.get('qs-change');
    if (!el) return;
    if (paid <= 0) { el.textContent = '-'; el.style.color = 'var(--g4)'; return; }
    const change = paid - total;
    el.textContent = '₪ ' + Math.abs(change).toFixed(2) + (change >= 0 ? ' (باقي للزبون)' : ' (ناقص)');
    el.style.color = change >= 0 ? 'var(--s)' : 'var(--d)';
  },

  applyDiscount(pct) {
    QuickSale._discount = pct;
    QuickSale.calcTotal();
    Notify.show(pct > 0 ? 'تم تطبيق خصم ' + pct + '%' : 'تم إلغاء الخصم');
  },

  clear() {
    DOM.setHTML('qs-items', QuickSale._buildRow());
    DOM.setText('qs-total', '₪ 0');
    DOM.clearInputs('qs-paid-amt', 'qs-cust-name');
    const ch = DOM.get('qs-change'); if (ch) { ch.textContent = '-'; ch.style.color = 'var(--g4)'; }
    QuickSale._discount = 0;
    Notify.show('تم المسح');
  },

  openDebtModal() {
    DOM.setHTML('qs-cust', '<option value="">-- اختر الزبون --</option>' +
      State.customers.map(c => `<option value="${c.id}">${Utils.escape(c.name)}</option>`).join(''));
    Modal.open('m-qs-debt');
  },

  async sell(paymentType) {
    const items = [];
    let subtotal = 0;
    document.querySelectorAll('.qs-item').forEach(row => {
      const select = row.querySelector('select');
      const qty    = parseFloat(row.querySelector('.qs-qty')?.value) || 0;
      const price  = parseFloat(row.querySelector('.qs-price')?.value) || 0;
      const invId  = select?.value || '';
      const name   = select?.options[select?.selectedIndex]?.getAttribute('data-name') || '';
      if (qty > 0 && price > 0) { items.push({ product_name: name, inventory_id: invId || null, quantity: qty, price }); subtotal += qty * price; }
    });
    if (!items.length || !subtotal) { Notify.error('أضف منتجاً بسعر'); return; }

    const discount   = QuickSale._discount > 0 ? subtotal * (QuickSale._discount / 100) : 0;
    const total      = Math.max(0, subtotal - discount);
    const custName   = DOM.val('qs-cust-name') || 'زبون عادي';
    let   customerId = '';

    if (paymentType === PAYMENT.DEFER) {
      customerId = DOM.val('qs-cust');
      if (!customerId) { Notify.error('اختر الزبون'); return; }
      Modal.close('m-qs-debt');
    }

    State.isMutating = true;
    try {
      const invoiceNumber = await Invoices._generateInvoiceNumber();
      const { data: invoice, error } = await DB.invoices().insert({
        store_id: State.user.id, customer_id: customerId || null,
        customer_name: customerId ? State.customers.find(c => c.id === customerId)?.name : custName,
        total, subtotal, discount, payment_type: paymentType,
        invoice_date: Utils.today(),
        sale_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        invoice_number: invoiceNumber,
      }).select().single();
      if (error) throw error;

      await sb.from('invoice_items').insert(items.map(it => ({ ...it, invoice_id: invoice.id })));
      await Inventory.deductItems(items);

      if (paymentType === PAYMENT.DEFER && customerId) {
        await Debts.addFromInvoice(customerId, total, Utils.today(), invoiceNumber);
      }

      if (navigator.vibrate) navigator.vibrate(50);
      Notify.success(invoiceNumber + ' — ' + Utils.currency(total));
      QuickSale.clear();
      await Promise.all([Dashboard.load(), Inventory.loadList(), QuickSale.loadSummary()]);
    } catch (err) { console.error('[QuickSale.sell]', err); Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async loadSummary() {
    const { data } = await DB.invoices().select('total,payment_type,customer_name,sale_time,invoice_number').eq('invoice_date', Utils.today()).order('created_at', { ascending: false });
    const list     = data || [];

    const cash     = list.filter(r => r.payment_type === PAYMENT.CASH).reduce((s, r) => s + r.total, 0);
    const transfer = list.filter(r => r.payment_type === PAYMENT.TRANSFER).reduce((s, r) => s + r.total, 0);
    const defer    = list.filter(r => [PAYMENT.DEFER, PAYMENT.PARTIAL].includes(r.payment_type)).reduce((s, r) => s + r.total, 0);

    DOM.setHTML('qs-daily-summary', `
      <div style="background:var(--sl);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:10px;color:var(--s);">نقدي</div><div style="font-size:15px;font-weight:800;color:var(--s);">₪${cash.toFixed(0)}</div></div>
      <div style="background:var(--pl);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:10px;color:var(--p);">تحويل</div><div style="font-size:15px;font-weight:800;color:var(--p);">₪${transfer.toFixed(0)}</div></div>
      <div style="background:var(--dl);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:10px;color:var(--d);">دين</div><div style="font-size:15px;font-weight:800;color:var(--d);">₪${defer.toFixed(0)}</div></div>`
    );

    DOM.setHTML('qs-recent', list.length
      ? list.slice(0, 5).map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--g0);border-radius:8px;margin-bottom:5px;"><div><span style="font-weight:700;font-size:13px;">${Utils.escape(r.invoice_number || '-')}</span><span style="color:var(--g5);font-size:12px;margin-right:6px;">${Utils.escape(r.customer_name || 'عادي')}</span></div><div style="text-align:left;"><span style="font-weight:700;font-size:13px;">₪${r.total.toFixed(2)}</span><span style="color:var(--g4);font-size:11px;display:block;">${r.sale_time || ''}</span></div></div>`).join('')
      : '<div style="color:var(--g4);font-size:13px;">لا توجد مبيعات اليوم</div>'
    );
  },
};

export { QuickSale };
