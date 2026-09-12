/* =========================================================
   SANTARA — Screens (siswa · penjemput · pengaturan)
   ========================================================= */
'use strict';

const DEFAULT_CENTER = { lat: -7.8166, lng: 112.0117 };
const ACTIVE = ['pending', 'accepted', 'arrived_pickup', 'on_trip', 'arrived_dest', 'paid'];

function centerFor() {
  const o = S.order;
  if (o && o.pickup) return o.pickup;
  if (S.me && S.me.home) return S.me.home;
  if (S.loc) return S.loc;
  return DEFAULT_CENTER;
}
function mapProvider() {
  return (S.settings.googleKey && S.settings.mapProvider !== 'osm') ? 'google' : 'osm';
}
function mountMap(el, sel, opts) {
  const c = el.querySelector(sel);
  if (!c) return null;
  const m = MapKit.create(c, Object.assign({ center: centerFor(), zoom: 15, provider: mapProvider() }, opts || {}));
  if (m.provider === 'google') setTimeout(() => m.invalidate(), 400);
  return m;
}
function avatarOf(name, cls) {
  return `<div class="avatar ${cls || ''}">${esc((name || '?').trim().charAt(0).toUpperCase())}</div>`;
}
function statusBadge(st) {
  const map = {
    pending: ['amber', 'Mencari'], accepted: ['cyan', 'Dijemput'], arrived_pickup: ['cyan', 'Di lokasi'],
    on_trip: ['pink', 'Perjalanan'], arrived_dest: ['pink', 'Bayar'], paid: ['green', 'Dibayar'],
    done: ['green', 'Selesai'], cancelled: ['gray', 'Batal']
  };
  const m = map[st] || ['gray', st];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}
async function routeBetween(a, b) {
  return api.get('/api/route', { latA: a.lat, lngA: a.lng, latB: b.lat, lngB: b.lng });
}

/* ======================================================================
   PICKER LOKASI (full screen sheet + peta + search)
   ====================================================================== */
function pickLocation(o) {
  o = o || {};
  return new Promise((resolve) => {
    const startPt = (o.value && o.value.lat != null) ? { lat: o.value.lat, lng: o.value.lng } : centerFor();
    // selalu mulai dengan titik yang valid supaya tombol PILIH tidak pernah buntu
    let picked = {
      lat: startPt.lat, lng: startPt.lng,
      address: (o.value && o.value.address) || '',
      name: (o.value && o.value.name) || ''
    };
    let map = null, searchTimer = null;
    const sh = UI.sheet({
      full: true, noGrab: true,
      body: `
        <div style="position:absolute;inset:0">
          <div class="map-wrap"><div id="pickMap" style="position:absolute;inset:0"></div></div>
          <div class="center-pin" style="top:calc(50% - 0px)">
            <svg width="46" height="58" viewBox="0 0 56 70"><path d="M28 68S50 42 50 26A22 22 0 1 0 6 26C6 42 28 68 28 68Z" fill="#FF3DC8" stroke="rgba(255,255,255,.9)" stroke-width="3"/><circle cx="28" cy="25" r="8" fill="#05070F"/></svg>
          </div>
          <div class="top-float" style="top:8px">
            <button class="icon-btn" data-close style="background:rgba(8,12,30,.85)">${icon('left')}</button>
            <div class="searchbox" style="flex:1;margin:0">
              ${icon('search')}
              <input id="pickQ" placeholder="${esc(o.placeholder || 'Cari alamat / tempat les…')}" autocomplete="off">
              <button class="icon-btn" id="pickClear" style="width:34px;height:34px;border-radius:11px">${icon('x', 'sm')}</button>
            </div>
          </div>
          <div id="pickResults" class="card glass" style="position:absolute;top:74px;left:12px;right:12px;max-height:44%;overflow-y:auto;padding:6px;display:none;z-index:20"></div>
          <div class="bottom-float" style="padding-bottom:20px">
            <div class="card glass mb8">
              <div class="row gap10">
                ${icon('pin')}
                <div class="grow"><div class="tiny">Lokasi dipilih</div><div class="h3" id="pickAddr">${esc(picked ? (picked.address || picked.name || 'Lokasi') : 'Geser peta untuk memilih')}</div></div>
                <button class="icon-btn" id="pickGps" title="Lokasi saya">${icon('crosshair')}</button>
              </div>
            </div>
            <div class="row gap10">
              ${o.allowCurrent === false ? '' : `<button class="btn ghost" id="pickMy">${icon('target')} Lokasi saya</button>`}
              <button class="btn primary grow" id="pickOk">${icon('check')} Pilih lokasi</button>
            </div>
          </div>
        </div>`,
      onMount(el, close) {
        map = MapKit.create($('#pickMap', el), { center: startPt, zoom: 16, provider: mapProvider(), interactive: true });
        // isi alamat awal (jika belum ada)
        if (!picked.address) {
          api.get('/api/reverse', { lat: picked.lat, lng: picked.lng }).then((r) => {
            if (!picked.address && r.address) {
              picked.address = r.address;
              const a = $('#pickAddr', el);
              if (a) a.textContent = r.address.split(',').slice(0, 2).join(',');
            }
          });
        }
        map.on('center', (c) => {
          picked = { lat: c.lat, lng: c.lng, address: '' };
          clearTimeout(searchTimer);
          searchTimer = setTimeout(async () => {
            const r = await api.get('/api/reverse', { lat: c.lat, lng: c.lng });
            if (picked && Math.abs(picked.lat - c.lat) < 1e-6) picked.address = r.address || '';
            const a = $('#pickAddr', el); if (a && picked) a.textContent = (picked.address || '').split(',').slice(0, 2).join(',') || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
          }, 550);
        });
        const q = $('#pickQ', el);
        const res = $('#pickResults', el);
        let qt = null;
        q.addEventListener('input', () => {
          clearTimeout(qt);
          const v = q.value.trim();
          if (v.length < 3) { res.style.display = 'none'; return; }
          qt = setTimeout(async () => {
            const r = await api.get('/api/geocode', { q: v + (o.near ? '' : ', Kediri') });
            if (!r.results || !r.results.length) { res.style.display = 'none'; return; }
            res.style.display = 'block';
            res.innerHTML = r.results.map((x, i) => `
              <div class="list-item" data-i="${i}" style="margin:0 0 6px">
                <div class="li-ic">${icon('pin')}</div>
                <div class="grow"><div class="h3 ellip">${esc(x.name)}</div><div class="tiny ellip">${esc(x.address)}</div></div>
              </div>`).join('');
            $$('[data-i]', res).forEach((row) => {
              row.onclick = () => {
                const x = r.results[+row.dataset.i];
                picked = { lat: x.lat, lng: x.lng, address: x.address, name: x.name };
                res.style.display = 'none'; q.value = x.name;
                map.setCenter(x.lat, x.lng, 17);
                $('#pickAddr', el).textContent = x.name;
                Sound.play('pop');
              };
            });
          }, 420);
        });
        $('#pickClear', el).onclick = () => { q.value = ''; res.style.display = 'none'; };
        $('#pickGps', el).onclick = $('#pickMy', el) ? null : null;
        const gpsBtn = $('#pickGps', el) || $('#pickMy', el);
        if (gpsBtn) gpsBtn.onclick = async () => {
          const stop = UI.loading('Mengambil lokasi…');
          try {
            const p = await GPS.get();
            S.loc = p; picked = { lat: p.lat, lng: p.lng, address: 'Lokasi saya saat ini' };
            map.setCenter(p.lat, p.lng, 17);
            const r = await api.get('/api/reverse', { lat: p.lat, lng: p.lng });
            picked.address = r.address || 'Lokasi saya saat ini';
            $('#pickAddr', el).textContent = (picked.address || '').split(',').slice(0, 2).join(',');
          } catch (e) { UI.toast({ title: 'GPS gagal', body: 'Nyalakan lokasi HP lalu coba lagi', type: 'red', icon: 'x' }); }
          stop();
        };
        $('#pickOk', el).onclick = async () => {
          if (!picked) return;
          if (!picked.address) {
            const r = await api.get('/api/reverse', { lat: picked.lat, lng: picked.lng });
            picked.address = r.address || '';
          }
          picked.name = picked.name || (picked.address || '').split(',')[0] || 'Lokasi pilihan';
          Sound.play('ok');
          close(); resolve(picked);
        };
      },
      onClose() { if (map) map.destroy(); }
    });
    return sh;
  });
}

/* ======================================================================
   CHAT
   ====================================================================== */
function openChat(order) {
  const sh = UI.sheet({
    title: 'Pesan',
    body: `<div id="chatLog" style="display:flex;flex-direction:column;gap:8px;min-height:180px;max-height:46vh;overflow-y:auto;padding:6px 0"></div>`,
    footer: `
      <div class="row gap8 mb8" style="overflow-x:auto">
        ${['Otw kak 🙏', 'Sudah sampai', 'Tunggu sebentar', 'Terima kasih'].map((t) => `<button class="chip" data-q="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <div class="row gap8">
        <input class="input" id="chatIn" placeholder="Tulis pesan…" style="height:48px;border-radius:16px">
        <button class="icon-btn fill" id="chatSend">${icon('nav')}</button>
      </div>`,
    onMount(el, close) {
      const log = $('#chatLog', el);
      const paint = () => {
        const msgs = (S.order && S.order.id === order.id ? S.order.messages : order.messages) || [];
        log.innerHTML = msgs.length ? msgs.map((m) => {
          const mine = (m.from === (S.me && S.me.role));
          return `<div style="align-self:${mine ? 'flex-end' : 'flex-start'};max-width:78%;background:${mine ? 'linear-gradient(135deg,#22E6FF,#7A5CFF)' : 'rgba(255,255,255,.07)'};color:${mine ? '#06101F' : 'var(--txt)'};padding:10px 13px;border-radius:16px 16px ${mine ? '4px' : '16px'} ${mine ? '16px' : '4px'};font-weight:600;font-size:13px">
            ${esc(m.text)}<div style="font-size:9.5px;opacity:.7;margin-top:3px">${fmt.time(m.ts)}</div></div>`;
        }).join('') : `<div class="small center" style="padding:30px 0">Belum ada pesan</div>`;
        log.scrollTop = log.scrollHeight;
      };
      paint();
      const un = Bus.on('chat', (m) => { if (m.orderId === order.id) paint(); });
      const un2 = Bus.on('order', (o) => { if (o.id === order.id) { order.messages = o.messages; paint(); } });
      sh.close = (function (orig) { return function () { un(); un2(); orig(); }; })(sh.close);
      const send = () => {
        const v = $('#chatIn', el).value.trim();
        if (!v) return;
        Net.send({ t: 'chat', orderId: order.id, text: v });
        $('#chatIn', el).value = '';
        Sound.play('pop');
        setTimeout(paint, 250);
      };
      $('#chatSend', el).onclick = send;
      $('#chatIn', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      $$('[data-q]', el).forEach((b) => { b.onclick = () => { $('#chatIn', el).value = b.dataset.q; send(); }; });
    }
  });
  return sh;
}

/* ======================================================================
   ONBOARDING
   ====================================================================== */
const ONBOARD = [
  { t: 'Pesan sekali sentuh', d: 'Tentukan titik jemput & tempat les, biaya langsung muncul dari jarak km.', c: 'cy' },
  { t: 'Lacak penjemput live', d: 'Posisi penjemput terhubung online dan terpantau di peta sampai tujuan.', c: 'pk' },
  { t: 'Bayar & dapat notifikasi', d: 'Begitu sampai, biaya muncul. Setelah dibayar, notifikasi langsung terkirim.', c: 'gr' }
];
function onboardHTML(i) {
  const s = ONBOARD[i];
  const illu = {
    cy: `<svg viewBox="0 0 200 130" style="width:100%;height:100%">
      <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22E6FF"/><stop offset="1" stop-color="#7A5CFF"/></linearGradient></defs>
      <rect x="14" y="86" width="172" height="6" rx="3" fill="#1B2450"/>
      <rect x="24" y="20" width="66" height="66" rx="16" fill="none" stroke="url(#g1)" stroke-width="3"/>
      <path d="M40 56h34M40 44h22" stroke="#22E6FF" stroke-width="4" stroke-linecap="round"/>
      <circle cx="150" cy="52" r="26" fill="url(#g1)" opacity=".9"/>
      <path d="M150 40v24M138 52h24" stroke="#06101F" stroke-width="5" stroke-linecap="round"/>
      <path d="M92 54h30" stroke="#7A5CFF" stroke-width="3" stroke-dasharray="6 6" stroke-linecap="round"/>
    </svg>`,
    pk: `<svg viewBox="0 0 200 130" style="width:100%;height:100%">
      <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF3DC8"/><stop offset="1" stop-color="#7A5CFF"/></linearGradient></defs>
      <circle cx="100" cy="62" r="46" fill="none" stroke="#2A3566" stroke-width="2"/>
      <circle cx="100" cy="62" r="28" fill="none" stroke="url(#g2)" stroke-width="2" opacity=".7"/>
      <circle cx="100" cy="62" r="10" fill="url(#g2)"/>
      <path d="M100 62 L142 40" stroke="url(#g2)" stroke-width="4" stroke-linecap="round"/>
      <circle cx="146" cy="38" r="8" fill="#FF3DC8"/>
      <path d="M20 106h160" stroke="#1B2450" stroke-width="6" stroke-linecap="round"/>
    </svg>`,
    gr: `<svg viewBox="0 0 200 130" style="width:100%;height:100%">
      <defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A8FF3E"/><stop offset="1" stop-color="#28E0A0"/></linearGradient></defs>
      <rect x="36" y="34" width="128" height="72" rx="18" fill="none" stroke="url(#g3)" stroke-width="3"/>
      <rect x="36" y="52" width="128" height="14" fill="url(#g3)" opacity=".85"/>
      <circle cx="152" cy="76" r="10" fill="none" stroke="#A8FF3E" stroke-width="3"/>
      <circle cx="70" cy="20" r="13" fill="url(#g3)"/>
      <path d="M64 20l5 5 9-10" stroke="#06101F" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <path d="M56 92h34" stroke="#2A3566" stroke-width="5" stroke-linecap="round"/>
    </svg>`
  }[s.c];
  return `<div class="hero" style="height:38%">
      <div style="position:absolute;inset:0;display:grid;place-items:center;padding:18px">${illu}</div>
      <div class="veil"></div>
    </div>
    <div class="pad center" style="padding-top:6px">
      <div class="h1">${esc(s.t)}</div>
      <p class="small" style="line-height:1.6;margin-top:10px">${esc(s.d)}</p>
    </div>`;
}

/* ======================================================================
   CHAT / call helpers
   ====================================================================== */
function callPhone(p) { if (p) location.href = 'tel:' + p.replace(/\D/g, ''); }
function openNav(a, b, label) {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`;
  window.open(url, '_blank', 'noopener');
}

/* ======================================================================
   SISWA — BERANDA
   ====================================================================== */
const Student = {
  pickup: null, dest: null, est: null,

  initHome() {
    if (!this.pickup) this.pickup = (S.me && S.me.home) ? Object.assign({ name: 'Rumah', address: S.me.homeAddress }, S.me.home) : null;
    if (!this.dest) this.dest = S.lastDest || (S.places[0] ? Object.assign({}, S.places[0]) : null);
  },

  async refreshEstimate(el) {
    if (!this.pickup || !this.dest) return;
    const box = el.querySelector('#estBox');
    if (box) box.innerHTML = `<div class="row gap10"><div class="shimmer" style="height:18px;flex:1"></div></div>`;
    const r = await routeBetween(this.pickup, this.dest);
    this.est = r.ok ? r : null;
    const cta = el.querySelector('#btnOrder');
    if (cta) cta.disabled = !r.ok;
    if (box && r.ok) {
      box.innerHTML = `
        <div class="between">
          <div class="row gap8">${icon('route')}<span class="km">${fmt.km(r.km)}</span></div>
          <div class="row gap8">${icon('clock')}<span class="small">± ${fmt.min(r.minutes)}</span></div>
          <div class="row gap8">${icon('wallet')}<span class="h3 grad-text">${fmt.money(r.fare.fare)}</span></div>
        </div>
        <div class="tiny mt6" style="text-transform:none;letter-spacing:0">Rute via ${r.source === 'google' ? 'Google Maps' : 'OpenStreetMap'} · tarif ${fmt.money(S.settings.rates.base)} + ${fmt.money(S.settings.rates.perKm)}/km</div>`;
    }
    const m = el._map;
    if (m && r.ok) {
      m.clearMarkers(); m.clearRoute();
      m.addMarker('pickup', this.pickup.lat, this.pickup.lng, { type: 'pickup', title: this.pickup.name || 'Titik jemput' });
      m.addMarker('dest', this.dest.lat, this.dest.lng, { type: 'dest', title: this.dest.name || 'Tujuan' });
      m.drawRoute(r.geometry && r.geometry.length > 1 ? r.geometry : [this.pickup, this.dest]);
      m.fit([this.pickup, this.dest], [90, 150]);
    }
  },

  home: {
    withTab: true, flat: true,
    render() {
      Student.initHome();
      const p = Student.pickup, d = Student.dest;
      const onlineDrivers = S.drivers.filter((x) => x.online).length;
      return `
        <div class="map-wrap"><div class="map" id="homeMap"></div></div>
        <div class="map-overlay">
          <div class="top-float">
            <div class="locbar mb8" id="barPickup">
              <span style="width:10px;height:10px;border-radius:99px;background:var(--cyan);box-shadow:0 0 10px var(--cyan)"></span>
              <div class="grow">
                <div class="tiny">Jemput dari</div>
                <div class="h3 ellip">${esc(p ? (p.name || p.address || 'Rumah') : 'Pilih titik jemput')}</div>
              </div>
              ${icon('edit', 'sm')}
            </div>
            <div class="locbar dst" id="barDest">
              <span style="width:10px;height:10px;border-radius:99px;background:var(--pink);box-shadow:0 0 10px var(--pink)"></span>
              <div class="grow">
                <div class="tiny">Antar ke</div>
                <div class="h3 ellip">${esc(d ? (d.name || d.address || 'Tujuan') : 'Pilih tujuan')}</div>
              </div>
              ${icon('edit', 'sm')}
            </div>
            <div class="row gap8 mt8" style="overflow-x:auto;padding-bottom:2px">
              <span class="chip ${onlineDrivers ? '' : 'dim'}"><span class="pulse-dot" style="${onlineDrivers ? '' : 'background:#5F6B8C;box-shadow:none'}"></span> ${onlineDrivers} penjemput online</span>
              ${S.places.slice(0, 4).map((x, i) => `<button class="chip ${d && d.id === x.id ? 'on' : ''}" data-place="${i}">${icon(x.kind === 'les' ? 'school' : 'pin', 'sm')} ${esc(x.name.split(' ').slice(0, 2).join(' '))}</button>`).join('')}
            </div>
          </div>

          <div class="bottom-float">
            <div class="est mb10">
              <div id="estBox"><div class="row gap10"><div class="shimmer" style="height:18px;flex:1"></div></div></div>
              <button class="btn primary big-cta block mt12" id="btnOrder">${icon('scooter')} Pesan Santara</button>
              ${S.lastOrder ? `<button class="btn ghost block sm mt8" id="btnRepeat">${icon('refresh', 'sm')} Ulangi pesanan terakhir</button>` : ''}
            </div>
          </div>
          <div class="recenter"><button class="icon-btn" id="btnRecenter">${icon('crosshair')}</button></div>
        </div>`;
    },
    mount(el) {
      const m = mountMap(el, '#homeMap', { zoom: 15 });
      el._map = m;
      Student.refreshEstimate(el);

      el.querySelector('#barPickup').onclick = async () => {
        const r = await pickLocation({ title: 'Titik jemput', value: Student.pickup, placeholder: 'Cari alamat rumah…' });
        if (r) { Student.pickup = r; Student.saveHomeMaybe(r); Router.refresh(); }
      };
      el.querySelector('#barDest').onclick = () => Student.chooseDest(el);
      $$('[data-place]', el).forEach((b) => {
        b.onclick = () => { Student.dest = Object.assign({}, S.places[+b.dataset.place]); S.lastDest = Student.dest; LS.set('lastDest', Student.dest); Router.refresh(); };
      });
      el.querySelector('#btnOrder').onclick = () => Student.order(el);
      const rep = el.querySelector('#btnRepeat');
      if (rep) rep.onclick = async () => {
        const r = await api.get('/api/orders', { studentId: S.me.id, limit: 1 });
        const last = r.orders && r.orders[0];
        if (!last) return;
        Student.pickup = Object.assign({ name: last.pickupName }, last.pickup);
        Student.dest = Object.assign({ name: last.destName }, last.dest);
        S.lastDest = Student.dest; LS.set('lastDest', Student.dest);
        await Student.order(el);
      };
      el.querySelector('#btnRecenter').onclick = async () => {
        try { const p = await GPS.get(); S.loc = p; m.setCenter(p.lat, p.lng, 16); } catch (e) { UI.toast({ title: 'GPS tidak aktif', body: 'Izinkan akses lokasi untuk memusatkan peta', type: 'red', icon: 'x' }); }
      };
      const un = Bus.on('drivers', () => {
        const badge = el.querySelector('.top-float .chip');
        if (badge) {
          const n = S.drivers.filter((x) => x.online).length;
          badge.innerHTML = `<span class="pulse-dot" style="${n ? '' : 'background:#5F6B8C;box-shadow:none'}"></span> ${n} penjemput online`;
        }
      });
      el._unsub = [un];
    },
    destroy(el) { if (el._map) el._map.destroy(); (el._unsub || []).forEach((f) => f()); }
  },

  saveHomeMaybe(r) {
    if (!S.me) return;
    S.me.home = { lat: r.lat, lng: r.lng }; S.me.homeAddress = r.address;
    LS.set('me', S.me);
    api.post('/api/students', { id: S.me.id, name: S.me.name, phone: S.me.phone, home: { lat: r.lat, lng: r.lng }, homeAddress: r.address });
  },

  chooseDest(el) {
    UI.sheet({
      title: 'Antar ke mana?',
      body: `
        <div class="searchbox">
          ${icon('search')}<input id="destQ" placeholder="Cari tempat les / alamat…" autocomplete="off">
        </div>
        <div id="destRes"></div>
        <div class="tiny mb8">Tempat les favorit</div>
        ${S.places.map((x, i) => `
          <div class="list-item" data-p="${i}">
            <div class="li-ic" style="color:var(--amber)">${icon(x.kind === 'les' ? 'school' : 'pin')}</div>
            <div class="grow"><div class="h3 ellip">${esc(x.name)}</div><div class="tiny ellip">${esc(x.address || '')}</div></div>
            ${icon('right', 'sm')}
          </div>`).join('')}
        <button class="btn ghost block mt12" id="destMap">${icon('pin')} Pilih langsung di peta</button>
        <div style="height:8px"></div>`,
      onMount(sh, close) {
        const q = $('#destQ', sh), res = $('#destRes', sh);
        let t = null;
        q.addEventListener('input', () => {
          clearTimeout(t);
          const v = q.value.trim();
          if (v.length < 3) { res.innerHTML = ''; return; }
          t = setTimeout(async () => {
            const r = await api.get('/api/geocode', { q: v });
            res.innerHTML = (r.results || []).slice(0, 6).map((x, i) => `
              <div class="list-item" data-r="${i}"><div class="li-ic">${icon('pin')}</div>
                <div class="grow"><div class="h3 ellip">${esc(x.name)}</div><div class="tiny ellip">${esc(x.address)}</div></div></div>`).join('');
            $$('[data-r]', res).forEach((row) => {
              row.onclick = () => {
                const x = r.results[+row.dataset.r];
                Student.dest = { lat: x.lat, lng: x.lng, name: x.name, address: x.address };
                S.lastDest = Student.dest; LS.set('lastDest', Student.dest);
                close(); Router.refresh();
              };
            });
          }, 400);
        });
        $$('[data-p]', sh).forEach((row) => {
          row.onclick = () => {
            Student.dest = Object.assign({}, S.places[+row.dataset.p]);
            S.lastDest = Student.dest; LS.set('lastDest', Student.dest);
            close(); Router.refresh();
          };
        });
        $('#destMap', sh).onclick = async () => {
          close();
          const r = await pickLocation({ title: 'Pilih tujuan', value: Student.dest });
          if (r) { Student.dest = r; S.lastDest = r; LS.set('lastDest', r); Router.refresh(); }
        };
      }
    });
  },

  async order(el) {
    if (!Student.pickup || !Student.dest) { UI.toast({ title: 'Lokasi belum lengkap', type: 'red', icon: 'x' }); return; }
    const stop = UI.loading('Membuat pesanan…');
    const r = await api.post('/api/orders', {
      studentId: S.me.id, studentName: S.me.name, studentPhone: S.me.phone,
      pickup: { lat: Student.pickup.lat, lng: Student.pickup.lng }, pickupName: Student.pickup.name || Student.pickup.address || 'Rumah',
      dest: { lat: Student.dest.lat, lng: Student.dest.lng }, destName: Student.dest.name || Student.dest.address || 'Tempat les'
    });
    stop();
    if (!r.ok) {
      // masih ada pesanan aktif → langsung lanjutkan ke pesanan itu
      if (r.order && r.order.id) {
        S.order = r.order;
        UI.toast({ title: 'Pesanan masih berjalan', body: 'Melanjutkan pesanan sebelumnya', type: 'amber', icon: 'clock' });
        App.syncScreen(r.order);
        return;
      }
      UI.toast({ title: 'Gagal', body: r.error, type: 'red', icon: 'x' }); Sound.play('err'); return;
    }
    S.order = r.order; S.lastOrder = r.order;
    Sound.play('ok');
    Router.go('wait');
  }
};

/* ======================================================================
   SISWA — MENCARI PENJEMPUT
   ====================================================================== */
const WaitScreen = {
  withTab: false, flat: true,
  render() {
    const o = S.order || {};
    const found = !!o.driverId;
    return `
      <div class="map-wrap"><div class="map" id="waitMap"></div></div>
      <div class="map-overlay">
        <div class="bottom-float" style="padding-bottom:calc(18px + var(--sb))">
          <div class="est">
            ${found ? `
              <div class="driver-card mb12">
                ${avatarOf(o.driverName, 'lg cy')}
                <div class="grow">
                  <div class="nm">${esc(o.driverName)}</div>
                  <div class="plate">${esc(o.driverPlate || '')}</div>
                  <div class="rating mt6">${icon('star')} ${o.driverRating || '5.0'} · ${o.driverVehicle || 'Motor'}</div>
                </div>
                <button class="icon-btn cy" id="btnCall">${icon('phone')}</button>
              </div>
              <div class="between mb12">
                <div><div class="tiny">Status</div><div class="h2">Menuju lokasi jemput</div></div>
                <span class="eta-pill">${icon('clock', 'sm')} ± ${fmt.min(o.etaPickupMin || 5)}</span>
              </div>
              <div class="row gap10">
                <button class="btn ghost" id="btnChat">${icon('chat')} Pesan</button>
                <button class="btn ghost" id="btnCancel">Batal</button>
              </div>
            ` : `
              <div class="center">
                <div class="radar">
                  <span class="wave"></span><span class="wave"></span><span class="wave"></span>
                  <span class="core-ring"></span>
                  <span class="core">${icon('scooter', 'lg')}</span>
                </div>
                <div class="h1 mt10">Mencari penjemput…</div>
                <div class="small mt6">Pesanan ${esc(o.code || '')} · ${fmt.km(o.km)} · ${fmt.money(o.estFare)}</div>
                <div class="tiny mt10" id="waitTimer" style="text-transform:none;letter-spacing:0">00:00</div>
              </div>
              <div class="divider"></div>
              <div class="row gap10" style="justify-content:center">
                ${S.drivers.filter((d) => d.online).slice(0, 4).map((d) => avatarOf(d.name, 'sm cy')).join('') || '<span class="small">Belum ada penjemput online</span>'}
              </div>
              <button class="btn ghost block mt14" id="btnCancel2">${icon('x')} Batalkan pesanan</button>
            `}
          </div>
        </div>
      </div>`;
  },
  mount(el) {
    const m = mountMap(el, '#waitMap', { zoom: 15 });
    el._map = m;
    const o = S.order;
    if (o) {
      m.addMarker('pickup', o.pickup.lat, o.pickup.lng, { type: 'pickup', title: 'Titik jemput' });
      m.addMarker('dest', o.dest.lat, o.dest.lng, { type: 'dest', title: 'Tujuan' });
      if (o.geometry) m.drawRoute(o.geometry);
      m.fit([o.pickup, o.dest], [90, 200]);
      // tampilkan penjemput terdekat yang online
      S.drivers.filter((d) => d.online && d.lat).forEach((d) => m.addMarker('d_' + d.id, d.lat, d.lng, { type: 'driver', title: d.name }));
    }
    const call = el.querySelector('#btnCall');
    if (call) call.onclick = () => callPhone(o.driverPhone);
    const chat = el.querySelector('#btnChat');
    if (chat) chat.onclick = () => openChat(o);
    const c1 = el.querySelector('#btnCancel'), c2 = el.querySelector('#btnCancel2');
    const cancel = async () => {
      const yes = await UI.confirm({ title: 'Batalkan pesanan?', text: 'Penjemput yang sudah di perjalanan akan diberitahu.', ok: 'Ya, batalkan', cancel: 'Tidak', danger: true, icon: 'x' });
      if (!yes) return;
      const r = await api.action(o.id, 'cancel', { reason: 'dibatalkan siswa' });
      if (r.ok) { S.order = null; UI.toast({ title: 'Pesanan dibatalkan', type: 'red', icon: 'x' }); Router.go('home'); }
    };
    if (c1) c1.onclick = cancel;
    if (c2) c2.onclick = cancel;
    const timer = el.querySelector('#waitTimer');
    if (timer) {
      const t0 = o.createdAt || Date.now();
      const tick = () => {
        const s = Math.floor((Date.now() - t0) / 1000);
        timer.textContent = `Menunggu ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      };
      tick(); el._iv = setInterval(tick, 1000);
    }
    el._un = Bus.on('order', (n) => { if (n.id === o.id && n.driverId) Router.go('trip'); });
    el._un2 = Bus.on('driver:loc', (d) => {
      if (!d.orderId || d.orderId !== o.id) return;
      m.addMarker('drv', d.lat, d.lng, { type: 'driver', title: 'Penjemput' });
      MapKit.rotate(m, 'drv', d.heading);
    });
  },
  destroy(el) { if (el._map) el._map.destroy(); clearInterval(el._iv); if (el._un) el._un(); if (el._un2) el._un2(); }
};

/* ======================================================================
   SISWA — PERJALANAN
   ====================================================================== */
const TripScreen = {
  withTab: false, flat: true,
  render() {
    const o = S.order;
    const steps = [
      { k: 'accepted', t: 'Penjemput dihubungkan', s: o.acceptedAt ? fmt.time(o.acceptedAt) : '—' },
      { k: 'arrived_pickup', t: 'Tiba di titik jemput', s: o.arrivedPickupAt ? fmt.time(o.arrivedPickupAt) : '—' },
      { k: 'on_trip', t: 'Perjalanan dimulai', s: o.startedAt ? fmt.time(o.startedAt) : '—' },
      { k: 'arrived_dest', t: 'Sampai di tujuan', s: o.arrivedDestAt ? fmt.time(o.arrivedDestAt) : '—' }
    ];
    const order = ['pending', 'accepted', 'arrived_pickup', 'on_trip', 'arrived_dest', 'paid', 'done'];
    const cur = order.indexOf(o.status);
    return `
      <div class="map-wrap"><div class="map" id="tripMap"></div></div>
      <div class="map-overlay">
        <div class="top-float">
          <div class="locbar">
            <span class="pulse-dot"></span>
            <div class="grow"><div class="tiny">${o.status === 'on_trip' ? 'Menuju' : 'Status'}</div>
              <div class="h3">${esc(o.statusLabel || '')}</div></div>
            <span class="eta-pill">${fmt.km(o.km)}</span>
          </div>
        </div>
        <div class="bottom-float" style="padding-bottom:calc(18px + var(--sb))">
          <div class="est">
            <div class="driver-card mb12">
              ${avatarOf(o.driverName, 'lg cy')}
              <div class="grow">
                <div class="nm">${esc(o.driverName)}</div>
                <div class="plate">${esc(o.driverPlate || '')} · ${esc(o.driverVehicle || '')}</div>
                <div class="small mt6">${esc(o.destName || 'Tujuan')}</div>
              </div>
              <div class="col gap8">
                <button class="icon-btn cy" id="btnCall">${icon('phone')}</button>
                <button class="icon-btn pk" id="btnChat">${icon('chat')}</button>
              </div>
            </div>
            <div class="steps mb12">
              ${steps.map((s, i) => {
      const done = cur > order.indexOf(s.k);
      return `<div class="step ${done ? 'done' : ''}">
                  <div class="rail"><i></i></div>
                  <div class="body grow"><div class="t">${esc(s.t)}</div><div class="s">${esc(s.s)}</div></div>
                </div>`;
    }).join('')}
            </div>
            <div class="row gap10">
              <button class="btn ghost" id="btnCancel">${icon('x')} Batal</button>
              <button class="btn outline grow" id="btnShare">${icon('shield')} Bagikan rute</button>
            </div>
          </div>
        </div>
      </div>`;
  },
  mount(el) {
    const o = S.order;
    const m = mountMap(el, '#tripMap', { zoom: 15 });
    el._map = m;
    m.addMarker('pickup', o.pickup.lat, o.pickup.lng, { type: 'pickup', title: 'Titik jemput' });
    m.addMarker('dest', o.dest.lat, o.dest.lng, { type: 'dest', title: o.destName });
    if (o.geometry) m.drawRoute(o.geometry);
    m.fit([o.pickup, o.dest], [90, 220]);
    if (S.driverLocs[o.driverId]) {
      const d = S.driverLocs[o.driverId];
      m.addMarker('drv', d.lat, d.lng, { type: 'driver', title: o.driverName });
      MapKit.rotate(m, 'drv', d.heading);
    }
    el.querySelector('#btnCall').onclick = () => callPhone(o.driverPhone);
    el.querySelector('#btnChat').onclick = () => openChat(o);
    el.querySelector('#btnShare').onclick = async () => {
      const txt = `SANTARA · ${o.driverName} (${o.driverPlate || ''}) mengantar saya ke ${o.destName}.`;
      try { await navigator.share({ title: 'SANTARA', text: txt }); } catch (e) {
        try { await navigator.clipboard.writeText(txt); UI.toast({ title: 'Tersalin', body: 'Link rute disalin', type: 'green', icon: 'copy' }); } catch (_) { }
      }
    };
    el.querySelector('#btnCancel').onclick = async () => {
      if (!['accepted', 'arrived_pickup'].includes(o.status)) { UI.toast({ title: 'Tidak bisa dibatalkan', body: 'Perjalanan sudah dimulai', type: 'red', icon: 'x' }); return; }
      const yes = await UI.confirm({ title: 'Batalkan penjemputan?', ok: 'Batalkan', cancel: 'Tidak', danger: true, icon: 'x', text: 'Beritahu penjemput jika Anda membatalkan.' });
      if (!yes) return;
      const r = await api.action(o.id, 'cancel', { reason: 'dibatalkan siswa' });
      if (r.ok) { S.order = null; Router.go('home'); }
    };
    el._un = Bus.on('driver:loc', (d) => {
      if (d.driverId !== o.driverId) return;
      m.addMarker('drv', d.lat, d.lng, { type: 'driver', title: o.driverName });
      MapKit.rotate(m, 'drv', d.heading);
      m.panTo(d.lat, d.lng);
    });
    el._un2 = Bus.on('order', (n) => { if (n.id === o.id && n.status !== S.order.status) Router.refresh(); });
  },
  destroy(el) { if (el._map) el._map.destroy(); if (el._un) el._un(); if (el._un2) el._un2(); }
};

/* ======================================================================
   SISWA — PEMBAYARAN
   ====================================================================== */
const PayScreen = {
  withTab: false,
  render() {
    const o = S.order;
    if (o.status === 'done') return PayScreen.doneHTML(o);
    const paid = o.status === 'paid';
    const r = S.settings.rates;
    return `
      <div class="pad">
        <div class="center mt10">
          <div class="tiny">${paid ? 'Menunggu konfirmasi penjemput' : 'Total biaya antar-jemput'}</div>
          <div class="fare-big mt6">${fmt.money(o.fare)}</div>
          <div class="small mt6">${esc(o.destName || '')} · ${fmt.km(o.billedKm || o.km)}</div>
        </div>

        ${paid ? `
          <div class="card mt18 center">
            <div class="radar" style="width:140px;height:140px">
              <span class="wave"></span><span class="wave"></span><span class="wave"></span>
              <span class="core" style="width:64px;height:64px;border-radius:22px">${icon('cash', 'lg')}</span>
            </div>
            <div class="h2 mt10">Menunggu ${esc(o.driverName)}</div>
            <div class="small mt6">Begitu penjemput menerima ${fmt.money(o.fare)}, notifikasi akan muncul di sini.</div>
          </div>
        ` : `
          <div class="card mt18">
            <div class="tiny mb8">Rincian</div>
            <div class="fare-row"><span>Tarif dasar (${r.includedKm} km pertama)</span><b>${fmt.money(r.base)}</b></div>
            ${(o.billedKm || o.km) > r.includedKm ? `<div class="fare-row"><span>${((o.billedKm || o.km) - r.includedKm).toFixed(2)} km x ${fmt.money(r.perKm)}</span><b>${fmt.money(((o.billedKm || o.km) - r.includedKm) * r.perKm)}</b></div>` : ''}
            <div class="fare-row"><span>Jarak tempuh</span><b>${fmt.km(o.billedKm || o.km)}</b></div>
            <div class="fare-row"><span>Waktu tempuh</span><b>± ${fmt.min(o.estMinutes)}</b></div>
            <div class="divider"></div>
            <div class="fare-row"><span>Kode pesanan</span><b class="mono">${esc(o.code)}</b></div>
          </div>

          <div class="tiny mt18 mb8">Metode pembayaran</div>
          <div class="pay-methods">
            <div class="pay-m on" data-m="Tunai">${icon('cash')}<span>Tunai</span></div>
            <div class="pay-m" data-m="Transfer">${icon('bank')}<span>Transfer</span></div>
            <div class="pay-m" data-m="QRIS">${icon('qr')}<span>QRIS</span></div>
          </div>

          <button class="btn primary big-cta block mt18" id="btnPay">${icon('check')} Bayar ${fmt.money(o.fare)}</button>
          <button class="btn ghost block sm mt8" id="btnChat2">${icon('chat')} Pesan penjemput</button>
        `}
      </div>`;
  },
  doneHTML(o) {
    return `
      <div class="pad center">
        <div class="mt18" style="display:grid;place-items:center">
          <div class="ok-ring" style="width:120px;height:120px">${icon('check')}</div>
        </div>
        <div class="h1 mt18">Pembayaran diterima</div>
        <div class="small mt6">${esc(o.driverName)} mengonfirmasi ${fmt.money(o.fare)} via ${esc(o.paymentMethod || 'Tunai')}</div>

        <div class="card mt18">
          <div class="tiny mb8">${o.rating ? 'Penilaian Anda' : 'Nilai perjalanan ini'}</div>
          <div class="stars" id="stars">
            ${[1, 2, 3, 4, 5].map((i) => `<button data-s="${i}" class="${o.rating && i <= o.rating ? 'on' : ''}">${icon('star')}</button>`).join('')}
          </div>
          <div class="small mt10" id="rateTxt">${o.rating ? (['', 'Kurang', 'Cukup', 'Baik', 'Sangat baik', 'Luar biasa!'][o.rating] + ' · terima kasih!') : 'Tap bintang untuk menilai'}</div>
        </div>

        <button class="btn primary big-cta block mt18" id="btnAgain">${icon('scooter')} Pesan lagi</button>
        <button class="btn ghost block mt10" id="btnHome">Kembali ke beranda</button>
      </div>`;
  },
  mount(el) {
    const o = S.order;
    let method = 'Tunai';
    $$('[data-m]', el).forEach((b) => {
      b.onclick = () => {
        method = b.dataset.m;
        $$('[data-m]', el).forEach((x) => x.classList.toggle('on', x === b));
        Sound.play('pop');
      };
    });
    const payBtn = el.querySelector('#btnPay');
    if (payBtn) payBtn.onclick = async () => {
      const stop = UI.loading('Memproses pembayaran…');
      const r = await api.action(o.id, 'pay', { method });
      stop();
      if (!r.ok) { UI.toast({ title: 'Gagal', body: r.error, type: 'red', icon: 'x' }); return; }
      Sound.play('cash');
      if (S.vibe) { try { navigator.vibrate([80, 50, 80]); } catch (e) { } }
      UI.toast({ title: 'Pembayaran terkirim', body: `${fmt.money(o.fare)} via ${method}`, type: 'green', icon: 'cash' });
      setTimeout(() => Notify.show('Menunggu konfirmasi', 'Penjemput akan segera mengonfirmasi pembayaran Anda', { orderId: o.id }), 800);
      Router.refresh();
    };
    const chat2 = el.querySelector('#btnChat2');
    if (chat2) chat2.onclick = () => openChat(o);

    const stars = el.querySelector('#stars');
    if (stars) {
      $$('[data-s]', stars).forEach((b) => {
        b.onclick = async () => {
          const v = +b.dataset.s;
          $$('[data-s]', stars).forEach((x) => x.classList.toggle('on', +x.dataset.s <= v));
          await api.action(o.id, 'rate', { rating: v });
          const txt = el.querySelector('#rateTxt');
          if (txt) txt.textContent = ['', 'Kurang', 'Cukup', 'Baik', 'Sangat baik', 'Luar biasa!'][v];
          Sound.play('ok');
        };
      });
    }
    const again = el.querySelector('#btnAgain');
    if (again) again.onclick = async () => {
      S.order = null;
      Student.pickup = { lat: o.pickup.lat, lng: o.pickup.lng, name: o.pickupName, address: o.pickupName };
      Student.dest = { lat: o.dest.lat, lng: o.dest.lng, name: o.destName, address: o.destName };
      S.lastDest = Student.dest; LS.set('lastDest', Student.dest);
      Student.lastOrderEl = true;
      Router.go('home');
      setTimeout(async () => {
        const btn = document.querySelector('#btnOrder');
        if (btn) btn.click();
      }, 400);
    };
    const hm = el.querySelector('#btnHome');
    if (hm) hm.onclick = () => { S.order = null; Router.go('home'); };

    el._un = Bus.on('order', (n) => { if (n.id === o.id) Router.refresh(); });
  },
  destroy(el) { if (el._un) el._un(); }
};

/* ======================================================================
   RIWAYAT
   ====================================================================== */
const HistoryScreen = {
  withTab: true,
  tab: 'history',
  render() {
    return `
      <div class="pad">
        <div class="h1 mb12">Pesanan</div>
        <div class="seg mb14">
          <button class="on" data-f="all">Semua</button>
          <button data-f="active">Berjalan</button>
          <button data-f="done">Selesai</button>
          <button data-f="cancelled">Batal</button>
        </div>
        <div id="histList"><div class="shimmer" style="height:70px;margin-bottom:10px"></div>
        <div class="shimmer" style="height:70px;margin-bottom:10px"></div><div class="shimmer" style="height:70px"></div></div>
      </div>`;
  },
  async mount(el) {
    let filter = 'all';
    const load = async () => {
      const id = (S.me.role === 'driver') ? { driverId: S.me.id } : { studentId: S.me.id };
      const r = await api.get('/api/orders', Object.assign({ limit: 60 }, id));
      const list = (r.orders || []).filter((o) => filter === 'all' || (filter === 'active' ? ACTIVE.includes(o.status) : o.status === filter));
      const box = el.querySelector('#histList');
      if (!list.length) {
        box.innerHTML = `<div class="empty">${icon('list', 'lg')}<div class="small">Belum ada pesanan</div></div>`;
        return;
      }
      box.innerHTML = list.map((o) => `
        <div class="hitem" data-id="${o.id}">
          ${avatarOf((S.me.role === 'driver' ? o.studentName : o.driverName) || 'S', 'sm ' + (S.me.role === 'driver' ? 'cy' : 'pk'))}
          <div class="grow">
            <div class="route ellip">${esc(o.pickupName || 'Jemput')} <span class="dim">→</span> ${esc(o.destName || 'Tujuan')}</div>
            <div class="tiny">${fmt.date(o.createdAt)} · ${fmt.km(o.billedKm || o.km)}</div>
          </div>
          <div class="col" style="align-items:flex-end;gap:5px">
            <div class="fare">${fmt.money(o.fare)}</div>
            ${statusBadge(o.status)}
          </div>
        </div>`).join('');
      $$('[data-id]', box).forEach((row) => {
        row.onclick = () => HistoryScreen.detail(row.dataset.id, list);
      });
    };
    $$('[data-f]', el).forEach((b) => {
      b.onclick = () => { $$('[data-f]', el).forEach((x) => x.classList.remove('on')); b.classList.add('on'); filter = b.dataset.f; load(); };
    });
    await load();
    el._un = Bus.on('order', () => load());
  },
  detail(id, list) {
    const o = (list || []).find((x) => x.id === id);
    if (!o) return;
    UI.sheet({
      title: 'Detail pesanan',
      body: `
        <div class="center mb14">
          <div class="fare-big" style="font-size:34px">${fmt.money(o.fare)}</div>
          <div class="small mt6">${esc(o.code)} · ${fmt.date(o.createdAt)}</div>
          <div class="mt8">${statusBadge(o.status)}</div>
        </div>
        <div class="card tight mb12">
          <div class="kv"><span>${icon('pin', 'sm')} Jemput</span><b class="ellip" style="max-width:60%">${esc(o.pickupName)}</b></div>
          <div class="kv"><span>${icon('school', 'sm')} Tujuan</span><b class="ellip" style="max-width:60%">${esc(o.destName)}</b></div>
          <div class="kv"><span>${icon('route', 'sm')} Jarak</span><b>${fmt.km(o.billedKm || o.km)}</b></div>
          <div class="kv"><span>${icon('user', 'sm')} ${S.me.role === 'driver' ? 'Siswa' : 'Penjemput'}</span><b>${esc(S.me.role === 'driver' ? (o.studentName || '-') : (o.driverName || '-'))}</b></div>
          ${o.paymentMethod ? `<div class="kv"><span>${icon('cash', 'sm')} Pembayaran</span><b>${esc(o.paymentMethod)} ${o.paidAt ? '· ' + fmt.time(o.paidAt) : ''}</b></div>` : ''}
        </div>
        ${o.rating ? `<div class="card tight mb12"><div class="kv"><span>Penilaian</span><b>${'★'.repeat(o.rating)}</b></div></div>` : ''}
        ${(o.status === 'done' || o.status === 'cancelled') ? `<button class="btn primary block" id="rep">${icon('refresh')} Pesan lagi</button>` : ''}
        <div style="height:10px"></div>`,
      onMount(sh, close) {
        const rep = $('#rep', sh);
        if (rep) rep.onclick = async () => {
          close();
          Student.pickup = { lat: o.pickup.lat, lng: o.pickup.lng, name: o.pickupName, address: o.pickupName };
          Student.dest = { lat: o.dest.lat, lng: o.dest.lng, name: o.destName, address: o.destName };
          S.lastDest = Student.dest; LS.set('lastDest', Student.dest);
          S.order = null;
          Router.go('home');
          setTimeout(() => { const b = document.querySelector('#btnOrder'); if (b) b.click(); }, 400);
        };
      }
    });
  },
  destroy(el) { if (el._un) el._un(); }
};

/* ======================================================================
   NOTIFIKASI
   ====================================================================== */
const NotifScreen = {
  withTab: true, tab: 'notif',
  render() {
    const list = S.notifs;
    return `
      <div class="pad">
        <div class="between mb12">
          <div class="h1">Notifikasi</div>
          <button class="btn xs ghost" id="clr">Bersihkan</button>
        </div>
        ${list.length ? list.map((n) => `
          <div class="notif ${n.read ? '' : 'unread'}">
            <div class="ni">${icon(notifIcon(n.type))}</div>
            <div class="grow">
              <div class="nt">${esc(n.title)}</div>
              <div class="nb">${esc(n.body || '')}</div>
              <div class="tiny mt6">${fmt.ago(n.ts)}</div>
            </div>
          </div>`).join('') : `<div class="empty">${icon('bell', 'lg')}<div class="small">Belum ada notifikasi</div></div>`}
      </div>`;
  },
  mount(el) {
    const c = el.querySelector('#clr');
    if (c) c.onclick = () => { S.notifs = []; LS.set('notifs', []); Router.refresh(); UI.renderTab('notif'); };
    S.notifs.forEach((n) => n.read = true);
    LS.set('notifs', S.notifs);
    setTimeout(() => UI.renderTab(Router.current.name), 300);
  }
};

/* ======================================================================
   AKUN
   ====================================================================== */
const AccountScreen = {
  withTab: true, tab: 'account',
  render() {
    const me = S.me || {};
    const role = me.role === 'driver' ? 'Penjemput' : 'Siswa';
    return `
      <div class="pad">
        <div class="card center mb16" style="padding:22px">
          ${avatarOf(me.name, 'lg')}
          <div class="h1 mt10">${esc(me.name || '-')}</div>
          <div class="small">${esc(me.phone || '')} · <span class="badge cyan">${role}</span></div>
          ${me.role === 'driver' ? `<div class="row gap8 mt12" style="justify-content:center">
            <span class="chip on">${icon('scooter', 'sm')} ${esc(me.plate || '-')}</span>
            <span class="chip on">${esc(me.vehicle || 'Motor')}</span></div>` : ''}
        </div>

        <div class="card tight mb12">
          <div class="kv"><span>${icon('pin', 'sm')} Alamat ${me.role === 'driver' ? 'pangkalan' : 'rumah'}</span><b class="ellip" style="max-width:58%">${esc(me.homeAddress || 'Belum diatur')}</b></div>
          <div class="kv"><span>${icon('bolt', 'sm')} Koneksi</span><b>${S.online ? '<span class="badge green">Online</span>' : '<span class="badge red">Offline</span>'}</b></div>
          <div class="kv"><span>${icon('users', 'sm')} Pengguna online</span><b>${(S.presence.student || 0) + (S.presence.driver || 0)}</b></div>
        </div>

        <div class="list-item" id="mHome"><div class="li-ic">${icon('pin')}</div><div class="grow"><div class="h3">Ubah alamat rumah</div><div class="tiny">Pilih titik jemput utama di peta</div></div>${icon('right', 'sm')}</div>
        <div class="list-item" id="mSound"><div class="li-ic">${icon('bell')}</div><div class="grow"><div class="h3">Suara & getar</div><div class="tiny">${S.sound ? 'Aktif' : 'Nonaktif'}</div></div><div class="switch ${S.sound ? 'on' : ''}"><i></i></div></div>
        <div class="list-item" id="mNotif"><div class="li-ic">${icon('alarm')}</div><div class="grow"><div class="h3">Izin notifikasi</div><div class="tiny">${Notify.permission === 'granted' ? 'Diizinkan' : 'Belum diizinkan'}</div></div>${icon('right', 'sm')}</div>
        <div class="list-item" id="mInstall"><div class="li-ic">${icon('install')}</div><div class="grow"><div class="h3">Install aplikasi</div><div class="tiny">Pasang SANTARA di layar utama HP</div></div>${icon('right', 'sm')}</div>
        <div class="list-item" id="mAdmin"><div class="li-ic">${icon('sliders')}</div><div class="grow"><div class="h3">Pengaturan tarif & peta</div><div class="tiny">Tarif per km, Google Maps API key, data</div></div>${icon('right', 'sm')}</div>
        <div class="list-item" id="mRole"><div class="li-ic">${icon('refresh')}</div><div class="grow"><div class="h3">Ganti peran</div><div class="tiny">Masuk sebagai siswa atau penjemput</div></div>${icon('right', 'sm')}</div>
        <div class="list-item" id="mOut"><div class="li-ic" style="color:var(--red)">${icon('logout')}</div><div class="grow"><div class="h3" style="color:var(--red)">Keluar</div></div></div>
        <div class="center tiny mt18">SANTARA · Setia Antar Tanpa Ragu<br>v1.0</div>
      </div>`;
  },
  mount(el) {
    el.querySelector('#mHome').onclick = async () => {
      const r = await pickLocation({ title: 'Alamat rumah', value: S.me.home, placeholder: 'Cari alamat rumah…' });
      if (r) { Student.saveHomeMaybe(r); Router.refresh(); UI.toast({ title: 'Alamat disimpan', type: 'green', icon: 'check' }); }
    };
    const sw = el.querySelector('#mSound');
    sw.onclick = () => {
      S.sound = !S.sound; LS.set('sound', S.sound);
      S.vibe = S.sound; LS.set('vibe', S.vibe);
      sw.querySelector('.switch').classList.toggle('on', S.sound);
      sw.querySelector('.tiny').textContent = S.sound ? 'Aktif' : 'Nonaktif';
      if (S.sound) Sound.play('pop');
    };
    el.querySelector('#mNotif').onclick = async () => {
      const p = await Notify.ask();
      UI.toast({ title: p === 'granted' ? 'Notifikasi aktif' : 'Izin ditolak', body: p === 'granted' ? 'Notifikasi akan muncul walau layar mati' : 'Aktifkan lewat setelan browser', type: p === 'granted' ? 'green' : 'red', icon: p === 'granted' ? 'check' : 'x' });
      setTimeout(() => Router.refresh(), 600);
    };
    el.querySelector('#mInstall').onclick = () => App.install();
    el.querySelector('#mAdmin').onclick = () => Router.go('admin');
    el.querySelector('#mRole').onclick = async () => {
      const yes = await UI.confirm({ title: 'Ganti peran?', text: 'Anda akan diminta memilih peran lagi.', ok: 'Ganti' });
      if (yes) { LS.del('me'); S.me = null; Router.go('role'); }
    };
    el.querySelector('#mOut').onclick = async () => {
      const yes = await UI.confirm({ title: 'Keluar dari SANTARA?', ok: 'Keluar', danger: true, icon: 'logout' });
      if (yes) { LS.del('me'); S.me = null; S.order = null; Router.go('role'); }
    };
  }
};

/* ======================================================================
   PENJEMPUT
   ====================================================================== */
const Driver = {
  offer(order) {
    if (S.order && ACTIVE.includes(S.order.status)) return;
    if (Driver.offered && Driver.offered[order.id]) return;
    Driver.offered = Driver.offered || {};
    Driver.offered[order.id] = true;
    Sound.play('alert');
    if (S.vibe) { try { navigator.vibrate([120, 80, 120, 80, 200]); } catch (e) { } }
    const left = Math.round((S.settings.offerTimeoutMs || 30000) / 1000);
    let remain = left;
    const sh = UI.sheet({
      title: 'Penjemputan baru',
      dismissible: false,
      body: `
        <div class="center mb10">
          <div class="tiny">Estimasi pendapatan</div>
          <div class="big-fare">${fmt.money(order.estFare || order.fare)}</div>
          <div class="small mt6">${fmt.km(order.km)} · ± ${fmt.min(order.estMinutes)}</div>
        </div>
        <div class="card tight mb12">
          <div class="kv"><span>${icon('pin', 'sm')} Jemput</span><b class="ellip" style="max-width:62%">${esc(order.pickupName)}</b></div>
          <div class="kv"><span>${icon('school', 'sm')} Tujuan</span><b class="ellip" style="max-width:62%">${esc(order.destName)}</b></div>
          <div class="kv"><span>${icon('user', 'sm')} Siswa</span><b>${esc(order.studentName)}</b></div>
        </div>
        <div class="timer"><i id="tmrBar" style="width:100%"></i></div>
        <div class="center tiny mt8" id="tmrTxt">${left} detik</div>`,
      footer: `<div class="row gap10">
          <button class="btn ghost" id="no">Tolak</button>
          <button class="btn primary grow xl" id="yes">${icon('check')} Terima</button>
        </div>`,
      onMount(el, close) {
        const iv = setInterval(() => {
          remain -= 0.1;
          const bar = el.querySelector('#tmrBar');
          if (bar) bar.style.width = Math.max(0, (remain / left) * 100) + '%';
          const t = el.querySelector('#tmrTxt');
          if (t) t.textContent = Math.max(0, Math.ceil(remain)) + ' detik';
          if (remain <= 0) { clearInterval(iv); close(); }
        }, 100);
        el.querySelector('#yes').onclick = async () => {
          clearInterval(iv);
          const stop = UI.loading('Mengambil pesanan…');
          const r = await api.action(order.id, 'accept', { driverId: S.me.id });
          stop();
          if (!r.ok) { UI.toast({ title: 'Gagal', body: r.error, type: 'red', icon: 'x' }); close(); return; }
          Sound.play('ok');
          close();
          Router.go('dtrip');
        };
        el.querySelector('#no').onclick = () => { clearInterval(iv); close(); };
      }
    });
    return sh;
  },

  /* ------------------------------ dashboard ----------------------------- */
  home: {
    withTab: true, flat: true,
    render() {
      const d = (S.drivers.find((x) => x.id === S.me.id) || {});
      const online = !!d.online;
      const today = Driver.todayEarnings || 0;
      return `
        <div class="map-wrap"><div class="map" id="dMap"></div></div>
        <div class="map-overlay">
          <div class="top-float">
            <div class="card glass" style="padding:14px" id="driveCard">
              <div class="between">
                <div class="row gap10">
                  <div class="avatar ${online ? 'gr' : ''}" style="${online ? '' : 'background:rgba(255,255,255,.1);color:#8E9BBE'}">${icon('scooter')}</div>
                  <div>
                    <div class="h2">${online ? 'Anda ONLINE' : 'Anda OFFLINE'}</div>
                    <div class="tiny">${online ? 'Siap menerima penjemputan' : 'Nyalakan untuk dapat order'}</div>
                  </div>
                </div>
                <div class="switch ${online ? 'on' : ''}" id="swOnline"><i></i></div>
              </div>
            </div>
          </div>
          <div class="bottom-float">
            <div class="row gap10 mb10">
              <div class="stat grow"><div class="v">${fmt.moneyShort(today)}</div><div class="k">Hari ini</div></div>
              <div class="stat grow"><div class="v">${d.trips || 0}</div><div class="k">Trip</div></div>
              <div class="stat grow"><div class="v">${d.rating || '5.0'}</div><div class="k">Rating</div></div>
            </div>
            <div class="est">
              <div class="row gap10">
                ${icon('radar')}
                <div class="grow"><div class="h3">${online ? 'Menunggu penjemputan…' : 'Nyalakan status online'}</div>
                <div class="tiny" style="text-transform:none;letter-spacing:0">${online ? 'Order masuk akan muncul otomatis di layar ini' : 'Geser tombol di atas untuk mulai bekerja'}</div></div>
              </div>
            </div>
          </div>
          <div class="recenter"><button class="icon-btn" id="btnRecenter">${icon('crosshair')}</button></div>
        </div>`;
    },
    mount(el) {
      const m = mountMap(el, '#dMap', { zoom: 16, center: (S.loc || (S.drivers.find((x) => x.id === S.me.id) || {}).lat ? { lat: (S.drivers.find((x) => x.id === S.me.id) || {}).lat, lng: (S.drivers.find((x) => x.id === S.me.id) || {}).lng } : centerFor()) });
      el._map = m;
      Driver.startTracking(el, m);
      const sw = el.querySelector('#swOnline');
      sw.onclick = async () => {
        const now = !sw.classList.contains('on');
        sw.classList.toggle('on', now);
        Net.send({ t: 'online', online: now, lat: S.loc && S.loc.lat, lng: S.loc && S.loc.lng });
        await api.put('/api/drivers', { id: S.me.id, online: now, lat: S.loc && S.loc.lat, lng: S.loc && S.loc.lng });
        if (now) {
          try { const p = await GPS.get(); S.loc = p; m.setCenter(p.lat, p.lng, 17); } catch (e) { }
          UI.toast({ title: 'Anda online', body: 'Menunggu penjemputan masuk', type: 'green', icon: 'bolt' });
        } else UI.toast({ title: 'Anda offline', icon: 'power' });
        Driver.paintOnline(el);
        setTimeout(() => { Driver.paintOnline(el); Router.refresh(); }, 1200);
      };
      el.querySelector('#btnRecenter').onclick = () => {
        if (S.loc) m.setCenter(S.loc.lat, S.loc.lng, 17);
        else UI.toast({ title: 'Lokasi belum tersedia', type: 'red', icon: 'x' });
      };
      Driver.loadWallet();
      el._un = Bus.on('drivers', () => Driver.paintOnline(el));
    },
    destroy(el) { if (el._map) el._map.destroy(); if (el._un) el._un(); }
  },

  paintOnline(el) {
    if (!el || !el.isConnected) return;
    const me = S.drivers.find((x) => x.id === S.me.id) || {};
    const online = !!me.online;
    const sw = el.querySelector('#swOnline');
    const card = el.querySelector('#driveCard');
    if (sw) sw.classList.toggle('on', online);
    if (card) {
      card.querySelector('.h2').textContent = online ? 'Anda ONLINE' : 'Anda OFFLINE';
      card.querySelector('.tiny').textContent = online ? 'Siap menerima penjemputan' : 'Nyalakan untuk dapat order';
      const av = card.querySelector('.avatar');
      if (av) {
        av.className = 'avatar ' + (online ? 'gr' : '');
        if (!online) { av.style.background = 'rgba(255,255,255,.1)'; av.style.color = '#8E9BBE'; }
        else { av.style.background = ''; av.style.color = ''; }
      }
    }
    const hint = el.querySelector('.bottom-float .h3');
    const hint2 = el.querySelector('.bottom-float .tiny');
    if (hint) hint.textContent = online ? 'Menunggu penjemputan…' : 'Nyalakan status online';
    if (hint2) hint2.textContent = online ? 'Order masuk akan muncul otomatis di layar ini' : 'Geser tombol di atas untuk mulai bekerja';
  },

  async loadWallet() {
    const r = await api.get('/api/orders', { driverId: S.me.id, limit: 100 });
    const list = (r.orders || []).filter((o) => o.status === 'done');
    const start = new Date(); start.setHours(0, 0, 0, 0);
    Driver.todayEarnings = list.filter((o) => (o.doneAt || o.createdAt) >= start.getTime()).reduce((a, o) => a + (o.fare || 0), 0);
    Driver.walletList = list;
    Driver.totalEarnings = list.reduce((a, o) => a + (o.fare || 0), 0);
  },

  startTracking(el, m) {
    const send = (p) => {
      S.loc = p;
      Net.send({ t: 'loc', lat: p.lat, lng: p.lng, heading: p.heading, speed: p.speed });
      if (m) {
        m.addMarker('me', p.lat, p.lng, { type: 'driver', title: 'Posisi saya' });
        MapKit.rotate(m, 'me', p.heading);
      }
      if (S.me.role === 'driver' && S.drivers.find((d) => d.id === S.me.id) && (S.drivers.find((d) => d.id === S.me.id).online)) {
        // throttle update ke REST
        clearTimeout(Driver._restT);
        Driver._restT = setTimeout(() => api.put('/api/drivers', { id: S.me.id, lat: p.lat, lng: p.lng, online: true }), 8000);
      }
    };
    GPS.get().then(send).catch(() => { });
    GPS.start(send, (e) => { console.warn('gps', e && e.message); });
  },

  /* -------------------------------- trip -------------------------------- */
  trip: {
    withTab: false, flat: true,
    render() {
      const o = S.order;
      const target = (o.status === 'pending' || o.status === 'accepted') ? o.pickup : o.dest;
      const label = (o.status === 'pending' || o.status === 'accepted') ? 'Titik jemput' : (o.destName || 'Tujuan');
      const btns = {
        accepted: ['primary', 'check', 'Sampai di lokasi jemput', 'arrive_pickup'],
        arrived_pickup: ['primary', 'scooter', 'Mulai antar', 'start'],
        on_trip: ['pink', 'pin', 'Sampai di tujuan', 'arrive_dest'],
        arrived_dest: ['ghost', 'cash', 'Tunggu pembayaran siswa', null],
        paid: ['green', 'check', 'Terima pembayaran', 'confirm_pay']
      }[o.status] || ['ghost', 'clock', o.statusLabel, null];
      return `
        <div class="map-wrap"><div class="map" id="dtMap"></div></div>
        <div class="map-overlay">
          <div class="top-float">
            <div class="locbar">
              <span class="pulse-dot"></span>
              <div class="grow"><div class="tiny">${esc(label)}</div><div class="h3 ellip">${esc((o.status === 'pending' || o.status === 'accepted') ? (o.pickupName || 'Titik jemput') : (o.destName || 'Tujuan'))}</div></div>
              <button class="icon-btn cy" id="btnNav">${icon('nav')}</button>
            </div>
          </div>
          <div class="bottom-float" style="padding-bottom:calc(18px + var(--sb))">
            <div class="est">
              <div class="driver-card mb12">
                ${avatarOf(o.studentName, 'lg pk')}
                <div class="grow">
                  <div class="nm">${esc(o.studentName)}</div>
                  <div class="tiny" style="text-transform:none;letter-spacing:0">${esc(o.pickupName)} → ${esc(o.destName)}</div>
                  <div class="row gap8 mt6">
                    <span class="badge">${fmt.km(o.km)}</span>
                    <span class="badge pink">${fmt.money(o.status === 'arrived_dest' || o.status === 'paid' || o.status === 'done' ? o.fare : o.estFare)}</span>
                  </div>
                </div>
                <div class="col gap8">
                  <button class="icon-btn cy" id="btnCall">${icon('phone')}</button>
                  <button class="icon-btn pk" id="btnChat">${icon('chat')}</button>
                </div>
              </div>
              ${btns[3] ? `<button class="btn ${btns[0]} big-cta block" id="btnAct">${icon(btns[1])} ${btns[2]}</button>` : `
                <div class="center">
                  <div class="radar" style="width:120px;height:120px"><span class="wave"></span><span class="wave"></span>
                    <span class="core" style="width:56px;height:56px;border-radius:20px">${icon('cash', 'lg')}</span></div>
                  <div class="h3 mt10">Menunggu pembayaran</div>
                  <div class="small">${fmt.money(o.fare)} · notifikasi muncul otomatis saat siswa bayar</div>
                </div>`}
              <div class="row gap10 mt10">
                <button class="btn ghost grow sm" id="btnCancel">${icon('x')} Batalkan</button>
                <button class="btn ghost grow sm" id="btnTrack">${icon('target')} Lacak</button>
              </div>
            </div>
          </div>
        </div>`;
    },
    mount(el) {
      const o = S.order;
      const m = mountMap(el, '#dtMap', { zoom: 15 });
      el._map = m;
      m.addMarker('pickup', o.pickup.lat, o.pickup.lng, { type: 'pickup', title: o.pickupName });
      m.addMarker('dest', o.dest.lat, o.dest.lng, { type: 'dest', title: o.destName });
      if (o.geometry) m.drawRoute(o.geometry);
      (function () {
        const me = S.driverLocs[S.me.id] || S.loc;
        if (me) { m.addMarker('me', me.lat, me.lng, { type: 'driver', title: 'Saya' }); MapKit.rotate(m, 'me', me.heading); }
      })();
      const fitNow = () => {
        const target = (o.status === 'pending' || o.status === 'accepted') ? o.pickup : o.dest;
        const me = S.driverLocs[S.me.id] || S.loc;
        m.fit(me ? [me, target] : [o.pickup, o.dest], [90, 220]);
      };
      fitNow();
      Driver.startTracking(el, m);

      el.querySelector('#btnNav').onclick = () => {
        const me = S.loc || o.pickup;
        const target = (o.status === 'pending' || o.status === 'accepted' || o.status === 'arrived_pickup') ? o.pickup : o.dest;
        openNav(me, target);
      };
      el.querySelector('#btnCall').onclick = () => callPhone(o.studentPhone);
      el.querySelector('#btnChat').onclick = () => openChat(o);
      el.querySelector('#btnTrack').onclick = () => {
        const me = S.loc;
        if (me) m.setCenter(me.lat, me.lng, 17);
      };
      const act = el.querySelector('#btnAct');
      if (act) act.onclick = async () => {
        const map = {
          'Sampai di lokasi jemput': 'arrive_pickup', 'Mulai antar': 'start',
          'Sampai di tujuan': 'arrive_dest', 'Terima pembayaran': 'confirm_pay'
        };
        const action = map[act.textContent.trim()] || (act.dataset.act);
        if (!action) return;
        const stop = UI.loading('Memproses…');
        const r = await api.action(o.id, action, { driverId: S.me.id });
        stop();
        if (!r.ok) { UI.toast({ title: 'Gagal', body: r.error, type: 'red', icon: 'x' }); return; }
        Sound.play(action === 'confirm_pay' ? 'cash' : 'ok');
        if (action === 'arrive_dest') UI.toast({ title: 'Tagihan dikirim', body: `${fmt.money(r.order.fare)} menunggu pembayaran`, type: 'pink', icon: 'wallet' });
        if (action === 'confirm_pay') { UI.ok('Pembayaran diterima', fmt.money(o.fare)); setTimeout(() => { S.order = null; Router.go('dhome'); }, 1400); return; }
        Router.refresh();
      };
      el.querySelector('#btnCancel').onclick = async () => {
        const yes = await UI.confirm({ title: 'Batalkan penjemputan?', ok: 'Batalkan', danger: true, icon: 'x' });
        if (!yes) return;
        const r = await api.action(o.id, 'cancel', { reason: 'dibatalkan penjemput' });
        if (r.ok) { S.order = null; Router.go('dhome'); }
      };
      el._un = Bus.on('order', (n) => { if (n.id === o.id) Router.refresh(); });
      el._un2 = Bus.on('driver:loc', (d) => { if (d.driverId === S.me.id && S.loc) { m.addMarker('me', S.loc.lat, S.loc.lng, { type: 'driver', title: 'Saya' }); MapKit.rotate(m, 'me', S.loc.heading); } });
    },
    destroy(el) { if (el._map) el._map.destroy(); if (el._un) el._un(); if (el._un2) el._un2(); }
  },

  wallet: {
    withTab: true, tab: 'dwallet',
    render() {
      return `<div class="pad">
        <div class="h1 mb12">Dompet</div>
        <div class="card mb14" style="background:linear-gradient(135deg,rgba(34,230,255,.14),rgba(122,92,255,.12))">
          <div class="tiny">Pendapatan hari ini</div>
          <div class="fare-big" style="font-size:38px">${fmt.money(Driver.todayEarnings || 0)}</div>
          <div class="row gap10 mt14">
            <div class="stat grow"><div class="v">${(Driver.walletList || []).length}</div><div class="k">Trip selesai</div></div>
            <div class="stat grow"><div class="v">${fmt.moneyShort(Driver.totalEarnings || 0)}</div><div class="k">Total</div></div>
          </div>
        </div>
        <div class="tiny mb8">Riwayat trip</div>
        <div id="walletList"><div class="shimmer" style="height:70px"></div></div>
      </div>`;
    },
    async mount(el) {
      await Driver.loadWallet();
      const box = el.querySelector('#walletList');
      const list = (Driver.walletList || []).slice(0, 30);
      box.innerHTML = list.length ? list.map((o) => `
        <div class="hitem">
          ${avatarOf(o.studentName, 'sm pk')}
          <div class="grow"><div class="route ellip">${esc(o.pickupName)} → ${esc(o.destName)}</div>
          <div class="tiny">${fmt.date(o.doneAt || o.createdAt)} · ${fmt.km(o.billedKm || o.km)}</div></div>
          <div class="col" style="align-items:flex-end;gap:4px"><div class="fare">${fmt.money(o.fare)}</div><div class="tiny">${esc(o.paymentMethod || '')}</div></div>
        </div>`).join('') : `<div class="empty">${icon('wallet', 'lg')}<div class="small">Belum ada trip selesai</div></div>`;
      const tb = el.querySelector('.fare-big');
      if (tb) tb.textContent = fmt.money(Driver.todayEarnings || 0);
    }
  }
};

/* ======================================================================
   ADMIN / PENGATURAN
   ====================================================================== */
const AdminScreen = {
  render() {
    const st = AdminScreen.stats || {};
    const r = S.settings.rates;
    return `
      <div class="pad">
        <div class="between mb14">
          <div class="h1">Pengaturan</div>
          <button class="icon-btn" id="closeX">${icon('x')}</button>
        </div>

        <div class="row gap10 mb16">
          <div class="stat grow"><div class="v">${st.active || 0}</div><div class="k">Aktif</div></div>
          <div class="stat grow"><div class="v">${st.done || 0}</div><div class="k">Selesai</div></div>
          <div class="stat grow"><div class="v">${fmt.moneyShort(st.revenue || 0)}</div><div class="k">Omzet</div></div>
        </div>

        <div class="card mb14">
          <div class="tiny mb10">Tarif antar-jemput</div>
          <div class="field"><label class="label">Tarif dasar (Rp)</label><input class="input" id="rBase" type="number" value="${r.base}"></div>
          <div class="field"><label class="label">Km termasuk tarif dasar</label><input class="input" id="rInc" type="number" step="0.5" value="${r.includedKm}"></div>
          <div class="field"><label class="label">Biaya per km (Rp)</label><input class="input" id="rKm" type="number" value="${r.perKm}"></div>
          <div class="field"><label class="label">Biaya minimum (Rp)</label><input class="input" id="rMin" type="number" value="${r.minFare}"></div>
          <div class="field"><label class="label">Pembulatan (Rp)</label><input class="input" id="rRound" type="number" value="${r.roundTo || 0}"></div>
          <button class="btn primary block" id="saveRate">${icon('check')} Simpan tarif</button>
          <div class="tiny mt10" style="text-transform:none;letter-spacing:0">Contoh: 3 km → ${fmt.money(AdminScreen.preview(r, 3))} · 7 km → ${fmt.money(AdminScreen.preview(r, 7))}</div>
        </div>

        <div class="card mb14">
          <div class="tiny mb10">Google Maps</div>
          <div class="field"><label class="label">Google Maps API Key (opsional)</label>
            <input class="input" id="gKey" placeholder="AIza..." value="${esc(S.settings.googleKey || '')}"></div>
          <div class="row gap8 mb10">
            <span class="badge ${S.settings.hasGoogleKey ? 'green' : 'gray'}">${S.settings.hasGoogleKey ? 'Google Maps aktif' : 'Memakai OpenStreetMap'}</span>
          </div>
          <button class="btn outline block" id="saveKey">${icon('pin')} Simpan & pakai Google Maps</button>
          <div class="tiny mt10" style="text-transform:none;letter-spacing:0">Kosongkan untuk kembali ke peta OpenStreetMap (gratis). Butuh Directions + Geocoding API di Google Cloud.</div>
        </div>

        <div class="card mb14">
          <div class="tiny mb10">Tempat les / tujuan</div>
          <div id="placeList">${S.places.map((p) => `
            <div class="list-item"><div class="li-ic" style="color:var(--amber)">${icon('school')}</div>
              <div class="grow"><div class="h3 ellip">${esc(p.name)}</div><div class="tiny ellip">${esc(p.address || '')}</div></div>
              <button class="icon-btn" data-del-place="${p.id}">${icon('trash')}</button></div>`).join('')}</div>
          <button class="btn ghost block mt10" id="addPlace">${icon('plus')} Tambah dari peta</button>
        </div>

        <div class="card mb14">
          <div class="tiny mb10">Data penjemput & siswa</div>
          <div class="row gap10 mb10">
            <button class="btn ghost grow sm" id="addDriver">${icon('plus')} Penjemput</button>
            <button class="btn ghost grow sm" id="testNotif">${icon('bell')} Tes notifikasi</button>
          </div>
          <div id="peopleList"></div>
        </div>

        <div class="card mb14">
          <div class="tiny mb10">Pemeliharaan</div>
          <div class="row gap10">
            <button class="btn ghost grow sm" id="clearOrders">Bersihkan pesanan</button>
            <button class="btn red grow sm" id="resetAll">Reset semua data</button>
          </div>
        </div>
        <div class="center tiny">Server: ${esc(location.host)} · koneksi ${S.online ? 'online' : 'offline'}</div>
      </div>`;
  },
  preview(r, km) {
    let f = (+r.base) + Math.max(0, km - (+r.includedKm)) * (+r.perKm);
    f = Math.max(+r.minFare, f);
    const rt = +r.roundTo || 0;
    return rt > 0 ? Math.ceil(f / rt) * rt : f;
  },
  async mount(el) {
    const s = await api.get('/api/stats');
    AdminScreen.stats = s.stats || {};
    const badge = () => { };
    const paintStats = () => {
      const st = AdminScreen.stats;
      const box = el.querySelector('.row.gap10');
      if (box) box.innerHTML = `
        <div class="stat grow"><div class="v">${st.active || 0}</div><div class="k">Aktif</div></div>
        <div class="stat grow"><div class="v">${st.done || 0}</div><div class="k">Selesai</div></div>
        <div class="stat grow"><div class="v">${fmt.moneyShort(st.revenue || 0)}</div><div class="k">Omzet</div></div>`;
    };
    paintStats();

    el.querySelector('#closeX').onclick = () => Router.back();

    const paintPeople = async () => {
      const b = await api.get('/api/bootstrap');
      S.drivers = b.drivers; S.students = b.students; S.places = b.places;
      el.querySelector('#peopleList').innerHTML = [
        ...b.drivers.map((d) => `<div class="list-item">${avatarOf(d.name, 'sm cy')}<div class="grow"><div class="h3">${esc(d.name)}</div><div class="tiny">${esc(d.plate || '')} · ${d.online ? 'online' : 'offline'}</div></div><button class="icon-btn" data-del-driver="${d.id}">${icon('trash')}</button></div>`),
        ...b.students.map((s2) => `<div class="list-item">${avatarOf(s2.name, 'sm pk')}<div class="grow"><div class="h3">${esc(s2.name)}</div><div class="tiny">${esc(s2.phone || '')}</div></div><button class="icon-btn" data-del-student="${s2.id}">${icon('trash')}</button></div>`)
      ].join('');
      $$('[data-del-driver]', el).forEach((b2) => b2.onclick = async () => { await api.del('/api/drivers?id=' + b2.dataset.delDriver); paintPeople(); });
      $$('[data-del-student]', el).forEach((b2) => b2.onclick = async () => { await api.del('/api/students?id=' + b2.dataset.delStudent); paintPeople(); });
    };
    await paintPeople();

    $$('[data-del-place]', el).forEach((b) => b.onclick = async () => {
      await api.del('/api/places?id=' + b.dataset.delPlace);
      const r2 = await api.get('/api/bootstrap'); S.places = r2.places;
      UI.toast({ title: 'Tempat dihapus', type: 'green', icon: 'check' });
      Router.refresh();
    });

    el.querySelector('#saveRate').onclick = async () => {
      const rates = {
        base: +el.querySelector('#rBase').value || 0,
        includedKm: +el.querySelector('#rInc').value || 0,
        perKm: +el.querySelector('#rKm').value || 0,
        minFare: +el.querySelector('#rMin').value || 0,
        roundTo: +el.querySelector('#rRound').value || 0
      };
      const r2 = await api.put('/api/settings', { rates });
      if (r2.ok) { S.settings.rates = r2.settings.rates; UI.toast({ title: 'Tarif disimpan', body: 'Berlaku untuk semua pesanan baru', type: 'green', icon: 'check' }); Sound.play('ok'); }
    };

    el.querySelector('#saveKey').onclick = async () => {
      const key = el.querySelector('#gKey').value.trim();
      const r2 = await api.put('/api/settings', { googleKey: key });
      S.settings.googleKey = key; S.settings.hasGoogleKey = !!key;
      UI.toast({ title: key ? 'Google Maps diaktifkan' : 'Kembali ke OpenStreetMap', body: 'Muat ulang halaman untuk menerapkan peta', type: 'green', icon: 'check' });
      setTimeout(() => location.reload(), 1200);
    };

    el.querySelector('#addPlace').onclick = async () => {
      const p = await pickLocation({ title: 'Tambah tempat les', placeholder: 'Cari tempat les…' });
      if (!p) return;
      UI.sheet({
        title: 'Nama tempat',
        body: `<div class="field"><label class="label">Nama</label><input class="input" id="pn" value="${esc(p.name || '')}"></div>
               <div class="field"><label class="label">Alamat</label><textarea class="input" id="pa">${esc(p.address || '')}</textarea></div>`,
        footer: `<button class="btn primary block" id="ok">Simpan</button>`,
        onMount(sh, close) {
          $('#ok', sh).onclick = async () => {
            await api.post('/api/places', { name: $('#pn', sh).value || 'Tempat les', address: $('#pa', sh).value, lat: p.lat, lng: p.lng, kind: 'les' });
            close(); UI.toast({ title: 'Tempat ditambahkan', type: 'green', icon: 'check' }); Router.refresh();
          };
        }
      });
    };

    el.querySelector('#addDriver').onclick = () => {
      UI.sheet({
        title: 'Tambah penjemput',
        body: `
          <div class="field"><label class="label">Nama</label><input class="input" id="dn" placeholder="Pak Slamet"></div>
          <div class="field"><label class="label">No. HP</label><input class="input" id="dp" type="tel" placeholder="0813xxxx"></div>
          <div class="field"><label class="label">Plat nomor</label><input class="input" id="dt" placeholder="AG 1234 XY"></div>
          <div class="field"><label class="label">Kendaraan</label>
            <select class="input" id="dv"><option>Motor</option><option>Mobil</option></select></div>`,
        footer: `<button class="btn primary block" id="ok">Simpan</button>`,
        onMount(sh, close) {
          $('#ok', sh).onclick = async () => {
            await api.post('/api/drivers', { name: $('#dn', sh).value, phone: $('#dp', sh).value, plate: $('#dt', sh).value, vehicle: $('#dv', sh).value });
            close(); UI.toast({ title: 'Penjemput ditambahkan', type: 'green', icon: 'check' }); paintPeople();
          };
        }
      });
    };

    el.querySelector('#testNotif').onclick = async () => {
      await Notify.ask();
      Notify.show('SANTARA · tes notifikasi', 'Notifikasi pembayaran akan tampil seperti ini', {});
      UI.toast({ title: 'Notifikasi terkirim', body: Notification.permission === 'granted' ? 'Lihat di panel notifikasi HP' : 'Izin belum diberikan', type: Notification.permission === 'granted' ? 'green' : 'red', icon: 'bell' });
    };

    el.querySelector('#clearOrders').onclick = async () => {
      const yes = await UI.confirm({ title: 'Bersihkan semua pesanan?', text: 'Data siswa, penjemput, dan tarif tetap aman.', ok: 'Bersihkan', danger: true, icon: 'trash' });
      if (!yes) return;
      await api.post('/api/reset', { ordersOnly: true });
      S.order = null; UI.toast({ title: 'Pesanan dibersihkan', type: 'green', icon: 'check' });
    };

    el.querySelector('#resetAll').onclick = async () => {
      const yes = await UI.confirm({ title: 'Reset semua data?', text: 'Semua siswa, penjemput, pesanan, dan tarif kembali ke bawaan.', ok: 'Reset', danger: true, icon: 'trash' });
      if (!yes) return;
      await api.post('/api/reset', {});
      UI.toast({ title: 'Data direset', type: 'green', icon: 'check' });
      setTimeout(() => location.reload(), 900);
    };
  }
};
