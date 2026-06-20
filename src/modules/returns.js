/**
 * returns.js — Returns Module
 */

import { DB, sb } from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM   from '../core/dom.js';
import * as Utils from '../core/utils.js';
import { escape } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal from '../nav/modal.js';
import { getDashboard, getDebts, getInvoices, getInventory } from '../core/registry.js';
import { FIFOService } from '../services/FIFOService.js';

// ── حماية من الضغط المتكرر ──
let _saving = false;

const Returns = {

  async load() {
    try {
      const { data } = await DB.returns()
        .select('*')
        .order('created_at', { ascending: false });

      DOM.setHTML('ret-list', (data || []).length
        ? data.map(r => `<tr>
            <td>${r.return_date}</td>
            <td>${r.invoice_id?.slice(-8) || '-'}</td>
            <td>${escape(r.buyer_name || '-')}</td>
            <td>₪${r.amount.toFixed(2)}</td>
            <td>${{
              cash:     '<span class="bg">نقدي</span>',
              debt:     '<span class="ba">شطب دين</span>',
              transfer: '<span class="bb">تحويل</span>'
            }[r.return_type] || r.return_type}</td>
            <td>${escape(r.notes || '-')}</td>
          </tr>`).join('')
        : '<tr class="er"><td colspan="6">لا توجد إرجاعات</td></tr>'
      );
    } catch {
      DOM.showEmpty?.('ret-list', 6, 'جدول الإرجاعات غير موجود');
    }
  },

  // ── نسخة آمنة من openModal — تقرأ البيانات من data-* attributes بدل تضمينها بالـ onclick نصّاً ──
  // (يمنع كسر الزر بصمت لو اسم الزبون يحتوي على علامة اقتباس فردية أو رموز خاصة)
  openModalFromBtn(btn) {
    const invId    = btn.dataset.invId;
    const buyer    = btn.dataset.buyer;
    const total     = parseFloat(btn.dataset.total) || 0;
    Returns.openModal(invId, buyer, total);
  },

  openModal(invId, custName, total) {
    // ✅ حماية — لو في حفظ جاري ما تفتح
    if (_saving) return;

    DOM.get('ret-inv-id').value  = invId;
    DOM.get('ret-buyer-name').value = custName || '';
    DOM.setText('ret-inv-info', `الزبون: ${custName || 'عادي'} — المجموع: ₪${total}`);
    DOM.get('ret-amount').value  = total;
    Modal.open('m-return');
  },

  async save() {
    // ✅ منع الضغط المتكرر
    if (_saving) return;
    _saving = true;

    const saveBtn = document.querySelector('#m-return .btn-s');
    if (saveBtn) {
      saveBtn.disabled    = true;
      saveBtn.textContent = 'جاري الحفظ...';
    }

    try {
      const invId      = DOM.val('ret-inv-id');
      const buyerName  = DOM.val('ret-buyer-name') || '';
      const retType    = document.querySelector('input[name="rtype"]:checked')?.value;
      const retAmount  = parseFloat(DOM.val('ret-amount')) || 0;

      if (!retAmount) { Notify.error('أدخل المبلغ'); return; }
      if (!retType)   { Notify.error('اختر نوع الإرجاع'); return; }

      // تحقق إن الفاتورة ما رُجعت قبل
      const { data: existing } = await DB.returns()
        .select('id')
        .eq('invoice_id', invId);

      if (existing?.length) {
        Notify.error('هذه الفاتورة رُجعت مسبقاً');
        return;
      }

      const { data: invoice } = await DB.invoices()
        .select('*,invoice_items(*)')
        .eq('id', invId)
        .single();

      if (!invoice) { Notify.error('الفاتورة غير موجودة'); return; }

      // إرجاع المخزون
      for (const item of invoice.invoice_items || []) {
        if (!item.inventory_id) continue;
        const retQty = (retAmount / invoice.total) * item.quantity;
        const { data: inv } = await DB.inventory()
          .select('quantity')
          .eq('id', item.inventory_id)
          .single();
        if (inv) await DB.inventory()
          .update({ quantity: inv.quantity + retQty })
          .eq('id', item.inventory_id);
      }

      // FIFO reverse
      try {
        await FIFOService.reverseFIFO(invId);
      } catch (e) {
        console.warn('FIFO reverse:', e.message);
      }

      // شطب الدين لو نوع الإرجاع دين
      if (retType === RETURN_TYPE.DEBT && invoice.customer_id) {
        const { data: debts } = await DB.debts()
          .select('*')
          .eq('customer_id', invoice.customer_id);
        let remaining = retAmount;
        for (const d of debts || []) {
          if (remaining <= 0) break;
          const reduce = Math.min(remaining, d.amount - d.paid);
          await DB.debts().update({ paid: d.paid + reduce }).eq('id', d.id);
          remaining -= reduce;
        }
      }

      // حفظ الإرجاع مع اسم الزبون ✅
      await DB.returns().insert({
        store_id:    State.user.id,
        invoice_id:  invId,
        buyer_name:  buyerName,
        amount:      retAmount,
        return_type: retType,
        notes:       DOM.val('ret-notes') || '',
        return_date: Utils.today(),
      });

      Notify.success('تم تسجيل الإرجاع');
      Modal.close('m-return');

      await Promise.all([
        getInvoices()?.load(),
        getInventory()?.load(),
        getDebts()?.load(),
        getDashboard()?.load(),
      ]);

    } catch (e) {
      Notify.error('فشل الإرجاع: ' + e.message);
    } finally {
      // ✅ أعد تفعيل الزر دائماً
      _saving = false;
      if (saveBtn) {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'تأكيد الإرجاع';
      }
    }
  },
};

export { Returns };
