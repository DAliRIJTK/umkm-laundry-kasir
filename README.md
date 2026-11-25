# UMKM Laundry Kasir & Pelacak Nota

Aplikasi web kasir dan pelacakan status cucian untuk usaha laundry kiloan dan satuan skala rumahan. Kasir mencatat order masuk, memantau antrean yang melewati janji selesai, menerima DP atau pelunasan (Tunai, QRIS, Transfer), dan membagikan tautan cek status ke pelanggan tanpa biaya langganan cloud.

## Tautan Desain

- Desain UI & Design System (Figma): [UMKM Laundry Kasir - UI & Design System](https://www.figma.com/design/FX4WJtTvwhqv3p1vwrbSHA)
- Flow State, Physical ERD & Arsitektur Sistem (FigJam): [UMKM Laundry Kasir - FigJam Board](https://www.figma.com/board/7fQLodoePW6RCyqNiWfHLG)

## Fitur Utama

1. **Workspace Kasir Terproteksi PIN (`/`):** Login menggunakan PIN toko yang di-hash dengan `scrypt`, cookie sesi bertanda tangan HMAC-SHA256, proteksi CSRF (`Origin`, `Sec-Fetch-Site`, dan `Content-Type`), serta pembatasan percobaan PIN salah.
2. **Order Kiloan dan Satuan:** Mendukung berat desimal (contoh `2.5 kg` atau `2,5 kg`) yang disimpan sebagai integer persepuluh (`qty_tenths`) agar hitungan Rupiah tidak meleset akibat pembulatan floating-point.
3. **Alur Status dan Gerbang Pelunasan:** Transisi status berjalan berurutan (`DITERIMA` -> `DICUCI` -> `DISETRIKA` -> `SIAP_AMBIL` -> `DIAMBIL`, atau `DIBATALKAN`). Order tidak bisa diubah ke `DIAMBIL` selama masih ada sisa tagihan.
4. **Rekap Kas Harian Akurat:** Pembayaran dicatat di buku besar `payments` terpisah sehingga DP kemarin dan pelunasan hari ini dihitung sesuai tanggal uang masuk per metode bayar (`TUNAI`, `QRIS`, `TRANSFER`).
5. **Pelacak Status Publik (`/track`):** Pelanggan mengecek progres cucian dan sisa bayar memakai kode nota dan 4 digit terakhir nomor HP. Catatan internal kasir dan nomor HP utuh disembunyikan dari respons publik.

## Arsitektur dan Struktur File

Aplikasi berjalan di satu proses Node.js (`v22+`) memakai pustaka bawaan (`node:http`, `node:sqlite`, `node:crypto`, `node:test`) tanpa dependensi eksternal. Database SQLite lokal disimpan terisolasi di `data/laundry.db` dalam mode `WAL`.

```text
src/
  domain.js   Normalisasi HP, hitungan qty_tenths & Rupiah, state machine status
  auth.js     Hash PIN scrypt, cookie token HMAC-SHA256, rate limiter
  db.js       Skema SQLite terisolasi, seed layanan standar & data demo
  store.js    Transaksi SQLite atomik untuk order, pembayaran, rekap, dan tracking
  server.js   Server HTTP, header keamanan (CSP ketat), API REST, dan file statis
public/
  index.html  Antarmuka login PIN dan workspace kasir
  track.html  Halaman pelacakan status untuk pelanggan (ramah layar HP)
  shared.js   Helper DOM aman (tanpa innerHTML) dan formatter Rupiah/waktu WIB
  kasir.js    Logika antrean, detail nota, order baru, tarif layanan, dan rekap kas
  track.js    Logika pencarian status nota publik
  styles.css  Token desain dan tata letak responsif
tests/
  domain.test.js, auth.test.js, api.test.js, edge-cases.test.js, security.test.js
```

## Cara Menjalankan

Prasyarat: Node.js `v22` ke atas.

```powershell
# Jalankan server lokal (port default 3080, PIN demo default 123456)
npm start

# Atau jalankan dengan PIN toko khusus
$env:LAUNDRY_PIN = "654321"
node --no-warnings src/server.js
```

Buka `http://127.0.0.1:3080` untuk halaman kasir atau `http://127.0.0.1:3080/track` untuk halaman pelacakan pelanggan.

## Menjalankan Pengujian

```powershell
npm test
# atau langsung tanpa overhead npm:
node --no-warnings --test tests/*.test.js
```

Seluruh 23 pengujian unit, integrasi HTTP, edge case input kotor, dan keamanan lulus pada Node.js v22.22.0.
