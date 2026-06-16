/**
 * db.js — Database Layer
 * 
 * sb      → للعمليات العامة (auth, realtime)
 * sbAdmin → للـ Super Admin فقط (app_accounts, stores)
 * apiDB   → لكل عمليات المحل — يمر بـ /api/db على السيرفر
 *           الـ serviceKey يبقى على السيرفر فقط
 */

import { createClient } from '@supabase/supabase-js';
import { CONFIG }       from '../config/constants.js';
import { State }        from './state.js';

// للـ realtime والـ auth العادي
export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// للـ Super Admin فقط — لا يُستخدم لعمليات المحل
export const sbAdmin = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey, {
  auth: {
    autoRefreshToken:   false,
    persistSession:     false,
    detectSessionInUrl: false,
    storageKey:         'hesabat-admin-client',
  },
});

/**
 * apiDB — يرسل الطلبات لـ /api/db على Vercel
 * الـ serviceKey يبقى على السيرفر فقط ✅
 */
async function apiCall(table, action, payload = {}) {
  const storeId = State.user?.id ?? '';
  const res = await fetch('/api/db', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-store-id':   storeId,
    },
    body: JSON.stringify({ table, action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'API error');
  return json;
}

/**
 * storeTable — نفس الـ interface القديم بس يمر بـ /api/db
 * كل الكود الموجود يشتغل بدون تغيير
 */
function storeTable(table) {
  // Builder pattern — يبني الـ query ثم ينفذه
  return {
    select: (...selectArgs) => {
      const selectStr = selectArgs[0] || '*';
      let _filters = {};
      let _order   = null;
      let _limit   = null;
      let _offset  = null;
      let _gte     = null;
      let _in      = null;
      let _gt      = null;

      const builder = {
        eq:    (col, val)  => { _filters[col] = val; return builder; },
        gte:   (col, val)  => { _gte = { col, val }; return builder; },
        gt:    (col, val)  => { _gt  = { col, val }; return builder; },
        in:    (col, vals) => { _in  = { col, vals }; return builder; },
        order: (col, opts) => { _order = { column: col, ascending: opts?.ascending ?? true }; return builder; },
        limit:  (n)        => { _limit  = n; return builder; },
        offset: (n)        => { _offset = n; return builder; },
        single:() => builder.then(r => ({ data: r.data?.[0] ?? null, error: null })),
        maybeSingle: () => builder.then(r => ({ data: r.data?.[0] ?? null, error: null })),
        then:  (resolve, reject) => {
          return apiCall(table, 'select', {
            select:  selectStr,
            filters: _filters,
            order:   _order,
            limit:   _limit,
            offset:  _offset,
            gte:     _gte,
            gt:      _gt,
            in:      _in,
          }).then(r => resolve({ data: r.data, error: null })).catch(e => {
            if (reject) reject(e);
            else return { data: null, error: { message: e.message } };
          });
        },
      };
      return builder;
    },

    insert: (data) => {
      const builder = {
        select: () => builder,
        single: () => builder.then(r => ({ data: r.data?.[0] ?? null, error: null })),
        then: (resolve, reject) => {
          return apiCall(table, 'insert', { data })
            .then(r => resolve({ data: r.data, error: null }))
            .catch(e => { if (reject) reject(e); else return { data: null, error: { message: e.message } }; });
        },
      };
      return builder;
    },

    update: (data) => {
      let _filters = {};
      const builder = {
        eq:   (col, val) => { _filters[col] = val; return builder; },
        then: (resolve, reject) => {
          return apiCall(table, 'update', { data, filters: _filters })
            .then(r => resolve({ data: r.data, error: null }))
            .catch(e => { if (reject) reject(e); else return { data: null, error: { message: e.message } }; });
        },
      };
      return builder;
    },

    delete: () => {
      let _filters = {};
      const builder = {
        eq:   (col, val) => { _filters[col] = val; return builder; },
        then: (resolve, reject) => {
          return apiCall(table, 'delete', { filters: _filters })
            .then(r => resolve({ data: r.data, error: null }))
            .catch(e => { if (reject) reject(e); else return { data: null, error: { message: e.message } }; });
        },
      };
      return builder;
    },

    // Shortcuts
    eq:  (col, val) => storeTable(table).select('*').eq(col, val),
    gte: (col, val) => storeTable(table).select('*').gte(col, val),
  };
}

export const DB = {
  customers:    () => storeTable('customers'),
  debts:        () => storeTable('debts'),
  invoices:     () => storeTable('invoices'),
  invoiceItems: () => storeTable('invoice_items'),
  inventory:    () => storeTable('inventory'),
  purchases:    () => storeTable('purchases'),
  netCardStock: () => storeTable('net_cards_stock'),
  netCardSales: () => storeTable('net_card_sales'),
  expenses:     () => storeTable('expenses'),
  returns:      () => storeTable('returns'),

  // FIFO
  inventoryBatches: () => storeTable('inventory_batches'),
  saleAllocations:  () => storeTable('sale_inventory_allocations'),

  // Admin only — لا تستخدم للمحلات
  accounts:      () => sbAdmin.from('app_accounts'),
  stores:        () => sbAdmin.from('stores'),
  notifications: () => sbAdmin.from('notifications'),
};
