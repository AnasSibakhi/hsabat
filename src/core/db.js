/**
 * db.js — Database Layer
 * 
 * Supabase JS v2 API:
 *   sb.from(table).select().eq()   ✅
 *   sb.from(table).eq()            ❌ — eq must come AFTER select/insert/update/delete
 *
 * Solution: each DB method returns a scoped builder object
 * that injects store_id filter into every operation.
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

/** 
 * Scoped table helper — automatically adds store_id to every query
 * Usage: DB.customers().select('*').order('name')
 *        DB.customers().select('*,debts(amount,paid)').order('name')
 *        DB.customers().insert({...})
 *        DB.customers().update({...}).eq('id', id)
 *        DB.customers().delete().eq('id', id)
 */
function storeTable(table) {
  const storeId = () => State.user?.id ?? '';
  return {
    select:  (...args) => sbAdmin.from(table).select(...args).eq('store_id', storeId()),
    insert:  (data)    => sbAdmin.from(table).insert(data),
    update:  (data)    => sbAdmin.from(table).update(data).eq('store_id', storeId()),
    delete:  ()        => sbAdmin.from(table).delete().eq('store_id', storeId()),
    // Shortcuts for common filter chains
    eq:      (col, val) => sbAdmin.from(table).select().eq('store_id', storeId()).eq(col, val),
    gte:     (col, val) => sbAdmin.from(table).select().eq('store_id', storeId()).gte(col, val),
  };
}

export const DB = {
  customers:    () => storeTable('customers'),
  debts:        () => storeTable('debts'),
  invoices:     () => storeTable('invoices'),
  invoiceItems: () => sbAdmin.from('invoice_items'),
  inventory:    () => storeTable('inventory'),
  purchases:    () => storeTable('purchases'),
  netCardStock: () => storeTable('net_cards_stock'),
  netCardSales: () => storeTable('net_card_sales'),
  expenses:     () => storeTable('expenses'),
  returns:      () => storeTable('returns'),

  // Admin (no store scope)
  accounts:      () => sbAdmin.from('app_accounts'),
  stores:        () => sbAdmin.from('stores'),
  notifications: () => sbAdmin.from('notifications'),
};
