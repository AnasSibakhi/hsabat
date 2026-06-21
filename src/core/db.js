/**
 * db.js - Database Layer
 */

import { createClient } from '@supabase/supabase-js';
import { CONFIG }       from '../config/constants.js';
import { State }        from './state.js';

export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

export const sbAdmin = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey, {
  auth: {
    autoRefreshToken:   false,
    persistSession:     false,
    detectSessionInUrl: false,
    storageKey:         'hesabat-admin-client',
  },
});

// ── استدعاء عام لجدول inventory عبر Edge Function آمنة ──
async function callInventoryDB(action, params) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('غير مسجّل دخول');

  const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/inventory-db`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization':  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, params }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'فشل الاتصال بخدمة المخزون');
  return json.data;
}

// ── Query builder آمن لجدول inventory — نفس الواجهة المتسلسلة المستخدمة بالموقع بالضبط ──
function secureInventoryTable() {
  return {
    select: (columns) => {
      const filters = [];
      let orderSpec = null, limitSpec = null;
      const b = {
        eq:  (c, v) => { filters.push({ op: 'eq',  col: c, val: v }); return b; },
        gt:  (c, v) => { filters.push({ op: 'gt',  col: c, val: v }); return b; },
        gte: (c, v) => { filters.push({ op: 'gte', col: c, val: v }); return b; },
        in:  (c, v) => { filters.push({ op: 'in',  col: c, val: v }); return b; },
        order: (c, o) => { orderSpec = { col: c, ascending: o?.ascending !== false }; return b; },
        limit: (n)    => { limitSpec = n; return b; },
        single:      () => callInventoryDB('select', { columns, filters, order: orderSpec, limit: limitSpec, single: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        maybeSingle: () => callInventoryDB('select', { columns, filters, order: orderSpec, limit: limitSpec, maybeSingle: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        then: (resolve, reject) => callInventoryDB('select', { columns, filters, order: orderSpec, limit: limitSpec })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    insert: (row) => {
      const promise = callInventoryDB('insert', { row });
      return {
        select: () => ({
          single: () => promise.then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
          then:   (resolve, reject) => promise.then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
        }),
        single: () => promise.then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        then:   (resolve, reject) => promise.then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
    },

    update: (changes) => {
      const filters = [];
      const b = {
        eq: (c, v) => {
          filters.push({ op: 'eq', col: c, val: v });
          return { then: (resolve, reject) => callInventoryDB('update', { changes, filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callInventoryDB('update', { changes, filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    delete: () => {
      const filters = [];
      const b = {
        eq: (c, v) => {
          filters.push({ op: 'eq', col: c, val: v });
          return { then: (resolve, reject) => callInventoryDB('delete', { filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callInventoryDB('delete', { filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    eq:  (c, v) => secureInventoryTable().select('*').eq(c, v),
    gte: (c, v) => secureInventoryTable().select('*').gte(c, v),
    gt:  (c, v) => secureInventoryTable().select('*').gt(c, v),
  };
}

function storeTable(table) {
  return {
    select: (cols) => {
      let q = sbAdmin.from(table).select(cols || '*').eq('store_id', State.user?.id ?? '');
      const b = {
        eq:          (c, v) => { q = q.eq(c, v);    return b; },
        gte:         (c, v) => { q = q.gte(c, v);   return b; },
        gt:          (c, v) => { q = q.gt(c, v);    return b; },
        in:          (c, v) => { q = q.in(c, v);    return b; },
        order:       (c, o) => { q = q.order(c, o); return b; },
        limit:       (n)    => { q = q.limit(n);    return b; },
        offset:      (n)    => { q = q.range(n, n + 49); return b; },
        single:      ()     => q.single(),
        maybeSingle: ()     => q.maybeSingle(),
        then:        (r, j) => q.then(r, j),
      };
      return b;
    },

    insert: (data) => {
      const d = Array.isArray(data)
        ? data.map(x => ({ ...x, store_id: State.user?.id }))
        : { ...data, store_id: State.user?.id };
      let q = sbAdmin.from(table).insert(d);
      return {
        select:      ()     => { q = q.select(); return { single: () => q.single(), then: (r,j) => q.then(r,j) }; },
        single:      ()     => q.select().single(),
        then:        (r, j) => q.then(r, j),
      };
    },

    update: (data) => {
      let q = sbAdmin.from(table).update(data).eq('store_id', State.user?.id ?? '');
      return {
        eq:   (c, v) => { q = q.eq(c, v); return { then: (r,j) => q.then(r,j) }; },
        then: (r, j) => q.then(r, j),
      };
    },

    delete: () => {
      let q = sbAdmin.from(table).delete().eq('store_id', State.user?.id ?? '');
      return {
        eq:   (c, v) => { q = q.eq(c, v); return { then: (r,j) => q.then(r,j) }; },
        then: (r, j) => q.then(r, j),
      };
    },

    eq:  (c, v) => storeTable(table).select('*').eq(c, v),
    gte: (c, v) => storeTable(table).select('*').gte(c, v),
    gt:  (c, v) => storeTable(table).select('*').gt(c, v),
  };
}

export const DB = {
  customers:        () => storeTable('customers'),
  debts:            () => storeTable('debts'),
  invoices:         () => storeTable('invoices'),
  invoiceItems:     () => storeTable('invoice_items'),
  inventory:        () => secureInventoryTable(),
  purchases:        () => storeTable('purchases'),
  netCardStock:     () => storeTable('net_cards_stock'),
  netCardSales:     () => storeTable('net_card_sales'),
  expenses:         () => storeTable('expenses'),
  returns:          () => storeTable('returns'),
  inventoryBatches: () => storeTable('inventory_batches'),
  saleAllocations:  () => storeTable('sale_inventory_allocations'),
  accounts:         () => sbAdmin.from('app_accounts'),
  stores:           () => sbAdmin.from('stores'),
  notifications:    () => sbAdmin.from('notifications'),
};
