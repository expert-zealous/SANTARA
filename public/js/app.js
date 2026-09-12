/* =========================================================
   SANTARA — App bootstrap: peran, login, navigasi, PWA
   ========================================================= */
'use strict';

const App = {
  async boot() {
    this.clock();
    this.registerSW();
    try {
      const b = await api.get('/api/bootstrap');
      S.settings = Object.assign(S.settings, b.settings || {});
      S.places = b.places || []; S.drivers = b.drivers || []; S.students = b.students || [];
    } catch (e) {
      UI.toast({ title: 'Server tidak terjangkau', body: 'Periksa koneksi ke komputer server', type: 'red', icon: 'x' });
    }
    if (S.me && S.me.id) {
      // sinkronkan profil & ambil pesanan aktif
      if (S.me.role === 'driver') {
        api.post('/api/drivers', { id: S.me.id, name: S.me.name, phone: S.me.phone, plate: S.me.plate, vehicle: S.me.vehicle });
        Driver.loadWallet();
      } else {
        api.post('/api/students', { id: S.me.id, name: S.me.name, phone: S.me.phone });
      }
      const r = await api.get('/api/orders', S.me.role === 'driver' ? { driverId: S.me.id, active: '1' } : { studentId: S.me.id, active: '1' });
      if (r.orders && r.orders.length) S.order = r.orders[0];
      if (S.me.role === 'student') {
        const h = await api.get('/api/orders', { studentId: S.me.id, limit: 1 });
        if (h.orders && h.orders[0]) S.lastOrder = h.orders[0];
      }
    }
    Net.connect();
    this.bind();
    setTimeout(() => this.start(), 1400);
  },

  start() {
    if (!S.onboarded) return Router.go('onboard');
    if (!S.me || !S.me.id) return Router.go('role');
    App.routeByOrder(true);
  },

  routeByOrder(first) {
    if (!S.me) return Router.go('role');
    const o = S.order;
    if (S.me.role === 'student') {
      let want = 'home';
      if (o) {
        if (o.status === 'pending') want = 'wait';
        else if (['accepted', 'arrived_pickup', 'on_trip'].includes(o.status)) want = 'trip';
        else if (['arrived_dest', 'paid', 'done'].includes(o.status)) want = 'pay';
      }
      return Router.go(want, {}, { force: first });
    }
    return Router.go(o && ACTIVE.includes(o.status) ? 'dtrip' : 'dhome', {}, { force: first });
  },

  syncScreen(o) {
    if (!S.me) return;
    const cur = Router.current && Router.current.name;
    if (S.me.role === 'student') {
      let want = 'home';
      if (o) {
        if (o.status === 'pending') want = 'wait';
        else if (['accepted', 'arrived_pickup', 'on_trip'].includes(o.status)) want = 'trip';
        else if (['arrived_dest', 'paid', 'done'].includes(o.status)) want = 'pay';
      }
      if (cur !== want) Router.go(want);
    } else {
      const want = (o && ACTIVE.includes(o.status)) ? 'dtrip' : 'dhome';
      if (cur !== want) Router.go(want);
    }
  },

  bind() {
    Bus.on('order', (o) => App.syncScreen(o));
    Bus.on('notif', () => { if (Router.current && Router.current.name === 'notif') Router.refresh(); });
    Bus.on('settings', () => { });
    Bus.on('net:online', () => {
      Net.hello();
      if (S.me) {
        api.get('/api/orders', S.me.role === 'driver' ? { driverId: S.me.id, active: '1' } : { studentId: S.me.id, active: '1' })
          .then((r) => { if (r.orders && r.orders.length) { S.order = r.orders[0]; App.routeByOrder(); } });
      }
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvent = e; });
    window.addEventListener('appinstalled', () => { S.installEvent = null; UI.toast({ title: 'SANTARA terpasang', body: 'Buka dari layar utama HP', type: 'green', icon: 'check' }); });
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.t === 'notificationclick') { window.focus(); if (e.data.orderId) Router.go('pay'); }
      });
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Net.send({ t: 'ping' }); });
  },

  clock() {
    const t = () => { const d = new Date(); const el = $('#sbTime'); if (el) el.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    t(); setInterval(t, 20000);
  },

  registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      navigator.serviceWorker.ready.then((r) => { S.swReady = r; });
    }).catch(() => { });
  },

  install() {
    if (S.installEvent) { S.installEvent.prompt(); S.installEvent.userChoice.then(() => { S.installEvent = null; }); return; }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    UI.sheet({
      title: 'Pasang SANTARA',
      body: `
        <div class="center">
          <img src="./assets/logo.png" alt="SANTARA" style="width:78%;max-width:250px;margin:6px auto 14px">
          <div class="h2">Jalankan seperti aplikasi HP</div>
          <div class="small mt10" style="line-height:1.7">
            ${ios
          ? '1. Tekan tombol <b>Bagikan</b> (kotak dengan panah ke atas) di browser Safari.<br>2. Pilih <b>Tambah ke Layar Utama</b>.<br>3. Buka SANTARA dari ikon di layar utama.'
          : '1. Buka menu browser (titik tiga di kanan atas).<br>2. Pilih <b>Install aplikasi</b> / <b>Tambah ke Layar Utama</b>.<br>3. Ikon SANTARA muncul di layar utama HP.'}
          </div>
        </div>
        <div class="card tight mt16"><div class="kv"><span>${icon('pin', 'sm')} Alamat aplikasi</span><b style="font-size:12px">${esc(location.origin)}</b></div>
        <div class="kv"><span>${icon('info', 'sm')} Mode</span><b>${navigator.standalone || window.matchMedia('(display-mode: standalone)').matches ? 'Terpasang' : 'Browser'}</b></div></div>`
    });
  }
};

/* ======================================================================
   ONBOARDING
   ====================================================================== */
Router.register('onboard', {
  render() {
    return `${onboardHTML(0)}
      <div class="pad center" style="padding-top:0">
        <div class="dots" id="dots"><i class="on"></i><i></i><i></i></div>
        <button class="btn primary big-cta block" id="next">Lanjut</button>
        <button class="btn ghost block sm mt10" id="skip">Lewati</button>
      </div>`;
  },
  mount(el) {
    let i = 0;
    const paint = () => {
      el.innerHTML = `${onboardHTML(i)}
        <div class="pad center" style="padding-top:0">
          <div class="dots" id="dots">${[0, 1, 2].map((n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
          <button class="btn primary big-cta block" id="next">${i === 2 ? 'Mulai sekarang' : 'Lanjut'}</button>
          ${i < 2 ? '<button class="btn ghost block sm mt10" id="skip">Lewati</button>' : ''}
        </div>`;
      el.querySelector('#next').onclick = () => {
        Sound.play('pop');
        if (i < 2) { i++; paint(); } else { S.onboarded = true; LS.set('onboarded', true); Router.go('role'); }
      };
      const sk = el.querySelector('#skip');
      if (sk) sk.onclick = () => { S.onboarded = true; LS.set('onboarded', true); Router.go('role'); };
    };
    paint();
  }
});

/* ======================================================================
   PILIH PERAN
   ====================================================================== */
Router.register('role', {
  render() {
    return `
      <div class="role-bg" style="background-image:url('./assets/hero-ride.jpg')"></div>
      <div class="pad center" style="padding-top:26px;position:relative;z-index:1">
        <img src="./assets/logo.png" alt="SANTARA" style="width:76%;max-width:260px;margin:0 auto 8px">
        <div class="tiny" style="letter-spacing:.24em">SETIA ANTAR TANPA RAGU</div>
      </div>
      <div class="pad-h" style="padding-top:18px;position:relative;z-index:1">
        <div class="role-card mb14" data-role="student">
          <div class="glowblob" style="background:#22E6FF"></div>
          <div class="role-illu">
            <svg viewBox="0 0 220 110" style="width:100%;height:100%">
              <defs><linearGradient id="rg1" x1="0" x2="1"><stop offset="0" stop-color="#22E6FF"/><stop offset="1" stop-color="#7A5CFF"/></linearGradient></defs>
              <rect x="18" y="60" width="80" height="42" rx="8" fill="#141C42" stroke="url(#rg1)" stroke-width="2.5"/>
              <path d="M18 60 58 34 98 60" fill="#182250" stroke="url(#rg1)" stroke-width="2.5"/>
              <circle cx="120" cy="74" r="16" fill="none" stroke="#FF3DC8" stroke-width="3"/>
              <path d="M120 58v32M104 74h32" stroke="#FF3DC8" stroke-width="3" stroke-linecap="round"/>
              <path d="M140 74h34" stroke="#3A4680" stroke-width="3" stroke-dasharray="5 6"/>
              <circle cx="190" cy="60" r="14" fill="url(#rg1)"/>
              <path d="M184 60l5 5 10-11" stroke="#06101F" stroke-width="3.2" fill="none" stroke-linecap="round"/>
            </svg>
          </div>
          <h3>Saya Siswa / Orang Tua</h3>
          <p>Pesan antar-jemput, pantau penjemput live, bayar setelah sampai.</p>
        </div>
        <div class="role-card" data-role="driver">
          <div class="glowblob" style="background:#FF3DC8"></div>
          <div class="role-illu">
            <svg viewBox="0 0 220 110" style="width:100%;height:100%">
              <defs><linearGradient id="rg2" x1="0" x2="1"><stop offset="0" stop-color="#FF3DC8"/><stop offset="1" stop-color="#7A5CFF"/></linearGradient></defs>
              <circle cx="52" cy="66" r="20" fill="none" stroke="#2A3566" stroke-width="2.5"/>
              <circle cx="52" cy="66" r="9" fill="url(#rg2)"/>
              <rect x="96" y="42" width="86" height="46" rx="12" fill="#141C42" stroke="url(#rg2)" stroke-width="2.5"/>
              <path d="M108 62h20l10-12h16l12 12" stroke="url(#rg2)" stroke-width="3" fill="none" stroke-linecap="round"/>
              <circle cx="116" cy="78" r="7" fill="none" stroke="url(#rg2)" stroke-width="3"/>
              <circle cx="162" cy="78" r="7" fill="none" stroke="url(#rg2)" stroke-width="3"/>
            </svg>
          </div>
          <h3>Saya Penjemput</h3>
          <p>Terima order, navigasi ke siswa, tagihan & konfirmasi pembayaran.</p>
        </div>
        <button class="btn ghost block mt16" id="toAdmin">${icon('sliders')} Pengaturan aplikasi</button>
        <div class="center tiny mt18">Aplikasi antar-jemput siswa<br>biaya otomatis dari jarak tempuh</div>
      </div>`;
  },
  mount(el) {
    $$('[data-role]', el).forEach((c) => {
      c.onclick = () => { Sound.play('pop'); Router.go('login', { role: c.dataset.role }); };
    });
    el.querySelector('#toAdmin').onclick = async () => {
      if (!S.me) {
        S.me = { role: 'admin', id: 'admin', name: 'Admin' };
        LS.set('me', S.me);
      }
      Router.go('admin');
    };
  }
});

/* ======================================================================
   LOGIN / DAFTAR
   ====================================================================== */
Router.register('login', {
  render(p) {
    const role = p.role || 'student';
    const isDriver = role === 'driver';
    const list = isDriver ? S.drivers : S.students;
    return `
      <div class="pad">
        <button class="icon-btn mb12" id="back">${icon('left')}</button>
        <div class="row gap12 mb16">
          <div class="avatar lg ${isDriver ? 'cy' : 'pk'}">${icon(isDriver ? 'scooter' : 'school', 'lg')}</div>
          <div><div class="h1">${isDriver ? 'Masuk Penjemput' : 'Masuk Siswa'}</div>
          <div class="small">${isDriver ? 'Terima order antar-jemput' : 'Pesan antar-jemput sekarang'}</div></div>
        </div>

        ${list.length ? `<div class="tiny mb8">Atau lanjutkan sebagai</div>
        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px" class="mb16">
          ${list.map((x, i) => `<button class="chip" data-ex="${i}">${avatarOf(x.name, 'sm')} ${esc(x.name.split(' ')[0])}</button>`).join('')}
        </div>` : ''}

        <div class="field"><label class="label">Nama lengkap</label>
          <input class="input" id="lgName" placeholder="${isDriver ? 'Pak Slamet' : 'Nama siswa'}" autocomplete="name"></div>
        <div class="field"><label class="label">No. HP / WhatsApp</label>
          <input class="input" id="lgPhone" type="tel" inputmode="numeric" placeholder="0812xxxxxxx" autocomplete="tel"></div>
        ${isDriver ? `
          <div class="field"><label class="label">Plat nomor</label>
            <input class="input" id="lgPlate" placeholder="AG 1234 XY"></div>
          <div class="field"><label class="label">Kendaraan</label>
            <select class="input" id="lgVeh"><option>Motor</option><option>Mobil</option></select></div>
        ` : ''}

        <button class="btn ${isDriver ? 'outline' : 'ghost'} block mb12" id="lgHome">
          ${icon('pin')} ${isDriver ? 'Tentukan pangkalan (opsional)' : 'Tentukan alamat rumah'}</button>
        <div class="tiny mb10" id="homeTxt" style="text-transform:none;letter-spacing:0"></div>

        <button class="btn primary big-cta block" id="lgGo">${icon('bolt')} ${isDriver ? 'Mulai bekerja' : 'Mulai pesan'}</button>
        <div class="center tiny mt14">Data tersimpan di HP ini dan tersambung online<br>ke perangkat penjemput & siswa lain.</div>
      </div>`;
  },
  mount(el, p) {
    const role = p.role || 'student';
    const isDriver = role === 'driver';
    let home = null;
    el.querySelector('#back').onclick = () => Router.go('role');
    el.querySelector('#lgHome').onclick = async () => {
      const r = await pickLocation({ title: isDriver ? 'Pangkalan' : 'Alamat rumah', placeholder: 'Cari alamat…' });
      if (r) {
        home = r;
        el.querySelector('#homeTxt').innerHTML = `<span style="color:var(--green)">${icon('check', 'sm')}</span> ${esc((r.address || r.name || '').split(',').slice(0, 2).join(','))}`;
      }
    };
    $$('[data-ex]', el).forEach((b) => {
      b.onclick = async () => {
        const list = isDriver ? S.drivers : S.students;
        const x = list[+b.dataset.ex];
        if (!x) return;
        const stop = UI.loading('Masuk…');
        const r = isDriver
          ? await api.post('/api/drivers', { id: x.id, name: x.name, phone: x.phone, plate: x.plate, vehicle: x.vehicle })
          : await api.post('/api/students', { id: x.id, name: x.name, phone: x.phone });
        stop();
        S.me = isDriver ? r.driver : r.student;
        S.me.role = role;
        LS.set('me', S.me);
        Net.hello();
        Sound.play('ok');
        Router.go(isDriver ? 'dhome' : 'home');
      };
    });
    el.querySelector('#lgGo').onclick = async () => {
      Notify.ask();
      const name = el.querySelector('#lgName').value.trim();
      const phone = el.querySelector('#lgPhone').value.trim();
      if (!name) { el.querySelector('#lgName').classList.add('shake'); setTimeout(() => el.querySelector('#lgName').classList.remove('shake'), 500); UI.toast({ title: 'Nama belum diisi', type: 'red', icon: 'x' }); return; }
      if (!phone) { UI.toast({ title: 'No. HP belum diisi', type: 'red', icon: 'x' }); return; }
      const stop = UI.loading('Menyiapkan akun…');
      let r;
      if (isDriver) {
        r = await api.post('/api/drivers', {
          name, phone,
          plate: (el.querySelector('#lgPlate').value || '').trim() || '-',
          vehicle: el.querySelector('#lgVeh').value
        });
        if (r.ok) { S.me = r.driver; S.me.role = 'driver'; await api.put('/api/drivers', { id: r.driver.id, online: false }); Net.hello(); }
      } else {
        r = await api.post('/api/students', {
          name, phone,
          home: home ? { lat: home.lat, lng: home.lng } : null,
          homeAddress: home ? (home.address || home.name || '') : ''
        });
        if (r.ok) { S.me = r.student; S.me.role = 'student'; Net.hello(); }
      }
      stop();
      if (!r.ok) { UI.toast({ title: 'Gagal', body: r.error, type: 'red', icon: 'x' }); return; }
      LS.set('me', S.me);
      Sound.play('ok');
      UI.toast({ title: `Halo, ${name.split(' ')[0]}!`, body: isDriver ? 'Nyalakan status online di beranda' : 'Tentukan tujuan lalu pesan', type: 'green', icon: 'check' });
      Router.go(isDriver ? 'dhome' : 'home');
    };
  }
});

/* ======================================================================
   REGISTER SCREENS + TAB BAR
   ====================================================================== */
Router.register('home', Student.home);
Router.register('wait', WaitScreen);
Router.register('trip', TripScreen);
Router.register('pay', PayScreen);
Router.register('history', HistoryScreen);
Router.register('notif', NotifScreen);
Router.register('account', AccountScreen);
Router.register('dhome', Driver.home);
Router.register('dtrip', Driver.trip);
Router.register('dwallet', Driver.wallet);
Router.register('daccount', AccountScreen);
Router.register('admin', AdminScreen);

UI.tabs = [
  { name: 'home', label: 'Beranda', icon: 'home', roles: ['student'], badge: () => false },
  { name: 'history', label: 'Pesanan', icon: 'list', roles: ['student', 'driver'] },
  { name: 'notif', label: 'Notif', icon: 'bell', roles: ['student'], badge: () => S.notifs.some((n) => !n.read) },
  { name: 'account', label: 'Akun', icon: 'user', roles: ['student'] },
  { name: 'dhome', label: 'Beranda', icon: 'radar', roles: ['driver'] },
  { name: 'dwallet', label: 'Dompet', icon: 'wallet', roles: ['driver'] },
  { name: 'daccount', label: 'Akun', icon: 'user', roles: ['driver'] }
];

window.addEventListener('DOMContentLoaded', () => App.boot());
if (document.readyState !== 'loading') { /* sudah siap */ }
