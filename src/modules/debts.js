/**
 * debts.js — Debts Module
 */

import { DB, sb } from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM   from '../core/dom.js';
import * as Utils from '../core/utils.js';
import { escape, currency, sumBy, daysSince, today, monthStart } from '../core/utils.js';
import { CONFIG } from '../config/constants.js';
import * as Modal from '../nav/modal.js';
import { getDashboard } from '../core/registry.js';
import { Customers }    from './customers.js';

// ── State ──
let _allDebts    = [];
let _sortMode    = 'date';
let _showArchive = false;
let _remindDays  = 0;
let _newCustName = null;

const Debts = {

  async load() {
    const { data } = await DB.debts()
      .select('*,customers(name,phone)')
      .order('debt_date', { ascending: false })
      .limit(200); // أكثر من كافي لأي محل
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

  // ── تجميع الديون حسب اسم الزبون — نفس فكرة تجميع الموردين/الزبائن بالمشتريات والفواتير ──
  _groupByDebtCustomer(list) {
    const groups = {};
    list.forEach(d => {
      const name = (d.customers?.name || '').trim() || 'زبون عادي';
      const key  = name.toLowerCase();
      if (!groups[key]) {
        groups[key] = { name, phone: d.cust_phone || d.customers?.phone || '', debts: [] };
      }
      groups[key].debts.push(d);
      if (d.cust_phone || d.customers?.phone) groups[key].phone = d.cust_phone || d.customers?.phone;
    });
    return Object.values(groups).sort((a, b) =>
      new Date(b.debts[0]?.debt_date || 0) - new Date(a.debts[0]?.debt_date || 0)
    );
  },

  // كارد دين واحد داخل قائمة الزبون المفتوحة
  _renderDebtItem(d) {
    const remaining   = d.amount - d.paid;
    const invNum      = (d.notes || '').match(/INV-\d+/)?.[0] || (d.invoice_id || '');
    const days        = Utils.daysSince(d.debt_date);
    const isLate      = days >= CONFIG.debtLateDays;
    const id          = d.id;
    const name        = Utils.escape(d.customers?.name || '-');
    const remindReady = d.remind_date && (d.cust_phone || d.customers?.phone) && d.remind_date <= new Date().toISOString().split('T')[0];
    const desc = d.notes && !d.notes.startsWith('فاتورة') ? `<div class="pur-item-meta">${escape(d.notes)}</div>` : '';

    return `<div class="pur-item">
      <div class="pur-item-top">
        <span class="pur-product-name">₪${remaining.toFixed(2)} <span style="color:var(--g5);font-weight:400;">متبقٍ من ₪${d.amount.toFixed(2)}</span></span>
        <span class="pur-status ${isLate ? 'bg-d' : 'bg-w'}">${days} يوم</span>
      </div>
      ${desc}
      <div class="pur-item-meta">${d.debt_date}</div>
      <div class="pur-item-actions">
        ${!d.archived
          ? `<button class="ibg" onclick="Debts.openPayModal('${id}','${name}',${remaining})">تسديد</button>
             <button class="iba" style="background:var(--wl);color:var(--w);border:none;border-radius:6px;padding:5px;font-size:10px;cursor:pointer;font-family:Cairo,sans-serif;font-weight:600;" onclick="Debts.archive('${id}')">أرشفة</button>
             ${remindReady ? `<button class="ibw" onclick="Debts.sendWhatsapp('${id}')">📲</button>` : ''}`
          : `<button class="ibb" onclick="Debts.unarchive('${id}')">إلغاء أرشفة</button>`}
        <button class="ibb" onclick="Debts.openInvoiceDetails('${invNum || ''}','${id}')">📋</button>
        <button class="ibr" onclick="Debts.delete('${id}')">حذف</button>
      </div>
    </div>`;
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
      DOM.setHTML('dlist', '<div class="er debt-empty-state">'
        + (_showArchive ? 'لا توجد ديون مؤرشفة' : 'لا توجد ديون نشطة') + '</div>');
      return;
    }

    const groups = Debts._groupByDebtCustomer(list);

    DOM.setHTML('dlist', groups.map((g, idx) => {
      const totalRemaining = g.debts.reduce((s, d) => s + (d.amount - d.paid), 0);
      const hasLate = g.debts.some(d => Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays);
      const initials = g.name.trim().slice(0, 2);
      const debtsHtml = g.debts.map(d => Debts._renderDebtItem(d)).join('');

      return `<div class="sup-card${groups.length === 1 ? ' open' : ''}" id="debt-card-${idx}">
        <div class="sup-header" onclick="document.getElementById('debt-card-${idx}').classList.toggle('open')">
          <div class="sup-info">
            <div class="pur-avatar">${escape(initials)}</div>
            <div style="min-width:0;">
              <div class="sup-name">${escape(g.name)}</div>
              ${g.phone ? '<a href="tel:' + g.phone + '" class="pur-sphone" onclick="event.stopPropagation()">' + escape(g.phone) + '</a>' : ''}
            </div>
          </div>
          <div class="sup-summary">
            <span class="sup-count">${g.debts.length} ${g.debts.length === 1 ? 'دين' : 'ديون'}</span>
            <div class="pur-stat" style="background:none;padding:0;">
              <div class="pur-stat-label">إجمالي المتبقي</div>
              <div class="pur-stat-val" style="color:var(--d);">₪${totalRemaining.toFixed(2)}</div>
            </div>
            ${hasLate ? '<span class="sup-debt-dot" title="يوجد دين متأخر لهذا الزبون"></span>' : ''}
            <span class="sup-chevron">‹</span>
          </div>
        </div>
        <div class="sup-items">${debtsHtml}</div>
      </div>`;
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

    let html = '';
    Object.entries(buckets).forEach(([key, list]) => {
      if (!list.length) return;
      const totalAmt = list.reduce((s, d) => s + (d.amount - d.paid), 0);
      const colorMap = { week1: 'amber', week2: 'red', month1: 'red', more: 'red' };
      html += `<div class="aging-bucket-v2 ${colorMap[key]}">
        <div class="aging-bucket-v2-head">
          <span class="aging-bucket-v2-pill">${labels[key]}</span>
          <span class="aging-bucket-v2-meta">${list.length} زبون — ₪${totalAmt.toFixed(2)}</span>
        </div>
        <div class="aging-bucket-v2-names">${list.map(d => Utils.escape(d.customers?.name || '-')).join('، ')}</div>
      </div>`;
    });

    const agingEl = DOM.get('d-aging');
    if (agingEl) agingEl.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--g5);font-size:13px;">✅ لا يوجد متأخرون</div>';
  },

  // ── Customer Search ──
  showAllCustomers() {
    const dd  = document.getElementById('dc-dropdown');
    const inp = document.getElementById('dc-search');
    if (!dd || !inp) return;
    if (!State.customers?.length) {
      DB.customers().select('id,name,phone').eq('store_id', State.user.id).order('name')
        .then(({ data }) => { State.customers = data || []; Debts.showAllCustomers(); });
      return;
    }
    const r = inp.getBoundingClientRect();
    dd.style.top      = r.bottom + 'px';
    dd.style.left     = r.left + 'px';
    dd.style.right    = 'auto';
    dd.style.width    = r.width + 'px';
    dd.style.maxWidth = '340px';
    dd.innerHTML = (State.customers || []).slice(0, 8).map(c =>
      Utils.customerSuggestRow(c, `onclick="Debts.selectCustomerById(this.dataset.id)"`)
    ).join('') || `<div class="dc-opt" style="color:var(--g4);">لا يوجد زبائن</div>`;
    dd.style.display = 'block';
  },

  async openModal() {
    // تحميل الزبائن مسبقاً لضمان البحث الفوري
    if (!State.customers?.length) {
      const { data } = await DB.customers()
        .select('id,name,phone').eq('store_id', State.user.id).order('name');
      State.customers = data || [];
    }
    Modal.open('m-debt');
    setTimeout(() => DOM.get('dc-search')?.focus(), 150);
  },

  searchCustomer(val) {
    const dd = DOM.get('dc-dropdown');
    const newWrap = DOM.get('dc-new-wrap');
    DOM.get('dc').value = '';
    _newCustName = null;
    if (!val.trim()) { dd.style.display = 'none'; newWrap.style.display = 'none'; return; }

    // لو ما في زبائن محمّلين — اطلبهم وأعد البحث
    if (!State.customers?.length) {
      DB.customers().select('id,name,phone').eq('store_id', State.user.id).order('name')
        .then(({ data }) => {
          State.customers = data || [];
          Debts.searchCustomer(val);
        });
      return;
    }

    const q = val.trim().toLowerCase();
    const matches = (State.customers || []).filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));

    // لو مطابق تماماً — عبّي الحقل مباشرة
    const exact = matches.find(c => c.name.toLowerCase() === q);
    if (exact) {
      DOM.get('dc-search').value = exact.name;
      DOM.get('dc').value = exact.id;
      document.getElementById('dc-dropdown').style.display = 'none';
      document.getElementById('dc-new-wrap').style.display = 'none';
      return;
    }

    dd.innerHTML = [
      ...matches.map(c =>
        Utils.customerSuggestRow(c, `onclick="Debts.selectCustomerById(this.dataset.id)"`)
      ),
      `<div class="dc-opt new" onclick="Debts.selectNew('${Utils.escape(val.trim())}')">+ إضافة "${Utils.escape(val.trim())}" كزبون جديد</div>`
    ].join('');

    // تحديد موقع الـ dropdown بـ fixed بناءً على موقع الـ input
    const inp = document.getElementById('dc-search');
    if (inp) {
      const r = inp.getBoundingClientRect();
      dd.style.top      = r.bottom + 'px';
      dd.style.left     = r.left + 'px';
      dd.style.right    = 'auto';
      dd.style.width    = r.width + 'px';
      dd.style.maxWidth = '340px';
    }
    dd.style.display = 'block';
    newWrap.style.display = 'none';
  },

  _closeDropdown() {
    const dd = document.getElementById('dc-dropdown');
    if (dd) dd.style.display = 'none';
  },

  selectCustomerById(id) {
    const c = (State.customers || []).find(x => x.id === id);
    if (!c) return;
    Debts.selectCustomer(c.id, c.name);
  },

  selectCustomer(id, name) {
    DOM.get('dc').value = id;
    DOM.get('dc-search').value = name;
    DOM.get('dc-dropdown').style.display = 'none';
    DOM.get('dc-new-wrap').style.display = 'none';
    _newCustName = null;
  },

  selectNew(name) {
    DOM.get('dc').value = '';
    DOM.get('dc-search').value = name;
    DOM.get('dc-dropdown').style.display = 'none';
    DOM.get('dc-new-wrap').style.display = 'block';
    _newCustName = name;
  },

  setRemind(days) {
    _remindDays = days;
    document.querySelectorAll('.debt-remind-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.days) === days);
    });
  },

  sendWhatsapp(debtId) {
    const debt = _allDebts.find(d => d.id === debtId);
    if (!debt) return;
    const phone = debt.cust_phone || debt.customers?.phone || '';
    const name  = debt.customers?.name || '';
    const amt   = (debt.amount - debt.paid).toFixed(2);
    const date  = debt.debt_date;
    const store = State.user?.store_name || 'حسابات';
    const msg   = encodeURIComponent(`السلام عليكم ${name}،
نذكركم بدين بمبلغ ₪${amt} بتاريخ ${date}.
شكراً - ${store}`);
    const num   = phone.replace(/[^0-9]/g, '');
    if (!num) { Notify.error('لا يوجد رقم هاتف لهذا الزبون'); return; }
    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
  },

  async openInvoiceDetails(invoiceNumber, debtId) {
    let inv;

    if (invoiceNumber) {
      const { data } = await DB.invoices().select('*').eq('invoice_number', invoiceNumber).maybeSingle();
      inv = data;
    }

    // لو ما في رقم فاتورة — نبحث عن فاتورة مرتبطة بالدين
    if (!inv && debtId) {
      const { data: debt } = await DB.debts().select('notes, amount, debt_date, customer_id').eq('id', debtId).maybeSingle();
      if (debt?.notes) {
        const num = (debt.notes).match(/INV-\d+/)?.[0];
        if (num) {
          const { data } = await DB.invoices().select('*').eq('invoice_number', num).maybeSingle();
          inv = data;
        }
      }
    }

    if (!inv) {
      Notify.error('لا توجد فاتورة مرتبطة بهذا الدين');
      return;
    }
    const { data: items } = await DB.invoiceItems().select('*').eq('invoice_id', inv.id);

    const payLabel = { cash: 'نقدي', transfer: 'تحويل', defer: 'دين', partial: 'جزئي' }[inv.payment_type] || inv.payment_type;
    const itemsHtml = (items || []).map(it =>
      `<tr>
        <td>${escape(it.product_name || '-')}</td>
        <td style="text-align:center;">${it.quantity}</td>
        <td style="text-align:left;">₪${parseFloat(it.price).toFixed(2)}</td>
        <td style="text-align:left;font-weight:700;">₪${(it.quantity * it.price).toFixed(2)}</td>
      </tr>`
    ).join('') || '<tr><td colspan="4" style="color:var(--g4);text-align:center;padding:1rem;">لا توجد منتجات</td></tr>';

    DOM.setHTML('inv-details-body', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1rem;">
        <div class="inv-det-row"><span>رقم الفاتورة</span><strong>${escape(inv.invoice_number || '-')}</strong></div>
        <div class="inv-det-row"><span>التاريخ والوقت</span><strong>${inv.invoice_date} ${inv.sale_time || ''}</strong></div>
        <div class="inv-det-row"><span>اسم المشتري</span><strong>${escape(inv.buyer_name || inv.customer_name || '-')}</strong></div>
        <div class="inv-det-row"><span>رقم الجوال</span><strong>${escape(inv.buyer_phone || '-')}</strong></div>
        <div class="inv-det-row"><span>طريقة الدفع</span><strong>${payLabel}</strong></div>
        ${inv.transfer_entity_name ? `<div class="inv-det-row"><span>جهة التحويل</span><strong>${escape(inv.transfer_entity_name)}</strong></div>` : ''}
      </div>
      <table class="dt" style="margin-bottom:.75rem;">
        <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="background:var(--g0);border-radius:10px;padding:12px;font-size:13px;">
        ${inv.discount > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--d);"><span>خصم</span><span>-₪${inv.discount.toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:16px;">
          <span>الإجمالي النهائي</span><span>₪${inv.total.toFixed(2)}</span>
        </div>
      </div>
    `);
    Modal.open('m-inv-details');
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
        body{font-family:Arial,sans-serif;padding:20px;direction:rtl;color:var(--g9);}
        h2{font-size:20px;margin-bottom:4px;}
        p{font-size:13px;color:var(--g5);margin-bottom:16px;}
        table{width:100%;border-collapse:collapse;font-size:13px;}
        th{background:var(--g1);padding:10px 12px;font-weight:700;border-bottom:2px solid var(--g2);text-align:right;}
        td{padding:10px 12px;border-bottom:1px solid var(--g1);}
        tr:last-child td{border-bottom:none;}
        .total{font-weight:700;font-size:15px;text-align:left;margin-top:12px;color:var(--p);}
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
    let customerId = DOM.val('dc');
    const amount   = parseFloat(DOM.val('da'));
    const date     = DOM.val('dd');
    const phone    = DOM.val('dc-new-phone');

    // إذا زبون جديد — أضفه أولاً
    if (!customerId && _newCustName) {
      const newC = await Customers.createInline(_newCustName, phone);
      if (!newC?.id) { Notify.error('فشل إضافة الزبون'); return; }
      customerId = newC.id;
    }

    if (!customerId) { Notify.error('اختر الزبون أو أدخل اسماً جديداً'); return; }
    if (!amount || amount <= 0) { Notify.error('أدخل المبلغ'); return; }

    // حساب تاريخ التذكير
    const remindDate = _remindDays > 0
      ? new Date(Date.now() + _remindDays * 86400000).toISOString().split('T')[0]
      : null;

    State.isMutating = true;
    try {
      const cust = State.customers?.find(c => c.id === customerId);
      const { error } = await DB.debts().insert({
        store_id:    State.user.id,
        customer_id: customerId,
        amount,
        debt_date:   date || Utils.today(),
        notes:       DOM.val('dn') || '',
        remind_date: remindDate,
        cust_phone:  cust?.phone || phone || null,
      });
      if (error) throw error;
      Notify.success('تم حفظ الدين' + (remindDate ? ' — تذكير: ' + remindDate : ''));
      Modal.close('m-debt');
      DOM.clearInputs('da', 'dn', 'dc-search', 'dc-new-phone');
      DOM.get('dc').value = '';
      DOM.get('dc-new-wrap').style.display = 'none';
      _newCustName = null; _remindDays = 0;
      document.querySelectorAll('.debt-remind-btn').forEach((b,i) => b.classList.toggle('active', i===0));

      // تحديث البيانات بالخلفية — لا تؤخر إغلاق الموديل
      Debts.load();
      Debts.loadBadge();
      getDashboard().load();
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

  async quickPay(id, name, remaining) {
    // تأكيد سريع
    const ok = confirm(`تسديد كامل ₪${parseFloat(remaining).toFixed(2)} من ${name}؟`);
    if (!ok) return;

    try {
      const { data: debt } = await DB.debts().select('amount').eq('id', id).single();
      await DB.debts().update({ paid: debt.amount }).eq('id', id);
      Notify.success('✅ تم التسديد');

      // تحديث فوري للواجهة — بدون انتظار إعادة تحميل كامل من السيرفر
      const local = _allDebts.find(d => d.id === id);
      if (local) local.paid = debt.amount;
      Debts._renderList();
      Debts._renderStats();

      await Promise.all([Customers.loadUnified(), Debts.loadBadge()]);
    } catch { Notify.error('فشل التسديد'); }
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
    const { data: debt } = await DB.debts().select('amount,paid,customer_id').eq('id', id).single();
    const newPaid = type === 'full'
      ? debt.amount
      : Math.min(debt.paid + (parseFloat(DOM.val('pamt')) || 0), debt.amount);

    if (type !== 'full' && !(parseFloat(DOM.val('pamt')) > 0)) { Notify.error('أدخل المبلغ'); return; }

    State.isMutating = true;
    try {
      await DB.debts().update({ paid: newPaid }).eq('id', id);
      Notify.success('تم التسديد ✅');
      Modal.close('m-pay');
      await Debts.loadBadge();

      // تحديث لايف — بدون إعادة تحميل كاملة
      const newRem = debt.amount - newPaid;

      if (State.currentPage === 'customers') {
        // حدّث بطاقة الزبون مباشرة
        const debtRow = document.querySelector(`[data-debt-id="${id}"]`);
        if (debtRow) {
          if (newRem <= 0) {
            // الدين سُدّد كاملاً — أزل الصف
            debtRow.style.transition = 'opacity .3s';
            debtRow.style.opacity = '0';
            setTimeout(() => {
              debtRow.remove();
              // لو ما في ديون للزبون — حدّث البطاقة
              Customers._updateCustomerCard(debt.customer_id);
            }, 300);
          } else {
            // دفع جزئي — حدّث المبلغ
            const remEl = debtRow.querySelector('[data-rem]');
            if (remEl) remEl.textContent = '₪' + newRem.toFixed(2);
            const btnEl = debtRow.querySelector('.ibg');
            if (btnEl) btnEl.setAttribute('onclick', `Debts.openPayModal('${id}','${DOM.val("pname")}',${newRem})`);
          }
        }
        // حدّث الإجماليات
        const { Customers } = await import('./customers.js');
        Customers._refreshStats();
      } else {
        await Debts.load();
      }
    } finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async addFromInvoice(customerId, amount, date, invoiceNumber) {
    if (!customerId || amount <= 0) return;
    await DB.debts().insert({ store_id: State.user.id, customer_id: customerId, amount, paid: 0, debt_date: date, notes: 'فاتورة ' + invoiceNumber });
    await Debts.loadBadge();
  },
};

export { Debts };
