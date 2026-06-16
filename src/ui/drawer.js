/**
 * drawer.js — Mobile Drawer + Add Menu UI
 * مستخرج من index.html inline script
 */

export function openAddMenu() {
  document.getElementById('add-menu-overlay').style.display = 'block';
  document.getElementById('add-menu').style.display         = 'block';
}

export function closeAddMenu() {
  document.getElementById('add-menu-overlay').style.display = 'none';
  document.getElementById('add-menu').style.display         = 'none';
}

export function openDrawer() {
  const overlay = document.getElementById('mobile-drawer-overlay');
  const drawer  = document.getElementById('mobile-drawer');
  overlay.style.display = 'block';
  drawer.style.display  = 'block';
  setTimeout(() => drawer.classList.add('open'), 10);
}

export function closeDrawer() {
  const overlay = document.getElementById('mobile-drawer-overlay');
  const drawer  = document.getElementById('mobile-drawer');
  drawer.classList.remove('open');
  setTimeout(() => {
    overlay.style.display = 'none';
    drawer.style.display  = 'none';
  }, 250);
}

// تسجيل الدوال على window حتى تشتغل من onclick في HTML
window.openAddMenu  = openAddMenu;
window.closeAddMenu = closeAddMenu;
window.openDrawer   = openDrawer;
window.closeDrawer  = closeDrawer;
