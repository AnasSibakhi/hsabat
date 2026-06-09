/**
 * nav.js — Navigation Module
 * Clean, simple, no hacks
 */
import { State } from '../core/state.js';

const _loaders = {};
export const register = (pageId, fn) => { _loaders[pageId] = fn; };

export const go = (pageId, activeElement = null) => {
  // 1. Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));

  // 2. Toggle quicksale mode on content
  const content = document.getElementById('main-content');
  if (content) {
    if (pageId === 'quicksale') {
      content.classList.add('qs-active');
    } else {
      content.classList.remove('qs-active');
    }
  }

  // 3. Show current page
  document.getElementById('page-' + pageId)?.classList.add('active');
  if (activeElement) activeElement.classList.add('active');

  State.currentPage = pageId;
  _loaders[pageId]?.();
};

export const goTo = (pageId) => {
  go(pageId);
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('bn-' + pageId)?.classList.add('active');
};
