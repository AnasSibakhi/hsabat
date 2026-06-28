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
  // إغلاق ذكي تلقائي — القوائم المنبثقة لبحث الزبائن مصمَّمة عمداً خارج الموديلات
  // (لمشاكل z-index)، فلا تُغلَق تلقائياً مع الموديل. نضمن إغلاقها هنا بمكان واحد،
  // يحمي كل الموديلات الحالية والمستقبلية من تسريب القائمة المنبثقة بعد الإغلاق
  document.querySelectorAll('.cust-suggest-dropdown').forEach(dd => { dd.style.display = 'none'; });
};

/** Initialize click-outside-to-close behavior */
export const init = () => {
  document.querySelectorAll('.mo').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(overlay.id);
    });
  });
};
