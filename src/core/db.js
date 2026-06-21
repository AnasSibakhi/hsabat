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

// ── استدعاء عام لكل الجداول المتبقية عبر Edge Function موحّدة آمنة ──
async function callStoreDB(table, action, params) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('غير مسجّل دخول');

  const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/store-db`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization':  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ table, action, params }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'فشل الاتصال بالخدمة');
  return json.data;
}

// ── Query builder آمن — نفس الواجهة المتسلسلة المستخدمة بالموقع بالضبط، لكل الجداول المتبقية ──
function secureStoreTable(table) {
  return {
    select: (columns) => {
      const filters = [];
      let orderSpec = null, limitSpec = null, offsetSpec = null;
      const b = {
        eq:  (c, v) => { filters.push({ op: 'eq',  col: c, val: v }); return b; },
        gt:  (c, v) => { filters.push({ op: 'gt',  col: c, val: v }); return b; },
        gte: (c, v) => { filters.push({ op: 'gte', col: c, val: v }); return b; },
        in:  (c, v) => { filters.push({ op: 'in',  col: c, val: v }); return b; },
        order: (c, o) => { orderSpec = { col: c, ascending: o?.ascending !== false }; return b; },
        limit: (n)    => { limitSpec = n; return b; },
        offset: (n)   => { offsetSpec = n; return b; },
        single:      () => callStoreDB(table, 'select', { columns, filters, order: orderSpec, limit: limitSpec, offset: offsetSpec, single: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        maybeSingle: () => callStoreDB(table, 'select', { columns, filters, order: orderSpec, limit: limitSpec, offset: offsetSpec, maybeSingle: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        then: (resolve, reject) => {
          // دعم نمط count: select('*', { count: 'exact', head: true })
          const isCountQuery = typeof columns === 'object' && columns?.count === 'exact';
          const action = isCountQuery
            ? callStoreDB(table, 'select', { filters, countOnly: true })
            : callStoreDB(table, 'select', { columns, filters, order: orderSpec, limit: limitSpec, offset: offsetSpec });
          return action
            .then(data => resolve(isCountQuery ? { count: data.count, error: null } : { data, error: null }))
            .catch(error => (reject ? reject(error) : resolve({ data: null, error, count: null })));
        },
      };
      return b;
    },

    insert: (rowOrRows) => {
      const isArray = Array.isArray(rowOrRows);
      const promise = isArray
        ? callStoreDB(table, 'insert', { rows: rowOrRows })
        : callStoreDB(table, 'insert', { row: rowOrRows });
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
          return { then: (resolve, reject) => callStoreDB(table, 'update', { changes, filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callStoreDB(table, 'update', { changes, filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    delete: () => {
      const filters = [];
      const b = {
        eq: (c, v) => {
          filters.push({ op: 'eq', col: c, val: v });
          return { then: (resolve, reject) => callStoreDB(table, 'delete', { filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callStoreDB(table, 'delete', { filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    eq:  (c, v) => secureStoreTable(table).select('*').eq(c, v),
    gte: (c, v) => secureStoreTable(table).select('*').gte(c, v),
    gt:  (c, v) => secureStoreTable(table).select('*').gt(c, v),
  };
}

export const DB = {
  customers:        () => secureStoreTable('customers'),
  debts:            () => secureStoreTable('debts'),
  invoices:         () => secureStoreTable('invoices'),
  invoiceItems:     () => secureStoreTable('invoice_items'),
  inventory:        () => secureInventoryTable(),
  purchases:        () => secureStoreTable('purchases'),
  netCardStock:     () => secureStoreTable('net_cards_stock'),
  netCardSales:     () => secureStoreTable('net_card_sales'),
  expenses:         () => secureStoreTable('expenses'),
  returns:          () => secureStoreTable('returns'),
};
