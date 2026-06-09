/**
 * nav.js — Navigation Module
 * Manages page switching and loader registration
 */

import { State } from '../core/state.js';

const _loaders = {};

/** Register a page loader function */
export const register = (pageId, loaderFn) => {
  _loaders[pageId] = loaderFn;
};

/** Navigate to a page */
export const go = (pageId, activeElement = null) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));

  document.getElementById('page-' + pageId)?.classList.add('active');
  if (activeElement) activeElement.classList.add('active');

  State.currentPage = pageId;
  _loaders[pageId]?.();
};

/** Navigate via bottom nav */
export const goTo = (pageId) => {
  go(pageId);
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('bn-' + pageId)?.classList.add('active');
};
