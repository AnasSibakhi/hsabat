/**
 * debts.js — Debts Module
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
// 15. DEBTS MODULE
// ─────────────────────────────────────────
const Debts = {
  async load() {
    const { data } = await DB.debts().select('*,customers(name)').order('debt_date', { ascending: false });
    const list     = data || [];
    const active   = list.filter(d => d.amount - d.paid > 0);
    const total    = active.reduce((s, d) => s + (d.amount - d.paid), 0);
    const overdue  = active.filter(d => Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays).length;

    const { data: paidThisMonth } = await DB.debts().select('paid').gte('debt_date', Utils.monthStart());
    const paidTotal = Utils.sumBy(paidThisMonth, 'paid');

    DOM.setText('dt1', Utils.currency(total));
    DOM.setText('dt2', overdue);
    DOM.setText('dt3', Utils.currency(paidTotal));

    DOM.setHTML('dalerts', active
      .filter(d => Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays)
      .map(d => `<div class="alert ad"><i class="ti ti-bell"></i><span><strong>${Utils.escape(d.customers?.name)}</strong> — متأخر ${Utils.daysSince(d.debt_date)} يوم — ₪${(d.amount - d.paid).toFixed(2)}</span></div>`)
      .join('')
    );

    DOM.setHTML('dlist', active.length
      ? active.map(d => `<tr>
          <td>${Utils.escape(d.customers?.name || '-')}</td>
          <td>₪${d.amount.toFixed(2)}</td>
          <td><strong>₪${(d.amount - d.paid).toFixed(2)}</strong></td>
          <td>${d.debt_date}</td>
          <td><span class="${Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays ? 'br' : 'bb'}">${Utils.daysSince(d.debt_date)} يوم</span></td>
          <td><button class="ibg" onclick="Debts.openPayModal('${d.id}','${Utils.escape(d.customers?.name)}',${d.amount - d.paid})">تسديد</button></td>
          <td><button class="ibr" onclick="Debts.delete('${d.id}')">حذف</button></td>
        </tr>`).join('')
      : '<tr class="er"><td colspan="7">لا توجد ديون</td></tr>'
    );
  },

  async loadBadge() {
    const { data } = await DB.debts().select('amount,paid,debt_date');
    const late = (data || []).filter(d => d.amount - d.paid > 0 && Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays).length;
    const badge = DOM.get('dbadge');
    const dot   = DOM.get('bn-dot');
    if (late > 0) { if (badge) { badge.textContent = late; badge.classList.remove('hidden'); } if (dot) dot.classList.remove('hidden'); }
    else          { badge?.classList.add('hidden'); dot?.classList.add('hidden'); }
  },

  async save() {
    const customerId = DOM.val('dc');
    const amount     = parseFloat(DOM.val('da'));
    const date       = DOM.val('dd');
    if (!customerId) { Notify.error('اختر الزبون'); return; }
    if (!amount || amount <= 0) { Notify.error('أدخل المبلغ'); return; }

    State.isMutating = true;
    try {
      const { error } = await DB.debts().insert({ store_id: State.user.id, customer_id: customerId, amount, debt_date: date, notes: DOM.val('dn') });
      if (error) throw error;
      Notify.success('تم حفظ الدين');
      Modal.close('m-debt');
      DOM.clearInputs('da', 'dn');
      DOM.get('dc').value = '';
      await Promise.all([Debts.load(), Debts.loadBadge(), Dashboard.load()]);
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async delete(id) {
    if (!confirm('حذف؟')) return;
    State.isMutating = true;
    try {
      await DB.debts().delete().eq('id', id);
      Notify.success('تم الحذف');
      await Promise.all([Debts.load(), Debts.loadBadge()]);
    } finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  openPayModal(id, name, remaining) {
    DOM.get('pid').value  = id;
    DOM.setText('pname',  name);
    DOM.setText('prem',   '₪' + parseFloat(remaining).toFixed(2));
    document.querySelector('input[name="pt"][value="full"]').checked = true;
    DOM.get('pawrap')?.classList.add('hidden');
    Modal.open('m-pay');
  },

  togglePartialAmount(radio) {
    DOM.get('pawrap')?.classList.toggle('hidden', radio.value === 'full');
  },

  async pay() {
    const id   = DOM.val('pid');
    const type = document.querySelector('input[name="pt"]:checked').value;
    const { data: debt } = await DB.debts().select('amount,paid').eq('id', id).single();
    const newPaid = type === 'full'
      ? debt.amount
      : Math.min(debt.paid + (parseFloat(DOM.val('pamt')) || 0), debt.amount);

    if (type !== 'full' && !(parseFloat(DOM.val('pamt')) > 0)) { Notify.error('أدخل المبلغ'); return; }

    State.isMutating = true;
    try {
      await DB.debts().update({ paid: newPaid }).eq('id', id);
      Notify.success('تم التسديد');
      Modal.close('m-pay');
      await Promise.all([Debts.load(), Debts.loadBadge(), Dashboard.load()]);
    } finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  /** Add a debt automatically from invoice (called by Invoices module) */
  async addFromInvoice(customerId, amount, date, invoiceNumber) {
    if (!customerId || amount <= 0) return;
    await DB.debts().insert({ store_id: State.user.id, customer_id: customerId, amount, paid: 0, debt_date: date, notes: 'فاتورة ' + invoiceNumber });
    await Debts.loadBadge();
  },
};

export { Debts };
