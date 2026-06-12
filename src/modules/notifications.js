/**
 * notifications.js — User Notifications
 */
import { sb }     from '../core/db.js';
import { State }  from '../core/state.js';
import * as DOM   from '../core/dom.js';
import { escape } from '../core/utils.js';

let _open = false;

export const Notifications = {

  async load() {
    if (!State.user?.id) return;

    const today = new Date().toISOString().split('T')[0];

    const [notifsRes, debtsRes, inventoryRes, purchasesRes] = await Promise.all([
      sb.from('notifications').select('*')
        .or(`store_id.eq.${State.user.id},store_id.is.null`)
        .order('created_at', { ascending: false }).limit(20),
      sb.from('debts').select('*, customers(name)')
        .eq('store_id', State.user.id).eq('archived', false).gt('amount', 0).limit(50),
      sb.from('inventory').select('id,name,quantity,low_stock_alert,unit')
        .eq('store_id', State.user.id),
      sb.from('purchases').select('*')
        .eq('store_id', State.user.id).eq('payment_status', 'defer').gt('remaining', 0),
    ]);

    const auto = [];

    // ١. منتجات نفدت
    (inventoryRes.data || []).filter(i => i.quantity <= 0).forEach(i => {
      auto.push({ id:'out-'+i.id, title:'🔴 نفد المخزون — '+i.name,
        message:'المنتج نفد تماماً — يرجى إعادة التوريد فوراً',
        created_at:today+'T00:00:00', read_at:null, _type:'out' });
    });

    // ٢. قاربت النفاد
    (inventoryRes.data || []).filter(i => i.quantity > 0 && i.quantity <= (i.low_stock_alert || 5)).forEach(i => {
      auto.push({ id:'low-'+i.id, title:'🟡 قارب النفاد — '+i.name,
        message:'المتبقي: '+i.quantity+' '+(i.unit||'')+' — الحد: '+(i.low_stock_alert||5),
        created_at:today+'T00:00:00', read_at:null, _type:'low' });
    });

    // ٣. ديون الزبائن المتأخرة
    (debtsRes.data || []).filter(d => {
      const rem  = d.amount - (d.paid || 0);
      const days = Math.floor((new Date(today) - new Date(d.debt_date)) / 86400000);
      return rem > 0 && days >= 2;
    }).forEach(d => {
      const name = d.customers?.name || 'زبون';
      const days = Math.floor((new Date(today) - new Date(d.debt_date)) / 86400000);
      const rem  = d.amount - (d.paid || 0);
      auto.push({ id:'debt-'+d.id, title:'⏰ دين متأخر — '+name,
        message:'متأخر '+days+' يوم · ₪'+rem.toFixed(2),
        created_at:d.debt_date+'T00:00:00', read_at:null, _type:'debt' });
    });

    // ٤. موعد سداد اقترب (خلال يومين)
    (debtsRes.data || []).filter(d => {
      if (!d.remind_date) return false;
      const rem  = d.amount - (d.paid || 0);
      const days = Math.floor((new Date(d.remind_date) - new Date(today)) / 86400000);
      return rem > 0 && days >= 0 && days <= 2;
    }).forEach(d => {
      const name  = d.customers?.name || 'زبون';
      const rem   = d.amount - (d.paid || 0);
      const days  = Math.floor((new Date(d.remind_date) - new Date(today)) / 86400000);
      const label = days === 0 ? 'اليوم' : 'خلال '+days+' يوم';
      auto.push({ id:'remind-'+d.id, title:'📅 موعد سداد — '+name,
        message:'موعد السداد '+label+' · ₪'+rem.toFixed(2),
        created_at:today+'T12:00:00', read_at:null, _type:'remind' });
    });

    // ٥. ديون الموردين المتأخرة
    (purchasesRes.data || []).filter(p => {
      const days = Math.floor((new Date(today) - new Date(p.purchase_date)) / 86400000);
      return days >= 3;
    }).forEach(p => {
      const days = Math.floor((new Date(today) - new Date(p.purchase_date)) / 86400000);
      auto.push({ id:'supdebt-'+p.id, title:'🏭 دين مورد — '+p.supplier,
        message:'متأخر '+days+' يوم · المتبقي: ₪'+(p.remaining||0).toFixed(2),
        created_at:p.purchase_date+'T00:00:00', read_at:null, _type:'supplier' });
    });

    const all = [...auto, ...(notifsRes.data||[])].sort(
      (a,b) => new Date(b.created_at) - new Date(a.created_at)
    );

    Notifications._render(all);

    const unread = all.filter(n => !n.read_at).length;
    const badge  = DOM.get('notif-badge');
    if (badge) {
      badge.style.display = unread > 0 ? 'block' : 'none';
      badge.style.background = auto.some(n => n._type === 'out') ? '#dc2626' : '#f59e0b';
    }
  },


  _render(items) {
    const list = DOM.get('notif-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--g4);font-size:13px;">لا توجد إشعارات</div>';
      return;
    }
    list.innerHTML = items.map(n => {
      const date    = new Date(n.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
      const time    = new Date(n.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      const unread  = !n.read_at;
      return `
        <div onclick="Notifications.open('${n.id}')" style="
          padding:12px 14px;border-bottom:1px solid var(--g1);cursor:pointer;
          background:${unread ? 'var(--pl)' : '#fff'};
          display:flex;gap:10px;align-items:flex-start;
          transition:.1s;
        " onmouseover="this.style.background='var(--g0)'" onmouseout="this.style.background='${unread ? 'var(--pl)' : '#fff'}'">
          <div style="width:8px;height:8px;border-radius:50%;background:${unread ? 'var(--p)' : 'transparent'};flex-shrink:0;margin-top:5px;"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:${unread ? '800' : '600'};color:var(--g9);margin-bottom:2px;">${escape(n.title)}</div>
            <div style="font-size:11px;color:var(--g5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escape(n.message || '')}</div>
            <div style="font-size:10px;color:var(--g4);margin-top:4px;">${date} · ${time}</div>
          </div>
        </div>`;
    }).join('');
  },

  toggle() {
    const dd = DOM.get('notif-dropdown');
    if (!dd) return;
    _open = !_open;
    dd.style.display = _open ? 'block' : 'none';
    if (_open) Notifications.load();
    // Close on outside click
    if (_open) {
      setTimeout(() => {
        document.addEventListener('click', Notifications._outsideClick, { once: true });
      }, 50);
    }
  },

  _outsideClick(e) {
    const dd = DOM.get('notif-dropdown');
    const btn = dd?.previousElementSibling;
    if (dd && !dd.contains(e.target) && !btn?.contains(e.target)) {
      dd.style.display = 'none';
      _open = false;
    }
  },

  async open(id) {
    // Mark as read
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
    await Notifications.load();
  },

  async markAllRead() {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    await Notifications.load();
  },
};
