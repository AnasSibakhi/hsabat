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
import { getCustomers, getDebts, getInventory, getDashboard } from '../core/registry.js';




// ─────────────────────────────────────────
// 16. INVOICES MODULE
// ─────────────────────────────────────────
const Invoices = {
  async load() {
    const { data } = await DB.invoices().select('*').order('created_at', { ascending: false });
    DOM.setHTML('ilist', (data || []).length
      ? data.map(inv => {
          const payBadge = { cash: '<span class="bg">نقدي</span>', transfer: '<span class="bb">تحويل</span>', partial: '<span class="ba">جزئي</span>', defer: '<span class="br">دين</span>' }[inv.payment_type] || '';
          const buyer = Utils.escape(inv.buyer_name || inv.customer_name || 'عادي');
          return `<tr>
            <td><strong>${Utils.escape(inv.invoice_number || '-')}</strong></td>
            <td>${buyer}</td>
            <td>${inv.invoice_date} <small style="color:var(--g4);">${inv.sale_time || ''}</small></td>
            <td>₪${inv.total.toFixed(2)}</td>
            <td>${payBadge}</td>
            <td>
              <button class="ibb" onclick="Invoices.openDetails('${inv.id}')" style="margin-left:4px;">تفاصيل</button>
              <button class="ibb" onclick="Returns.openModal('${inv.id}','${Utils.escape(inv.customer_name || '')}',${inv.total})" style="margin-left:4px;">إرجاع</button>
              <button class="ibr" onclick="Invoices.delete('${inv.id}')">حذف</button>
            </td>
          </tr>`;
        }).join('')
      : '<tr class="er"><td colspan="6">لا توجد فواتير</td></tr>'
    );
  },

  async openDetails(invId) {
    const { data: inv } = await sb.from('invoices').select('*').eq('id', invId).single();
    const { data: items } = await sb.from('invoice_items').select('*').eq('invoice_id', invId);
    if (!inv) { Notify.error('تعذّر تحميل الفاتورة'); return; }

    const payLabel = { cash: 'نقدي', transfer: 'تحويل', partial: 'جزئي', defer: 'دين' }[inv.payment_type] || inv.payment_type;
    const itemsHtml = (items || []).map(it =>
      `<tr>
        <td>${Utils.escape(it.product_name || '-')}</td>
        <td style="text-align:center;">${it.quantity}</td>
        <td style="text-align:left;">₪${parseFloat(it.price).toFixed(2)}</td>
        <td style="text-align:left;font-weight:700;">₪${(it.quantity * it.price).toFixed(2)}</td>
      </tr>`
    ).join('') || '<tr><td colspan="4" style="color:var(--g4);">لا توجد منتجات</td></tr>';

    DOM.setHTML('inv-details-body', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1rem;">
        <div class="inv-det-row"><span>رقم الفاتورة</span><strong>${Utils.escape(inv.invoice_number || '-')}</strong></div>
        <div class="inv-det-row"><span>التاريخ والوقت</span><strong>${inv.invoice_date} ${inv.sale_time || ''}</strong></div>
        <div class="inv-det-row"><span>اسم المشتري</span><strong>${Utils.escape(inv.buyer_name || inv.customer_name || '-')}</strong></div>
        <div class="inv-det-row"><span>رقم الجوال</span><strong>${Utils.escape(inv.buyer_phone || '-')}</strong></div>
        <div class="inv-det-row"><span>طريقة الدفع</span><strong>${payLabel}</strong></div>
        ${inv.transfer_entity_name ? `<div class="inv-det-row"><span>جهة التحويل</span><strong>${Utils.escape(inv.transfer_entity_name)}</strong></div>` : ''}
      </div>
      <table class="dt" style="margin-bottom:.75rem;">
        <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="text-align:left;font-size:15px;">
        ${inv.discount > 0 ? `<div style="color:var(--g5);margin-bottom:4px;">خصم: ₪${inv.discount.toFixed(2)}</div>` : ''}
        <strong style="font-size:18px;">الإجمالي: ₪${inv.total.toFixed(2)}</strong>
      </div>
    `);
    Modal.open('m-inv-details');
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
        const newCustomer = await getCustomers().createInline(newName, DOM.val('inv-new-phone'));
        customerId   = newCustomer.id;
        customerName = newName;
        customerPhone = DOM.val('inv-new-phone');
        await getCustomers().loadAll();
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
      await getInventory().deductItems(items);

      // Create debt if needed
      if ([PAYMENT.DEFER, PAYMENT.PARTIAL].includes(paymentType) && customerId) {
        const debtAmount = paymentType === PAYMENT.PARTIAL ? total - partialPaid : total;
        if (debtAmount > 0) await getDebts().addFromInvoice(customerId, debtAmount, today, invoiceNumber);
      }

      Notify.success('فاتورة ' + invoiceNumber + ' — ' + Utils.currency(total));
      Modal.close('m-invoice');
      Invoices.resetForm();
      DOM.get('new-cust-wrap')?.classList.add('hidden');
      DOM.clearInputs('inv-new-name', 'inv-new-phone', 'inotes');
      DOM.get('idiscount').value = '0';

      await getInventory().loadList();
      await Promise.all([Invoices.load(), getDashboard().load(), getCustomers().loadTable()]);
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
