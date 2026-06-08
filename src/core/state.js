/**
 * state.js — Single source of truth for app state
 * All modules read/write state through this object
 * No global variables anywhere else
 */

import { ROLES } from '../config/constants.js';

export const State = {
  user:         null,   // Current account object from app_accounts
  role:         null,   // ROLES constant
  customers:    [],     // Cached customer list
  inventory:    [],     // Cached inventory list
  currentPage:  'home',
  isMutating:   false,  // Prevents realtime double-updates during local saves

  // ── Role helpers ──
  isAdmin()    { return this.role === ROLES.SUPERADMIN; },
  isOwner()    { return this.role === ROLES.OWNER || this.role === ROLES.SUPERADMIN; },
  isEmployee() { return this.role === ROLES.EMPLOYEE; },
  canDelete()  { return this.isOwner(); },

  /** Reset all state on logout */
  reset() {
    this.user        = null;
    this.role        = null;
    this.customers   = [];
    this.inventory   = [];
    this.currentPage = 'home';
    this.isMutating  = false;
  },

  /** Wrap any mutation — sets isMutating flag to block realtime double-updates */
  async mutate(fn) {
    this.isMutating = true;
    try {
      await fn();
    } finally {
      setTimeout(() => { this.isMutating = false; }, 500);
    }
  },
};
