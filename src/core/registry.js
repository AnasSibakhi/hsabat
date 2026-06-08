/**
 * registry.js — Module Registry
 * Breaks circular dependencies by providing late-bound module references
 * All modules register themselves here after initialization
 */

const _modules = {};

export const Registry = {
  register: (name, module) => { _modules[name] = module; },
  get: (name) => _modules[name],
};

// Convenience getters
export const getDashboard  = () => _modules['Dashboard'];
export const getDebts      = () => _modules['Debts'];
export const getInvoices   = () => _modules['Invoices'];
export const getInventory  = () => _modules['Inventory'];
export const getCustomers  = () => _modules['Customers'];
export const getPurchases  = () => _modules['Purchases'];
