/* =====================================================================
   SANTARA - Setia Antar Tanpa Ragu
   Backend server: REST API + WebSocket realtime + proxy peta (Google/OSM)
   Tanpa dependensi eksternal (pure Node.js)
   ===================================================================== */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------ utilities ------------------------------ */
const now = () => Date.now();
const uid = (p = 'id') => p + '_' + now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const round2 = (v) => Math.round(v * 100) / 100;
const rupiah = (v) => 'Rp ' + Math.round(v).toLocaleString('id-ID');

/* --------------------------------- db --------------------------------- */
function seed() {
  const kota = { lat: -7.8166, lng: 112.0117 }; // Kediri, Jawa Timur
  const near = (dLat, dLng) => ({ lat: round2(kota.lat + dLat), lng: round2(kota.lng + dLng) });
  return {
    settings: {
      appName: 'SANTARA',
      tagline: 'Setia Antar Tanpa Ragu',
      googleKey: '',
      mapProvider: 'auto', // auto | google | osm
      currency: 'IDR',
      rates: {
        base: 6000,        // tarif dasar (flag fall)
        includedKm: 2,     // km pertama termasuk tarif dasar
        perKm: 3500,       // per km berikutnya
        minFare: 8000,     // biaya minimum
        perMinute: 0,      // opsional
        roundTo: 500
      },
      roadFactor: 1.28,    // pengali jarak lurus -> jarak jalan (cadangan)
      searchRadiusKm: 10,
      offerTimeoutMs: 30000,
      trackMaxPoints: 400
    },
    places: [
      { id: 'place_les1', name: 'Les Primagama Kediri', address: 'Jl. Diponegoro, Kediri', ...near(0.004, -0.012), kind: 'les' },
      { id: 'place_les2', name: 'Ganesha Operation Kota', address: 'Jl. Hayam Wuruk, Kediri', ...near(-0.010, 0.016), kind: 'les' },
      { id: 'place_les3', name: 'Bimbingan Alumni UI', address: 'Jl. Brigjen Pol. Imam Bachri, Kediri', ...near(0.012, 0.009), kind: 'les' },
      { id: 'place_les4', name: 'Rumah Les Bu Sri', address: 'Jl. Melati, Kediri', ...near(-0.006, -0.018), kind: 'les' }
    ],
    students: [
      { id: 'stu_demo', name: 'Alya Ramadhani', phone: '081200001111', home: near(0.008, -0.02), homeAddress: 'Jl. Anggrek No. 12, Kediri', avatar: 'A', createdAt: now() },
      { id: 'stu_demo2', name: 'Rafa Aditya', phone: '081200002222', home: near(-0.014, 0.02), homeAddress: 'Jl. Kenanga No. 7, Kediri', avatar: 'R', createdAt: now() }
    ],
    drivers: [
      { id: 'drv_demo', name: 'Pak Slamet', phone: '081300001111', plate: 'AG 1234 XY', vehicle: 'Motor', avatar: 'S', rating: 4.9, trips: 128, online: false, lat: null, lng: null, heading: 0, updatedAt: 0 },
      { id: 'drv_demo2', name: 'Pak Joko', phone: '081300002222', plate: 'AG 5678 ZT', vehicle: 'Mobil', avatar: 'J', rating: 4.8, trips: 96, online: false, lat: null, lng: null, heading: 0, updatedAt: 0 }
    ],
    orders: [],
    notifications: [],
    log: []
  };
}

let db = load();
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const base = seed();
    return {
      settings: Object.assign(base.settings, raw.settings || {}, { rates: Object.assign(base.settings.rates, (raw.settings || {}).rates || {}) }),
      places: raw.places?.length ? raw.places : base.places,
      students: raw.students || base.students,
      drivers: raw.drivers || base.drivers,
      orders: raw.orders || [],
      notifications: raw.notifications || [],
      log: raw.log || []
    };
  } catch {
    return seed();
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error('save failed', e); }
  }, 250);
}

/* ------------------------------- outbound ------------------------------- */
async function fetchJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 9000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SANTARA/1.0 (school-ride-app)', ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

const routeCache = new Map();
async function getRoute(a, b) {
  const key = `${round2(a.lat).toFixed(2)},${round2(a.lng).toFixed(2)}->${round2(b.lat).toFixed(2)},${round2(b.lng).toFixed(2)}`;
  const c = routeCache.get(key);
  if (c && now() - c.t < 10 * 60 * 1000) return c.data;
  let out = null;
  const gk = db.settings.googleKey;
  if (gk) {
    try {
      const u = new URL('https://maps.googleapis.com/maps/api/directions/json');
      u.searchParams.set('origin', `${a.lat},${a.lng}`);
      u.searchParams.set('destination', `${b.lat},${b.lng}`);
      u.searchParams.set('mode', 'driving');
      u.searchParams.set('key', gk);
      const j = await fetchJSON(u.toString());
      const r = j.routes && j.routes[0];
      if (r) {
        const leg = r.legs[0];
        out = {
          km: round2(leg.distance.value / 1000),
          minutes: Math.round(leg.duration.value / 60),
          geometry: decodePolyline(r.overview_polyline.points).map(([lat, lng]) => ({ lat, lng })),
          source: 'google'
        };
      }
    } catch (e) { /* fall through to OSRM */ }
  }
  if (!out) {
    try {
      const u = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      const j = await fetchJSON(u);
      const r = j.routes && j.routes[0];
      if (r) {
        out = {
          km: round2(r.distance / 1000),
          minutes: Math.round(r.duration / 60),
          geometry: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
          source: 'osrm'
        };
      }
    } catch (e) { /* fallback below */ }
  }
  if (!out) {
    const straight = haversineKm(a, b);
    out = {
      km: round2(straight * db.settings.roadFactor),
      minutes: Math.round((straight * db.settings.roadFactor / 25) * 60),
      geometry: [a, b],
      source: 'straight'
    };
  }
  out.straightKm = round2(haversineKm(a, b));
  routeCache.set(key, { t: now(), data: out });
  return out;
}

function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0; const co = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat; lng += dlng;
    co.push([lat / 1e5, lng / 1e5]);
  }
  return co;
}

async function geocode(q) {
  const gk = db.settings.googleKey;
  if (gk) {
    try {
      const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      u.searchParams.set('address', q); u.searchParams.set('region', 'id'); u.searchParams.set('key', gk);
      const j = await fetchJSON(u.toString());
      return (j.results || []).slice(0, 8).map((r) => ({
        name: r.formatted_address.split(',')[0],
        address: r.formatted_address,
        lat: r.geometry.location.lat, lng: r.geometry.location.lng, source: 'google'
      }));
    } catch { /* fallback */ }
  }
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', q); u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '8'); u.searchParams.set('countrycodes', 'id');
    u.searchParams.set('accept-language', 'id');
    const j = await fetchJSON(u.toString());
    return (j || []).map((r) => ({ name: r.display_name.split(',')[0], address: r.display_name, lat: +r.lat, lng: +r.lon, source: 'osm' }));
  } catch { return []; }
}

async function reverseGeocode(lat, lng) {
  const gk = db.settings.googleKey;
  if (gk) {
    try {
      const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      u.searchParams.set('latlng', `${lat},${lng}`); u.searchParams.set('key', gk);
      const j = await fetchJSON(u.toString());
      if (j.results && j.results[0]) return j.results[0].formatted_address;
    } catch { /* fallback */ }
  }
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('lat', lat); u.searchParams.set('lon', lng);
    u.searchParams.set('format', 'json'); u.searchParams.set('accept-language', 'id');
    const j = await fetchJSON(u.toString());
    return j && j.display_name ? j.display_name : `${round2(lat)}, ${round2(lng)}`;
  } catch { return `${round2(lat)}, ${round2(lng)}`; }
}

/* --------------------------------- fare --------------------------------- */
function computeFare(km, extraMinutes = 0) {
  const r = db.settings.rates;
  let fare = num(r.base) + Math.max(0, km - num(r.includedKm)) * num(r.perKm) + num(extraMinutes) * num(r.perMinute);
  fare = Math.max(num(r.minFare), fare);
  const rt = num(r.roundTo, 0);
  if (rt > 0) fare = Math.ceil(fare / rt) * rt;
  return { fare: Math.round(fare), breakdown: { base: num(r.base), includedKm: num(r.includedKm), perKm: num(r.perKm), minFare: num(r.minFare) } };
}

/* ------------------------------- orders -------------------------------- */
const STATUS = {
  PENDING: 'pending',           // menunggu penjemput
  ACCEPTED: 'accepted',         // penjemput menuju lokasi jemput
  ARRIVED_PICKUP: 'arrived_pickup', // penjemput sudah di lokasi jemput
  ON_TRIP: 'on_trip',           // dalam perjalanan ke tujuan
  ARRIVED_DEST: 'arrived_dest', // sampai tujuan -> muncul biaya
  PAID: 'paid',                 // siswa sudah bayar, menunggu konfirmasi
  DONE: 'done',                 // penjemput konfirmasi pembayaran
  CANCELLED: 'cancelled'
};
const STATUS_LABEL = {
  pending: 'Mencari penjemput', accepted: 'Penjemput menuju lokasi', arrived_pickup: 'Penjemput sudah di lokasi',
  on_trip: 'Dalam perjalanan', arrived_dest: 'Sampai tujuan • menunggu pembayaran', paid: 'Menunggu konfirmasi penjemput',
  done: 'Selesai', cancelled: 'Dibatalkan'
};
const ACTIVE_STATUSES = [STATUS.PENDING, STATUS.ACCEPTED, STATUS.ARRIVED_PICKUP, STATUS.ON_TRIP, STATUS.ARRIVED_DEST, STATUS.PAID];

function publicOrder(o) {
  if (!o) return null;
  const c = JSON.parse(JSON.stringify(o));
  c.statusLabel = STATUS_LABEL[c.status] || c.status;
  return c;
}
function activeOrderForStudent(id) { return db.orders.find((o) => o.studentId === id && ACTIVE_STATUSES.includes(o.status)); }
function activeOrderForDriver(id) { return db.orders.find((o) => o.driverId === id && ACTIVE_STATUSES.includes(o.status)); }

/* ------------------------------ websocket ------------------------------- */
const wss = { clients: new Set() };
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsSend(sock, obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  try { sock.write(Buffer.concat([header, payload])); } catch { }
}
function broadcast(obj, filter) {
  for (const c of wss.clients) {
    if (!filter || filter(c)) wsSend(c, obj);
  }
}
function sendToUser(role, userId, obj) {
  broadcast(obj, (c) => c.role === role && String(c.userId) === String(userId));
}
function sendToRole(role, obj) { broadcast(obj, (c) => c.role === role); }

function handleWSMessage(sock, msg) {
  let data;
  try { data = JSON.parse(msg); } catch { return; }
  const t = data.t;

  if (t === 'hello') {
    sock.role = data.role || 'guest';
    sock.userId = data.id || null;
    sock.name = data.name || '';
    sock.meta = data.meta || {};
    wsSend(sock, { t: 'welcome', id: sock.id, serverTime: now(), settings: publicSettings() });
    if (sock.role === 'driver' && sock.userId) {
      const d = db.drivers.find((x) => x.id === sock.userId);
      if (d) { d.socket = true; d.lastSeen = now(); }
      broadcastDrivers();
    }
    if (sock.role === 'student' && sock.userId) {
      const o = activeOrderForStudent(sock.userId);
      if (o) wsSend(sock, { t: 'order', order: publicOrder(o) });
    }
    broadcastPresence();
    return;
  }

  if (t === 'loc') {
    if (sock.role !== 'driver' || !sock.userId) return;
    const d = db.drivers.find((x) => x.id === sock.userId);
    if (!d) return;
    d.lat = num(data.lat, d.lat); d.lng = num(data.lng, d.lng);
    d.heading = num(data.heading, 0); d.speed = num(data.speed, 0); d.updatedAt = now(); d.lastSeen = now();
    broadcastDrivers();
    const o = activeOrderForDriver(d.id);
    if (o && [STATUS.ACCEPTED, STATUS.ARRIVED_PICKUP, STATUS.ON_TRIP].includes(o.status)) {
      o.track = o.track || [];
      const last = o.track[o.track.length - 1];
      if (!last || haversineKm(last, d) > 0.01) {
        o.track.push({ lat: d.lat, lng: d.lng, ts: now() });
        if (o.track.length > db.settings.trackMaxPoints) o.track.shift();
      }
      if (o.status === STATUS.ON_TRIP && o.track.length) {
        o.travelKm = round2(o.track.reduce((acc, p, i) => acc + (i ? haversineKm(o.track[i - 1], p) : 0), 0));
      }
      broadcast({ t: 'driver:loc', driverId: d.id, orderId: o.id, lat: d.lat, lng: d.lng, heading: d.heading, speed: d.speed, travelKm: o.travelKm || 0 },
        (c) => c.role === 'student' && String(c.userId) === String(o.studentId));
      save();
    }
    return;
  }

  if (t === 'online') {
    if (sock.role !== 'driver' || !sock.userId) return;
    const d = db.drivers.find((x) => x.id === sock.userId);
    if (!d) return;
    d.online = !!data.online;
    if (data.lat) { d.lat = num(data.lat); d.lng = num(data.lng); }
    d.lastSeen = now();
    if (!d.online) { /* keep last known */ }
    broadcastDrivers(); broadcastPresence(); save();
    return;
  }

  if (t === 'chat') {
    const o = db.orders.find((x) => x.id === data.orderId);
    if (!o) return;
    const m = { id: uid('msg'), from: sock.role, name: sock.name || '', text: String(data.text || '').slice(0, 300), ts: now() };
    o.messages = o.messages || []; o.messages.push(m);
    const payload = { t: 'chat', orderId: o.id, message: m };
    broadcast(payload, (c) => (c.role === 'student' && String(c.userId) === String(o.studentId)) || (c.role === 'driver' && String(c.userId) === String(o.driverId)));
    save();
    return;
  }

  if (t === 'ping') { wsSend(sock, { t: 'pong', ts: now() }); return; }
}

function broadcastDrivers() {
  const list = db.drivers.map((d) => ({
    id: d.id, name: d.name, phone: d.phone, plate: d.plate, vehicle: d.vehicle, avatar: d.avatar,
    rating: d.rating, trips: d.trips, online: !!d.online && now() - (d.lastSeen || 0) < 90000,
    lat: d.lat, lng: d.lng, heading: d.heading, updatedAt: d.updatedAt || 0
  }));
  broadcast({ t: 'drivers', drivers: list });
}
function broadcastPresence() {
  const counts = {};
  for (const c of wss.clients) counts[c.role] = (counts[c.role] || 0) + 1;
  broadcast({ t: 'presence', counts });
}
function notify(role, userId, n) {
  const rec = { id: uid('n'), role, userId, ...n, ts: now(), read: false };
  db.notifications.unshift(rec);
  if (db.notifications.length > 200) db.notifications.length = 200;
  sendToUser(role, userId, { t: 'notif', notif: rec });
  save();
  return rec;
}
function pushOrder(order) {
  const payload = { t: 'order', order: publicOrder(order) };
  broadcast(payload, (c) => (c.role === 'student' && String(c.userId) === String(order.studentId)) || (c.role === 'driver' && String(c.userId) === String(order.driverId)));
  sendToRole('admin', payload);
}

/* ------------------------------- http api ------------------------------- */
function publicSettings() {
  const s = db.settings;
  return {
    appName: s.appName, tagline: s.tagline, currency: s.currency, rates: s.rates,
    roadFactor: s.roadFactor, searchRadiusKm: s.searchRadiusKm, offerTimeoutMs: s.offerTimeoutMs,
    hasGoogleKey: !!s.googleKey,
    mapProvider: s.mapProvider,
    googleKey: s.googleKey || ''
  };
}

const routes = {
  'GET /api/config': async () => ({ ok: true, settings: publicSettings() }),

  'GET /api/bootstrap': async (body, q) => {
    return {
      ok: true,
      settings: publicSettings(),
      places: db.places,
      drivers: db.drivers.map((d) => ({
        id: d.id, name: d.name, phone: d.phone, plate: d.plate, vehicle: d.vehicle, avatar: d.avatar,
        rating: d.rating, trips: d.trips, online: !!d.online && now() - (d.lastSeen || 0) < 90000, lat: d.lat, lng: d.lng
      })),
      students: db.students.map((s) => ({ id: s.id, name: s.name, phone: s.phone, home: s.home, homeAddress: s.homeAddress, avatar: s.avatar }))
    };
  },

  'POST /api/students': async (b) => {
    let s = b.id ? db.students.find((x) => x.id === b.id) : db.students.find((x) => x.phone === b.phone);
    if (!s) {
      s = { id: b.id || uid('stu'), createdAt: now() };
      db.students.push(s);
    }
    Object.assign(s, {
      name: b.name || s.name, phone: b.phone || s.phone,
      home: b.home || s.home, homeAddress: b.homeAddress || s.homeAddress,
      avatar: (b.name || s.name || 'S').trim().charAt(0).toUpperCase()
    });
    save();
    return { ok: true, student: s };
  },

  'POST /api/drivers': async (b) => {
    let d = b.id ? db.drivers.find((x) => x.id === b.id) : db.drivers.find((x) => x.phone === b.phone);
    if (!d) {
      d = { id: b.id || uid('drv'), rating: 5, trips: 0, online: false, lat: null, lng: null, heading: 0, createdAt: now() };
      db.drivers.push(d);
    }
    Object.assign(d, {
      name: b.name || d.name, phone: b.phone || d.phone, plate: b.plate || d.plate,
      vehicle: b.vehicle || d.vehicle, avatar: (b.name || d.name || 'D').trim().charAt(0).toUpperCase()
    });
    save(); broadcastDrivers();
    return { ok: true, driver: d };
  },

  'PUT /api/drivers': async (b) => {
    const d = db.drivers.find((x) => x.id === b.id);
    if (!d) return { ok: false, error: 'driver tidak ditemukan' };
    if (b.online !== undefined) d.online = !!b.online;
    if (b.lat !== undefined) { d.lat = num(b.lat); d.lng = num(b.lng); }
    d.lastSeen = now();
    save(); broadcastDrivers();
    return { ok: true, driver: d };
  },

  'DELETE /api/drivers': async (b, q) => {
    const id = q.id;
    db.drivers = db.drivers.filter((d) => d.id !== id);
    save(); broadcastDrivers();
    return { ok: true };
  },

  'DELETE /api/students': async (b, q) => {
    db.students = db.students.filter((s) => s.id !== q.id);
    save();
    return { ok: true };
  },

  'POST /api/places': async (b) => {
    const p = { id: uid('place'), name: b.name || 'Tempat', address: b.address || '', lat: num(b.lat), lng: num(b.lng), kind: b.kind || 'les' };
    db.places.push(p); save();
    return { ok: true, place: p };
  },

  'DELETE /api/places': async (b, q) => {
    db.places = db.places.filter((p) => p.id !== q.id);
    save();
    return { ok: true };
  },

  'PUT /api/settings': async (b) => {
    if (b.rates) Object.assign(db.settings.rates, b.rates);
    ['appName', 'tagline', 'googleKey', 'mapProvider', 'roadFactor', 'searchRadiusKm', 'offerTimeoutMs'].forEach((k) => {
      if (b[k] !== undefined) db.settings[k] = b[k];
    });
    ['base', 'includedKm', 'perKm', 'minFare', 'perMinute', 'roundTo'].forEach((k) => {
      if (b.rates && b.rates[k] !== undefined) db.settings.rates[k] = num(b.rates[k]);
    });
    routeCache.clear();
    save();
    broadcast({ t: 'settings', settings: publicSettings() });
    return { ok: true, settings: publicSettings() };
  },

  'GET /api/route': async (b, q) => {
    const a = { lat: num(q.latA), lng: num(q.lngA) };
    const c = { lat: num(q.latB), lng: num(q.lngB) };
    const r = await getRoute(a, c);
    return { ok: true, ...r, fare: computeFare(r.km) };
  },

  'GET /api/geocode': async (b, q) => ({ ok: true, results: await geocode(q.q || '') }),
  'GET /api/reverse': async (b, q) => ({ ok: true, address: await reverseGeocode(num(q.lat), num(q.lng)) }),

  'POST /api/orders': async (b) => {
    const pickup = b.pickup, dest = b.dest;
    if (!pickup || !dest) return { ok: false, error: 'lokasi belum lengkap' };
    const existing = activeOrderForStudent(b.studentId);
    if (existing) return { ok: false, error: 'masih ada pesanan aktif', order: publicOrder(existing) };
    const r = await getRoute(pickup, dest);
    const f = computeFare(r.km);
    const o = {
      id: uid('ord'), code: 'SNT' + String(Math.floor(Math.random() * 9000) + 1000),
      studentId: b.studentId, studentName: b.studentName || '', studentPhone: b.studentPhone || '',
      driverId: null, driverName: '', driverPlate: '',
      pickup, dest,
      pickupName: b.pickupName || '', destName: b.destName || '',
      km: r.km, straightKm: r.straightKm, estMinutes: r.minutes, geometry: r.geometry, routeSource: r.source,
      estFare: f.fare, fare: f.fare, travelKm: 0,
      status: STATUS.PENDING, track: [], messages: [], timeline: [{ status: STATUS.PENDING, ts: now() }],
      paymentMethod: null, paidAt: null, rating: null,
      createdAt: now(), updatedAt: now()
    };
    db.orders.unshift(o);
    save();
    // tawarkan ke penjemput online
    sendToRole('driver', { t: 'order:new', order: publicOrder(o) });
    sendToRole('admin', { t: 'order:new', order: publicOrder(o) });
    return { ok: true, order: publicOrder(o), route: r, fare: f };
  },

  'GET /api/orders': async (b, q) => {
    let list = db.orders.slice();
    if (q.studentId) list = list.filter((o) => o.studentId === q.studentId);
    if (q.driverId) list = list.filter((o) => o.driverId === q.driverId);
    if (q.active === '1') list = list.filter((o) => ACTIVE_STATUSES.includes(o.status));
    const limit = num(q.limit, 50);
    return { ok: true, orders: list.slice(0, limit).map(publicOrder) };
  },

  'POST /api/orders/action': async (b) => {
    const o = db.orders.find((x) => x.id === b.orderId);
    if (!o) return { ok: false, error: 'pesanan tidak ditemukan' };
    const act = b.action;
    const actor = b.actor || 'system';
    o.updatedAt = now();

    if (act === 'accept') {
      if (o.status !== STATUS.PENDING) return { ok: false, error: 'pesanan sudah diambil' };
      const d = db.drivers.find((x) => x.id === b.driverId);
      if (!d) return { ok: false, error: 'penjemput tidak ditemukan' };
      if (activeOrderForDriver(d.id)) return { ok: false, error: 'Anda masih punya pesanan aktif' };
      o.driverId = d.id; o.driverName = d.name; o.driverPlate = d.plate; o.driverPhone = d.phone;
      o.driverVehicle = d.vehicle; o.driverAvatar = d.avatar; o.driverRating = d.rating;
      o.status = STATUS.ACCEPTED; o.acceptedAt = now();
      o.timeline.push({ status: STATUS.ACCEPTED, ts: now() });
      const leg = await getRoute({ lat: d.lat ?? o.pickup.lat, lng: d.lng ?? o.pickup.lng }, o.pickup);
      o.etaPickupMin = leg.minutes; o.etaPickupKm = leg.km;
      save(); pushOrder(o);
      notify('student', o.studentId, {
        type: 'accepted', title: 'Penjemput ditemukan!',
        body: `${d.name} (${d.plate}) menuju lokasi jemput • ±${o.etaPickupMin} menit`, orderId: o.id
      });
      broadcastDrivers();
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'arrive_pickup') {
      if (o.status !== STATUS.ACCEPTED) return { ok: false, error: 'status tidak valid' };
      o.status = STATUS.ARRIVED_PICKUP; o.arrivedPickupAt = now();
      o.timeline.push({ status: STATUS.ARRIVED_PICKUP, ts: now() });
      save(); pushOrder(o);
      notify('student', o.studentId, { type: 'arrived', title: 'Penjemput sudah sampai', body: `${o.driverName} menunggu di titik jemput`, orderId: o.id });
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'start') {
      if (o.status !== STATUS.ARRIVED_PICKUP) return { ok: false, error: 'status tidak valid' };
      o.status = STATUS.ON_TRIP; o.startedAt = now(); o.track = [{ lat: o.pickup.lat, lng: o.pickup.lng, ts: now() }];
      o.timeline.push({ status: STATUS.ON_TRIP, ts: now() });
      const leg = await getRoute(o.pickup, o.dest);
      o.km = leg.km; o.estMinutes = leg.minutes; o.geometry = leg.geometry;
      save(); pushOrder(o);
      notify('student', o.studentId, { type: 'start', title: 'Perjalanan dimulai', body: `Estimasi sampai ${o.estMinutes} menit lagi`, orderId: o.id });
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'arrive_dest') {
      if (o.status !== STATUS.ON_TRIP) return { ok: false, error: 'status tidak valid' };
      o.status = STATUS.ARRIVED_DEST; o.arrivedDestAt = now();
      o.timeline.push({ status: STATUS.ARRIVED_DEST, ts: now() });
      // hitung ulang jarak & biaya aktual berdasarkan titik jemput aktual (posisi terakhir driver)
      // dasar penagihan = jarak rute (rumah -> tempat les); jarak GPS disimpan sebagai info
      o.billedKm = round2(num(o.km));
      const f = computeFare(o.billedKm);
      o.fare = f.fare; o.fareBreakdown = f.breakdown;
      save(); pushOrder(o);
      notify('student', o.studentId, {
        type: 'bill', title: 'Sampai di tujuan 🎉',
        body: `Biaya antar-jemput ${rupiah(o.fare)} (${o.billedKm} km). Silakan bayar.`, orderId: o.id
      });
      notify('driver', o.driverId, { type: 'bill', title: 'Tujuan tercapai', body: `Tagihan ${rupiah(o.fare)} menunggu pembayaran siswa`, orderId: o.id });
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'pay') {
      if (o.status !== STATUS.ARRIVED_DEST) return { ok: false, error: 'status tidak valid' };
      o.status = STATUS.PAID; o.paymentMethod = b.method || 'Tunai'; o.paidAt = now();
      o.timeline.push({ status: STATUS.PAID, ts: now() });
      save(); pushOrder(o);
      notify('driver', o.driverId, {
        type: 'paid', title: 'Pembayaran diterima 💸',
        body: `${o.studentName} membayar ${rupiah(o.fare)} via ${o.paymentMethod}`, orderId: o.id
      });
      notify('student', o.studentId, {
        type: 'paid', title: 'Pembayaran terkirim',
        body: `${rupiah(o.fare)} via ${o.paymentMethod} • menunggu konfirmasi ${o.driverName}`, orderId: o.id
      });
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'confirm_pay') {
      if (o.status !== STATUS.PAID) return { ok: false, error: 'status tidak valid' };
      o.status = STATUS.DONE; o.doneAt = now();
      o.timeline.push({ status: STATUS.DONE, ts: now() });
      const d = db.drivers.find((x) => x.id === o.driverId);
      if (d) { d.trips = (d.trips || 0) + 1; d.earnings = num(d.earnings, 0) + num(o.fare, 0); }
      save(); pushOrder(o);
      notify('student', o.studentId, {
        type: 'done', title: 'Pembayaran dikonfirmasi ✅',
        body: `${o.driverName} menerima pembayaran ${rupiah(o.fare)}. Terima kasih!`, orderId: o.id
      });
      broadcastDrivers();
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'rate') {
      o.rating = clamp(num(b.rating, 5), 1, 5);
      if (b.note) o.note = String(b.note).slice(0, 200);
      save(); pushOrder(o);
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'cancel') {
      if (![STATUS.PENDING, STATUS.ACCEPTED, STATUS.ARRIVED_PICKUP].includes(o.status)) return { ok: false, error: 'pesanan tidak bisa dibatalkan' };
      o.status = STATUS.CANCELLED; o.cancelledAt = now(); o.cancelReason = b.reason || '';
      o.timeline.push({ status: STATUS.CANCELLED, ts: now() });
      save(); pushOrder(o);
      const other = actor === 'student' ? 'driver' : 'student';
      notify(other, other === 'driver' ? o.driverId : o.studentId, { type: 'cancelled', title: 'Pesanan dibatalkan', body: `Pesanan ${o.code} dibatalkan`, orderId: o.id });
      broadcastDrivers();
      return { ok: true, order: publicOrder(o) };
    }

    if (act === 'delete') {
      db.orders = db.orders.filter((x) => x.id !== o.id);
      save();
      return { ok: true };
    }

    return { ok: false, error: 'aksi tidak dikenal' };
  },

  'GET /api/notifications': async (b, q) => {
    return { ok: true, notifications: db.notifications.filter((n) => n.userId === q.userId).slice(0, 30) };
  },

  'POST /api/notifications/read': async (b) => {
    db.notifications.forEach((n) => { if (n.userId === b.userId) n.read = true; });
    save();
    return { ok: true };
  },

  'GET /api/stats': async () => {
    const done = db.orders.filter((o) => o.status === STATUS.DONE);
    return {
      ok: true,
      stats: {
        orders: db.orders.length, done: done.length,
        active: db.orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
        revenue: done.reduce((a, o) => a + num(o.fare), 0),
        km: round2(done.reduce((a, o) => a + num(o.billedKm || o.km), 0)),
        driversOnline: db.drivers.filter((d) => d.online).length
      }
    };
  },

  'POST /api/reset': async (b) => {
    if (b && b.ordersOnly) { db.orders = []; db.notifications = []; }
    else { const s = seed(); db = s; }
    save();
    broadcast({ t: 'reset' }); broadcastDrivers();
    return { ok: true };
  }
};

/* ------------------------------- http core ------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.webm': 'video/webm'
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(u.pathname);

  // CORS (untuk akses dari device lain / testing)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (pathname.startsWith('/api/')) {
    const q = Object.fromEntries(u.searchParams.entries());
    let body = {};
    if (req.method !== 'GET') {
      try {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) break; }
        body = raw ? JSON.parse(raw) : {};
      } catch { body = {}; }
    }
    const key = `${req.method} ${pathname}`;
    const handler = routes[key];
    try {
      if (!handler) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'endpoint tidak ada: ' + key })); }
      const out = await handler(body, q);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (e) {
      console.error('api error', key, e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  // static
  let file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      // SPA fallback
      const idx = path.join(PUBLIC, 'index.html');
      return fs.readFile(idx, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        res.end(buf);
      });
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache = ext === '.html' || ext === '.webmanifest' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    fs.createReadStream(file).pipe(res);
  });
});

/* websocket upgrade */
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  sock.setNoDelay(true);
  sock.id = uid('ws');
  sock.role = 'guest';
  sock.userId = null;
  sock.buffer = Buffer.alloc(0);
  wss.clients.add(sock);

  sock.on('data', (chunk) => {
    sock.buffer = Buffer.concat([sock.buffer, chunk]);
    // parse frames
    for (;;) {
      const buf = sock.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
      const masked = (buf[1] & 0x80) !== 0;
      const maskKey = masked ? buf.slice(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (buf.length < offset + len) return;
      let payload = buf.slice(offset, offset + len);
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
      }
      sock.buffer = buf.slice(offset + len);
      if (opcode === 0x8) { try { sock.end(); } catch { } wss.clients.delete(sock); return; }
      if (opcode === 0x9) { wsSend(sock, { t: 'pong', ts: now() }); continue; }
      if (opcode === 0x1 && fin) { try { handleWSMessage(sock, payload.toString('utf8')); } catch (e) { console.error('ws msg error', e); } }
    }
  });
  sock.on('close', () => {
    wss.clients.delete(sock);
    if (sock.role === 'driver' && sock.userId) {
      const d = db.drivers.find((x) => x.id === sock.userId);
      if (d) { d.lastSeen = now(); broadcastDrivers(); }
    }
    broadcastPresence();
  });
  sock.on('error', () => { wss.clients.delete(sock); });
  wsSend(sock, { t: 'connected', id: sock.id });
});

server.listen(PORT, HOST, () => {
  const ifaces = [];
  try {
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) for (const n of nets[name]) if (n.family === 'IPv4' && !n.internal) ifaces.push(n.address);
  } catch { }
  console.log(`\n  SANTARA berjalan di http://localhost:${PORT}`);
  ifaces.forEach((i) => console.log(`  Akses HP (jaringan sama): http://${i}:${PORT}`));
  console.log('');
});

setInterval(() => {
  broadcast({ t: 'tick', ts: now(), settings: publicSettings() });
  broadcastDrivers();
}, 20000);
