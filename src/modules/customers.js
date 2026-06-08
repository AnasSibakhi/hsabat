/**
 * customers.js — Customers Module
 * All customer-related operations
 */

import { DB }          from '../core/db.js';
import { State }       from '../core/state.js';
import { Notify }      from '../core/notify.js';
import * as DOM        from '../core/dom.js';
import { escape }      from '../core/utils.js';
import * as Modal      from '../nav/modal.js';

export const Customers = {
  /** Load all customers into State.customers cache */
  async loadAll() {
    const { data } = await DB.customers().select('*').order('name');
    State.customers = data ?? [];
    Customers.fillSelects();
  },

  /** Load and render customers table */
  async loadTable() {
    const { data } = await DB.customers().select('*,debts(amount,paid)').order('name');
    Customers._render(data ?? []);
  },

  /** Filter customers by search query */
  filter(query) {
    const q = query.toLowerCase();
    Customers._render(
      State.customers.filter(c =>
        c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)
      )
    );
  },

  _render(list) {
    DOM.setHTML('clist', list.length
      ? list.map((c, i) => {
          const debt = (c.debts ?? []).reduce((s, d) => s + (d.amount - d.paid), 0);
          return `<tr>
            <td>${i + 1}</td>
            <td>${escape(c.name)}</td>
            <td>${escape(c.phone ?? '-')}</td>
            <td>${debt > 0 ? `<span class="br">₪${debt.toFixed(2)}</span>` : '<span class="bg">₪0</span>'}</td>
            <td><button class="ibb" onclick="Customers.showStatement('${c.id}','${escape(c.name)}')">كشف</button></td>
            <td><button class="ibr" onclick="Customers.delete('${c.id}')">حذف</button></td>
          </tr>`;
        }).join('')
      : '<tr class="er"><td colspan="6">لا يوجد زبائن</td></tr>'
    );
  },

  /** Fill customer dropdowns in modals */
  fillSelects() {
    const forDebt    = '<option value="">-- اختر الزبون --</option>'
      + State.customers.map(c => `<option value="${c.id}">${escape(c.name)}</option>`).join('');
    const forInvoice = '<option value="">-- زبون عادي --</option>'
      + State.customers.map(c => `<option value="${c.id}">${escape(c.name)}</option>`).join('')
      + '<option value="__new__">➕ زبون جديد...</option>';

    DOM.setHTML('dc',      forDebt);
    DOM.setHTML('ic',      forInvoice);
    DOM.setHTML('qs-cust', forDebt);
  },

  toggleNewFields(select) {
    DOM.toggle('new-cust-wrap', 'hidden', select.value !== '__new__');
  },

  /** Save a new customer */
  async save() {
    const name = DOM.val('cn');
    if (!name) { Notify.error('يرجى إدخال الاسم'); return; }

    await State.mutate(async () => {
      const { error } = await DB.customers().insert({
        store_id: State.user.id,
        name,
        phone:   DOM.val('cph'),
        address: DOM.val('cad'),
        notes:   DOM.val('cno'),
      });
      if (error) throw error;
      Notify.success('تم إضافة الزبون');
      Modal.close('m-customer');
      DOM.clearInputs('cn', 'cph', 'cad', 'cno');
      await Customers.loadAll();
      Customers.loadTable();
    });
  },

  /** Delete a customer */
  async delete(id) {
    if (!confirm('حذف هذا الزبون؟')) return;
    await State.mutate(async () => {
      await DB.customers().delete().eq('id', id);
      Notify.success('تم الحذف');
      await Customers.loadAll();
      Customers.loadTable();
    });
  },

  /** Create a customer inline (called from Invoices/QuickSale) */
  async createInline(name, phone) {
    const { data, error } = await DB.customers().insert({
      store_id: State.user.id, name, phone: phone ?? '',
    }).select().single();
    if (error) throw error;
    return data;
  },

  /** Show account statement modal */
  async showStatement(customerId, name) {
    DOM.setText('stmttitle', 'كشف حساب — ' + name);
    DOM.setHTML('stmtbody', '<div style="text-align:center;padding:1.5rem;"><span class="spin">↻</span></div>');
    Modal.open('m-stmt');

    const [{ data: debts }, { data: invoices }] = await Promise.all([
      DB.sb?.from('debts').select('*').eq('customer_id', customerId).order('debt_date')
        ?? import('../core/db.js').then(m => m.sb.from('debts').select('*').eq('customer_id', customerId).order('debt_date')),
      DB.sb?.from('invoices').select('*').eq('customer_id', customerId).order('invoice_date')
        ?? import('../core/db.js').then(m => m.sb.from('invoices').select('*').eq('customer_id', customerId).order('invoice_date')),
    ]);

    const totalDebt = (debts ?? []).reduce((s, d) => s + (d.amount - d.paid), 0);
    let html = `<div style="display:flex;justify-content:space-between;background:var(--g0);border-radius:8px;padding:10px 14px;margin-bottom:1rem;font-size:13px;">
      <span>إجمالي الدين:</span><strong style="color:var(--d);">₪${totalDebt.toFixed(2)}</strong>
    </div>`;

    if (!debts?.length && !invoices?.length) {
      html += '<p style="text-align:center;color:var(--g4);padding:1rem;">لا توجد معاملات</p>';
    } else {
      html += `<table class="dt" style="font-size:12px;">
        <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>`;
      (invoices ?? []).forEach(inv => {
        html += `<tr><td>${inv.invoice_date}</td><td>${inv.invoice_number ?? 'فاتورة'}</td><td>₪${inv.total.toFixed(2)}</td><td>-</td></tr>`;
      });
      (debts ?? []).forEach(d => {
        if (d.paid > 0) html += `<tr><td>${d.debt_date}</td><td>دفعة</td><td>-</td><td style="color:var(--s);">₪${d.paid.toFixed(2)}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    DOM.setHTML('stmtbody', html);
  },

  printStatement() {
    const content = DOM.get('stmtbody')?.innerHTML ?? '';
    const title   = DOM.get('stmttitle')?.textContent ?? '';
    const w = window.open('', '_blank');
    w.document.write(`<html dir="rtl"><head><title>${title}</title>
      <style>body{font-family:Arial;padding:20px;direction:rtl;}table{width:100%;border-collapse:collapse;}
      th,td{border:1px solid #ddd;padding:8px;text-align:right;}th{background:#f5f5f5;}</style></head>
      <body><h2>${title}</h2>${content}</body></html>`);
    w.document.close();
    w.print();
  },
};
