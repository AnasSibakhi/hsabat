/**
 * nav.js — Navigation Module
 */
import { State } from '../core/state.js';

const _loaders = {};
export const register = (pageId, fn) => { _loaders[pageId] = fn; };

export const go = (pageId, activeElement = null) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));

  const content = document.getElementById('main-content');
  if (content) {
    if (pageId === 'quicksale') {
      content.classList.add('qs-mode');
    } else {
      content.classList.remove('qs-mode');
      content.scrollTop = 0;
    }
  }

  document.getElementById('page-' + pageId)?.classList.add('active');
  if (activeElement) activeElement.classList.add('active');
  State.currentPage = pageId;

  const loader = _loaders[pageId];
  if (loader) loader();
};

export const goTo = (pageId) => {
  go(pageId);
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('bn-' + pageId)?.classList.add('active');
};
