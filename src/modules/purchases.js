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

  _renderRows(data) {
    const STATUS = { cash:{l:'كاش ✓',c:'sl',t:'s'}, transfer:{l:'تحويل',c:'pl',t:'p'}, defer:{l:'آجل',c:'wl',t:'w'} };
    DOM.setHTML('purlist', (data || []).length
      ? data.map(p => {
          const st = STATUS[p.payment_status] || STATUS.cash;
          const initials = (p.supplier || '؟').trim().slice(0, 2);
          const remaining = p.remaining > 0
            ? '<div style="font-size:10px;color:var(--d);margin-top:2px;">متبقي: ₪' + p.remaining.toFixed(2) + '</div>'
            : '';
          return `<div class="pur-card">
            <div class="pur-card-top">
              <div class="pur-supplier">
                <div class="pur-avatar">${Utils.escape(initials)}</div>
                <div style="min-width:0;">
                  <div class="pur-sname">${Utils.escape(p.supplier)}</div>
                  ${p.supplier_phone ? '<a href="tel:' + p.supplier_phone + '" class="pur-sphone">' + Utils.escape(p.supplier_phone) + '</a>' : ''}
                </div>
              </div>
              <div>
                <span class="pur-status" style="background:var(--${st.c});color:var(--${st.t});">${st.l}</span>
                ${remaining}
              </div>
            </div>
            <div class="pur-product-row">
              <span class="pur-product-name">📦 ${Utils.escape(p.product_name)}</span>
              <span class="pur-product-qty">${p.quantity} وحدة</span>
            </div>
            <div class="pur-grid2">
              <div class="pur-stat"><div class="pur-stat-label">التكلفة</div><div class="pur-stat-val">₪${p.cost.toFixed(2)}</div></div>
              <div class="pur-stat"><div class="pur-stat-label">سعر البيع</div><div class="pur-stat-val" style="color:var(--p);">${p.sale_price ? '₪' + p.sale_price.toFixed(2) : '-'}</div></div>
            </div>
            <div class="pur-footer">
              <span>${p.purchase_date}${p.invoice_ref ? ' · فاتورة #' + Utils.escape(p.invoice_ref) : ''}</span>
              <div class="pur-actions">
                <button class="ibb" onclick="Purchases.openEdit('${p.id}')">تعديل</button>
                <button class="ibr" onclick="Purchases.delete('${p.id}')">حذف</button>
              </div>
            </div>
          </div>`;
        }).join('')
      : '<div class="er" style="padding:30px;text-align:center;color:var(--g5);">لا توجد مشتريات</div>'
    );
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
      const { error } = await DB.purchases().insert({
        store_id: State.user.id, supplier, product_name: productName,
        quantity: qty, cost, purchase_date: DOM.val('pud'),
        supplier_phone: supplierPhone || null,
        invoice_ref:    invoiceNumber || null,
        payment_status: payStatus,
        paid_amount:    paidAmount,
        remaining:      remaining,
      });
      if (error) throw error;

      // ربط المخزون — ابحث عن الصنف بالاسم وأضف الكمية
      const unit = DOM.get('pu-unit')?.value || 'قطعة (pcs)';
      // Use selected inventory ID or search by name
      let existing = null;
      if (invId) {
        const { data } = await DB.inventory().select('id,quantity').eq('id', invId).maybeSingle();
        existing = data;
      }
      if (!existing) {
        const { data } = await DB.inventory().select('id,quantity').eq('name', productName).maybeSingle();
        existing = data;
      }

      let productId = null;
      if (existing) {
        productId = existing.id;
        // صنف موجود — أضف الكمية وحدّث سعر البيع
        await DB.inventory().update({
          quantity:   existing.quantity + qty,
          sale_price: salePrice,
        }).eq('id', existing.id);
        Notify.success('تم — المجموع: ' + (existing.quantity + qty) + ' — سعر البيع: ₪' + salePrice);
      } else {
        // صنف جديد — أنشئه في المخزون
        const { data: newProd } = await DB.inventory().insert({
          store_id:        State.user.id,
          name:            productName,
          category:        'عام',
          unit:            unit,
          quantity:        qty,
          sale_price:      salePrice,
          low_stock_alert: CONFIG.lowStockDefault,
        }).select().single();
        productId = newProd?.id;
        Notify.success('تم — أُضيف "' + productName + '" — سعر البيع: ₪' + salePrice);
      }

      // ── FIFO: أنشئ batch جديد لهاد الشراء ──
      if (productId) {
        const unitCost = qty > 0 ? cost / qty : cost;
        try {
          await FIFOService.addBatch({
            productId,
            quantity:         qty,
            costPrice:        unitCost,
            sellingPrice:     salePrice,
            supplierId:       supplier || null,
            purchaseDate:     DOM.val('pud'),
          });
        } catch (fifoErr) {
          console.warn('FIFO batch creation failed (non-critical):', fifoErr.message);
        }
      }
      // تحديث كاش المخزون
      await getInventory()?.loadList();

      Modal.close('m-pur');
      DOM.clearInputs('pus', 'pup', 'puc');
      DOM.get('pur-inv-sel').value = '';
      const puq = DOM.get('puq'); if (puq) puq.value = '1';
      const puu      = DOM.get('puu');      if (puu)      puu.value      = '';
      const pusPrice = DOM.get('pus-price'); if (pusPrice) pusPrice.value = '';
      const hidden   = DOM.get('pur-inv-sel'); if (hidden) hidden.value = '';
      const badge    = document.getElementById('pur-match-badge'); if (badge) badge.style.display = 'none';
      const sugg     = document.getElementById('pur-suggestions'); if (sugg) sugg.style.display = 'none';
      const phone = DOM.get('pus-phone'); if (phone) phone.value = '';
      const invno = DOM.get('pus-invoice');if (invno) invno.value = '';
      const pud = DOM.get('pud'); if (pud) pud.value = new Date().toISOString().split('T')[0];
      const inp = DOM.get('pup'); if (inp) inp.placeholder = 'اتركه فارغاً لو اخترت من فوق';
      // Reset payment
      Purchases.setPayStatus('cash');
      const paidEl = DOM.get('pur-paid-amount'); if (paidEl) paidEl.value = '';
      const remEl  = DOM.get('pur-remaining');   if (remEl)  remEl.value  = '';
      await getInventory().load();
      await Purchases.load();
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
    const salePrice = parseFloat(document.getElementById('edit-pur-sale-price').value) || null;
    const date      = document.getElementById('edit-pur-date').value;

    if (!supplier) { Notify.error('أدخل اسم المورد'); return; }
    if (!cost || cost <= 0) { Notify.error('أدخل التكلفة'); return; }

    try {
      const phone = document.getElementById('edit-pur-phone').value.trim();
      const invno = document.getElementById('edit-pur-invoice').value.trim();
      const { error } = await DB.purchases().update({
        supplier, product_name: product, quantity: qty, cost, purchase_date: date,
        supplier_phone: phone || null,
        invoice_ref:    invno || null,
        sale_price:     salePrice,
      }).eq('id', id);
      if (error) throw error;

      // تحديث سعر البيع في المخزون
      if (salePrice) {
        const { data: inv } = await DB.inventory().select('id').eq('name', product).maybeSingle();
        if (inv) await DB.inventory().update({ sale_price: salePrice }).eq('id', inv.id);
      }

      Notify.success('تم التعديل');
      window.Modal.close('m-edit-pur');
      await Purchases.load();
    } catch(err) { Notify.error(err.message); }
  },

  async delete(id) {
    if (!confirm('حذف؟')) return;
    await DB.purchases().delete().eq('id', id);
    Notify.success('تم');
    await Purchases.load();
  },
};

export { Purchases };
