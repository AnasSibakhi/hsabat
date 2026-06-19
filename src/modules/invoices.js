/**
 * invoices.js — Invoice Management Dashboard
 */

import { DB, sb } from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM   from '../core/dom.js';
import * as Utils from '../core/utils.js';
import { escape, currency } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal from '../nav/modal.js';
import { getCustomers, getDebts, getInventory, getDashboard, getQuickSale } from '../core/registry.js';

// ── State ──
let _allInvoices  = [];
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
      sb.from('customers').select('id,name,phone').eq('store_id', State.user.id).order('name')
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
      const { data } = await sb.from('customers').select('id,name,phone').eq('store_id', State.user.id).order('name');
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
      `<div class="dc-opt" data-id="${c.id}" onclick="Invoices.selectCustomerById(this.dataset.id)">
        ${escape(c.name)}${c.phone ? ' — '+c.phone : ''}
      </div>`
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
      sb.from('customers').select('id,name,phone').eq('store_id', State.user.id).order('name')
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
      `<div class="dc-opt" data-id="${c.id}" onclick="Invoices.selectCustomerById(this.dataset.id)">
        <b>${escape(c.name)}</b>${c.phone ? ' — ' + c.phone : ''}
      </div>`
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
    // Check if already in list
    const existing = document.querySelector(`#inv-items-list .inv-item-row[data-pid="${id}"]`);
    if (existing) {
      const qtyInp = existing.querySelector('.inv-qty-inp');
      qtyInp.value = parseInt(qtyInp.value||1) + initialQty;
      Invoices.calcTotal();
    } else {
      const list = DOM.get('inv-items-list');
      list.insertAdjacentHTML('beforeend', `
        <div class="inv-item-row" data-pid="${p.id}" data-price="${p.sale_price||0}">
          <div class="inv-item-top">
            <div class="inv-item-name">${escape(p.name)}</div>
            <button class="inv-del-row" onclick="this.closest('.inv-item-row').remove();Invoices.calcTotal()" type="button">✕</button>
          </div>
          <div class="inv-item-bottom">
            <div class="inv-item-ctrl">
              <button class="inv-qty-btn" onclick="Invoices.changeQty(this,-1)" type="button">−</button>
              <input class="inv-qty-inp" type="number" value="${initialQty}" min="1" max="${p.quantity}" oninput="Invoices.calcTotal()" inputmode="decimal">
              <button class="inv-qty-btn" onclick="Invoices.changeQty(this,1)" type="button">+</button>
            </div>
            <div style="font-size:12px;color:var(--g5);">
              ₪<input class="price-inp" type="number" value="${p.sale_price||0}" min="0" oninput="Invoices.calcTotal()" inputmode="decimal"
               style="width:60px;border:1px solid var(--br);border-radius:6px;padding:3px 5px;font-size:12px;font-family:Cairo,sans-serif;text-align:center;">
            </div>
            <div class="inv-item-total">₪${((p.sale_price||0) * initialQty).toFixed(2)}</div>
          </div>
        </div>`
      );
    }
    Invoices.calcTotal();
  },

  changeQty(btn, delta) {
    const inp = btn.closest('.inv-item-ctrl').querySelector('.inv-qty-inp');
    const max = parseInt(inp.max) || 9999;
    const val = Math.min(max, Math.max(1, (parseInt(inp.value)||1) + delta));
    inp.value = val;
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
      const price = parseFloat(row.dataset.price) || parseFloat(row.querySelector('.price-inp')?.value) || 0;
      const qty   = parseFloat(row.querySelector('.inv-qty-inp')?.value) || 0;
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
      const qty   = parseFloat(row.querySelector('.inv-qty-inp')?.value) || 0;
      const price = parseFloat(row.querySelector('.price-inp')?.value) || parseFloat(row.dataset.price) || 0;
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
    const [invRes, retRes] = await Promise.all([
      DB.invoices()
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
        .offset(offset),
      // جلب IDs الفواتير المُرجَعة
      DB.returns().select('invoice_id'),
    ]);

    // بناء Set من IDs المُرجَعة للبحث السريع
    const returnedIds = new Set((retRes.data || []).map(r => r.invoice_id));

    _allInvoices = (invRes.data || []).map(inv => ({
      ...inv,
      _returned: returnedIds.has(inv.id),
    }));

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
  _renderTable() {
    const start  = (_page - 1) * UI_SIZE;
    const page   = _filtered.slice(start, start + UI_SIZE);
    const total  = _filtered.length;
    const pages  = Math.max(1, Math.ceil(total / UI_SIZE));

    DOM.setHTML('ilist', page.length
      ? page.map(inv => {
          const buyer    = escape(inv.buyer_name || inv.customer_name || 'عادي');
          const payClass = PAY_CLASS[inv.payment_type] || '';
          const payLabel = PAY_LABELS[inv.payment_type] || inv.payment_type;
          const discount = inv.discount > 0 ? `<span style="color:var(--d);font-size:11px;">-₪${inv.discount.toFixed(2)}</span>` : '<span style="color:var(--g4);">—</span>';
          const isReturned = inv._returned;
          return `<tr${isReturned ? ' style="opacity:0.7;"' : ''}>
            <td>
              <strong style="color:var(--p);">${escape(inv.invoice_number || '-')}</strong>
              ${isReturned ? '<br><span class="br" style="font-size:10px;">مُرجَعة</span>' : ''}
            </td>
            <td>
              <div style="font-weight:600;">${buyer}</div>
              ${inv.buyer_phone ? `<div style="font-size:11px;color:var(--g5);">${escape(inv.buyer_phone)}</div>` : ''}
            </td>
            <td>
              <div>${inv.invoice_date}</div>
              <div style="font-size:11px;color:var(--g4);">${inv.sale_time || ''}</div>
            </td>
            <td><span class="inv-items-badge" id="ic-${inv.id}">—</span></td>
            <td>${discount}</td>
            <td><strong>₪${inv.total.toFixed(2)}</strong></td>
            <td><span class="inv-pay-badge ${payClass}">${payLabel}</span></td>
            <td>
              <div class="inv-actions">
                <button class="inv-action-btn" onclick="Invoices.openDetails('${inv.id}')"><i class="ti ti-eye"></i> عرض</button>
                ${!isReturned ? `<button class="ibb" onclick="Returns.openModal('${inv.id}','${escape(inv.buyer_name || inv.customer_name || '')}',${inv.total})" style="padding:4px 7px;font-size:11px;">إرجاع</button>` : '<span style="font-size:11px;color:var(--g4);">مُرجَعة</span>'}
                <button class="inv-del-btn" onclick="Invoices.delete('${inv.id}')"><i class="ti ti-trash"></i></button>
              </div>
            </td>
          </tr>`;
        }).join('')
      : '<tr class="er"><td colspan="8">لا توجد فواتير</td></tr>'
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
    const { data } = await sb.from('invoice_items')
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
    const [{ data: inv }, { data: items }, { data: retData }] = await Promise.all([
      sb.from('invoices').select('*').eq('id', invId).single(),
      sb.from('invoice_items').select('*').eq('invoice_id', invId),
      sb.from('returns').select('*').eq('store_id', State.user?.id).eq('invoice_id', invId).maybeSingle(),
    ]);
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
      `طريقة الدفع: ${payLabel}`
    );
    const waUrl = phone ? `https://wa.me/${phone.replace(/[^0-9]/g,'')}?text=${waMsg}` : `https://wa.me/?text=${waMsg}`;

    DOM.setHTML('inv-details-body', `
      <!-- معلومات الإرجاع لو موجودة -->
      ${ret ? `
      <div style="background:var(--dl);border-radius:12px;padding:12px;margin-bottom:12px;border:1px solid #fecaca;">
        <div style="font-size:13px;font-weight:800;color:var(--d);margin-bottom:8px;">⚠️ هذه الفاتورة مُرجَعة</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);margin-bottom:4px;">
          <span>تاريخ الإرجاع</span><strong>${ret.return_date}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);margin-bottom:4px;">
          <span>مبلغ الإرجاع</span><strong>₪${ret.amount?.toFixed(2)}</strong>
        </div>
        ${ret.buyer_name ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);margin-bottom:4px;"><span>الزبون</span><strong>${escape(ret.buyer_name)}</strong></div>` : ''}
        ${ret.notes ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--d);"><span>ملاحظات</span><strong>${escape(ret.notes)}</strong></div>` : ''}
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
      <button class="btn btn-o" style="width:100%;justify-content:center;margin-top:8px;" onclick="Modal.close('m-inv-details');Returns.openModal('${invId}','${escape(inv.buyer_name || inv.customer_name || '')}',${inv.total})">
        <i class="ti ti-arrow-back-up"></i> إرجاع هذه الفاتورة
      </button>` : ''}
    `);
    Modal.open('m-inv-details');
  },

  // ── Print Invoice ──
  printInvoice(invId) {
    sb.from('invoices').select('*').eq('id', invId).single().then(({ data: inv }) => {
      sb.from('invoice_items').select('*').eq('invoice_id', invId).then(({ data: items }) => {
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
  body{font-family:'Cairo',Arial,sans-serif;margin:0;padding:16px;font-size:13px;color:#111;max-width:320px;margin:auto;}
  .store-name{font-size:18px;font-weight:900;text-align:center;margin-bottom:4px;}
  .inv-num{text-align:center;color:#666;font-size:12px;margin-bottom:12px;border-bottom:1px dashed #ccc;padding-bottom:8px;}
  .info-row{display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px;}
  table{width:100%;border-collapse:collapse;margin:10px 0;}
  th{background:#f5f5f5;padding:6px 8px;font-size:11px;text-align:right;border-bottom:1px solid #ddd;}
  td{padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:12px;}
  .total-row{font-size:15px;font-weight:900;display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #111;margin-top:8px;}
  .footer{text-align:center;font-size:11px;color:#999;margin-top:12px;border-top:1px dashed #ccc;padding-top:8px;}
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

  async _generateInvoiceNumber() {
    const { count } = await DB.invoices().select('*', { count: 'exact', head: true });
    return 'INV-' + String((count||0)+1).padStart(4,'0');
  },

  async save() {
    const { items, subtotal } = Invoices._collectItems();
    if (!items.length) { Notify.error('أضف منتجاً على الأقل'); return; }
    if (!subtotal && subtotal !== 0) { Notify.error('تحقق من أسعار المنتجات'); return; }

    const globalDisc  = parseFloat(DOM.val('idiscount')) || 0;
    const itemsDisc   = items.reduce((s, i) => s + (i.discount||0), 0);
    const discount    = globalDisc + itemsDisc;
    const total       = Math.max(0, subtotal - discount);
    const paymentType = document.querySelector('input[name="ip"]:checked')?.value || 'cash';
    const partialPaid = paymentType === PAYMENT.PARTIAL ? (parseFloat(DOM.val('ipartial'))||0) : 0;
    const today       = Utils.today();
    const timeNow     = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });

    let customerId = DOM.val('ic'), customerName = 'زبون عادي', customerPhone = '';
    State.isMutating = true;
    try {
      const searchVal = DOM.val('inv-cust-search')?.trim();

      if (customerId === '__new__' || (!customerId && searchVal)) {
        const newName = DOM.val('inv-new-name') || searchVal;
        if (!newName) { Notify.error('أدخل اسم الزبون'); State.isMutating = false; return; }
        const newCustomer = await getCustomers().createInline(newName, DOM.val('inv-new-phone'));
        customerId = newCustomer.id; customerName = newName; customerPhone = DOM.val('inv-new-phone') || newCustomer.phone || '';
      } else if (customerId) {
        const found = State.customers.find(c => c.id === customerId);
        customerName = found?.name || searchVal || ''; customerPhone = found?.phone || '';
      }

      const invoiceNumber = await Invoices._generateInvoiceNumber();
      const { data: invoice, error } = await DB.invoices().insert({
        store_id: State.user.id, customer_id: customerId||null,
        customer_name: customerName, customer_phone: customerPhone,
        buyer_name: customerName, buyer_phone: customerPhone,
        total, subtotal, discount, payment_type: paymentType,
        partial_paid: partialPaid, invoice_date: today,
        sale_time: timeNow, invoice_number: invoiceNumber,
        notes: DOM.val('inotes'),
      }).select().single();
      if (error) throw error;

      await sb.from('invoice_items').insert(items.map(it => ({ ...it, invoice_id: invoice.id })));
      await getInventory().deductItems(items);

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
    } finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async delete(id) {
    if (!confirm('حذف الفاتورة؟')) return;
    State.isMutating = true;
    try { await DB.invoices().delete().eq('id', id); Notify.success('تم الحذف'); Invoices.load(); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },
};

export { Invoices };
