/**
 * realtime.js — Supabase Realtime Sync
 * Registers handlers per table — debounced to prevent double updates
 */

import { sb }      from '../core/db.js';
import { State }   from '../core/state.js';
import { debounce } from '../core/utils.js';

let _channel  = null;
const _handlers = {};

/** Register a debounced handler for a table change event */
export const on = (table, fn, ms = 800) => {
  _handlers[table] = debounce(fn, ms);
};

/** Start listening — called after login */
export const start = () => {
  if (!State.user) return;
  stop();

  _channel = sb.channel('store-' + State.user.id);

  Object.entries(_handlers).forEach(([table, handler]) => {
    _channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      if (State.isMutating) return; // Skip if we triggered the change locally
      handler();
    });
  });

  _channel.subscribe();
};

/** Stop listening — called on logout */
export const stop = () => {
  if (_channel) {
    sb.removeChannel(_channel);
    _channel = null;
  }
};

export const Realtime = { on, start, stop };
