/**
 * expenses.js — Expenses Module
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
// 22. EXPENSES MODULE
// ─────────────────────────────────────────
const Expenses = {
  async load() {
    const { data } = await DB.expenses().select('*').order('exp_date', { ascending: false });
    const list     = data || [];
    const today    = Utils.today();
    const weekAgo  = Utils.daysAgo(7);
    const monthStart = Utils.monthStart();

    DOM.setText('exp-day',   Utils.currency(list.filter(e => e.exp_date === today).reduce((s, e) => s + e.amount, 0)));
    DOM.setText('exp-week',  Utils.currency(list.filter(e => e.exp_date >= weekAgo).reduce((s, e) => s + e.amount, 0)));
    DOM.setText('exp-month', Utils.currency(list.filter(e => e.exp_date >= monthStart).reduce((s, e) => s + e.amount, 0)));

    DOM.setHTML('exp-list', list.length
      ? list.map(e => `<tr>
          <td><span class="bb">${Utils.escape(e.exp_type)}</span></td>
          <td>₪${e.amount.toFixed(2)}</td>
          <td>${e.exp_date}</td>
          <td>${Utils.escape(e.notes || '-')}</td>
          <td><button class="ibr" onclick="Expenses.delete('${e.id}')">حذف</button></td>
        </tr>`).join('')
      : '<tr class="er"><td colspan="5">لا توجد مصاريف</td></tr>'
    );
  },

  async save() {
    const amount = parseFloat(DOM.val('exp-amount'));
    if (!amount || amount <= 0) { Notify.error('أدخل المبلغ'); return; }
    State.isMutating = true;
    try {
      const { error } = await DB.expenses().insert({ store_id: State.user.id, exp_type: DOM.get('exp-type').value, amount, exp_date: DOM.val('exp-date'), notes: DOM.val('exp-notes') });
      if (error) throw error;
      Notify.success('تم تسجيل المصروف');
      Modal.close('m-expense');
      DOM.clearInputs('exp-amount', 'exp-notes');
      await Expenses.load();
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async delete(id) {
    if (!confirm('حذف هذا المصروف؟')) return;
    State.isMutating = true;
    try { await DB.expenses().delete().eq('id', id); Notify.success('تم الحذف'); await Expenses.load(); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },
};

export { Expenses };
