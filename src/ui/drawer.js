/**
 * drawer.js — Bottom Sheet Navigation
 */

import { State } from '../core/state.js';

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
  if (!overlay || !drawer) return;

  // حدّث اسم المحل والصاحب
  const nameEl  = document.getElementById('bs-store-name');
  const ownerEl = document.getElementById('bs-owner-name');
  if (nameEl  && State.user?.store_name) nameEl.textContent  = State.user.store_name;
  if (ownerEl && State.user?.owner)      ownerEl.textContent = State.user.owner;

  overlay.style.display = 'block';
  drawer.style.display  = 'block';

  // animation من الأسفل
  requestAnimationFrame(() => {
    drawer.style.transform = 'translateY(0)';
  });
}

export function closeDrawer() {
  const overlay = document.getElementById('mobile-drawer-overlay');
  const drawer  = document.getElementById('mobile-drawer');
  if (!drawer) return;

  drawer.style.transform = 'translateY(100%)';
  setTimeout(() => {
    overlay.style.display = 'none';
    drawer.style.display  = 'none';
  }, 280);
}

// تسجيل على window
window.openAddMenu  = openAddMenu;
window.closeAddMenu = closeAddMenu;
window.openDrawer   = openDrawer;
window.closeDrawer  = closeDrawer;
