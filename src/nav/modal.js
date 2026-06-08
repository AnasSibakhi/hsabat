/**
 * modal.js — Modal Management
 * All modal open/close logic in one place
 */

/** Open a modal by ID */
export const open = (id) => {
  document.getElementById(id)?.classList.add('open');

  // Side effects per modal — lazy loaded to avoid circular deps
  if (id === 'm-debt' || id === 'm-invoice') {
    import('../modules/customers.js').then(m => m.Customers.fillSelects());
  }
  if (id === 'm-pur') {
    import('../modules/purchases.js').then(m => m.Purchases.fillInventorySelect());
  }
};

/** Close a modal by ID */
export const close = (id) => {
  document.getElementById(id)?.classList.remove('open');
};

/** Initialize click-outside-to-close behavior */
export const init = () => {
  document.querySelectorAll('.mo').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
};
