/**
 * db.js — Database Layer
 * Single place for all Supabase client interactions
 * All queries auto-scoped to current store via State
 */

import { createClient } from '@supabase/supabase-js';
import { CONFIG }       from '../config/constants.js';
import { State }        from './state.js';

// Public client — uses anon key, respects RLS
export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// Admin client — uses service role, bypasses RLS
// Used ONLY for admin operations (create/delete stores, link auth_id)
export const sbAdmin = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey, {
  auth: {
    autoRefreshToken:  false,
    persistSession:    false,
    detectSessionInUrl: false,
    storageKey:        'hesabat-admin-client',
  },
});

/**
 * DB — auto-scoped query builder
 * Usage: DB.customers().select('*').order('name')
 */
export const DB = {
  /** Returns a query builder scoped to current store */
  _store: (table) => sb.from(table).eq('store_id', State.user?.id ?? ''),

  // ── Public tables (store-scoped) ──
  customers:    () => DB._store('customers'),
  debts:        () => DB._store('debts'),
  invoices:     () => DB._store('invoices'),
  invoiceItems: () => sb.from('invoice_items'),
  inventory:    () => DB._store('inventory'),
  purchases:    () => DB._store('purchases'),
  netCardStock: () => DB._store('net_cards_stock'),
  netCardSales: () => DB._store('net_card_sales'),
  expenses:     () => DB._store('expenses'),
  returns:      () => DB._store('returns'),

  // ── Admin tables (no store scope) ──
  accounts:      () => sbAdmin.from('app_accounts'),
  stores:        () => sbAdmin.from('stores'),
  notifications: () => sb.from('notifications'),
};
