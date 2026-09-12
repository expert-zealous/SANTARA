/* =========================================================
   SANTARA — Core: state, API, realtime socket, UI kit, notifikasi
   ========================================================= */
'use strict';

/* --------------------------------- utils -------------------------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, cls) => `<svg class="ic ${cls || ''}"><use href="#i-${n}"/></svg>`;

const fmt = {
  money(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); },
  moneyShort(n) {
    n = Math.round(Number(n) || 0);
    if (n >= 1e6) return 'Rp ' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'jt';
    if (n >= 1000) return 'Rp ' + Math.round(n / 1000) + 'rb';
    return 'Rp ' + n;
  },
  km(n) { return (Math.round(Number(n || 0) * 100) / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' km'; },
  min(m) { m = Math.max(1, Math.round(Number(m) || 0)); return m + ' mnt'; },
  time(ts) { return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); },
  date(ts) {
    const d = new Date(ts), t = new Date();
    const same = d.toDateString() === t.toDateString();
    const y = new Date(t.getTime() - 86400000);
    if (same) return 'Hari ini, ' + fmt.time(ts);
    if (d.toDateString() === y.toDateString()) return 'Kemarin, ' + fmt.time(ts);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ', ' + fmt.time(ts);
  },
  ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + ' dtk lalu';
    if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    return Math.floor(s / 86400) + ' hari lalu';
  },
  phone(p) { return (p || '').replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3'); }
};

function haversine(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const l1 = a.lat * Math.PI / 180, l2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(l1) * Math.cos(l2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ------------------------------- event bus ------------------------------ */
const Bus = {
  map: {},
  on(ev, fn) { (this.map[ev] = this.map[ev] || []).push(fn); return () => this.off(ev, fn); },
  off(ev, fn) { this.map[ev] = (this.map[ev] || []).filter((f) => f !== fn); },
  emit(ev, data) { (this.map[ev] || []).slice().forEach((f) => { try { f(data); } catch (e) { console.error('bus', ev, e); } }); }
};

/* --------------------------------- state -------------------------------- */
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('santara.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('santara.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('santara.' + k); } catch { } }
};

const S = {
  me: LS.get('me', null),              // {role,id,name,phone,...}
  onboarded: LS.get('onboarded', false),
  settings: { rates: {}, appName: 'SANTARA', tagline: 'Setia Antar Tanpa Ragu', hasGoogleKey: false, googleKey: '' },
  places: [], drivers: [], students: [],
  order: null, offers: [], notifs: LS.get('notifs', []),
  driverLocs: {}, online: false, presence: {},
  loc: null, sound: LS.get('sound', true), vibe: LS.get('vibe', true),
  installEvent: null, swReady: null,
  lastDest: LS.get('lastDest', null)
};

/* ---------------------------------- api --------------------------------- */
const api = {
  async get(path, params) {
    const u = new URL(path.startsWith('http') ? path : path, location.origin);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, v); });
    const r = await fetch(u.toString(), { cache: 'no-store' });
    return r.json();
  },
  async send(method, path, body) {
    const r = await fetch(path, {
      method, headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return r.json();
  },
  post: (p, b) => api.send('POST', p, b),
  put: (p, b) => api.send('PUT', p, b),
  del: (p, b) => api.send('DELETE', p, b),
  action(orderId, action, extra) {
    return api.post('/api/orders/action', Object.assign({ orderId, action, actor: S.me && S.me.role }, extra || {}));
  }
};

/* -------------------------------- socket -------------------------------- */
const Net = {
  ws: null, tries: 0, timer: null, closed: false,
  connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch (e) { return this.retry(); }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0; S.online = true; UI.netbar('online', 'Terhubung');
      setTimeout(() => UI.netbar(null), 1600);
      this.hello();
      Bus.emit('net:online');
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      Realtime.handle(m);
    };
    ws.onclose = () => { S.online = false; UI.netbar('offline', 'Putus · menyambung ulang'); this.retry(); Bus.emit('net:offline'); };
    ws.onerror = () => { try { ws.close(); } catch (_) { } };
  },
  hello() {
    this.send({ t: 'hello', role: S.me ? S.me.role : 'guest', id: S.me ? S.me.id : null, name: S.me ? S.me.name : '' });
  },
  retry() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), Math.min(15000, 800 * Math.pow(1.5, this.tries++)));
  },
  send(obj) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); } catch (e) { } }
};

/* ------------------------------ realtime hub ---------------------------- */
const Realtime = {
  handle(m) {
    switch (m.t) {
      case 'welcome':
        S.settings = Object.assign(S.settings, m.settings || {});
        Bus.emit('settings', S.settings);
        break;
      case 'order': this.setOrder(m.order); break;
      case 'order:new':
        if (S.me && S.me.role === 'driver' && !m.order.driverId) Driver.offer(m.order);
        break;
      case 'drivers': S.drivers = m.drivers || []; Bus.emit('drivers', S.drivers); break;
      case 'driver:loc':
        S.driverLocs[m.driverId] = { lat: m.lat, lng: m.lng, heading: m.heading, ts: Date.now() };
        Bus.emit('driver:loc', m);
        break;
      case 'chat': Bus.emit('chat', m); break;
      case 'notif': this.notif(m.notif); break;
      case 'settings': S.settings = Object.assign(S.settings, m.settings || {}); Bus.emit('settings', S.settings); break;
      case 'presence': S.presence = m.counts || {}; Bus.emit('presence', m.counts); break;
      case 'reset': S.order = null; Bus.emit('reset'); break;
      case 'pong': break;
    }
  },
  setOrder(o) {
    if (!o) return;
    const prev = S.order;
    S.order = o;
    Bus.emit('order', o);
    if (!prev || prev.status !== o.status) Bus.emit('order:status', o);
  },
  notif(n) {
    S.notifs.unshift(n);
    if (S.notifs.length > 40) S.notifs.length = 40;
    LS.set('notifs', S.notifs);
    Bus.emit('notif', n);
    UI.toast({ title: n.title, body: n.body, type: n.type === 'cancelled' ? 'red' : (n.type === 'done' || n.type === 'paid' ? 'green' : 'cyan'), icon: notifIcon(n.type), id: n.id });
    Sound.play(n.type === 'paid' || n.type === 'done' ? 'cash' : 'ding');
    Notify.show(n.title, n.body, { orderId: n.orderId, type: n.type });
    if (S.vibe) { try { navigator.vibrate(n.type === 'bill' ? [90, 60, 90] : 140); } catch (e) { } }
  }
};

function notifIcon(type) {
  return { accepted: 'scooter', arrived: 'pin', start: 'route', bill: 'wallet', paid: 'cash', done: 'check', cancelled: 'x' }[type] || 'bell';
}

/* --------------------------------- sound -------------------------------- */
const Sound = {
  ctx: null,
  ensure() {
    if (!S.sound) return null;
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) { return null; }
  },
  tone(freq, start, dur, type, vol) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, ctx.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.02);
  },
  play(name) {
    if (!S.sound) return;
    if (name === 'ding') { this.tone(880, 0, .18, 'sine', .13); this.tone(1320, .12, .22, 'sine', .10); }
    else if (name === 'cash') { [660, 880, 1180, 1480].forEach((f, i) => this.tone(f, i * .085, .2, 'triangle', .12)); }
    else if (name === 'alert') { for (let i = 0; i < 3; i++) this.tone(1180, i * .22, .16, 'square', .09); }
    else if (name === 'pop') { this.tone(520, 0, .09, 'sine', .12); }
    else if (name === 'ok') { this.tone(740, 0, .12, 'sine', .12); this.tone(1100, .1, .18, 'sine', .1); }
    else if (name === 'err') { this.tone(240, 0, .22, 'sawtooth', .08); }
  }
};

/* ------------------------------ notifications --------------------------- */
const Notify = {
  permission: (typeof Notification !== 'undefined') ? Notification.permission : 'default',
  async ask() {
    if (typeof Notification === 'undefined') return 'unsupported';
    try {
      const p = await Notification.requestPermission();
      this.permission = p; return p;
    } catch (e) { return 'denied'; }
  },
  show(title, body, data) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const reg = S.swReady;
      const opts = {
        body, icon: './icons/icon-192.png', badge: './icons/favicon-64.png',
        tag: (data && data.type) || 'santara', renotify: true,
        vibrate: [120, 60, 120], data: data || {},
        actions: [{ action: 'open', title: 'Buka' }]
      };
      if (reg && reg.showNotification) reg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch (e) { /* ignore */ }
  }
};

/* ----------------------------------- UI --------------------------------- */
const UI = {
  netbar(state, text) {
    const el = $('#netbar'); if (!el) return;
    el.className = 'netbar' + (state ? ' show ' + state : '');
    if (text) $('#netbarText').textContent = text;
  },

  toast(o) {
    const host = $('#toastHost');
    const el = document.createElement('div');
    el.className = 'toast ' + (o.type || '');
    el.innerHTML = `
      <div class="ti">${icon(o.icon || 'bell')}</div>
      <div class="grow"><div class="tt">${esc(o.title)}</div>${o.body ? `<div class="ts">${esc(o.body)}</div>` : ''}</div>`;
    el.addEventListener('click', () => { if (o.onClick) o.onClick(); close(); });
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    host.appendChild(el);
    setTimeout(close, o.timeout || 4200);
    return close;
  },

  sheet(o) {
    const host = $('#sheetHost');
    const wrap = document.createElement('div');
    wrap.className = 'sheet' + (o.full ? ' full' : '');
    wrap.innerHTML = `
      <div class="bd"></div>
      <div class="pnl">
        ${o.noGrab ? '' : '<div class="grab"></div>'}
        ${o.title ? `<div class="sheet-head"><div class="h2">${esc(o.title)}</div>
          <button class="icon-btn xs-close" data-close aria-label="tutup">${icon('x')}</button></div>` : ''}
        <div class="body">${o.body || ''}</div>
        ${o.footer ? `<div class="pad-h" style="padding-bottom:calc(14px + var(--sb))">${o.footer}</div>` : ''}
      </div>`;
    host.appendChild(wrap);
    const close = () => {
      const pnl = $('.pnl', wrap);
      pnl.style.transition = 'transform .24s ease, opacity .24s ease';
      pnl.style.transform = 'translateY(102%)';
      $('.bd', wrap).style.opacity = '0';
      setTimeout(() => wrap.remove(), 240);
      if (o.onClose) o.onClose();
    };
    wrap.addEventListener('click', (e) => {
      if (e.target.classList.contains('bd')) { if (o.dismissible !== false) close(); }
      if (e.target.closest('[data-close]')) close();
    });
    if (o.onMount) o.onMount(wrap, close);
    return { el: wrap, close };
  },

  confirm(o) {
    return new Promise((resolve) => {
      let done = false;
      const sh = UI.sheet({
        body: `
          <div class="center" style="padding:6px 0 18px">
            <div class="avatar lg" style="margin:0 auto 14px;background:${o.danger ? 'var(--grad-red)' : 'var(--grad)'};color:${o.danger ? '#fff' : '#06101F'}">${icon(o.icon || (o.danger ? 'trash' : 'info'), 'lg')}</div>
            <div class="h2 mb8">${esc(o.title)}</div>
            <div class="small" style="line-height:1.55">${o.text || ''}</div>
          </div>`,
        footer: `<div class="row gap10">
            <button class="btn ghost grow" data-no>${esc(o.cancel || 'Batal')}</button>
            <button class="btn ${o.danger ? 'red' : 'primary'} grow" data-yes>${esc(o.ok || 'Ya')}</button>
          </div>`,
        onMount(el, close) {
          $('[data-yes]', el).onclick = () => { done = true; close(); resolve(true); };
          $('[data-no]', el).onclick = () => { done = true; close(); resolve(false); };
        },
        onClose() { if (!done) resolve(false); }
      });
      return sh;
    });
  },

  ok(title, sub) {
    const host = $('#stage');
    const el = document.createElement('div');
    el.className = 'float-ok';
    el.innerHTML = `<div class="center">
        <div class="ok-ring">${icon('check')}</div>
        <div class="h1 mt18">${esc(title)}</div>
        <div class="small mt6">${esc(sub || '')}</div>
      </div>`;
    host.appendChild(el);
    Sound.play('ok');
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 420); }, 1500);
    return el;
  },

  loading(text) {
    const el = document.createElement('div');
    el.className = 'float-ok';
    el.innerHTML = `<div class="center"><div class="radar" style="width:150px;height:150px">
        <span class="wave"></span><span class="wave"></span><span class="wave"></span>
        <span class="core" style="width:64px;height:64px;border-radius:22px">${icon('scooter', 'lg')}</span></div>
      <div class="small mt18">${esc(text || 'Memproses…')}</div></div>`;
    $('#stage').appendChild(el);
    return () => el.remove();
  }
};

/* ---------------------------------- GPS --------------------------------- */
const GPS = {
  watchId: null, cb: null,
  get(timeout) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('GPS tidak tersedia'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading || 0, speed: p.coords.speed || 0, acc: p.coords.accuracy }),
        (e) => reject(e),
        { enableHighAccuracy: true, timeout: timeout || 12000, maximumAge: 8000 }
      );
    });
  },
  start(cb, err) {
    if (!navigator.geolocation) { err && err(new Error('GPS tidak tersedia')); return; }
    this.stop();
    this.watchId = navigator.geolocation.watchPosition(
      (p) => cb({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading || 0, speed: p.coords.speed || 0, acc: p.coords.accuracy }),
      (e) => err && err(e),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000, distanceFilter: 5 }
    );
  },
  stop() { if (this.watchId) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; } }
};

/* --------------------------------- router ------------------------------- */
const Router = {
  defs: {}, stack: [], current: null, busy: false,
  register(name, def) { this.defs[name] = def; return this; },
  async go(name, params, opt) {
    opt = opt || {};
    const def = this.defs[name];
    if (!def) { console.error('screen tidak ada:', name); return; }
    if (this.busy) return;
    if (this.current && this.current.name === name && !opt.force) return;
    this.busy = true;
    const old = this.current;
    const oldEl = old && old.el;
    const stage = $('#stage');

    const el = document.createElement('section');
    el.className = 'screen' + (def.withTab ? ' with-tab' : '') + (def.flat ? ' flat' : '');
    el.dataset.screen = name;
    el.innerHTML = def.render ? def.render(params || {}) : '';
    stage.appendChild(el);

    // enter
    requestAnimationFrame(() => { el.classList.add('active'); });
    // leave old (termasuk splash statis di HTML)
    $$('#stage .screen').forEach((s) => {
      if (s === el) return;
      s.classList.remove('active');
      if (oldEl === s && old && old.def.destroy) { try { old.def.destroy(s); } catch (e) { } }
      setTimeout(() => s.remove(), 320);
    });
    this.current = { name, def, el, params: params || {} };
    if (!opt.keepStack) this.stack.push({ name, params });
    if (this.stack.length > 30) this.stack.shift();
    this.busy = false;

    if (def.mount) { try { def.mount(el, params || {}); } catch (e) { console.error('MOUNT ERROR [' + name + '] ' + ((e && e.stack) || e)); } }
    Bus.emit('route', { name, params });
    UI.renderTab(name);
  },
  replace(name, params) {
    const cur = this.current;
    if (cur) { this.stack = this.stack.filter((s) => s.name !== cur.name); }
    return this.go(name, params, { keepStack: false });
  },
  back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      const p = this.stack[this.stack.length - 1];
      return this.go(p.name, p.params, { keepStack: true });
    }
    return this.go('home');
  },
  refresh() { const c = this.current; if (c) return this.go(c.name, c.params, { keepStack: true, force: true }); }
};

/* -------------------------------- bottom tab ---------------------------- */
UI.tabs = [];
UI.renderTab = function (active) {
  const bar = $('#tabbar');
  const list = UI.tabs.filter((t) => t.roles.includes(S.me ? S.me.role : 'guest'));
  if (!list.length) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = list.map((t) => `
    <button class="tab ${t.name === active ? 'on' : ''}" data-tab="${t.name}">
      ${icon(t.icon)}<span>${t.label}</span>
      ${t.badge && t.badge() ? '<i class="dotb"></i>' : ''}
    </button>`).join('');
  $$('.tab', bar).forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.tab;
      if (name === active) return;
      Sound.play('pop');
      const t = list.find((x) => x.name === name);
      Router.go(name, {}, { keepStack: false });
      UI.stackReset(name);
    };
  });
};
UI.stackReset = function (name) {
  Router.stack = [{ name, params: {} }];
};

/* debug surface (berguna saat uji coba / konsol HP) */
window.SANTARA = { S, api, Router, Bus, Net, UI, fmt, LS, Realtime, Notify, Sound, GPS };
