/**
 * invoices.js — Invoice Management Dashboard
 */

import { DB }     from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM   from '../core/dom.js';
import { sb }     from '../core/db.js';
import * as Utils from '../core/utils.js';
import { escape, currency } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal from '../nav/modal.js';
import { getCustomers, getDebts, getInventory, getDashboard } from '../core/registry.js';

// ── State ──
let _allInvoices  = [];
let _filtered     = [];
let _period       = 'all';
let _page         = 1;
const PAGE_SIZE   = 20;

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
    Invoices.resetForm();
    // Auto-focus على حقل البحث
    setTimeout(() => {
      const s = DOM.get('inv-prod-search');
      if (s) s.focus();
    }, 300);
  },

  // ── Product Search ──
  onSearchKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = DOM.val('inv-prod-search').trim();
      if (!val) return;
      // Try exact barcode match first
      const exact = (State.inventory||[]).find(p => p.barcode === val && p.quantity > 0);
      if (exact) {
        Invoices.addProductById(exact.id);
        return;
      }
      // Otherwise add first result
      const first = (State.inventory||[]).find(p =>
        p.quantity > 0 && (p.name.toLowerCase().includes(val.toLowerCase()) || (p.barcode||'').includes(val))
      );
      if (first) {
        Invoices.addProductById(first.id);
      } else {
        Notify.error('المنتج غير موجود');
        DOM.get('inv-prod-search').select();
      }
    }
  },

  searchProduct(val) {
    const dd = DOM.get('inv-prod-dropdown');
    if (!val.trim()) { dd.style.display = 'none'; return; }
    const q = val.trim().toLowerCase();
    const matches = (State.inventory || []).filter(p =>
      p.quantity > 0 && (p.name.toLowerCase().includes(q) || (p.barcode||'').includes(q))
    ).slice(0, 8);
    if (!matches.length) { dd.innerHTML = '<div class="inv-prod-opt" style="color:var(--g4);">لا توجد نتائج</div>'; dd.style.display = 'block'; return; }
    dd.innerHTML = matches.map(p =>
      `<div class="inv-prod-opt" onclick="Invoices.addProductById('${p.id}')">
        <div><div class="inv-prod-opt-name">${escape(p.name)}</div><div class="inv-prod-opt-meta">${p.barcode||''} · ${p.quantity} ${p.unit||'قطعة'}</div></div>
        <div style="font-weight:700;color:var(--p);">₪${p.sale_price?.toFixed(2)||0}</div>
      </div>`
    ).join('');
    dd.style.display = 'block';
  },

  addProductById(id) {
    const p = (State.inventory||[]).find(i => i.id === id);
    if (!p) return;
    // Check if already in list
    const existing = document.querySelector(`#inv-items-list .inv-item-row[data-pid="${id}"]`);
    if (existing) {
      const qtyInp = existing.querySelector('.inv-qty-inp');
      qtyInp.value = parseInt(qtyInp.value||1) + 1;
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
              <input class="inv-qty-inp" type="number" value="1" min="1" max="${p.quantity}" oninput="Invoices.calcTotal()" inputmode="decimal">
              <button class="inv-qty-btn" onclick="Invoices.changeQty(this,1)" type="button">+</button>
            </div>
            <div style="font-size:12px;color:var(--g5);">
              ₪<input class="price-inp" type="number" value="${p.sale_price||0}" min="0" oninput="Invoices.calcTotal()" inputmode="decimal"
               style="width:60px;border:1px solid var(--br);border-radius:6px;padding:3px 5px;font-size:12px;font-family:Cairo,sans-serif;text-align:center;">
            </div>
            <div class="inv-item-total">₪${((p.sale_price||0)).toFixed(2)}</div>
          </div>
        </div>`
      );
    }
    DOM.get('inv-prod-search').value = '';
    DOM.get('inv-prod-dropdown').style.display = 'none';
    Invoices.calcTotal();
    setTimeout(() => DOM.get('inv-prod-search')?.focus(), 100);
  },

  changeQty(btn, delta) {
    const inp = btn.closest('.inv-qty-ctrl').querySelector('.inv-qty-inp');
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
  // ── Load all invoices ──
  async load() {
    const { data } = await DB.invoices().select('*').order('created_at', { ascending: false });
    _allInvoices = data || [];
    Invoices.applyFilters();
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
    const start  = (_page - 1) * PAGE_SIZE;
    const page   = _filtered.slice(start, start + PAGE_SIZE);
    const total  = _filtered.length;
    const pages  = Math.max(1, Math.ceil(total / PAGE_SIZE));

    DOM.setHTML('ilist', page.length
      ? page.map(inv => {
          const buyer    = escape(inv.buyer_name || inv.customer_name || 'عادي');
          const payClass = PAY_CLASS[inv.payment_type] || '';
          const payLabel = PAY_LABELS[inv.payment_type] || inv.payment_type;
          const discount = inv.discount > 0 ? `<span style="color:var(--d);font-size:11px;">-₪${inv.discount.toFixed(2)}</span>` : '<span style="color:var(--g4);">—</span>';
          const itemsCount = inv._items_count ?? '...';
          return `<tr>
            <td><strong style="color:var(--p);">${escape(inv.invoice_number || '-')}</strong></td>
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
                <button class="ibb" onclick="Returns.openModal('${inv.id}','${escape(inv.customer_name || '')}',${inv.total})" style="padding:4px 7px;font-size:11px;">إرجاع</button>
                <button class="inv-del-btn" onclick="Invoices.delete('${inv.id}')"><i class="ti ti-trash"></i></button>
              </div>
            </td>
          </tr>`;
        }).join('')
      : '<tr class="er"><td colspan="8">لا توجد فواتير</td></tr>'
    );

    // Pagination
    const pag = DOM.get('inv-pagination');
    if (pag) {
      const from = total ? start + 1 : 0;
      const to   = Math.min(start + PAGE_SIZE, total);
      pag.innerHTML = `
        <span>${from}–${to} من ${total} فاتورة</span>
        <div class="inv-page-btns">
          <button class="inv-page-btn" onclick="Invoices.goPage(${_page-1})" ${_page<=1?'disabled':''}>‹</button>
          ${Array.from({length:Math.min(pages,5)},(_,i)=>{
            const p = Math.max(1,Math.min(_page-2,pages-4))+i;
            return `<button class="inv-page-btn${p===_page?' active':''}" onclick="Invoices.goPage(${p})">${p}</button>`;
          }).join('')}
          <button class="inv-page-btn" onclick="Invoices.goPage(${_page+1})" ${_page>=pages?'disabled':''}>›</button>
        </div>`;
    }

    // Load items count in background
    Invoices._loadItemsCounts(page.map(i => i.id));
  },

  goPage(p) {
    const pages = Math.ceil(_filtered.length / PAGE_SIZE);
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
    const { data: inv }   = await sb.from('invoices').select('*').eq('id', invId).single();
    const { data: items } = await sb.from('invoice_items').select('*').eq('invoice_id', invId);
    if (!inv) { Notify.error('تعذّر تحميل الفاتورة'); return; }

    const payLabel  = PAY_LABELS[inv.payment_type] || inv.payment_type;
    const payClass  = PAY_CLASS[inv.payment_type]  || '';
    const totalQty  = (items || []).reduce((s, i) => s + i.quantity, 0);
    const itemsHtml = (items || []).map(it =>
      `<tr>
        <td>${escape(it.product_name || '-')}</td>
        <td style="text-align:center;">${it.quantity}</td>
        <td style="text-align:left;">₪${parseFloat(it.price).toFixed(2)}</td>
        <td style="text-align:left;font-weight:700;">₪${(it.quantity * it.price).toFixed(2)}</td>
      </tr>`
    ).join('') || '<tr><td colspan="4" style="color:var(--g4);">لا توجد منتجات</td></tr>';

    DOM.setHTML('inv-details-body', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1rem;">
        <div class="inv-det-row"><span>رقم الفاتورة</span><strong>${escape(inv.invoice_number || '-')}</strong></div>
        <div class="inv-det-row"><span>التاريخ والوقت</span><strong>${inv.invoice_date} ${inv.sale_time || ''}</strong></div>
        <div class="inv-det-row"><span>اسم المشتري</span><strong>${escape(inv.buyer_name || inv.customer_name || '-')}</strong></div>
        <div class="inv-det-row"><span>رقم الجوال</span><strong>${escape(inv.buyer_phone || '-')}</strong></div>
        <div class="inv-det-row"><span>طريقة الدفع</span><strong><span class="inv-pay-badge ${payClass}">${payLabel}</span></strong></div>
        ${inv.transfer_entity_name ? `<div class="inv-det-row"><span>جهة التحويل</span><strong>${escape(inv.transfer_entity_name)}</strong></div>` : ''}
      </div>
      <table class="dt" style="margin-bottom:.75rem;">
        <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="background:var(--g0);border-radius:10px;padding:12px;font-size:13px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--g5);">
          <span>إجمالي الأصناف</span><span>${(items||[]).length} صنف · ${totalQty} قطعة</span>
        </div>
        ${inv.discount > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--d);"><span>خصم</span><span>-₪${inv.discount.toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:16px;margin-top:6px;padding-top:6px;border-top:1px solid var(--br);">
          <span>الإجمالي النهائي</span><span>₪${inv.total.toFixed(2)}</span>
        </div>
      </div>
    `);
    Modal.open('m-inv-details');
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
    const srch = DOM.get('inv-prod-search'); if (srch) srch.value = '';
    const dd   = DOM.get('inv-prod-dropdown'); if (dd) dd.style.display = 'none';
    Invoices._discType = 'fixed';
    const btn = DOM.get('inv-disc-toggle'); if (btn) btn.textContent = '₪';
  },

  addItem() {},

  _collectItems() {
    const items = []; let subtotal = 0;
    document.querySelectorAll('#iitems .ii').forEach(row => {
      const select = row.querySelector('.prod-sel');
      const qty    = parseFloat(row.querySelector('.qty-inp')?.value) || 0;
      const price  = parseFloat(row.querySelector('.price-inp')?.value) || 0;
      const invId  = select?.value || '';
      const name   = select?.options[select?.selectedIndex]?.getAttribute('data-name') || 'منتج';
      if (qty > 0 && price > 0) { items.push({ product_name: name, inventory_id: invId||null, quantity: qty, price }); subtotal += qty * price; }
    });
    return { items, subtotal };
  },

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
      if (customerId === '__new__') {
        const newName = DOM.val('inv-new-name');
        if (!newName) { Notify.error('أدخل اسم الزبون الجديد'); return; }
        const newCustomer = await getCustomers().createInline(newName, DOM.val('inv-new-phone'));
        customerId = newCustomer.id; customerName = newName; customerPhone = DOM.val('inv-new-phone');
        await getCustomers().loadAll();
      } else if (customerId) {
        const found = State.customers.find(c => c.id === customerId);
        customerName = found?.name || ''; customerPhone = found?.phone || '';
      }

      const invoiceNumber = await Invoices._generateInvoiceNumber();
      const { data: invoice, error } = await DB.invoices().insert({
        store_id: State.user.id, customer_id: customerId||null,
        customer_name: customerName, customer_phone: customerPhone,
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
