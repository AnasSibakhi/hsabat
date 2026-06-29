/**
 * invoices.js — Invoice Management Dashboard
 */

import { DB, sb } from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import { OfflineQueue } from '../core/offline-queue.js';
import * as DOM   from '../core/dom.js';
import * as Utils from '../core/utils.js';
import { escape, currency } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal from '../nav/modal.js';
import { getCustomers, getDebts, getInventory, getDashboard, getQuickSale } from '../core/registry.js';
import { FIFOService } from '../services/FIFOService.js';

// ── State ──
let _allInvoices  = [];
let _debtsByCustomer = {}; // { customer_id: { count, total } } — مُحدَّث مرة واحدة عند تحميل الصفحة
let _filtered     = [];
let _period       = 'all';
let _page         = 1;
let _totalCount   = 0;
let _serverPage   = 1;  // صفحة السيرفر
const PAGE_SIZE   = 50; // عدد الفواتير لكل طلب من السيرفر
const UI_SIZE     = 20; // عدد الفواتير لكل صفحة في الـ UI

const PAY_LABELS  = { cash: 'نقدي', transfer: 'تحويل', defer: 'دين', partial: 'جزئي' };
const PAY_CLASS   = { cash: 'inv-pay-cash', transfer: 'inv-pay-transfer', defer: 'inv-pay-defer', partial: 'inv-pay-partial' };

const Invoices = {

  // ── Invoice Modal Init ──
  async initModal() {
    const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
    const num = 'INV-' + String((count||0)+1).padStart(4,'0');
    DOM.setText('inv-num-preview', num);
    const now = new Date();
    DOM.setText('inv-date-preview', now.toLocaleDateString('ar-EG'));
    DOM.setText('inv-cashier-preview', State.user?.owner || '');
    const cs = DOM.get('inv-cust-search'); if (cs) cs.value = '';
    const ic = DOM.get('ic'); if (ic) ic.value = '';
    const dd = DOM.get('inv-cust-dropdown'); if (dd) dd.style.display = 'none';
    Invoices.resetForm();

    // تحميل الزبائن والمخزون مسبقاً — المخزون ضروري لإضافة المنتجات بشكل صحيح
    if (!State.customers?.length) {
      DB.customers().select('id,name,phone').eq('store_id', State.user.id).order('name')
        .then(({ data }) => { State.customers = data || []; });
    }
    if (!State.inventory?.length) {
      const inv = getInventory();
      if (inv) await inv.loadList();
    }

    // استيراد منتجات سلة البيع السريع تلقائياً — الفاتورة المباشرة تكمل بيع جاري، لا تبدأ بحث جديد
    Invoices._importFromCart();
  },

  // ── استيراد منتجات سلة البيع السريع لقائمة الفاتورة (نفس الكمية المضافة فعلياً) ──
  _importFromCart() {
    const list = DOM.get('inv-items-list');
    if (list) list.innerHTML = ''; // تأكيد نظافة القائمة قبل الاستيراد (resetForm فعلت هذا أصلاً، لكن للتأكيد)

    const qs = getQuickSale();
    const cart = qs ? qs.getCart() : [];

    if (!cart.length) {
      Notify.warn('السلة فارغة — لا يوجد منتجات لاستيرادها');
      return;
    }

    cart.forEach(item => {
      if (item.id) Invoices.addProductById(item.id, item.qty || 1);
    });
  },

  async searchCustomer(val) {
    const dd = DOM.get('inv-cust-dropdown');
    const ic = DOM.get('ic');
    if (!val.trim()) {
      if (dd) dd.style.display = 'none';
      if (ic) ic.value = '';
      return;
    }
    if (!State.customers?.length) {
      const { data } = await DB.customers().select('id,name,phone').eq('store_id', State.user.id).order('name');
      State.customers = data || [];
    }
    const q = val.trim().toLowerCase();
    const matches = (State.customers || []).filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
    ).slice(0, 6);

    // لو مطابق تماماً — عبّي الحقل مباشرة
    const exact = matches.find(c => c.name.toLowerCase() === q);
    if (exact) {
      const cs = document.getElementById('inv-cust-search');
      const ic = document.getElementById('ic');
      const dd = document.getElementById('inv-cust-dropdown');
      if (cs) cs.value = exact.name;
      if (ic) ic.value = exact.id;
      if (dd) dd.style.display = 'none';
      document.getElementById('new-cust-wrap')?.classList.add('hidden');
      return;
    }

    if (!dd) return;
    if (!matches.length) {
      dd.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--g5);">لا يوجد زبون — سيُضاف كزبون جديد</div>`;
      dd.style.display = 'block';
      if (ic) ic.value = '__new__';
      // تعبئة حقل الاسم الجديد
      const nm = DOM.get('inv-new-name'); if (nm) nm.value = val.trim();
      DOM.get('new-cust-wrap')?.classList.remove('hidden');
      return;
    }
    dd.innerHTML = matches.map(c =>
      Utils.customerSuggestRow(c, `onclick="Invoices.selectCustomerById(this.dataset.id)"`)
    ).join('');
    // fixed position
    const inp = document.getElementById('inv-cust-search');
    if (inp) {
      const r = inp.getBoundingClientRect();
      dd.style.top      = r.bottom + 'px';
      dd.style.left     = r.left + 'px';
      dd.style.right    = 'auto';
      dd.style.width    = r.width + 'px';
      dd.style.maxWidth = '340px';
    }
    dd.style.display = 'block';
    DOM.get('new-cust-wrap')?.classList.add('hidden');
  },

  showAllCustomers() {
    const dd  = document.getElementById('inv-cust-dropdown');
    const inp = document.getElementById('inv-cust-search');
    if (!dd || !inp) return;
    if (!State.customers?.length) {
      DB.customers().select('id,name,phone').eq('store_id', State.user.id).order('name')
        .then(({ data }) => { State.customers = data || []; Invoices.showAllCustomers(); });
      return;
    }
    const r = inp.getBoundingClientRect();
    dd.style.top      = r.bottom + 'px';
    dd.style.left     = r.left + 'px';
    dd.style.right    = 'auto';
    dd.style.width    = r.width + 'px';
    dd.style.maxWidth = '340px';
    dd.innerHTML = (State.customers || []).slice(0, 8).map(c =>
      Utils.customerSuggestRow(c, `onclick="Invoices.selectCustomerById(this.dataset.id)"`)
    ).join('') || `<div class="dc-opt" style="color:var(--g4);">لا يوجد زبائن</div>`;
    dd.style.display = 'block';
  },

  selectCustomerById(id) {
    const c = (State.customers || []).find(x => x.id === id);
    if (!c) return;
    Invoices.selectCustomer(c.id, c.name, c.phone || '');
  },

  selectCustomer(id, name, phone) {
    const cs = DOM.get('inv-cust-search'); if (cs) cs.value = name;
    const ic = DOM.get('ic'); if (ic) ic.value = id;
    const dd = DOM.get('inv-cust-dropdown'); if (dd) dd.style.display = 'none';
    DOM.get('new-cust-wrap')?.classList.add('hidden');
  },

  addProductById(id, initialQty = 1) {
    const p = (State.inventory||[]).find(i => i.id === id);
    if (!p) { Notify.error('لم يتم العثور على المنتج — حاولي مرة أخرى'); return; }
    // Check if already in list — لا يفترض أن يحصل أصلاً (الاستيراد من السلة فيه كل منتج مرة واحدة فقط)
    const existing = document.querySelector(`#inv-items-list .inv-item-row[data-pid="${id}"]`);
    if (existing) {
      const qtyEl = existing.querySelector('.inv-qty-fixed');
      const newQty = (parseInt(qtyEl?.dataset.qty || 1)) + initialQty;
      if (qtyEl) { qtyEl.dataset.qty = newQty; qtyEl.textContent = newQty; }
      Invoices.calcTotal();
    } else {
      const list = DOM.get('inv-items-list');
      const lineTotal = (p.sale_price||0) * initialQty;
      list.insertAdjacentHTML('beforeend', `
        <div class="inv-item-row" data-pid="${p.id}" data-price="${p.sale_price||0}" data-qty="${initialQty}">
          <div class="inv-item-top">
            <div class="inv-item-name">${escape(p.name)}</div>
          </div>
          <div class="inv-item-bottom">
            <div class="inv-item-ctrl">
              <span class="inv-qty-fixed" data-qty="${initialQty}">${initialQty}</span>
              <span style="font-size:11px;color:var(--g5);">${escape(p.unit || 'قطعة')}</span>
            </div>
            <div style="font-size:12px;color:var(--g5);">₪${(p.sale_price||0).toFixed(2)}</div>
            <div class="inv-item-total">₪${lineTotal.toFixed(2)}</div>
          </div>
        </div>`
      );
    }
    Invoices.calcTotal();
  },

  // ── Discount type toggle ──
  _discType: 'fixed', // 'fixed' or 'pct'
  toggleDiscType() {
    Invoices._discType = Invoices._discType === 'fixed' ? 'pct' : 'fixed';
    const btn = DOM.get('inv-disc-toggle');
    if (btn) btn.textContent = Invoices._discType === 'pct' ? '%' : '₪';
    DOM.get('idiscount').value = '0';
    Invoices.calcTotal();
  },
  onPayChange(radio) {
    const isPartial = radio.value === 'partial';
    const isCash    = radio.value === 'cash';
    DOM.get('ipartialwrap').style.display  = isPartial ? 'block' : 'none';
    DOM.get('inv-cash-wrap').style.display = isCash    ? 'block' : 'none';
    Invoices.calcChange();
  },

  calcChange() {
    const total = parseFloat(DOM.get('itotal')?.textContent?.replace('₪','')) || 0;
    // Partial
    const partial = parseFloat(DOM.val('ipartial')) || 0;
    const remaining = total - partial;
    const changeRow = DOM.get('inv-change-row');
    if (changeRow) {
      changeRow.style.display = partial > 0 ? 'flex' : 'none';
      DOM.setText('inv-change-val', '₪' + Math.max(0, remaining).toFixed(2));
    }
    // Cash
    const paid = parseFloat(DOM.val('inv-paid-cash')) || 0;
    const change = paid - total;
    const cashRow = DOM.get('inv-cash-change-row');
    if (cashRow) {
      cashRow.style.display = paid > 0 ? 'flex' : 'none';
      const el = DOM.get('inv-cash-change-val');
      if (el) { el.textContent = '₪' + Math.abs(change).toFixed(2); el.style.color = change >= 0 ? 'var(--s)' : 'var(--d)'; }
    }
  },

  // ── Calc total (override) ──
  calcTotal() {
    let subtotal = 0, totalDisc = 0, totalQty = 0, itemCount = 0;
    document.querySelectorAll('#inv-items-list .inv-item-row').forEach(row => {
      const price = parseFloat(row.dataset.price) || 0;
      const qty   = parseFloat(row.dataset.qty) || 0;
      const rowTotal = qty * price;
      const el = row.querySelector('.inv-item-total');
      if (el) el.textContent = '₪' + rowTotal.toFixed(2);
      subtotal  += rowTotal;
      totalQty  += qty;
      itemCount++;
    });
    const globalDiscVal = parseFloat(DOM.val('idiscount')) || 0;
    const globalDisc = Invoices._discType === 'pct'
      ? subtotal * (globalDiscVal / 100)
      : globalDiscVal;
    const total = Math.max(0, subtotal - globalDisc);
    DOM.setText('is-subtotal',    '₪' + subtotal.toFixed(2));
    DOM.setText('is-discount',    '-₪' + globalDisc.toFixed(2));
    DOM.setText('itotal',         '₪' + total.toFixed(2));
    DOM.setText('inv-items-count', itemCount + ' صنف');
    Invoices.calcChange();
  },

  // ── Collect items (override) ──
  _collectItems() {
    const items = []; let subtotal = 0;
    document.querySelectorAll('#inv-items-list .inv-item-row').forEach(row => {
      const id    = row.dataset.pid;
      const p     = (State.inventory||[]).find(i => i.id === id);
      const qty   = parseFloat(row.dataset.qty)   || 0;
      const price = parseFloat(row.dataset.price) || 0;
      if (qty > 0 && price > 0) {
        items.push({ product_name: p?.name||'منتج', inventory_id: id||null, quantity: qty, price });
        subtotal += qty * price;
      }
    });
    return { items, subtotal };
  },

  // ── Reset form (override) ──
  // ── Load invoices — server-side pagination ──
  async load(serverPage = 1) {
    _serverPage  = serverPage;
    _page        = 1;

    const offset = (serverPage - 1) * PAGE_SIZE;
    // طلب واحد فقط لكل الديون النشطة — بدل طلب منفصل لكل زبون بالقائمة (كان السبب الجذري
    // للتأخير الملحوظ عند فتح الصفحة، خصوصاً مع عدد زبائن كبير أو شبكة بطيئة)، نجلب كل الديون
    // دفعة واحدة بالتوازي مع باقي البيانات، ونصفّيها محلياً لكل زبون عند الحاجة بدون أي طلب إضافي
    const [invRes, retRes, debtsRes] = await Promise.all([
      DB.invoices()
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
        .offset(offset),
      // جلب IDs الفواتير المُرجَعة
      DB.returns().select('invoice_id'),
      DB.debts().select('customer_id,amount,paid'),
    ]);

    // بناء Set من IDs المُرجَعة للبحث السريع
    const returnedIds = new Set((retRes.data || []).map(r => r.invoice_id));

    _allInvoices = (invRes.data || []).map(inv => ({
      ...inv,
      _returned: returnedIds.has(inv.id),
    }));

    // تجميع الديون النشطة محلياً حسب customer_id — يُستخدَم لاحقاً لعرض ملخص الدين فوراً
    // بدون أي طلب شبكي إضافي عند رسم بطاقات الزبائن
    _debtsByCustomer = {};
    (debtsRes.data || []).forEach(d => {
      const rem = d.amount - (d.paid || 0);
      if (rem <= 0 || !d.customer_id) return;
      if (!_debtsByCustomer[d.customer_id]) _debtsByCustomer[d.customer_id] = { count: 0, total: 0 };
      _debtsByCustomer[d.customer_id].count++;
      _debtsByCustomer[d.customer_id].total += rem;
    });

    _totalCount = _allInvoices.length;
    Invoices.applyFilters();
  },

  // ── تحميل المزيد من السيرفر ──
  async loadMore() {
    await Invoices.load(_serverPage + 1);
  },

  async loadPrev() {
    if (_serverPage > 1) await Invoices.load(_serverPage - 1);
  },

  // ── Period filter ──
  setFilter(period, btn) {
    _period = period;
    _page   = 1;
    document.querySelectorAll('.inv-tab').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    Invoices.applyFilters();
  },

  // ── Apply all filters + sort + render ──
  applyFilters() {
    const q       = (DOM.val('inv-search') || '').toLowerCase().trim();
    const payF    = DOM.val('inv-filter-pay') || '';
    const sortV   = DOM.val('inv-sort') || 'date_desc';
    const today   = Utils.today();
    const weekAgo = Utils.daysAgo(7);
    const monAgo  = Utils.daysAgo(30);

    let list = _allInvoices.filter(inv => {
      // Period
      if (_period === 'today' && inv.invoice_date !== today) return false;
      if (_period === 'week'  && inv.invoice_date < weekAgo) return false;
      if (_period === 'month' && inv.invoice_date < monAgo)  return false;
      // Payment
      if (payF && inv.payment_type !== payF) return false;
      // Search
      if (q) {
        const num   = (inv.invoice_number || '').toLowerCase();
        const buyer = (inv.buyer_name || inv.customer_name || '').toLowerCase();
        const phone = (inv.buyer_phone || '').toLowerCase();
        if (!num.includes(q) && !buyer.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });

    // Sort
    list.sort((a, b) => {
      if (sortV === 'date_desc')  return new Date(b.created_at) - new Date(a.created_at);
      if (sortV === 'date_asc')   return new Date(a.created_at) - new Date(b.created_at);
      if (sortV === 'total_desc') return b.total - a.total;
      if (sortV === 'total_asc')  return a.total - b.total;
      return 0;
    });

    _filtered = list;
    Invoices._renderKPI(list);
    Invoices._renderTable();
  },

  // ── KPI Cards ──
  _renderKPI(list) {
    const total = list.reduce((s, i) => s + (i.total || 0), 0);
    const count = list.length;
    const avg   = count ? total / count : 0;
    const defer = list.filter(i => i.payment_type === 'defer').length;
    DOM.setText('inv-kpi-total', '₪' + total.toFixed(2));
    DOM.setText('inv-kpi-count', count);
    DOM.setText('inv-kpi-avg',   '₪' + avg.toFixed(2));
    DOM.setText('inv-kpi-defer', defer);
  },

  // ── Render table with pagination ──
  // كارد فاتورة واحدة داخل قائمة الزبون المفتوحة
  _renderInvoiceCard(inv) {
    const payClass = PAY_CLASS[inv.payment_type] || '';
    const payLabel = PAY_LABELS[inv.payment_type] || inv.payment_type;
    const hasDiscount = inv.discount > 0;
    const isReturned = inv._returned;
    return `<div class="inv-receipt page-invoice${isReturned ? ' inv-receipt-returned' : ''}">
      <div class="page-accent-stripe invoice"></div>
      <div class="ir-top">
        <span class="ir-num"><i class="ti ti-receipt"></i> ${escape(inv.invoice_number || '-')}</span>
        <span class="inv-pay-badge ${payClass}">${payLabel}</span>
      </div>
      ${isReturned ? '<div class="ir-returned-strip">مُرجَعة</div>' : ''}
      <div class="ir-line"></div>
      <div class="ir-row"><span>التاريخ</span><b>${inv.invoice_date}${inv.sale_time ? ' · ' + inv.sale_time : ''}</b></div>
      <div class="ir-row"><span>المنتجات</span><b class="inv-items-badge" id="ic-${inv.id}">—</b></div>
      ${hasDiscount ? `<div class="ir-row"><span>الخصم</span><b class="ir-disc-val">-₪${inv.discount.toFixed(2)}</b></div>` : ''}
      <div class="ir-total">
        <span class="ir-total-label">الإجمالي</span>
        <span class="ir-total-val">₪${inv.total.toFixed(2)}</span>
      </div>
      <div class="ir-actions">
        <button class="ir-act-btn" onclick="Invoices.openDetails('${inv.id}')" title="عرض"><i class="ti ti-eye"></i></button>
        <button class="ir-act-btn ir-act-del" onclick="Invoices.delete('${inv.id}')" title="حذف"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  },

  // ── تجميع الفواتير حسب اسم الزبون — نفس فكرة تجميع الموردين بالمشتريات ──
  _groupByCustomer(data) {
    const groups = {};
    data.forEach(inv => {
      const name = (inv.buyer_name || inv.customer_name || '').trim() || 'زبون عادي';
      // المفتاح الصحيح والدقيق: customer_id الحقيقي المحفوظ بالفاتورة من السيرفر، لو موجود —
      // هذا السبب الجذري لمشكلة "أسماء خاطئة بالتسديد" التي أصلحناها: التجميع والمطابقة
      // كانا يعتمدان فقط على نص الاسم (هش جداً، يخطئ مع أسماء متشابهة أو زبائن مكرَّرين بنفس
      // الاسم)، رغم أن customer_id الحقيقي والدقيق كان متوفراً بالبيانات نفسها طوال الوقت.
      // لو الفاتورة بدون customer_id فعلياً (زبون كاش بدون ربط، أو "زبون عادي")، نستخدم الاسم
      // كحل بديل فقط — لكن مع تمييز كل اسم بمفتاح خاص به (لا تجميع كل فواتير "بدون زبون" معاً)
      const key = inv.customer_id ? ('id:' + inv.customer_id) : ('name:' + name.toLowerCase());
      if (!groups[key]) {
        groups[key] = { name, phone: inv.buyer_phone || '', customerId: inv.customer_id || null, invoices: [] };
      }
      groups[key].invoices.push(inv);
      if (inv.buyer_phone) groups[key].phone = inv.buyer_phone;
      // لو فاتورة لاحقة لها customer_id حقيقي بينما الأولى لم يكن لها (نادر، لكن ممكن)، نثبّته
      if (inv.customer_id && !groups[key].customerId) groups[key].customerId = inv.customer_id;
    });
    // الأحدث أولاً (الزبون الذي له فاتورة أحدث يظهر بالأعلى)
    return Object.values(groups).sort((a, b) =>
      new Date(b.invoices[0]?.created_at || 0) - new Date(a.invoices[0]?.created_at || 0)
    );
  },

  // ── تحميل ملخص ديون كل زبون بالقائمة الحالية، بالخلفية وبدون حجب العرض الأساسي ──
  // نطابق كل اسم بمعرّف زبون حقيقي بـ State.customers (المصدر الوحيد المتاح هنا)، ثم نجلب
  // ديونه النشطة لعرض زر التسديد فقط عند وجود دين فعلي

  // ── تحديث كاش الديون المحلي فقط (بدون إعادة جلب الفواتير نفسها) — تُستدعى من Debts بعد
  // نجاح "تسديد الإجمالي" لتعكس الحالة الجديدة فوراً بدون إعادة تحميل الصفحة بالكامل ──
  async refreshDebtsCache() {
    try {
      const { data: debts } = await DB.debts().select('customer_id,amount,paid');
      _debtsByCustomer = {};
      (debts || []).forEach(d => {
        const rem = d.amount - (d.paid || 0);
        if (rem <= 0 || !d.customer_id) return;
        if (!_debtsByCustomer[d.customer_id]) _debtsByCustomer[d.customer_id] = { count: 0, total: 0 };
        _debtsByCustomer[d.customer_id].count++;
        _debtsByCustomer[d.customer_id].total += rem;
      });
      Invoices._renderTable();
    } catch {
      // فشل صامت — ملخص ثانوي، لا يؤثر على البيانات الحقيقية بقاعدة البيانات
    }
  },

  _renderTable() {
    const start  = (_page - 1) * UI_SIZE;
    const page   = _filtered.slice(start, start + UI_SIZE);
    const total  = _filtered.length;
    const pages  = Math.max(1, Math.ceil(total / UI_SIZE));

    const groups = Invoices._groupByCustomer(page);

    DOM.setHTML('ilist', groups.length
      ? groups.map((g, idx) => {
          const totalAmount = g.invoices.reduce((s, inv) => s + inv.total, 0);
          const hasReturned = g.invoices.some(inv => inv._returned);
          const initials    = g.name.trim().slice(0, 2);
          const debtInfo    = g.customerId ? _debtsByCustomer[g.customerId] : null;
          const invoicesHtml = g.invoices.map(inv => Invoices._renderInvoiceCard(inv)).join('');

          return `<div class="cust-card${idx === 0 && groups.length === 1 ? ' open' : ''}" id="cust-card-${idx}">
            <div class="cust-header" onclick="document.getElementById('cust-card-${idx}').classList.toggle('open')">
              <div class="cust-info">
                <div class="pur-avatar">${escape(initials)}</div>
                <div style="min-width:0;">
                  <div class="cust-name">${escape(g.name)}</div>
                  ${g.phone ? '<a href="tel:' + g.phone + '" class="pur-sphone" onclick="event.stopPropagation()">' + escape(g.phone) + '</a>' : ''}
                </div>
              </div>
              <div class="cust-summary">
                <span class="cust-count">${g.invoices.length} ${g.invoices.length === 1 ? 'فاتورة' : 'فواتير'}</span>
                <div class="pur-stat" style="background:none;padding:0;">
                  <div class="pur-stat-label">إجمالي مشترياته</div>
                  <div class="pur-stat-val" style="color:var(--p);">₪${totalAmount.toFixed(2)}</div>
                </div>
                ${hasReturned ? '<span class="sup-debt-dot" title="يوجد فاتورة مُرجَعة لهذا الزبون"></span>' : ''}
                <span class="sup-chevron">‹</span>
              </div>
            </div>
            ${debtInfo ? `<div class="cust-debt-row" onclick="event.stopPropagation()">
              <div>
                <span class="cust-debt-row-label">دين متبقٍ (${debtInfo.count})</span>
                <span class="cust-debt-row-total">₪${debtInfo.total.toFixed(2)}</span>
              </div>
              <button class="ibg ibg-primary" onclick="Debts.openTotalPayModal('${g.customerId}',${debtInfo.total})">تسديد</button>
            </div>` : ''}
            <div class="cust-invoices">${invoicesHtml}</div>
          </div>`;
        }).join('')
      : '<div class="er inv-empty-state">لا توجد فواتير</div>'
    );

    // Pagination UI
    const pag = DOM.get('inv-pagination');
    if (pag) {
      const from = total ? start + 1 : 0;
      const to   = Math.min(start + UI_SIZE, total);
      pag.innerHTML = `
        <span>${from}–${to} من ${total} ظاهر</span>
        <div class="inv-page-btns">
          <button class="inv-page-btn" onclick="Invoices.goPage(${_page-1})" ${_page<=1?'disabled':''}>‹</button>
          ${Array.from({length:Math.min(pages,5)},(_,i)=>{
            const p = Math.max(1,Math.min(_page-2,pages-4))+i;
            return `<button class="inv-page-btn${p===_page?' active':''}" onclick="Invoices.goPage(${p})">${p}</button>`;
          }).join('')}
          <button class="inv-page-btn" onclick="Invoices.goPage(${_page+1})" ${_page>=pages?'disabled':''}>›</button>
        </div>
        <div style="display:flex;gap:6px;">
          ${_serverPage > 1 ? `<button class="inv-page-btn" onclick="Invoices.loadPrev()">‹ الأحدث</button>` : ''}
          ${_allInvoices.length === PAGE_SIZE ? `<button class="inv-page-btn" onclick="Invoices.loadMore()">الأقدم ›</button>` : ''}
        </div>`;
    }

    // Load items count in background
    Invoices._loadItemsCounts(page.map(i => i.id));
  },

  goPage(p) {
    const pages = Math.ceil(_filtered.length / UI_SIZE);
    if (p < 1 || p > pages) return;
    _page = p;
    Invoices._renderTable();
  },

  // ── Load items counts ──
  async _loadItemsCounts(ids) {
    if (!ids.length) return;
    const { data } = await DB.invoiceItems()
      .select('invoice_id, quantity')
      .in('invoice_id', ids);
    const counts = {};
    (data || []).forEach(it => {
      if (!counts[it.invoice_id]) counts[it.invoice_id] = { items: 0, qty: 0 };
      counts[it.invoice_id].items++;
      counts[it.invoice_id].qty += it.quantity;
    });
    ids.forEach(id => {
      const el = DOM.get('ic-' + id);
      if (el) {
        const c = counts[id] || { items: 0, qty: 0 };
        el.textContent = `${c.items} صنف · ${c.qty} قطعة`;
      }
    });
  },

  // ── Invoice Details Modal ──
  async openDetails(invId) {
    let inv, items, retData;
    try {
      const result = await Promise.all([
        DB.invoices().select("*").eq("id", invId).single(),
        DB.invoiceItems().select("*").eq("invoice_id", invId),
        DB.returns().select("*").eq("store_id", State.user?.id).eq("invoice_id", invId).maybeSingle(),
      ]);
      inv = result[0].data; items = result[1].data; retData = result[2].data;
    } catch {
      Notify.error("تعذّر تحميل الفاتورة — تحققي من الاتصال");
      return;
    }
    if (!inv) { Notify.error('تعذّر تحميل الفاتورة'); return; }

    const ret = retData; // معلومات الإرجاع لو موجودة

    const payLabel = PAY_LABELS[inv.payment_type] || inv.payment_type;
    const payClass = PAY_CLASS[inv.payment_type]  || '';
    const totalQty = (items || []).reduce((s, i) => s + i.quantity, 0);
    const store    = State.user?.store_name || 'حسابات';
    const itemsHtml = (items || []).map(it =>
      `<tr>
        <td style="padding:9px 12px;border-bottom:1px solid var(--g1);font-size:13px;">${escape(it.product_name || '-')}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--g1);font-size:13px;text-align:center;">${it.quantity}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--g1);font-size:13px;text-align:center;">₪${parseFloat(it.price).toFixed(2)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid var(--g1);font-size:13px;text-align:left;font-weight:700;color:var(--p);">₪${(it.quantity * it.price).toFixed(2)}</td>
      </tr>`
    ).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--g4);padding:1rem;">لا توجد منتجات</td></tr>';

    // واتساب
    const phone = inv.buyer_phone || '';
    const waMsg = encodeURIComponent(
      `🧾 فاتورة من ${store}\n` +
      `رقم: ${inv.invoice_number}\n` +
      `التاريخ: ${inv.invoice_date} ${inv.sale_time||''}\n` +
      (inv.buyer_name ? `الزبون: ${inv.buyer_name}\n` : '') +
      `\nالمنتجات:\n` +
      (items||[]).map(it => `• ${it.product_name} × ${it.quantity} = ₪${(it.quantity*it.price).toFixed(2)}`).join('\n') +
      `\n\nالإجمالي: ₪${inv.total.toFixed(2)}\n` +
      (inv.payment_type === 'partial'
        ? `المدفوع: ₪${(inv.partial_paid || 0).toFixed(2)}\nالمتبقي كدين: ₪${(inv.total - (inv.partial_paid || 0)).toFixed(2)}\n`
        : '') +
      `طريقة الدفع: ${payLabel}`
    );
    const waUrl = phone ? `https://wa.me/${phone.replace(/[^0-9]/g,'')}?text=${waMsg}` : `https://wa.me/?text=${waMsg}`;

    DOM.setHTML('inv-details-body', `
      <!-- معلومات الإرجاع لو موجودة -->
      ${ret ? `
      <div style="background:var(--dl);border-radius:12px;padding:12px;margin-bottom:12px;border:1px solid var(--dl);">
        <div style="font-size:13px;font-weight:800;color:var(--d);margin-bottom:8px;">⚠️ هذه الفاتورة مُرجَعة</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);margin-bottom:4px;">
          <span>تاريخ الإرجاع</span><strong>${ret.return_date}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);margin-bottom:4px;">
          <span>مبلغ الإرجاع</span><strong>₪${ret.amount?.toFixed(2)}</strong>
        </div>
        ${(() => {
          const m = (ret.notes || '').match(/^الزبون:\s*([^—]+?)(?:\s*—\s*(.*))?$/);
          const buyer = m ? m[1].trim() : null;
          const extra = m ? (m[2] || '').trim() : (ret.notes || '');
          return (buyer ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);margin-bottom:4px;"><span>الزبون</span><strong>${escape(buyer)}</strong></div>` : '')
               + (extra ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);"><span>ملاحظات</span><strong>${escape(extra)}</strong></div>` : '');
        })()}
      </div>` : ''}

      <!-- معلومات الفاتورة -->
      <div style="background:var(--g0);border-radius:12px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--br);">
          <span style="font-size:12px;color:var(--g5);">رقم الفاتورة</span>
          <strong style="font-size:13px;color:var(--p);">${escape(inv.invoice_number || '-')}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--br);">
          <span style="font-size:12px;color:var(--g5);">التاريخ والوقت</span>
          <strong style="font-size:13px;">${inv.invoice_date} ${inv.sale_time || ''}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--br);">
          <span style="font-size:12px;color:var(--g5);">اسم المشتري</span>
          <strong style="font-size:13px;">${escape(inv.buyer_name || inv.customer_name || '-')}</strong>
        </div>
        ${inv.buyer_phone ? `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--br);">
          <span style="font-size:12px;color:var(--g5);">رقم الجوال</span>
          <strong style="font-size:13px;">${escape(inv.buyer_phone)}</strong>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;${inv.transfer_entity_name ? 'border-bottom:1px solid var(--br);' : ''}">
          <span style="font-size:12px;color:var(--g5);">طريقة الدفع</span>
          <span class="inv-pay-badge ${payClass}">${payLabel}</span>
        </div>
        ${inv.transfer_entity_name ? `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">
          <span style="font-size:12px;color:var(--g5);">جهة التحويل</span>
          <strong style="font-size:13px;">${escape(inv.transfer_entity_name)}</strong>
        </div>` : ''}
      </div>

      <!-- جدول المنتجات -->
      <div style="border:1px solid var(--br);border-radius:12px;overflow:hidden;margin-bottom:12px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:var(--g0);">
              <th style="padding:9px 12px;font-size:11px;color:var(--g6);font-weight:700;text-align:right;border-bottom:1px solid var(--br);">المنتج</th>
              <th style="padding:9px 8px;font-size:11px;color:var(--g6);font-weight:700;text-align:center;border-bottom:1px solid var(--br);">الكمية</th>
              <th style="padding:9px 8px;font-size:11px;color:var(--g6);font-weight:700;text-align:center;border-bottom:1px solid var(--br);">السعر</th>
              <th style="padding:9px 12px;font-size:11px;color:var(--g6);font-weight:700;text-align:left;border-bottom:1px solid var(--br);">الإجمالي</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
      </div>

      <!-- الملخص -->
      <div style="background:var(--g0);border-radius:12px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--g5);margin-bottom:4px;">
          <span>عدد الأصناف</span>
          <span>${(items||[]).length} صنف · ${totalQty} قطعة</span>
        </div>
        ${inv.discount > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--d);margin-bottom:4px;">
          <span>خصم</span><span>-₪${inv.discount.toFixed(2)}</span>
        </div>` : ''}
        ${inv.payment_type === 'partial' ? `
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--s);margin-bottom:4px;">
          <span>المدفوع</span><span>₪${(inv.partial_paid || 0).toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--d);margin-bottom:4px;">
          <span>المتبقي كدين</span><span>₪${(inv.total - (inv.partial_paid || 0)).toFixed(2)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:17px;margin-top:8px;padding-top:8px;border-top:1.5px solid var(--br);">
          <span>الإجمالي النهائي</span>
          <span style="color:var(--p);">₪${inv.total.toFixed(2)}</span>
        </div>
      </div>

      <!-- أزرار -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-s" onclick="Invoices.printInvoice('${invId}')" style="justify-content:center;gap:6px;padding:12px;">
          <i class="ti ti-printer"></i> طباعة
        </button>
        <a href="${waUrl}" target="_blank" class="btn" style="background:#25d366;color:#fff;justify-content:center;gap:6px;text-decoration:none;display:flex;align-items:center;border-radius:10px;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;padding:12px;">
          <i class="ti ti-brand-whatsapp"></i> واتساب
        </a>
      </div>
      ${!ret ? `
      <button class="btn btn-o" style="width:100%;justify-content:center;margin-top:8px;" data-inv-id="${invId}" data-buyer="${escape(inv.buyer_name || inv.customer_name || '')}" data-total="${inv.total}" onclick="Modal.close('m-inv-details');Returns.openModalFromBtn(this)">
        <i class="ti ti-arrow-back-up"></i> إرجاع هذه الفاتورة
      </button>` : ''}
    `);
    Modal.open('m-inv-details');
  },

  // ── Print Invoice ──
  printInvoice(invId) {
    DB.invoices().select('*').eq('id', invId).single().then(({ data: inv }) => {
      if (!inv) { Notify.error("تعذّر تحميل الفاتورة — تحققي من الاتصال"); return; }
      DB.invoiceItems().select('*').eq('invoice_id', invId).then(({ data: items }) => {
        const store   = State.user?.store_name || 'حسابات';
        const payLabel = PAY_LABELS[inv.payment_type] || inv.payment_type;
        const itemsHtml = (items||[]).map(it =>
          `<tr>
            <td>${it.product_name||'-'}</td>
            <td style="text-align:center;">${it.quantity}</td>
            <td style="text-align:left;">₪${parseFloat(it.price).toFixed(2)}</td>
            <td style="text-align:left;font-weight:700;">₪${(it.quantity*it.price).toFixed(2)}</td>
          </tr>`
        ).join('');
        const html = `<!DOCTYPE html><html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>فاتورة ${inv.invoice_number}</title>
<style>
  body{font-family:'Cairo',Arial,sans-serif;margin:0;padding:16px;font-size:13px;color:var(--g9);max-width:320px;margin:auto;}
  .store-name{font-size:18px;font-weight:900;text-align:center;margin-bottom:4px;}
  .inv-num{text-align:center;color:var(--g5);font-size:12px;margin-bottom:12px;border-bottom:1px dashed var(--g3);padding-bottom:8px;}
  .info-row{display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px;}
  table{width:100%;border-collapse:collapse;margin:10px 0;}
  th{background:var(--g0);padding:6px 8px;font-size:11px;text-align:right;border-bottom:1px solid var(--g3);}
  td{padding:6px 8px;border-bottom:1px solid var(--g1);font-size:12px;}
  .total-row{font-size:15px;font-weight:900;display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid var(--g9);margin-top:8px;}
  .footer{text-align:center;font-size:11px;color:var(--g4);margin-top:12px;border-top:1px dashed var(--g3);padding-top:8px;}
  @media print{body{padding:0;}}
</style></head>
<body>
  <div class="store-name">${store}</div>
  <div class="inv-num">${inv.invoice_number} · ${inv.invoice_date} ${inv.sale_time||''}</div>
  ${inv.buyer_name ? `<div class="info-row"><span>الزبون</span><span>${inv.buyer_name}</span></div>` : ''}
  ${inv.buyer_phone ? `<div class="info-row"><span>الجوال</span><span>${inv.buyer_phone}</span></div>` : ''}
  <div class="info-row"><span>طريقة الدفع</span><span>${payLabel}</span></div>
  ${inv.transfer_entity_name ? `<div class="info-row"><span>جهة التحويل</span><span>${inv.transfer_entity_name}</span></div>` : ''}
  <table>
    <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  ${inv.discount > 0 ? `<div class="info-row"><span>خصم</span><span style="color:red;">-₪${inv.discount.toFixed(2)}</span></div>` : ''}
  <div class="total-row"><span>الإجمالي</span><span>₪${inv.total.toFixed(2)}</span></div>
  <div class="footer">شكراً لتعاملكم معنا</div>
  <script>window.onload=()=>{window.print();}<\/script>
</body></html>`;
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
      });
    });
  },

  // ── Export Excel ──
  async exportExcel() {
    const list = _filtered.length ? _filtered : _allInvoices;
    if (!list.length) { Notify.error('لا توجد فواتير للتصدير'); return; }
    Notify.show('جارٍ التصدير...');
    const rows = [['رقم الفاتورة','المشتري','الجوال','التاريخ','الوقت','طريقة الدفع','الإجمالي','الخصم']];
    list.forEach(inv => {
      rows.push([
        inv.invoice_number || '',
        inv.buyer_name || inv.customer_name || '',
        inv.buyer_phone || '',
        inv.invoice_date || '',
        inv.sale_time || '',
        PAY_LABELS[inv.payment_type] || '',
        inv.total?.toFixed(2) || '',
        inv.discount?.toFixed(2) || '0',
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'invoices.csv'; a.click();
    URL.revokeObjectURL(url);
  },

  // ── Form helpers ──
  _buildItemRow() {
    const opts = State.inventory
      .map(i => `<option value="${i.id}" data-price="${i.sale_price||0}" data-name="${escape(i.name)}">${escape(i.name)} (${i.quantity} ${i.unit||''})</option>`)
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
    const list = DOM.get('inv-items-list');
    if (list) list.innerHTML = '';
    DOM.setText('itotal',          '₪0');
    DOM.setText('is-subtotal',     '₪0');
    DOM.setText('is-discount',     '₪0');
    DOM.setText('inv-items-count', '0 صنف');
    const disc = DOM.get('idiscount'); if (disc) disc.value = '0';
    Invoices._discType = 'fixed';
    const btn = DOM.get('inv-disc-toggle'); if (btn) btn.textContent = '₪';
  },

  addItem() {},

  // ── توليد رقم فاتورة فريد بشكل مضمون — يتحقق من عدم وجود تكرار فعلياً قبل الإرجاع ──
  // (السبب الجذري للتكرار: كان يعتمد على عدّ السجلات فقط، وهذا غير آمن لو حُفظت فاتورتان بنفس اللحظة تقريباً)
  async _generateInvoiceNumber() {
    const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
    let nextNum = (count || 0) + 1;

    // حاولي حتى 20 مرة للتأكد من رقم فريد فعلياً غير مستخدم بقاعدة البيانات
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = 'INV-' + String(nextNum).padStart(4, '0');
      const { data: existing } = await DB.invoices().select('id').eq('invoice_number', candidate).maybeSingle();
      if (!existing) return candidate; // الرقم فريد فعلياً — جاهز للاستخدام
      nextNum++; // الرقم مستخدم مسبقاً (حصل تعارض) — جربي الرقم التالي
    }

    // احتياط أخير نادر الحدوث — لو فشلت كل المحاولات، استخدمي timestamp لضمان فريدية مطلقة
    return 'INV-' + Date.now().toString().slice(-6);
  },

  async save() {
    const { items, subtotal } = Invoices._collectItems();
    if (!items.length) { Notify.error('أضف منتجاً على الأقل'); return; }
    if (!subtotal && subtotal !== 0) { Notify.error('تحقق من أسعار المنتجات'); return; }

    // اسم الزبون إلزامي — إما زبون محفوظ مُختار، أو اسم مكتوب للزبون الجديد
    const custIdCheck  = DOM.val('ic');
    const searchValCheck = DOM.val('inv-cust-search')?.trim();
    const newNameCheck = DOM.val('inv-new-name')?.trim();
    if (!custIdCheck && !searchValCheck && !newNameCheck) {
      Notify.error('أدخل اسم الزبون');
      DOM.get('inv-cust-search')?.focus();
      return;
    }

    const globalDisc  = parseFloat(DOM.val('idiscount')) || 0;
    const itemsDisc   = items.reduce((s, i) => s + (i.discount||0), 0);
    const discount    = globalDisc + itemsDisc;
    const total       = Math.max(0, subtotal - discount);
    const paymentType = document.querySelector('input[name="ip"]:checked')?.value || 'cash';
    const partialPaid = paymentType === PAYMENT.PARTIAL ? (parseFloat(DOM.val('ipartial'))||0) : 0;
    const today       = Utils.today();
    const timeNow     = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });

    // ربط الزبون محلياً فقط (بحث بالكاش، صفر طلب شبكي) — نفس فلسفة sell() بالضبط. لو الزبون
    // غير موجود محلياً، يبقى customerId فاضياً ويُرسَل الاسم نصاً، السيرفر يربطه/ينشئه تلقائياً
    let customerId = DOM.val('ic'), customerName = 'زبون عادي', customerPhone = '';
    const searchVal = DOM.val('inv-cust-search')?.trim();
    let newNameForBackground = null, newPhoneForBackground = null;

    if (customerId === '__new__' || (!customerId && searchVal)) {
      const newName = DOM.val('inv-new-name') || searchVal;
      if (!newName) { Notify.error('أدخل اسم الزبون'); return; }
      const existingByName = (State.customers || []).find(c => c.name.toLowerCase() === newName.toLowerCase());
      if (existingByName) {
        customerId = existingByName.id; customerName = newName; customerPhone = existingByName.phone || '';
      } else {
        customerName = newName; customerPhone = DOM.val('inv-new-phone') || '';
        newNameForBackground = newName; newPhoneForBackground = customerPhone;
      }
    } else if (customerId) {
      const found = State.customers.find(c => c.id === customerId);
      customerName = found?.name || searchVal || ''; customerPhone = found?.phone || '';
    }

    // رقم محلي فوري للعرض فقط، صفر طلب شبكي — السيرفر (بعد الإصلاح المطلوب نشره) يولّد دائماً
    // رقمه الحقيقي الخاص ذرّياً، نفس فلسفة complete-sale، يتجاهل أي رقم مُرسَل من العميل
    const invNum = 'LOCAL-' + Date.now().toString().slice(-8);
    const debtAmount = ([PAYMENT.DEFER, PAYMENT.PARTIAL].includes(paymentType) && customerId)
      ? (paymentType === PAYMENT.PARTIAL ? total - partialPaid : total)
      : 0;

    const invoicePayload = {
      items, subtotal, discount, total, paymentType, partialPaid,
      customerId: customerId || null, customerName, customerPhone,
      invoiceDate: today, saleTime: timeNow, invoiceNumber: invNum,
      notes: DOM.val('inotes'),
      debtAmount,
    };

    // ── عرض فوري (Optimistic UI) — نفس فلسفة sell() بالضبط. الفاتورة تظهر فوراً محلياً،
    // والإرسال الحقيقي يحصل بالكامل بالخلفية، بصفر انتظار على الواجهة بغض النظر عن الشبكة ──
    Notify.success('فاتورة ' + invNum + ' — ' + Utils.currency(total));
    Modal.close('m-invoice');
    Invoices.resetForm();
    DOM.get('new-cust-wrap')?.classList.add('hidden');
    DOM.clearInputs('inv-new-name', 'inv-new-phone', 'inotes');
    DOM.get('idiscount').value = '0';

    // أفرغ سلة البيع السريع فوراً — الفاتورة كانت نسخة من نفس منتجاتها، يجب ألا يُباع نفس المنتج مرتين
    const qs = getQuickSale();
    if (qs) qs.clearCart(true);

    // الإرسال الحقيقي بالكامل بالخلفية — بدون أي await هنا
    (async () => {
      try {
        // إنشاء الزبون الجديد بالخلفية لو لم يُوجَد محلياً — منفصل عن استدعاء الفاتورة نفسها
        // لتجنّب أي تعارض، السيرفر سيربط/ينشئ الزبون تلقائياً بنفسه أثناء معالجة complete-invoice
        // أصلاً، فهذا فقط لتحديث الكاش المحلي لاحقاً بشكل أسرع لو فشل لسبب آخر
        const { data: { session } } = await sb.auth.getSession();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/complete-invoice`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify(invoicePayload),
        });
        clearTimeout(timeoutId);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'فشل حفظ الفاتورة');

        // نجحت فعلياً بالخلفية — نحدّث البيانات الثانوية بصمت
        getInventory().loadList();
        Invoices.load();
        getDashboard().load();
        getCustomers().loadUnified();
      } catch (err) {
        const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
        if (isNetworkFailure) {
          // فشل شبكي حقيقي — نخزّن بالطابور المحلي لمزامنة تلقائية لاحقة، صفر فقدان بيانات
          OfflineQueue.add(invoicePayload, 'invoice');
        } else {
          // فشل حقيقي من السيرفر — المستخدمة رأت فاتورة "ناجحة" بالفعل، فهذا يستدعي تنبيهاً واضحاً
          Notify.error('⚠️ فاتورة ' + invNum + ' فشلت فعلياً بالخادم: ' + (err.message || 'خطأ غير معروف') + ' — راجعي المخزون والديون يدوياً');
        }
      }
    })();
  },

  delete(id) {
    const inv = (_allInvoices || []).find(i => i.id === id) || _filtered.find(i => i.id === id);
    const isDefer = inv?.payment_type === PAYMENT.DEFER || inv?.payment_type === PAYMENT.PARTIAL;

    DOM.get('del-inv-id').value = id;
    DOM.setText('del-inv-num', inv?.invoice_number || '');
    const warning = DOM.get('del-debt-warning');
    if (warning) warning.style.display = isDefer ? 'flex' : 'none';

    Modal.open('m-del-invoice');
  },

  async confirmDelete() {
    const id = DOM.val('del-inv-id');
    if (!id) return;

    Modal.close('m-del-invoice');
    State.isMutating = true;
    try {
      // جلب أصناف الفاتورة قبل حذفها — لازم نعرفهم لنرجّع الكمية صحيح
      const { data: items } = await DB.invoiceItems().select('*').eq('invoice_id', id);

      // إرجاع كل صنف للمخزون (الكمية المباشرة + التراجع عن batch الـ FIFO الأصلي)
      if (items?.length) {
        await Promise.all(items.map(async item => {
          if (!item.inventory_id) return;
          const { data: prod } = await DB.inventory().select('quantity').eq('id', item.inventory_id).maybeSingle();
          if (prod) {
            await DB.inventory().update({ quantity: prod.quantity + item.quantity }).eq('id', item.inventory_id);
          }
        }));
      }

      // التراجع عن استهلاك FIFO (يرجّع الكمية لنفس الدفعات الأصلية بدقة محاسبية)
      try { await FIFOService.reverseFIFO(id); } catch (fifoErr) {
        console.warn('FIFO reverse (non-critical):', fifoErr.message);
      }

      // حذف أصناف الفاتورة، ثم الفاتورة نفسها
      await DB.invoiceItems().delete().eq('invoice_id', id);
      await DB.invoices().delete().eq('id', id);

      Notify.success('تم الحذف وإرجاع الكمية للمخزون');
      await Invoices.load();
      const invSvc = getInventory(); if (invSvc) await invSvc.loadList();
    } catch (err) {
      Notify.error('فشل الحذف: ' + err.message);
    } finally {
      setTimeout(() => { State.isMutating = false; }, 500);
    }
  },
};

export { Invoices };
