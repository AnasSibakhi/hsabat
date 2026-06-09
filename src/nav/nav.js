/**
 * nav.js — Navigation Module
 */
import { State } from '../core/state.js';

const _loaders = {};
export const register = (pageId, fn) => { _loaders[pageId] = fn; };

export const go = (pageId, activeElement = null) => {
  // Hide ALL pages including quicksale
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));

  const content = document.getElementById('main-content');
  const qsPage  = document.getElementById('page-quicksale');

  if (pageId === 'quicksale') {
    // POS mode: flex layout
    if (content) {
      content.style.overflow      = 'hidden';
      content.style.padding       = '0';
      content.style.display       = 'flex';
      content.style.flexDirection = 'column';
    }
    // Show quicksale as flex
    if (qsPage) {
      qsPage.classList.add('active');
      qsPage.style.display       = 'flex';
      qsPage.style.flexDirection = 'column';
      qsPage.style.flex          = '1';
      qsPage.style.minHeight     = '0';
      qsPage.style.overflow      = 'hidden';
    }
  } else {
    // Normal mode: restore content
    if (content) {
      content.style.overflow      = '';
      content.style.padding       = '';
      content.style.display       = '';
      content.style.flexDirection = '';
    }
    // quicksale hidden via .page (no active class)
    document.getElementById('page-' + pageId)?.classList.add('active');
  }

  if (activeElement) activeElement.classList.add('active');
  State.currentPage = pageId;
  _loaders[pageId]?.();
};

export const goTo = (pageId) => {
  go(pageId);
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('bn-' + pageId)?.classList.add('active');
};
