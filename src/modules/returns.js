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

      const returnsList = data || [];

      // جلب أرقام الفواتير الحقيقية المرتبطة (بدل عرض UUID خام)
      const invIds = [...new Set(returnsList.map(r => r.invoice_id).filter(Boolean))];
      let invoiceNumMap = {};
      if (invIds.length) {
        const { data: invs } = await DB.invoices().select('id,invoice_number').in('id', invIds);
        invoiceNumMap = Object.fromEntries((invs || []).map(i => [i.id, i.invoice_number]));
      }

      const typeLabel = {
        cash:     { text: 'نقدي',     cls: 'ret-badge-cash' },
        debt:     { text: 'شطب دين',  cls: 'ret-badge-debt' },
        transfer: { text: 'تحويل',    cls: 'ret-badge-transfer' },
      };

      DOM.setHTML('ret-list', returnsList.length
        ? returnsList.map(r => {
            const t = typeLabel[r.return_type] || { text: r.return_type, cls: '' };
            const invNum = invoiceNumMap[r.invoice_id] || ('#' + (r.invoice_id?.slice(-6) || '-'));
            // اسم الزبون يُستخرج من بداية notes (نُخزّنه بصيغة "الزبون: الاسم — ملاحظات")
            const buyerMatch = (r.notes || '').match(/^الزبون:\s*([^—]+?)(?:\s*—\s*(.*))?$/);
            const buyerName  = buyerMatch ? buyerMatch[1].trim() : null;
            const extraNotes = buyerMatch ? (buyerMatch[2] || '').trim() : (r.notes || '');

            return `<div class="ret-card">
              <div class="ret-card-top">
                <span class="ret-card-inv"><i class="ti ti-receipt"></i> ${escape(invNum)}</span>
                <span class="ret-badge ${t.cls}">${t.text}</span>
              </div>
              ${buyerName ? `<div class="ret-card-buyer"><i class="ti ti-user"></i> ${escape(buyerName)}</div>` : ''}
              <div class="ret-card-bottom">
                <span class="ret-card-date">${r.return_date}</span>
                <strong class="ret-card-amount">₪${r.amount.toFixed(2)}</strong>
              </div>
              ${extraNotes ? `<div class="ret-card-notes">${escape(extraNotes)}</div>` : ''}
            </div>`;
          }).join('')
        : '<div class="er ret-empty-state">لا توجد إرجاعات</div>'
      );
    } catch (e) {
      console.error('[Returns.load]', e);
      DOM.showEmpty?.('ret-list', 6, 'جدول الإرجاعات غير موجود');
    }
  },

  // ── نسخة آمنة من openModal — تقرأ البيانات من data-* attributes بدل تضمينها بالـ onclick نصّاً ──
  // (يمنع كسر الزر بصمت لو اسم الزبون يحتوي على علامة اقتباس فردية أو رموز خاصة)
  openModalFromBtn(btn) {
    const invId = btn.dataset.invId;
    const buyer = btn.dataset.buyer;
    const total = parseFloat(btn.dataset.total) || 0;
    // تأخير بسيط جداً — يسمح برؤية تأثير اللون عند اللمس قبل أن يغطي الموديل الشاشة
    setTimeout(() => Returns.openModal(invId, buyer, total), 150);
  },

  openModal(invId, custName, total) {
    // ✅ حماية — لو في حفظ جاري ما تفتح
    if (_saving) return;

    DOM.get('ret-inv-id').value  = invId;
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

      // ── استدعاء واحد فقط ينفّذ كل العملية (تحقق + إرجاع مخزون + FIFO + شطب دين + تسجيل) على السيرفر دفعة وحدة ──
      const { data: { session } } = await sb.auth.getSession();
            const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/process-return`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          invId, buyerName, retType, retAmount,
          notes: DOM.val('ret-notes') || '',
        }),
      });
            clearTimeout(timeoutId);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تسجيل الإرجاع');

      Notify.success('تم تسجيل الإرجاع');
      Modal.close('m-return');

      // تحديث البيانات بالخلفية — بدون تأخير ظهور رسالة النجاح للمستخدمة
      getInvoices()?.load();
      getInventory()?.load();
      getDebts()?.load();
      getDashboard()?.load();

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
