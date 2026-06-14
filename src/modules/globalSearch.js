/**
 * globalSearch.js — بحث شامل عن الأسماء
 */
import { sb }    from '../core/db.js';
import { State } from '../core/state.js';
import * as Utils from '../core/utils.js';

let _timer = null;

export const GlobalSearch = {

  open() {
    const overlay = document.getElementById('global-search-overlay');
    const input   = document.getElementById('global-search-input');
    if (overlay) overlay.style.display = 'block';
    document.getElementById('global-search-results').innerHTML = '';
    setTimeout(() => input?.focus(), 100);
  },

  close() {
    const overlay = document.getElementById('global-search-overlay');
    if (overlay) overlay.style.display = 'none';
    const input = document.getElementById('global-search-input');
    if (input) input.value = '';
    document.getElementById('global-search-results').innerHTML = '';
  },

  search(val) {
    clearTimeout(_timer);
    const res = document.getElementById('global-search-results');
    if (!val.trim()) { res.innerHTML = ''; return; }
    // debounce 300ms
    _timer = setTimeout(() => GlobalSearch._fetch(val.trim()), 300);
  },

  async _fetch(q) {
    const res = document.getElementById('global-search-results');
    res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--g4);font-size:13px;"><span class="spin">↻</span></div>';

    const store = State.user.id;

    // بحث في كل المصادر معاً
    const [custRes, invRes, purRes, debtRes] = await Promise.all([
      // الزبائن
      sb.from('customers').select('id,name,phone').eq('store_id', store).ilike('name', `%${q}%`).limit(5),
      // الفواتير (اسم المشتري)
      sb.from('invoices').select('id,invoice_number,buyer_name,buyer_phone,total,invoice_date').eq('store_id', store).ilike('buyer_name', `%${q}%`).limit(5),
      // المشتريات (اسم المورد)
      sb.from('purchases').select('id,supplier,supplier_phone,cost,purchase_date').eq('store_id', store).ilike('supplier', `%${q}%`).limit(5),
      // الديون
      sb.from('debts').select('id,amount,paid,debt_date,customers(name,phone)').eq('store_id', store).eq('archived', false).limit(20),
    ]);

    const results = [];

    // الزبائن
    (custRes.data || []).forEach(c => {
      results.push({
        type: 'زبون', icon: '👤', color: '#6366f1',
        name: c.name, sub: c.phone || '',
        action: `Nav.goTo('debts')`,
      });
    });

    // الفواتير
    (invRes.data || []).filter(i => i.buyer_name).forEach(i => {
      results.push({
        type: 'فاتورة', icon: '🧾', color: '#0ea5e9',
        name: i.buyer_name, sub: `${i.invoice_number} · ₪${i.total?.toFixed(2)} · ${i.invoice_date}`,
        action: `Nav.goTo('invoices')`,
      });
    });

    // الموردين
    (purRes.data || []).forEach(p => {
      results.push({
        type: 'مورد', icon: '🏭', color: '#f59e0b',
        name: p.supplier, sub: `${p.supplier_phone || ''} · ₪${p.cost?.toFixed(2)} · ${p.purchase_date}`,
        action: `Nav.goTo('purchases')`,
      });
    });

    // الديون - فلتر بالاسم
    const ql = q.toLowerCase();
    (debtRes.data || []).filter(d => d.customers?.name?.toLowerCase().includes(ql)).forEach(d => {
      const rem = d.amount - (d.paid || 0);
      if (rem <= 0) return;
      results.push({
        type: 'دين', icon: '💰', color: '#dc2626',
        name: d.customers.name, sub: `متبقي ₪${rem.toFixed(2)} · ${d.debt_date}`,
        action: `Nav.goTo('debts')`,
      });
    });

    if (!results.length) {
      res.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--g4);font-size:13px;">لا توجد نتائج لـ "${Utils.escape(q)}"</div>`;
      return;
    }

    res.innerHTML = results.map(r => `
      <div onclick="${r.action};GlobalSearch.close()" style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--g1);cursor:pointer;border-radius:8px;" onmouseover="this.style.background='var(--g0)'" onmouseout="this.style.background=''">
        <div style="width:38px;height:38px;border-radius:10px;background:${r.color}18;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${r.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:#1e293b;font-size:14px;">${Utils.escape(r.name)}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Utils.escape(r.sub)}</div>
        </div>
        <span style="font-size:10px;font-weight:700;color:${r.color};background:${r.color}18;padding:3px 8px;border-radius:6px;">${r.type}</span>
      </div>
    `).join('');
  },
};
