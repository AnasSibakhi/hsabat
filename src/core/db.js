/**
 * db.js — Database Layer
 * Single place for all Supabase client interactions
 */

import { createClient } from '@supabase/supabase-js';
import { CONFIG }       from '../config/constants.js';
import { State }        from './state.js';

// Public client — uses anon key + Supabase Auth session automatically
export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// Admin client — service role, bypasses RLS
// Used ONLY for admin operations
export const sbAdmin = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey, {
  auth: {
    autoRefreshToken:   false,
    persistSession:     false,
    detectSessionInUrl: false,
    storageKey:         'hesabat-admin-client',
  },
});

/**
 * DB — auto-scoped query builder
 * Uses sbAdmin to bypass RLS for store queries
 * (since we handle auth ourselves via app_accounts)
 */
export const DB = {
  // Use sbAdmin to bypass RLS — auth is handled via app_accounts
  _store: (table) => sbAdmin.from(table).eq('store_id', State.user?.id ?? ''),

  customers:    () => DB._store('customers'),
  debts:        () => DB._store('debts'),
  invoices:     () => DB._store('invoices'),
  invoiceItems: () => sbAdmin.from('invoice_items'),
  inventory:    () => DB._store('inventory'),
  purchases:    () => DB._store('purchases'),
  netCardStock: () => DB._store('net_cards_stock'),
  netCardSales: () => DB._store('net_card_sales'),
  expenses:     () => DB._store('expenses'),
  returns:      () => DB._store('returns'),

  // Admin tables
  accounts:      () => sbAdmin.from('app_accounts'),
  stores:        () => sbAdmin.from('stores'),
  notifications: () => sbAdmin.from('notifications'),
};
