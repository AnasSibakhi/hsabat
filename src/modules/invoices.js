/**
 * invoices.js — Invoices Module
 * Extracted from monolithic app.js into clean module
 */

import { DB }     from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM     from '../core/dom.js';
import { sb }     from '../core/db.js';
import * as Utils from '../core/utils.js';
import { escape, currency, sumBy, daysSince, today, monthStart, daysAgo, periodStart, invoiceNumber, currentTime, formatDate } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal   from '../nav/modal.js';
import { Customers } from './customers.js';
import { Debts } from './debts.js';
import { Inventory } from './inventory.js';
import { Dashboard } from './dashboard.js';

// ─────────────────────────────────────────
// 16. INVOICES MODULE
// ─────────────────────────────────────────
const Invoices = {
  async load() {
    const { data } = await DB.invoices().select('*').order('created_at', { ascending: false });
    DOM.setHTML('ilist', (data || []).length
      ? data.map(inv => {
          const payBadge = { cash: '<span class="bg">نقدي</span>', transfer: '<span class="bb">تحويل</span>', partial: '<span class="ba">جزئي</span>', defer: '<span class="br">دين</span>' }[inv.payment_type] || '';
          return `<tr>
            <td><strong>${Utils.escape(inv.invoice_number || '-')}</strong></td>
            <td>${Utils.escape(inv.customer_name || 'عادي')}</td>
            <td>${inv.invoice_date} <small style="color:var(--g4);">${inv.sale_time || ''}</small></td>
            <td>₪${inv.total.toFixed(2)}</td>
            <td>${payBadge}</td>
            <td>
              <button class="ibb" onclick="Returns.openModal('${inv.id}','${Utils.escape(inv.customer_name || '')}',${inv.total})" style="margin-left:4px;">إرجاع</button>
              <button class="ibr" onclick="Invoices.delete('${inv.id}')">حذف</button>
            </td>
          </tr>`;
        }).join('')
      : '<tr class="er"><td colspan="6">لا توجد فواتير</td></tr>'
    );
  },

  _buildItemRow() {
    const opts = State.inventory
      .map(i => `<option value="${i.id}" data-price="${i.sale_price || 0}" data-name="${Utils.escape(i.name)}">${Utils.escape(i.name)} (${i.quantity} ${i.unit || ''})</option>`)
      .join('');
    return `<div class="ii" style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:6px;margin-bottom:8px;align-items:center;">
      <select class="inp prod-sel" style="font-size:13px;" onchange="Invoices._onProductSelect(this)">
        <option value="">-- اختر المنتج --</option>${opts}
      </select>
      <input class="inp qty-inp" type="number" value="1" oninput="Invoices.calcTotal()" style="font-size:13px;" inputmode="decimal">
      <input class="inp price-inp" type="number" placeholder="₪" oninput="Invoices.calcTotal()" style="font-size:13px;" inputmode="decimal">
      <button onclick="this.closest('.ii').remove();Invoices.calcTotal()" style="background:var(--dl);color:var(--d);border:none;border-radius:6px;width:34px;height:38px;cursor:pointer;font-size:18px;">✕</button>
    </div>`;
  },

  _onProductSelect(select) {
    const price = parseFloat(select.options[select.selectedIndex]?.getAttribute('data-price')) || 0;
    if (price > 0) select.closest('.ii').querySelector('.price-inp').value = price;
    Invoices.calcTotal();
  },

  resetForm() {
    const wrap = DOM.get('iitems');
    if (wrap) wrap.innerHTML = Invoices._buildItemRow();
    DOM.setText('itotal', '₪ 0');
    const disc = DOM.get('idiscount'); if (disc) disc.value = '0';
  },

  addItem() {
    DOM.get('iitems')?.insertAdjacentHTML('beforeend', Invoices._buildItemRow());
  },

  calcTotal() {
    let subtotal = 0;
    document.querySelectorAll('#iitems .ii').forEach(row => {
      subtotal += (parseFloat(row.querySelector('.qty-inp')?.value) || 0) * (parseFloat(row.querySelector('.price-inp')?.value) || 0);
    });
    const discount = parseFloat(DOM.val('idiscount')) || 0;
    DOM.setText('itotal', '₪ ' + Math.max(0, subtotal - discount).toFixed(2));
  },

  _collectItems() {
    const items = [];
    let subtotal = 0;
    document.querySelectorAll('#iitems .ii').forEach(row => {
      const select = row.querySelector('.prod-sel');
      const qty    = parseFloat(row.querySelector('.qty-inp')?.value) || 0;
      const price  = parseFloat(row.querySelector('.price-inp')?.value) || 0;
      const invId  = select?.value || '';
      const name   = select?.options[select?.selectedIndex]?.getAttribute('data-name') || 'منتج';
      if (qty > 0 && price > 0) {
        items.push({ product_name: name, inventory_id: invId || null, quantity: qty, price });
        subtotal += qty * price;
      }
    });
    return { items, subtotal };
  },

  async _generateInvoiceNumber() {
    const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
    return 'INV-' + String((count || 0) + 1).padStart(4, '0');
  },

  async save() {
    const { items, subtotal } = Invoices._collectItems();
    if (!items.length || !subtotal) { Notify.error('أضف منتجاً وسعراً'); return; }

    const discount     = parseFloat(DOM.val('idiscount')) || 0;
    const total        = Math.max(0, subtotal - discount);
    const paymentType  = document.querySelector('input[name="ip"]:checked').value;
    const partialPaid  = paymentType === PAYMENT.PARTIAL ? (parseFloat(DOM.val('ipartial')) || 0) : 0;
    const today        = Utils.today();
    const timeNow      = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Resolve customer
    let customerId = DOM.val('ic');
    let customerName = 'زبون عادي';
    let customerPhone = '';

    State.isMutating = true;
    try {
      if (customerId === '__new__') {
        const newName = DOM.val('inv-new-name');
        if (!newName) { Notify.error('أدخل اسم الزبون الجديد'); return; }
        const newCustomer = await Customers.createInline(newName, DOM.val('inv-new-phone'));
        customerId   = newCustomer.id;
        customerName = newName;
        customerPhone = DOM.val('inv-new-phone');
        await Customers.loadAll();
      } else if (customerId) {
        const found = State.customers.find(c => c.id === customerId);
        customerName  = found?.name  || '';
        customerPhone = found?.phone || '';
      }

      const invoiceNumber = await Invoices._generateInvoiceNumber();

      const { data: invoice, error } = await DB.invoices().insert({
        store_id: State.user.id, customer_id: customerId || null,
        customer_name: customerName, customer_phone: customerPhone,
        total, subtotal, discount, payment_type: paymentType,
        partial_paid: partialPaid, invoice_date: today,
        sale_time: timeNow, invoice_number: invoiceNumber,
        notes: DOM.val('inotes'),
      }).select().single();

      if (error) throw error;

      // Save line items
      await sb.from('invoice_items').insert(items.map(it => ({ ...it, invoice_id: invoice.id })));

      // Deduct inventory
      await Inventory.deductItems(items);

      // Create debt if needed
      if ([PAYMENT.DEFER, PAYMENT.PARTIAL].includes(paymentType) && customerId) {
        const debtAmount = paymentType === PAYMENT.PARTIAL ? total - partialPaid : total;
        if (debtAmount > 0) await Debts.addFromInvoice(customerId, debtAmount, today, invoiceNumber);
      }

      Notify.success('فاتورة ' + invoiceNumber + ' — ' + Utils.currency(total));
      Modal.close('m-invoice');
      Invoices.resetForm();
      DOM.get('new-cust-wrap')?.classList.add('hidden');
      DOM.clearInputs('inv-new-name', 'inv-new-phone', 'inotes');
      DOM.get('idiscount').value = '0';

      await Inventory.loadList();
      await Promise.all([Invoices.load(), Dashboard.load(), Customers.loadTable()]);
    } catch (err) {
      console.error('[Invoices.save]', err);
      Notify.error(err.message);
    } finally {
      setTimeout(() => { State.isMutating = false; }, 500);
    }
  },

  async delete(id) {
    if (!confirm('حذف؟')) return;
    State.isMutating = true;
    try { await DB.invoices().delete().eq('id', id); Notify.success('تم'); Invoices.load(); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },
};

export { Invoices };
