/**
 * db.js — Database Layer
 * sb      → للعمليات العادية
 * sbAdmin → للـ Super Admin فقط
 * storeTable → كل عمليات المحل مع RLS
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

// كل عمليات المحل — RLS في Supabase تحمي البيانات
function storeTable(table) {
  const base = () => sbAdmin.from(table).eq('store_id', State.user?.id ?? '');

  return {
    select: (cols = '*') => {
      let q = sbAdmin.from(table).select(cols).eq('store_id', State.user?.id ?? '');
      const builder = {
        eq:          (c, v)  => { q = q.eq(c, v);                                    return builder; },
        gte:         (c, v)  => { q = q.gte(c, v);                                   return builder; },
        gt:          (c, v)  => { q = q.gt(c, v);                                    return builder; },
        in:          (c, vs) => { q = q.in(c, vs);                                   return builder; },
        order:       (c, o)  => { q = q.order(c, o);                                 return builder; },
        limit:       (n)     => { q = q.limit(n);                                    return builder; },
        offset:      (n)     => { q = q.range(n, n + 49);                            return builder; },
        single:      ()      => q.single(),
        maybeSingle: ()      => q.maybeSingle(),
        then:        (res, rej) => q.then(res, rej),
      };
      return builder;
    },

    insert: (data) => {
      const d = Array.isArray(data)
        ? data.map(x => ({ ...x, store_id: State.user?.id }))
        : { ...data, store_id: State.user?.id };
      let q = sbAdmin.from(table).insert(d);
      return {
        select:      ()      => { q = q.select(); return { single: () => q.single(), then: (r, j) => q.then(r, j) }; },
        single:      ()      => q.select().single(),
        then:        (r, j)  => q.then(r, j),
      };
    },

    update: (data) => {
      let q = sbAdmin.from(table).update(data).eq('store_id', State.user?.id ?? '');
      return {
        eq:   (c, v) => { q = q.eq(c, v); return { then: (r, j) => q.then(r, j) }; },
        then: (r, j) => q.then(r, j),
      };
    },

    delete: () => {
      let q = sbAdmin.from(table).delete().eq('store_id', State.user?.id ?? '');
      return {
        eq:   (c, v) => { q = q.eq(c, v); return { then: (r, j) => q.then(r, j) }; },
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
  inventory:        () => storeTable('inventory'),
  purchases:        () => storeTable('purchases'),
  netCardStock:     () => storeTable('net_cards_stock'),
  netCardSales:     () => storeTable('net_card_sales'),
  expenses:         () => storeTable('expenses'),
  returns:          () => storeTable('returns'),
  inventoryBatches: () => storeTable('inventory_batches'),
  saleAllocations:  () => storeTable('sale_inventory_allocations'),

  // Admin only
  accounts:      () => sbAdmin.from('app_accounts'),
  stores:        () => sbAdmin.from('stores'),
  notifications: () => sbAdmin.from('notifications'),
};
