/**
 * purchases.js — Purchases Module
 * Extracted from monolithic app.js into clean module
 */

import { DB, sb } from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM     from '../core/dom.js';
import * as Utils from '../core/utils.js';
import { escape, currency, sumBy, daysSince, today, monthStart, daysAgo, periodStart, invoiceNumber, currentTime, formatDate } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal   from '../nav/modal.js';
import { getDashboard, getInventory } from '../core/registry.js';
import { FIFOService } from '../services/FIFOService.js';




// ─────────────────────────────────────────
// 19. PURCHASES MODULE
// ─────────────────────────────────────────
const Purchases = {
  async load() {
    const { data } = await DB.purchases().select('*').order('purchase_date', { ascending: false });
    Purchases._cache = {};
    Purchases._allData = data || [];
    (data || []).forEach(p => { Purchases._cache[p.id] = p; });

    // تأكد من تحميل المخزون لاستخدامه بعرض الوحدة الصحيحة لكل عملية شراء
    if (!State.inventory?.length) {
      const { data: invData } = await DB.inventory().select('*');
      State.inventory = invData || [];
    }

    const srch = document.getElementById('pur-search');
    if (srch) srch.value = '';
    Purchases._renderRows(Purchases._allData);
  },

  filterList(query) {
    if (!Purchases._allData) return;
    const q = (query || '').toLowerCase().trim();
    const rows = q
      ? Purchases._allData.filter(p =>
          (p.supplier     || '').toLowerCase().includes(q) ||
          (p.product_name || '').toLowerCase().includes(q) ||
          (p.invoice_ref  || '').toLowerCase().includes(q)
        )
      : Purchases._allData;
    Purchases._renderRows(rows);
  },

  // يجمّع المشتريات حسب المورد لمنع تكرار اسمه
  _groupBySupplier(data) {
    const groups = {};
    data.forEach(p => {
      const key = p.supplier || 'غير محدد';
      if (!groups[key]) {
        groups[key] = { supplier: p.supplier, supplier_phone: p.supplier_phone, items: [] };
      }
      groups[key].items.push(p);
      // أحدث رقم جوال متوفر بأي عملية شراء من هذا المورد
      if (p.supplier_phone) groups[key].supplier_phone = p.supplier_phone;
    });
    return Object.values(groups);
  },

  _renderRows(data) {
    const groups = Purchases._groupBySupplier(data || []);
    DOM.setHTML('purlist', groups.length
      ? groups.map((g, idx) => {
          const totalCost  = g.items.reduce((s, p) => s + (p.cost || 0), 0);
          const hasDebt     = g.items.some(p => p.remaining > 0);
          const initials    = (g.supplier || '؟').trim().slice(0, 2);
          const itemsHtml   = g.items.map(p => Purchases._renderItem(p)).join('');
          return `<div class="sup-card${idx === 0 ? ' open' : ''}" id="sup-card-${idx}">
            <div class="sup-header" onclick="document.getElementById('sup-card-${idx}').classList.toggle('open')">
              <div class="sup-info">
                <div class="pur-avatar">${Utils.escape(initials)}</div>
                <div style="min-width:0;">
                  <div class="sup-name">${Utils.escape(g.supplier)}</div>
                  ${g.supplier_phone ? '<a href="tel:' + g.supplier_phone + '" class="pur-sphone" onclick="event.stopPropagation()">' + Utils.escape(g.supplier_phone) + '</a>' : ''}
                </div>
              </div>
              <div class="sup-summary">
                <span class="sup-count">${g.items.length} ${g.items.length === 1 ? 'مشترى' : 'مشتريات'}</span>
                <div class="pur-stat" style="background:none;padding:0;">
                  <div class="pur-stat-label">إجمالي ما اشتريتيه منه</div>
                  <div class="pur-stat-val" style="color:var(--p);">₪${totalCost.toFixed(2)}</div>
                </div>
                ${hasDebt ? '<span class="sup-debt-dot" title="يوجد مبلغ متبقٍ غير مدفوع لهذا المورد"></span>' : ''}
                <span class="sup-chevron">‹</span>
              </div>
            </div>
            <div class="sup-items">${itemsHtml}</div>
          </div>`;
        }).join('')
      : '<div class="er" style="padding:30px;text-align:center;color:var(--g5);">لا توجد مشتريات</div>'
    );
  },

  // كارد منتج واحد داخل قائمة المورد المفتوحة
  _renderItem(p) {
    const STATUS = { cash:{l:'كاش ✓',c:'sl',t:'s'}, transfer:{l:'تحويل',c:'pl',t:'p'}, defer:{l:'آجل',c:'wl',t:'w'} };
    const st = STATUS[p.payment_status] || STATUS.cash;
    const showPaidRow = p.payment_status === 'defer';
    const cost      = p.cost || 0;
    const showUnit  = p.quantity > 1;
    const unitCost  = showUnit ? (cost / p.quantity) : 0;

    // جلب الوحدة وسعر البيع الاحتياطي من المخزون بمطابقة الاسم (للسجلات القديمة الناقصة)
    const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const matched = (State.inventory || []).find(i => normalize(i.name) === normalize(p.product_name));
    const unitLabel = matched?.unit || 'وحدة';

    // p.sale_price هو الإجمالي للكمية كاملة. سعر المخزون (matched.sale_price) هو سعر الوحدة الواحدة فقط
    // لذلك عند استخدامه كاحتياطي يجب ضربه بالكمية أولاً لمطابقة نفس المعنى (إجمالي)
    const effectiveSale = p.sale_price || (matched?.sale_price ? matched.sale_price * p.quantity : null);
    const unitSaleVal    = (showUnit && effectiveSale) ? (effectiveSale / p.quantity) : 0;

    return `<div class="pur-item page-purchase">
      <div class="page-accent-stripe purchase"></div>
      <div class="pur-item-top">
        <span class="pur-product-name"><i class="ti ti-shopping-cart" style="color:var(--w);font-size:13px;margin-left:3px;"></i>${Utils.escape(p.product_name)}</span>
        <span class="pur-status" style="background:var(--${st.c});color:var(--${st.t});">${st.l}</span>
      </div>
      <div class="pur-item-meta">${p.purchase_date}${p.invoice_ref ? ' · فاتورة #' + Utils.escape(p.invoice_ref) : ''} · الكمية المشتراة ${p.quantity} ${Utils.escape(unitLabel)}</div>
      <div class="pur-grid2">
        <div class="pur-stat">
          <div class="pur-stat-label">التكلفة الكلية</div>
          <div class="pur-stat-val">₪${cost.toFixed(2)}</div>
          ${showUnit ? '<div class="pur-stat-sub">₪' + unitCost.toFixed(2) + ' لكل ' + Utils.escape(unitLabel) + '</div>' : ''}
        </div>
        <div class="pur-stat">
          <div class="pur-stat-label">سعر البيع الكلي</div>
          <div class="pur-stat-val" style="color:var(--p);">${effectiveSale ? '₪' + effectiveSale.toFixed(2) : '-'}</div>
          ${showUnit && effectiveSale ? '<div class="pur-stat-sub">₪' + unitSaleVal.toFixed(2) + ' لكل ' + Utils.escape(unitLabel) + '</div>' : ''}
        </div>
      </div>
      ${showPaidRow ? `<div class="pur-grid2" style="margin-top:-2px;">
        <div class="pur-stat"><div class="pur-stat-label">المدفوع لهذا المورد</div><div class="pur-stat-val" style="color:var(--s);">₪${(p.paid_amount || 0).toFixed(2)}</div></div>
        <div class="pur-stat"><div class="pur-stat-label">المتبقي عليك</div><div class="pur-stat-val" style="color:var(--d);">₪${(p.remaining || 0).toFixed(2)}</div></div>
      </div>` : ''}
      <div class="pur-item-actions">
        <button class="ibb" onclick="event.stopPropagation();Purchases.openEdit('${p.id}')">تعديل</button>
        <button class="ibr" onclick="event.stopPropagation();Purchases.delete('${p.id}')">حذف</button>
      </div>
    </div>`;
  },

  searchInventory(query) {
    const suggestions = document.getElementById('pur-suggestions');
    const badge       = document.getElementById('pur-match-badge');
    const hiddenSel   = document.getElementById('pur-inv-sel');

    if (!query || query.length < 1) {
      suggestions.style.display = 'none';
      badge.style.display = 'none';
      if (hiddenSel) hiddenSel.value = '';
      return;
    }

    const q       = query.toLowerCase();
    const matches = State.inventory.filter(p => p.name.toLowerCase().includes(q));

    if (!matches.length) {
      suggestions.style.display = 'none';
      badge.style.display = 'none';
      if (hiddenSel) hiddenSel.value = '';
      return;
    }

    suggestions.style.display = 'block';
    suggestions.innerHTML = matches.slice(0, 8).map(p => {
      const id   = p.id;
      const name = p.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const unit = (p.unit || '').replace(/'/g, "\\'");
      return '<div class="pur-sugg-item" onclick="Purchases.selectInventoryItem(\'' + id + '\',\'' + name + '\',\'' + unit + '\')">'
        + '<span>' + p.name + ' <small style="color:var(--g4);">(' + (p.unit || '') + ')</small></span>'
        + '<span style="color:var(--g5);font-size:12px;">كمية: ' + p.quantity + '</span>'
        + '</div>';
    }).join('');
  },

  selectInventoryItem(id, name, unit) {
    const input    = document.getElementById('pup');
    const hidden   = document.getElementById('pur-inv-sel');
    const badge    = document.getElementById('pur-match-badge');
    const sugg     = document.getElementById('pur-suggestions');
    const unitSel  = document.getElementById('pu-unit');

    if (input)   input.value   = name;
    if (hidden)  hidden.value  = id;
    if (badge)   badge.style.display = 'inline';
    if (sugg)    sugg.style.display  = 'none';

    // Match unit if possible
    if (unitSel && unit) {
      const opts = Array.from(unitSel.options);
      const match = opts.find(o => o.value.includes(unit) || unit.includes(o.value.split(' ')[0]));
      if (match) unitSel.value = match.value;
    }
  },

  calcTotal() {
    const qty      = parseFloat(document.getElementById('puq')?.value) || 0;
    const unitCost = parseFloat(document.getElementById('puu')?.value) || 0;
    const totalEl  = document.getElementById('puc');
    if (totalEl && qty > 0 && unitCost > 0) {
      totalEl.value = (qty * unitCost).toFixed(2);
      totalEl.style.background = 'var(--sl)';
      totalEl.style.color      = 'var(--s)';
    }
    Purchases.calcRemaining();
  },

  calcTotalAndRemaining() {
    Purchases.calcRemaining();
  },

  setPayStatus(status) {
    DOM.get('pur-pay-status').value = status;
    const btns = { cash: 'pur-pay-cash', transfer: 'pur-pay-transfer', defer: 'pur-pay-defer' };
    Object.entries(btns).forEach(([k, id]) => {
      const btn = DOM.get(id);
      if (!btn) return;
      if (k === status) {
        btn.style.background   = 'var(--p)';
        btn.style.color        = '#fff';
        btn.style.borderColor  = 'var(--p)';
      } else {
        btn.style.background  = '#fff';
        btn.style.color       = 'var(--g7)';
        btn.style.borderColor = 'var(--br)';
      }
    });
    // كاش وتحويل = دفع كلي، آجل = دفع جزئي/كلي
    const section = DOM.get('pur-partial-section');
    if (section) section.style.display = (status === 'defer') ? 'block' : 'none';
    if (status !== 'defer') {
      const paid = DOM.get('pur-paid-amount'); if (paid) paid.value = '';
      const rem  = DOM.get('pur-remaining');   if (rem)  rem.value  = '';
    }
    Purchases.calcRemaining();
  },

  calcRemaining() {
    const total  = parseFloat(DOM.get('puc')?.value) || 0;
    const paid   = parseFloat(DOM.get('pur-paid-amount')?.value) || 0;
    const remEl  = DOM.get('pur-remaining');
    if (remEl) remEl.value = Math.max(0, total - paid).toFixed(2);
  },



  // ── تهيئة موديل الشراء وقت الفتح — تعبئة التاريخ بتاريخ اليوم وتنظيف الحقول من فاتورة سابقة ──
  initModal() {
    const dateEl = DOM.get('pud');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];

    const searchEl = DOM.get('pup');
    if (searchEl) searchEl.value = '';
    DOM.get('pur-inv-sel') && (DOM.get('pur-inv-sel').value = '');
    DOM.get('pur-match-badge') && (DOM.get('pur-match-badge').style.display = 'none');
  },

  async save() {
    const supplier = DOM.val('pus');
    const manual   = DOM.val('pup');
    const cost     = parseFloat(DOM.val('puc'));
    const qty      = parseFloat(DOM.val('puq')) || 1;

    const salePrice = parseFloat(DOM.val('pus-price'));
    if (!manual)                      { Notify.error('أدخل اسم الصنف');       return; }
    if (!cost || cost <= 0)           { Notify.error('أدخل التكلفة الإجمالية'); return; }
    if (!salePrice || salePrice <= 0) { Notify.error('أدخل سعر البيع');        return; }
    if (!supplier)                    { Notify.error('أدخل اسم المورد');        return; }

    const productName = manual;
    const invId = DOM.val('pur-inv-sel') || null;

    const supplierPhone   = DOM.val('pus-phone');
    const invoiceNumber   = DOM.val('pus-invoice');

    const payStatus  = DOM.val('pur-pay-status') || 'cash';
    const paidAmount = parseFloat(DOM.val('pur-paid-amount')) || (payStatus !== 'defer' ? cost : 0);
    const remaining  = Math.max(0, cost - paidAmount);

    State.isMutating = true;
    try {
      // ── استدعاء واحد فقط ينفّذ كل العملية (شراء + ربط/تحديث مخزون + FIFO) على السيرفر دفعة وحدة ──
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/complete-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          supplier, productName, quantity: qty, cost, purchaseDate: DOM.val('pud'),
          supplierPhone: supplierPhone || null,
          invoiceRef: invoiceNumber || null,
          paymentStatus: payStatus, paidAmount, remaining,
          salePrice, unit: DOM.get('pu-unit')?.value || 'قطعة (pcs)',
          invId, lowStockDefault: CONFIG.lowStockDefault,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تنفيذ عملية الشراء');

      Notify.success(json.data.message);

      Modal.close('m-pur');
      DOM.clearInputs('pus', 'pup', 'puc');
      DOM.get('pur-inv-sel').value = '';
      const puq = DOM.get('puq'); if (puq) puq.value = '1';
      const puu      = DOM.get('puu');      if (puu)      puu.value      = '';
      const pusPrice = DOM.get('pus-price'); if (pusPrice) pusPrice.value = '';
      const hidden   = DOM.get('pur-inv-sel'); if (hidden) hidden.value = '';
      const badge    = document.getElementById('pur-match-badge'); if (badge) badge.style.display = 'none';
      const sugg     = document.getElementById('pur-suggestions'); if (sugg) sugg.style.display = 'none';

      // تحديث كاش المخزون بالخلفية — بدون تأخير إغلاق الموديل أو التنظيف البصري
      getInventory()?.loadList();
      const phone = DOM.get('pus-phone'); if (phone) phone.value = '';
      const invno = DOM.get('pus-invoice');if (invno) invno.value = '';
      const pud = DOM.get('pud'); if (pud) pud.value = new Date().toISOString().split('T')[0];
      const inp = DOM.get('pup'); if (inp) inp.placeholder = 'اتركه فارغاً لو اخترت من فوق';
      // Reset payment
      Purchases.setPayStatus('cash');
      const paidEl = DOM.get('pur-paid-amount'); if (paidEl) paidEl.value = '';
      const remEl  = DOM.get('pur-remaining');   if (remEl)  remEl.value  = '';
      getInventory()?.load();
      Purchases.load();
      await getDashboard().load();
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },


  switchTab(tab) {
    const isAll = tab === 'all';
    // sections
    document.getElementById('pur-section-all')?.style.setProperty('display',   isAll ? 'block' : 'none');
    document.getElementById('pur-section-debts')?.style.setProperty('display', isAll ? 'none'  : 'block');
    // tabs active
    document.getElementById('pur-tab-all')?.classList.toggle('active', isAll);
    document.getElementById('pur-tab-debts')?.classList.toggle('active', !isAll);
    // صفر البحث
    const srch = document.getElementById('pur-search');
    if (srch) srch.value = '';
    if (!isAll) Purchases.loadDebts();
  },

  async loadDebts() {
    const { data } = await DB.purchases()
      .select('*')
      .eq('payment_status', 'defer')
      .gt('remaining', 0)
      .order('purchase_date', { ascending: false });

    const list = document.getElementById('sup-debt-list');
    if (!list) return;

    if (!data || !data.length) {
      list.innerHTML = '<tr class="er"><td colspan="8">لا توجد ديون للموردين 🎉</td></tr>';
      const t = document.getElementById('sup-debt-total'); if (t) t.textContent = '₪0.00';
      const p = document.getElementById('sup-debt-paid');  if (p) p.textContent = '₪0.00';
      return;
    }

    const totalRem  = data.reduce((s, r) => s + (r.remaining   || 0), 0);
    const totalPaid = data.reduce((s, r) => s + (r.paid_amount || 0), 0);
    const tEl = document.getElementById('sup-debt-total'); if (tEl) tEl.textContent = '₪' + totalRem.toFixed(2);
    const pEl = document.getElementById('sup-debt-paid');  if (pEl) pEl.textContent = '₪' + totalPaid.toFixed(2);

    list.innerHTML = data.map(p => {
      const rem  = p.remaining   || 0;
      const paid = p.paid_amount || 0;
      const phone = p.supplier_phone
        ? '<a href="tel:' + p.supplier_phone + '" style="color:var(--p);">' + Utils.escape(p.supplier_phone) + '</a>'
        : '-';
      return '<tr>'
        + '<td style="font-weight:800;color:#1e293b;">' + Utils.escape(p.supplier) + '</td>'
        + '<td style="color:#475569;">' + phone + '</td>'
        + '<td style="color:#475569;">' + Utils.escape(p.product_name) + '</td>'
        + '<td style="font-weight:600;color:#1e293b;">₪' + p.cost.toFixed(2) + '</td>'
        + '<td style="color:var(--s);font-weight:700;">₪' + paid.toFixed(2) + '</td>'
        + '<td style="color:var(--r);font-weight:800;">₪' + rem.toFixed(2) + '</td>'
        + '<td style="color:#64748b;">' + p.purchase_date + '</td>'
        + '<td><button class="ibb" onclick="Purchases.openPayModal(\'' + p.id + '\')" >تسديد</button></td>'
        + '</tr>';
    }).join('');
  },

  openPayModal(id) {
    const p = Purchases._cache[id];
    if (!p) { Notify.error('لم يُوجد السجل'); return; }
    document.getElementById('sup-pay-id').value          = id;
    document.getElementById('sup-pay-name').textContent  = p.supplier + (p.product_name ? ' — ' + p.product_name : '');
    document.getElementById('sup-pay-total').textContent = '₪' + (p.cost || 0).toFixed(2);
    document.getElementById('sup-pay-paid').textContent  = '₪' + (p.paid_amount || 0).toFixed(2);
    document.getElementById('sup-pay-rem').textContent   = '₪' + (p.remaining || 0).toFixed(2);
    document.getElementById('sup-pay-amount').value      = '';
    Modal.open('m-sup-pay');
  },

  quickPayFull() {
    const id = document.getElementById('sup-pay-id')?.value;
    const p  = Purchases._cache[id];
    if (p) document.getElementById('sup-pay-amount').value = (p.remaining || 0).toFixed(2);
  },

  async paySupplier() {
    const id     = document.getElementById('sup-pay-id')?.value;
    const amount = parseFloat(document.getElementById('sup-pay-amount')?.value) || 0;
    if (!id || amount <= 0) { Notify.error('أدخل مبلغ التسديد'); return; }
    const p = Purchases._cache[id];
    if (!p) { Notify.error('لم يُوجد السجل'); return; }
    const newPaid      = (p.paid_amount || 0) + amount;
    const newRemaining = Math.max(0, (p.remaining || 0) - amount);
    const newStatus    = newRemaining <= 0 ? 'cash' : 'defer';
    try {
      const { error } = await DB.purchases().update({
        paid_amount: newPaid, remaining: newRemaining, payment_status: newStatus,
      }).eq('id', id);
      if (error) throw error;
      Notify.success('تم التسديد — المتبقي: ₪' + newRemaining.toFixed(2));
      Modal.close('m-sup-pay');
      await Purchases.load();
      await Purchases.loadDebts();
    } catch (err) { Notify.error(err.message); }
  },

  openEdit(id) {
    const p = Purchases._cache[id];
    if (!p) { Notify.error('لم يُوجد السجل'); return; }
    document.getElementById('edit-pur-id').value           = p.id;
    document.getElementById('edit-pur-supplier').value     = p.supplier || '';
    document.getElementById('edit-pur-phone').value        = p.supplier_phone || '';
    document.getElementById('edit-pur-invoice').value      = p.invoice_ref || '';
    document.getElementById('edit-pur-product').value      = p.product_name || '';
    document.getElementById('edit-pur-qty').value          = p.quantity || 1;
    document.getElementById('edit-pur-cost').value         = p.cost || '';
    document.getElementById('edit-pur-sale-price').value   = p.sale_price || '';
    document.getElementById('edit-pur-date').value         = p.purchase_date || '';
    window.Modal.open('m-edit-pur');
  },

  openReturn(id) {
    const p = Purchases._cache[id];
    if (!p) { Notify.error('لم يُوجد السجل'); return; }
    document.getElementById('ret-pur-id').value = id;
    const unitCost = p.quantity > 0 ? (p.cost / p.quantity) : 0;
    document.getElementById('ret-pur-info').innerHTML =
      '<b style="color:#1e293b;">' + Utils.escape(p.supplier) + '</b> — ' + Utils.escape(p.product_name) +
      '<br>الكمية المتوفرة: <b>' + p.quantity + '</b> — تكلفة الوحدة: <b>₪' + unitCost.toFixed(2) + '</b>';
    document.getElementById('ret-pur-qty').value    = '';
    document.getElementById('ret-pur-amount').value = '';
    document.getElementById('ret-pur-reason').value = '';
    Purchases._returnUnitCost = unitCost;
    Purchases._returnPurId    = id;
    Modal.open('m-pur-return');
  },

  calcReturnAmount() {
    const qty    = parseFloat(document.getElementById('ret-pur-qty')?.value) || 0;
    const amount = qty * (Purchases._returnUnitCost || 0);
    const el     = document.getElementById('ret-pur-amount');
    if (el) el.value = amount.toFixed(2);
  },

  async saveReturn() {
    const id     = document.getElementById('ret-pur-id')?.value;
    const qty    = parseFloat(document.getElementById('ret-pur-qty')?.value) || 0;
    const amount = parseFloat(document.getElementById('ret-pur-amount')?.value) || 0;
    const reason = document.getElementById('ret-pur-reason')?.value?.trim();

    if (!qty || qty <= 0)    { Notify.error('أدخل الكمية المرتجعة'); return; }

    const p = Purchases._cache[id];
    if (!p) { Notify.error('لم يُوجد السجل'); return; }
    if (qty > p.quantity)    { Notify.error('الكمية أكبر من المشتراة'); return; }

    try {
      // خصم من المخزون
      const { data: inv } = await DB.inventory()
        .select('id,quantity')
        .eq('name', p.product_name)
        .maybeSingle();
      if (inv) {
        await DB.inventory()
          .update({ quantity: Math.max(0, inv.quantity - qty) })
          .eq('id', inv.id);
      }

      // تحديث كمية الشراء والتكلفة
      const newQty  = p.quantity - qty;
      const newCost = newQty > 0 ? (p.cost - amount) : 0;
      const newRem  = Math.max(0, (p.remaining || 0) - amount);
      await DB.purchases().update({
        quantity: newQty,
        cost:     newCost,
        remaining: newRem,
        payment_status: newRem <= 0 ? 'cash' : p.payment_status,
      }).eq('id', id);

      Notify.success('تم الإرجاع — خُصمت ' + qty + ' وحدة ومبلغ ₪' + amount.toFixed(2));
      Modal.close('m-pur-return');
      await Purchases.load();
      await getInventory()?.loadList?.();
    } catch (err) { Notify.error(err.message); }
  },

  async updatePurchase() {
    const id        = document.getElementById('edit-pur-id').value;
    const supplier  = document.getElementById('edit-pur-supplier').value.trim();
    const product   = document.getElementById('edit-pur-product').value.trim();
    const qty       = parseFloat(document.getElementById('edit-pur-qty').value) || 1;
    const cost      = parseFloat(document.getElementById('edit-pur-cost').value);
    const salePrice = parseFloat(document.getElementById('edit-pur-sale-price').value);
    const date      = document.getElementById('edit-pur-date').value;

    if (!supplier)                    { Notify.error('أدخل اسم المورد'); return; }
    if (!cost || cost <= 0)           { Notify.error('أدخل التكلفة'); return; }
    if (!salePrice || salePrice <= 0) { Notify.error('أدخل سعر البيع'); return; }

    try {
      const phone = document.getElementById('edit-pur-phone').value.trim();
      const invno = document.getElementById('edit-pur-invoice').value.trim();
      const { error } = await DB.purchases().update({
        supplier, product_name: product, quantity: qty, cost, purchase_date: date,
        supplier_phone: phone || null,
        invoice_ref:    invno || null,
        sale_price:     salePrice * qty, // إجمالي سعر البيع لكل الكمية — المستخدمة تُدخل سعر الوحدة بالنموذج
      }).eq('id', id);
      if (error) throw error;

      // تحديث سعر البيع وسعر التكلفة في المخزون (لحساب هامش الربح بشكل صحيح)
      // — نفس منطق التطبيع بدالة save() لمنع فشل المطابقة بصمت بسبب مسافات/اختلاف بسيط بالاسم
      const unitCost = qty > 0 ? (cost / qty) : cost;
      const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const targetNorm = normalize(product);
      if (!State.inventory?.length) {
        const { data } = await DB.inventory().select('id,name');
        State.inventory = data || [];
      }
      const inv = State.inventory.find(item => normalize(item.name) === targetNorm) || null;
      if (inv) {
        const updates = { cost_price: unitCost };
        if (salePrice) updates.sale_price = salePrice;
        await DB.inventory().update(updates).eq('id', inv.id);
      }

      Notify.success('تم التعديل');
      window.Modal.close('m-edit-pur');
      await Purchases.load();
    } catch(err) { Notify.error(err.message); }
  },

  async delete(id) {
    if (!confirm('حذف هذه العملية؟ سيتم إرجاع الكمية غير المباعة للمخزون')) return;

    try {
      // جلب بيانات العملية قبل حذفها — لازم نعرف المنتج/الكمية لنرجّعهم صحيح
      const { data: purchase } = await DB.purchases().select('*').eq('id', id).maybeSingle();

      if (purchase) {
        const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
        const targetNorm = normalize(purchase.product_name);
        if (!State.inventory?.length) {
          const { data } = await DB.inventory().select('id,name,quantity');
          State.inventory = data || [];
        }
        const product = State.inventory.find(item => normalize(item.name) === targetNorm) || null;

        if (product) {
          // حاول التراجع عبر الـ batch المرتبط (يحافظ على دقة المبيعات السابقة لو استُهلك جزء منه)
          const result = await FIFOService.removeBatchByPurchase(id, product.id);

          // لا يوجد batch مرتبط (عملية قديمة قبل الإصلاح) — احتياط: اخصم الكمية كاملة مباشرة
          if (!result.found) {
            const newQty = Math.max(0, product.quantity - purchase.quantity);
            await DB.inventory().update({ quantity: newQty }).eq('id', product.id);
          }
        }
      }

      await DB.purchases().delete().eq('id', id);
      Notify.success('تم الحذف وإرجاع الكمية للمخزون');
      await Purchases.load();
      const invSvc = getInventory(); if (invSvc) await invSvc.loadList();
    } catch (err) {
      Notify.error('فشل الحذف: ' + err.message);
    }
  },
};

export { Purchases };
