/**
 * nav.js — Navigation Module
 */

import { State } from '../core/state.js';

const _loaders = {};

export const register = (pageId, loaderFn) => { _loaders[pageId] = loaderFn; };

export const go = (pageId, activeElement = null) => {
  // Hide all regular pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));

  const content = document.getElementById('main-content');
  const qsPage  = document.getElementById('page-quicksale');

  if (pageId === 'quicksale') {
    // POS mode: hide .content scroll, show quicksale
    if (content) {
      content.style.overflow      = 'hidden';
      content.style.display       = 'flex';
      content.style.flexDirection = 'column';
      content.style.padding       = '0';
    }
    if (qsPage) qsPage.classList.add('active');
  } else {
    // Normal mode: restore .content
    if (content) {
      content.style.overflow      = '';
      content.style.display       = '';
      content.style.flexDirection = '';
      content.style.padding       = '';
    }
    if (qsPage) qsPage.classList.remove('active');
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
