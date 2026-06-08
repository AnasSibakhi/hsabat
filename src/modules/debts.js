/**
 * debts.js — Debts Module
 */

import { DB }     from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM   from '../core/dom.js';
import * as Utils from '../core/utils.js';
import { escape, currency, sumBy, daysSince, today, monthStart } from '../core/utils.js';
import { CONFIG } from '../config/constants.js';
import * as Modal from '../nav/modal.js';
import { getDashboard } from '../core/registry.js';

// ── State ──
let _allDebts    = [];
let _sortMode    = 'date';   // 'date' | 'amount' | 'overdue'
let _showArchive = false;

const Debts = {

  async load() {
    const { data } = await DB.debts().select('*,customers(name)').order('debt_date', { ascending: false });
    _allDebts = data || [];
    Debts._renderStats();
    Debts._renderList();
    Debts._renderAging();
  },

  _renderStats() {
    const active   = _allDebts.filter(d => d.amount - d.paid > 0 && !d.archived);
    const total    = active.reduce((s, d) => s + (d.amount - d.paid), 0);
    const overdue  = active.filter(d => Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays).length;
    const paidTotal = _allDebts.filter(d => d.debt_date >= Utils.monthStart()).reduce((s, d) => s + d.paid, 0);

    DOM.setText('dt1', Utils.currency(total));
    DOM.setText('dt2', overdue);
    DOM.setText('dt3', Utils.currency(paidTotal));

    // Alerts
    DOM.setHTML('dalerts', active
      .filter(d => Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays)
      .map(d => '<div class="alert ad"><i class="ti ti-bell"></i><span><strong>'
        + Utils.escape(d.customers?.name) + '</strong> — متأخر '
        + Utils.daysSince(d.debt_date) + ' يوم — ₪'
        + (d.amount - d.paid).toFixed(2) + '</span></div>')
      .join('')
    );
  },

  _renderList() {
    let list = _showArchive
      ? _allDebts.filter(d => d.archived)
      : _allDebts.filter(d => d.amount - d.paid > 0 && !d.archived);

    // Sort
    if (_sortMode === 'amount') {
      list = list.sort((a, b) => (b.amount - b.paid) - (a.amount - a.paid));
    } else if (_sortMode === 'overdue') {
      list = list.sort((a, b) => Utils.daysSince(b.debt_date) - Utils.daysSince(a.debt_date));
    } else {
      list = list.sort((a, b) => new Date(b.debt_date) - new Date(a.debt_date));
    }

    if (!list.length) {
      DOM.setHTML('dlist', '<tr class="er"><td colspan="7">'
        + (_showArchive ? 'لا توجد ديون مؤرشفة' : 'لا توجد ديون نشطة') + '</td></tr>');
      return;
    }

    DOM.setHTML('dlist', list.map(d => {
      const remaining = d.amount - d.paid;
      const days      = Utils.daysSince(d.debt_date);
      const isLate    = days >= CONFIG.debtLateDays;
      const id        = d.id;
      const name      = Utils.escape(d.customers?.name || '-');

      return '<tr>'
        + '<td>' + name + '</td>'
        + '<td>₪' + d.amount.toFixed(2) + '</td>'
        + '<td><strong>₪' + remaining.toFixed(2) + '</strong></td>'
        + '<td>' + d.debt_date + '</td>'
        + '<td><span class="' + (isLate ? 'br' : 'bb') + '">' + days + ' يوم</span></td>'
        + '<td>'
        + (!d.archived
          ? '<button class="ibg" onclick="Debts.openPayModal(\'' + id + '\',\'' + name + '\',' + remaining + ')">تسديد</button> '
            + '<button class="iba" onclick="Debts.archive(\'' + id + '\')" style="background:var(--wl);color:var(--w);border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:Cairo,sans-serif;font-weight:600;">أرشفة</button>'
          : '<button class="ibb" onclick="Debts.unarchive(\'' + id + '\')">إلغاء أرشفة</button>')
        + '</td>'
        + '<td><button class="ibr" onclick="Debts.delete(\'' + id + '\')">حذف</button></td>'
        + '</tr>';
    }).join(''));
  },

  _renderAging() {
    const active = _allDebts.filter(d => d.amount - d.paid > 0 && !d.archived);

    const buckets = {
      week1:  active.filter(d => { const x = Utils.daysSince(d.debt_date); return x >= 7  && x < 14; }),
      week2:  active.filter(d => { const x = Utils.daysSince(d.debt_date); return x >= 14 && x < 30; }),
      month1: active.filter(d => { const x = Utils.daysSince(d.debt_date); return x >= 30 && x < 60; }),
      more:   active.filter(d => Utils.daysSince(d.debt_date) >= 60),
    };

    const labels = { week1: 'أسبوع', week2: 'أسبوعان', month1: 'شهر', more: '+شهرين' };
    const colors = { week1: 'ba', week2: 'br', month1: 'br', more: 'br' };

    let html = '';
    Object.entries(buckets).forEach(([key, list]) => {
      if (!list.length) return;
      const totalAmt = list.reduce((s, d) => s + (d.amount - d.paid), 0);
      html += '<div class="aging-bucket">'
        + '<div class="aging-label"><span class="' + colors[key] + '">' + labels[key] + '</span>'
        + '<span style="font-size:12px;color:var(--g5);margin-right:6px;">' + list.length + ' زبون — ₪' + totalAmt.toFixed(2) + '</span></div>'
        + '<div class="aging-names">' + list.map(d => Utils.escape(d.customers?.name || '-')).join('، ') + '</div>'
        + '</div>';
    });

    const agingEl = DOM.get('d-aging');
    if (agingEl) agingEl.innerHTML = html || '<p style="color:var(--g4);font-size:13px;">لا يوجد متأخرون</p>';
  },

  setSort(mode) {
    _sortMode = mode;
    document.querySelectorAll('.d-sort-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('dsort-' + mode);
    if (btn) btn.classList.add('active');
    Debts._renderList();
  },

  toggleArchive() {
    _showArchive = !_showArchive;
    const btn = DOM.get('d-archive-btn');
    if (btn) btn.textContent = _showArchive ? '📋 النشطة' : '🗄 الأرشيف';
    Debts._renderList();
  },

  async archive(id) {
    await DB.debts().update({ archived: true }).eq('id', id);
    _allDebts = _allDebts.map(d => d.id === id ? { ...d, archived: true } : d);
    Debts._renderList();
    Debts._renderStats();
    Notify.show('تم الأرشفة');
  },

  async unarchive(id) {
    await DB.debts().update({ archived: false }).eq('id', id);
    _allDebts = _allDebts.map(d => d.id === id ? { ...d, archived: false } : d);
    Debts._renderList();
    Notify.show('تم إلغاء الأرشفة');
  },

  printDebts() {
    const active = _allDebts.filter(d => d.amount - d.paid > 0 && !d.archived)
      .sort((a, b) => Utils.daysSince(b.debt_date) - Utils.daysSince(a.debt_date));

    const total = active.reduce((s, d) => s + (d.amount - d.paid), 0);
    const storeName = State.user?.store_name || 'حسابات';
    const dateStr   = new Date().toLocaleDateString('ar-EG');

    const rows = active.map(d => '<tr>'
      + '<td>' + Utils.escape(d.customers?.name || '-') + '</td>'
      + '<td>₪' + (d.amount - d.paid).toFixed(2) + '</td>'
      + '<td>' + d.debt_date + '</td>'
      + '<td>' + Utils.daysSince(d.debt_date) + ' يوم</td>'
      + '<td>' + (d.notes || '-') + '</td>'
      + '</tr>').join('');

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head>
      <meta charset="UTF-8">
      <title>كشف الديون — ${storeName}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;direction:rtl;color:#111;}
        h2{font-size:20px;margin-bottom:4px;}
        p{font-size:13px;color:#666;margin-bottom:16px;}
        table{width:100%;border-collapse:collapse;font-size:13px;}
        th{background:#f3f4f6;padding:10px 12px;font-weight:700;border-bottom:2px solid #e5e7eb;text-align:right;}
        td{padding:10px 12px;border-bottom:1px solid #f3f4f6;}
        tr:last-child td{border-bottom:none;}
        .total{font-weight:700;font-size:15px;text-align:left;margin-top:12px;color:#1a56db;}
        @media print{button{display:none;}}
      </style></head><body>
      <h2>كشف الديون — ${Utils.escape(storeName)}</h2>
      <p>تاريخ الطباعة: ${dateStr} — إجمالي المدينين: ${active.length}</p>
      <table><thead><tr><th>الزبون</th><th>المبلغ</th><th>تاريخ الدين</th><th>التأخر</th><th>ملاحظات</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="total">الإجمالي: ₪${total.toFixed(2)}</p>
      <script>window.print();</script>
    </body></html>`);
    w.document.close();
  },

  async loadBadge() {
    const { data } = await DB.debts().select('amount,paid,debt_date,archived');
    const late = (data || []).filter(d => !d.archived && d.amount - d.paid > 0 && Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays).length;
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
      await Promise.all([Debts.load(), Debts.loadBadge(), getDashboard().load()]);
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async delete(id) {
    if (!confirm('حذف؟')) return;
    State.isMutating = true;
    try {
      await DB.debts().delete().eq('id', id);
      Notify.success('تم الحذف');
      _allDebts = _allDebts.filter(d => d.id !== id);
      Debts._renderList();
      Debts._renderStats();
      await Debts.loadBadge();
    } finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  openPayModal(id, name, remaining) {
    DOM.get('pid').value = id;
    DOM.setText('pname', name);
    DOM.setText('prem', '₪' + parseFloat(remaining).toFixed(2));
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
      await Promise.all([Debts.load(), Debts.loadBadge(), getDashboard().load()]);
    } finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async addFromInvoice(customerId, amount, date, invoiceNumber) {
    if (!customerId || amount <= 0) return;
    await DB.debts().insert({ store_id: State.user.id, customer_id: customerId, amount, paid: 0, debt_date: date, notes: 'فاتورة ' + invoiceNumber });
    await Debts.loadBadge();
  },
};

export { Debts };
