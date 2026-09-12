/* Uji alur lengkap SANTARA: order -> accept -> jemput -> antar -> tagihan -> bayar -> konfirmasi
   plus uji realtime WebSocket (order:new, driver:loc, notif) */
const net = require('net');
const crypto = require('crypto');
const BASE = 'http://127.0.0.1:3000';

function wsConnect(onMsg) {
  const key = crypto.randomBytes(16).toString('base64');
  const sock = net.connect(3000, '127.0.0.1', () => {
    sock.write(`GET /ws HTTP/1.1\r\nHost: localhost:3000\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
  let buf = Buffer.alloc(0), handshook = false;
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (!handshook) {
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      buf = buf.slice(i + 4); handshook = true;
    }
    for (;;) {
      if (buf.length < 2) return;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      onMsg(JSON.parse(payload.toString()));
    }
  });
  sock.sendJSON = (obj) => {
    const p = Buffer.from(JSON.stringify(obj));
    const mask = crypto.randomBytes(4);
    const head = Buffer.from([0x81, 0x80 | (p.length < 126 ? p.length : 126)]);
    const masked = Buffer.from(p);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    let frame;
    if (p.length < 126) frame = Buffer.concat([head, mask, masked]);
    else {
      const l = Buffer.alloc(2); l.writeUInt16BE(p.length, 0);
      frame = Buffer.concat([Buffer.from([0x81, 0x80 | 126]), l, mask, masked]);
    }
    sock.write(frame);
  };
  return sock;
}

const J = async (m, p, b) => {
  if (m === 'GET' && b) p += '?' + new URLSearchParams(Object.entries(b).filter(([, v]) => v !== undefined)).toString();
  const r = await fetch(BASE + p, {
    method: m, headers: { 'content-type': 'application/json' },
    body: (m !== 'GET' && b) ? JSON.stringify(b) : undefined
  });
  return r.json();
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let FAIL = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
  if (!cond) FAIL++;
}

(async () => {
  console.log('\n===== 1. Siapkan akun =====');
  const stu = (await J('POST', '/api/students', { name: 'Alya Ramadhani', phone: '081200001111', home: { lat: -7.8166, lng: 112.0117 }, homeAddress: 'Jl. Anggrek 12' })).student;
  const drv = (await J('POST', '/api/drivers', { name: 'Pak Slamet', phone: '081300001111', plate: 'AG 1234 XY', vehicle: 'Motor' })).driver;
  check('siswa dibuat', !!stu.id, stu.name);
  check('penjemput dibuat', !!drv.id, drv.name);

  console.log('\n===== 2. Realtime: penjemput online =====');
  const dMsgs = [], sMsgs = [];
  const dSock = wsConnect((m) => dMsgs.push(m));
  const sSock = wsConnect((m) => sMsgs.push(m));
  await wait(300);
  dSock.sendJSON({ t: 'hello', role: 'driver', id: drv.id, name: drv.name });
  sSock.sendJSON({ t: 'hello', role: 'student', id: stu.id, name: stu.name });
  await wait(300);
  dSock.sendJSON({ t: 'online', online: true, lat: -7.8180, lng: 112.0140 });
  await wait(300);
  check('penjemput menerima welcome', dMsgs.some((m) => m.t === 'welcome'));
  check('broadcast drivers online', dMsgs.some((m) => m.t === 'drivers' && m.drivers.some((d) => d.id === drv.id && d.online)));

  console.log('\n===== 3. Siswa membuat pesanan =====');
  const o1 = await J('POST', '/api/orders', {
    studentId: stu.id, studentName: stu.name, studentPhone: stu.phone,
    pickup: { lat: -7.8166, lng: 112.0117 }, pickupName: 'Rumah Alya',
    dest: { lat: -7.8206, lng: 112.0237 }, destName: 'Les Primagama'
  });
  check('pesanan dibuat', o1.ok, { km: o1.order && o1.order.km, fare: o1.order && o1.order.estFare });
  await wait(400);
  check('penjemput menerima order:new', dMsgs.some((m) => m.t === 'order:new' && m.order.id === o1.order.id));
  const id = o1.order.id;

  console.log('\n===== 4. Penjemput menerima =====');
  let r = await J('POST', '/api/orders/action', { orderId: id, action: 'accept', driverId: drv.id, actor: 'driver' });
  check('status accepted', r.ok && r.order.status === 'accepted', r.order && r.order.status);
  await wait(300);
  check('siswa dapat notifikasi "penjemput ditemukan"', sMsgs.some((m) => m.t === 'notif' && m.notif.type === 'accepted'), (sMsgs.find((m) => m.t === 'notif') || {}).notif);

  console.log('\n===== 5. Kirim lokasi GPS (tracking) =====');
  for (const p of [[-7.8175, 112.0130], [-7.8170, 112.0138], [-7.8166, 112.0117]]) {
    dSock.sendJSON({ t: 'loc', lat: p[0], lng: p[1], heading: 90, speed: 20 });
    await wait(120);
  }
  await wait(300);
  check('siswa menerima driver:loc', sMsgs.some((m) => m.t === 'driver:loc'));

  console.log('\n===== 6. Alur perjalanan =====');
  r = await J('POST', '/api/orders/action', { orderId: id, action: 'arrive_pickup', actor: 'driver' });
  check('arrive_pickup', r.ok && r.order.status === 'arrived_pickup');
  r = await J('POST', '/api/orders/action', { orderId: id, action: 'start', actor: 'driver' });
  check('start (on_trip)', r.ok && r.order.status === 'on_trip');
  for (const p of [[-7.8180, 112.0150], [-7.8190, 112.0180], [-7.8200, 112.0210], [-7.8206, 112.0237]]) {
    dSock.sendJSON({ t: 'loc', lat: p[0], lng: p[1], heading: 90, speed: 25 });
    await wait(120);
  }
  r = await J('POST', '/api/orders/action', { orderId: id, action: 'arrive_dest', actor: 'driver' });
  check('arrive_dest → tagihan muncul', r.ok && r.order.status === 'arrived_dest', { km: r.order.billedKm, fare: r.order.fare });
  await wait(300);
  check('siswa dapat notifikasi tagihan', sMsgs.some((m) => m.t === 'notif' && m.notif.type === 'bill'));

  console.log('\n===== 7. Pembayaran =====');
  r = await J('POST', '/api/orders/action', { orderId: id, action: 'pay', method: 'Tunai', actor: 'student' });
  check('pay → status paid', r.ok && r.order.status === 'paid');
  await wait(300);
  check('penjemput dapat notifikasi dibayar', dMsgs.some((m) => m.t === 'notif' && m.notif.type === 'paid'));
  dMsgs.length = 0; sMsgs.length = 0;
  r = await J('POST', '/api/orders/action', { orderId: id, action: 'confirm_pay', actor: 'driver' });
  check('confirm_pay → done', r.ok && r.order.status === 'done');
  await wait(300);
  check('siswa dapat NOTIFIKASI pembayaran diterima', sMsgs.some((m) => m.t === 'notif' && m.notif.type === 'done'), (sMsgs.find((m) => m.t === 'notif') || {}).notif);

  console.log('\n===== 8. Riwayat & statistik =====');
  const hist = await J('GET', '/api/orders?studentId=' + stu.id);
  check('riwayat tersimpan', hist.ok && hist.orders.length >= 1, hist.orders.length);
  const stats = await J('GET', '/api/stats');
  check('statistik omzet', stats.ok && stats.stats.revenue >= r.order.fare, stats.stats);

  console.log('\n===== 9. Ulangi pesanan (repeat order) =====');
  const o2 = await J('POST', '/api/orders', {
    studentId: stu.id, studentName: stu.name, studentPhone: stu.phone,
    pickup: { lat: -7.8166, lng: 112.0117 }, pickupName: 'Rumah Alya',
    dest: { lat: -7.8206, lng: 112.0237 }, destName: 'Les Primagama'
  });
  check('pesanan ulang dibuat', o2.ok, { km: o2.order.km });
  r = await J('POST', '/api/orders/action', { orderId: o2.order.id, action: 'cancel', actor: 'student' });
  check('pesanan bisa dibatalkan', r.ok && r.order.status === 'cancelled');

  console.log('\n===== 10. Tarif bisa diubah =====');
  const st = await J('PUT', '/api/settings', { rates: { base: 8000, perKm: 4000, minFare: 10000 } });
  check('tarif tersimpan', st.ok && st.settings.rates.perKm === 4000, st.settings.rates);
  const rt = await J('GET', '/api/route?latA=-7.8166&lngA=112.0117&latB=-7.8300&lngB=112.0400');
  check('fare mengikuti tarif baru', rt.fare.fare > 0, { km: rt.km, fare: rt.fare.fare });
  await J('PUT', '/api/settings', { rates: { base: 6000, perKm: 3500, minFare: 8000 } });

  console.log('\n===== 11. Chat =====');
  dMsgs.length = 0; sMsgs.length = 0;
  dSock.sendJSON({ t: 'chat', orderId: id, text: 'Otw kak' });
  await wait(300);
  check('chat diterima siswa', sMsgs.some((m) => m.t === 'chat' && m.message.text === 'Otw kak'));

  console.log('\n===== 12. Bersihkan data uji =====');
  await J('POST', '/api/reset', { ordersOnly: true });
  check('reset pesanan', (await J('GET', '/api/orders', {})).orders.length === 0);

  dSock.destroy(); sSock.destroy();
  console.log('\n' + (FAIL === 0 ? '🎉 SEMUA UJI LULUS' : `⚠️  ${FAIL} uji gagal`));
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
