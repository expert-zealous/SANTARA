# 🛵 SANTARA — Setia Antar Tanpa Ragu

Aplikasi web **PWA** untuk layanan **antar-jemput siswa** dari rumah ke tempat les.
Biaya dihitung **otomatis dari jarak km** (rute jalan), siswa & penjemput **terhubung
online realtime**, biaya muncul **setelah sampai tujuan**, dan **notifikasi** muncul
setelah pembayaran diterima.

---

## 1. Menjalankan aplikasi

```bash
cd santara
node server.js
```

Lalu buka:

* **Komputer ini / server:** <http://localhost:3000>
* **HP (satu Wi‑Fi yang sama):** <http://192.168.x.x:3000> ← alamat IP komputer,
  tampil di terminal saat server start
* Port bisa diganti: `PORT=8080 node server.js`

Windows: klik dua kali **`mulai-windows.bat`**. Linux/macOS: `bash mulai.sh`.

> Tidak perlu `npm install` — server murni Node.js tanpa dependensi.
> Butuh **Node.js 18+** (disarankan 20).

---

## 2. Alur pakai (seperti aplikasi ojek online)

### 👩‍🎓 Siswa / Orang tua
1. Buka aplikasi → pilih **Saya Siswa** → isi nama & no. HP → tentukan **alamat rumah** (peta).
2. Di beranda: titik jemput (rumah) + pilih **tempat les** → langsung muncul
   **jarak (km)**, **estimasi waktu**, dan **estimasi biaya**.
3. Tekan **PESAN SANTARA** → layar radar *Mencari penjemput…*
4. Setelah penjemput menerima → **lacak posisi penjemput live** di peta, ada tombol
   telepon & chat.
5. **Sampai tujuan** → layar **tagihan** muncul (besar, jelas).
6. Pilih **Tunai / Transfer / QRIS** → tekan **BAYAR**.
7. Penjemput konfirmasi → **notifikasi "Pembayaran diterima ✅"** → beri bintang ✓
8. Mau dipakai lagi? Menu **Pesanan → detail → PESAN LAGI** (langsung pesan ulang dengan rute sama).

### 🧑‍✈️ Penjemput
1. Pilih **Saya Penjemput** → isi nama, no. HP, plat nomor, jenis kendaraan.
2. Di beranda geser tombol **ONLINE** (posisi GPS dikirim terus ke server).
3. Order masuk muncul otomatis sebagai **kartu tawaran** (ada hitung mundur) → **Terima / Tolak**.
4. Tombol besar berubah mengikuti status:
   **Sampai di lokasi jemput → Mulai antar → Sampai di tujuan → Terima pembayaran**
5. Tombol **Navigasi** membuka rute di Google Maps.
6. Menu **Dompet** berisi pendapatan hari ini, total trip, dan riwayat.

---

## 3. Rumus biaya (bisa diubah di aplikasi)

```
Biaya = Tarif dasar + (jarak rute - km termasuk) × tarif per km
Biaya minimal tetap berlaku, lalu dibulatkan ke kelipatan Rp 500
```

Nilai bawaan:

| Item | Nilai bawaan |
|---|---|
| Tarif dasar (2 km pertama) | Rp 6.000 |
| Tarif per km berikutnya | Rp 3.500 |
| Biaya minimum | Rp 8.000 |
| Pembulatan | Rp 500 |

Ubah lewat **Akun → Pengaturan tarif & peta** (langsung berlaku untuk pesanan baru).
Jarak diambil dari **rute jalan** (bukan jarak lurus), jadi adil untuk kedua belah pihak.

---

## 4. Google Maps

Aplikasi **sudah terhubung ke peta online** dan punya dua mode:

| Kondisi | Peta yang dipakai |
|---|---|
| **Tanpa API key** (bawaan) | OpenStreetMap + rute OSRM (gratis, tetap online) |
| **Dengan Google Maps API key** | Google Maps (peta, rute, pencarian alamat) |

Cara pasang key: buka **Akun → Pengaturan tarif & peta → Google Maps API Key**,
tempel key `AIza...`, simpan. Aktifkan di Google Cloud: **Maps JavaScript API,
Directions API, Geocoding API**. Jika key salah/kuota habis, aplikasi **otomatis
kembali ke OpenStreetMap** tanpa error.

Tombol **Navigasi** selalu membuka Google Maps untuk belokan demi belokan
(gratis, tidak butuh key).

---

## 5. Pasang di HP (PWA)

* **Android/Chrome:** buka aplikasi → tombol **Install** muncul, atau menu browser
  (⋮) → **Install aplikasi / Tambahkan ke Layar Utama**.
* **iPhone/Safari:** tombol **Bagikan** → **Tambah ke Layar Utama**.
* Ikon, splash screen, favicon, dan mode layar penuh (tanpa bilah browser) sudah disertakan.

---

## 6. Notifikasi

* Saat masuk, aplikasi **meminta izin notifikasi** — izinkan agar notifikasi muncul
  walau layar HP mati / aplikasi di‑background.
* Notifikasi dikirim untuk: penjemput ditemukan, penjemput sampai, perjalanan mulai,
  **tagihan muncul**, **pembayaran diterima**, dan pembatalan.
* Disertai **suara** dan **getar** (bisa dimatikan di Akun → Suara & getar).
* Ada juga **Pusat Notifikasi** di tab **Notif** (tersimpan di HP).

---

## 7. Ganti logo

Letakkan file **`logo.png`** Anda di folder:

```
santara/public/assets/logo.png
```

(timpa file bawaan). Logo dipakai di splash, layar pilih peran, dan sheet install.
Ikon aplikasi ada di `public/icons/` (`icon-192.png`, `icon-512.png`,
`icon-maskable-512.png`, `favicon.ico`, `apple-touch-icon.png`) — ganti bila perlu
dengan ukuran yang sama. Generator aset ada di `tools/make_assets.py`.

---

## 8. Struktur folder

```
santara/
├── server.js              # server: REST API + WebSocket realtime + proxy peta/rute
├── data/db.json           # database (dibuat otomatis)
├── public/
│   ├── index.html         # shell aplikasi
│   ├── manifest.webmanifest
│   ├── sw.js              # service worker (PWA + push)
│   ├── css/style.css      # tema neon / dark glass
│   ├── js/                # map.js · core.js · screens.js · app.js
│   ├── assets/            # logo.png, hero, font  ← taruh logo Anda di sini
│   ├── icons/             # favicon & ikon PWA
│   └── vendor/leaflet/    # peta offline-cadangan (tanpa CDN)
├── tools/
│   ├── make_assets.py     # pembuat logo/ikon
│   └── test-flow.js       # uji alur pesanan + WebSocket
└── docs/screens/          # tangkapan layar hasil uji
```

---

## 9. Uji otomatis (sudah lulus semua)

```bash
# uji backend & realtime (tanpa browser)
node tools/test-flow.js

# uji UI end-to-end 2 perangkat (butuh puppeteer terpisah)
node ../uitest/ui-test.js
node ../uitest/audit.js
```

Yang diuji: login, pesan, terima order, kirim GPS, ubah status, tagihan,
pembayaran, konfirmasi, notifikasi, riwayat, pesan ulang, dompet, pengaturan tarif,
PWA/manifest/ikon, fallback Google Maps, dan audit tata letak di layar 412px & 360px.

---

## 10. Catatan

* Data tersimpan di `data/db.json`. Hapus file itu untuk kembali ke data contoh.
* Menu **Pengaturan** berisi: tarif, API key, kelola tempat les / penjemput / siswa,
  tes notifikasi, bersihkan pesanan, dan reset semua data.
* Untuk pemakaian luar (beda jaringan), jalankan server di komputer dengan IP publik
  atau gunakan tunnel (Cloudflare Tunnel / ngrok) supaya HP bisa mengakses dari mana saja.
