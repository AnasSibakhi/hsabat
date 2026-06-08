/**
 * db.js — Database Layer
 */

import { createClient } from '@supabase/supabase-js';
import { CONFIG }       from '../config/constants.js';
import { State }        from './state.js';

// Public client — anon key
export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// Admin client — service role, bypasses RLS
export const sbAdmin = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey, {
  auth: {
    autoRefreshToken:   false,
    persistSession:     false,
    detectSessionInUrl: false,
    storageKey:         'hesabat-admin-client',
  },
});

/**
 * DB — scoped query builder
 * Returns a function chain: sb.from(table).eq('store_id', id)
 * Caller must add .select() / .insert() etc.
 */
export const DB = {
  // Returns query scoped to current store
  // Usage: DB.customers().select('*') — NOT DB.customers().eq(...)
  _store: (table) => {
    const storeId = State.user?.id ?? '';
    return {
      select:  (...args) => sbAdmin.from(table).eq('store_id', storeId).select(...args),
      insert:  (data)    => sbAdmin.from(table).insert(data),
      update:  (data)    => sbAdmin.from(table).eq('store_id', storeId).update(data),
      delete:  ()        => sbAdmin.from(table).eq('store_id', storeId).delete(),
      // Allow chaining filters
      eq:      (col, val) => sbAdmin.from(table).eq('store_id', storeId).eq(col, val),
      gte:     (col, val) => sbAdmin.from(table).eq('store_id', storeId).gte(col, val),
      lte:     (col, val) => sbAdmin.from(table).eq('store_id', storeId).lte(col, val),
    };
  },

  customers:    () => sbAdmin.from('customers').eq('store_id', State.user?.id ?? ''),
  debts:        () => sbAdmin.from('debts').eq('store_id', State.user?.id ?? ''),
  invoices:     () => sbAdmin.from('invoices').eq('store_id', State.user?.id ?? ''),
  invoiceItems: () => sbAdmin.from('invoice_items'),
  inventory:    () => sbAdmin.from('inventory').eq('store_id', State.user?.id ?? ''),
  purchases:    () => sbAdmin.from('purchases').eq('store_id', State.user?.id ?? ''),
  netCardStock: () => sbAdmin.from('net_cards_stock').eq('store_id', State.user?.id ?? ''),
  netCardSales: () => sbAdmin.from('net_card_sales').eq('store_id', State.user?.id ?? ''),
  expenses:     () => sbAdmin.from('expenses').eq('store_id', State.user?.id ?? ''),
  returns:      () => sbAdmin.from('returns').eq('store_id', State.user?.id ?? ''),

  // Admin tables
  accounts:      () => sbAdmin.from('app_accounts'),
  stores:        () => sbAdmin.from('stores'),
  notifications: () => sbAdmin.from('notifications'),
};
