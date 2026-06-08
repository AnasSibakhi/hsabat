/**
 * returns.js — Returns Module
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



// ─────────────────────────────────────────
// 21. RETURNS MODULE
// ─────────────────────────────────────────
const Returns = {
  async load() {
    try {
      const { data } = await DB.returns().select('*').order('created_at', { ascending: false });
      DOM.setHTML('ret-list', (data || []).length
        ? data.map(r => `<tr>
            <td>${r.return_date}</td><td>${r.invoice_id?.slice(-8) || '-'}</td>
            <td>₪${r.amount.toFixed(2)}</td>
            <td>${{ cash: '<span class="bg">نقدي</span>', debt: '<span class="ba">شطب دين</span>', transfer: '<span class="bb">تحويل</span>' }[r.return_type] || r.return_type}</td>
            <td>${Utils.escape(r.notes || '-')}</td>
          </tr>`).join('')
        : '<tr class="er"><td colspan="5">لا توجد إرجاعات</td></tr>'
      );
    } catch { DOM.showEmpty('ret-list', 5, 'جدول الإرجاعات غير موجود — شغّل SQL التحديث'); }
  },

  openModal(invId, custName, total) {
    DOM.get('ret-inv-id').value = invId;
    DOM.setText('ret-inv-info', `الزبون: ${custName || 'عادي'} — المجموع: ₪${total}`);
    DOM.get('ret-amount').value = total;
    Modal.open('m-return');
  },

  async save() {
    const invId     = DOM.val('ret-inv-id');
    const retType   = document.querySelector('input[name="rtype"]:checked').value;
    const retAmount = parseFloat(DOM.val('ret-amount')) || 0;
    if (!retAmount) { Notify.error('أدخل المبلغ'); return; }

    const { data: invoice } = await DB.invoices().select('*,invoice_items(*)').eq('id', invId).single();
    if (!invoice) { Notify.error('الفاتورة غير موجودة'); return; }

    // Return items to inventory proportionally
    for (const item of invoice.invoice_items || []) {
      if (!item.inventory_id) continue;
      const retQty = (retAmount / invoice.total) * item.quantity;
      const { data: inv } = await DB.inventory().select('quantity').eq('id', item.inventory_id).single();
      if (inv) await DB.inventory().update({ quantity: inv.quantity + retQty }).eq('id', item.inventory_id);
    }

    // Reduce debt if debt-type return
    if (retType === RETURN_TYPE.DEBT && invoice.customer_id) {
      const { data: debts } = await DB.debts().select('*').eq('customer_id', invoice.customer_id);
      let remaining = retAmount;
      for (const d of debts || []) {
        if (remaining <= 0) break;
        const reduce = Math.min(remaining, d.amount - d.paid);
        await DB.debts().update({ paid: d.paid + reduce }).eq('id', d.id);
        remaining -= reduce;
      }
    }

    try {
      await DB.returns().insert({ store_id: State.user.id, invoice_id: invId, amount: retAmount, return_type: retType, notes: DOM.val('ret-notes'), return_date: Utils.today() });
    } catch { /* returns table might not exist */ }

    Notify.success('تم تسجيل الإرجاع');
    Modal.close('m-return');
    await Promise.all([window.Invoices.load(), window.Inventory.load(), window.Debts.load(), window.Dashboard.load()]);
  },
};

export { Returns };
