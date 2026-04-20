# MPLS SMAN 5 Tuban — Extra Add-on v1.3

## Yang Diperbaiki di v1.3

1. **Foto verifikasi (Izin/Sakit) DIJAMIN tersimpan di Firestore.**
   - Sebelumnya pakai monkey-patch `CollectionReference.add` yang kalah race
     dengan `firebase-sync.js` (capture phase).
   - Sekarang foto disimpan di queue `pendingPhotos`, lalu listener
     `onSnapshot` otomatis meng-`update()` dokumen yang baru muncul (match
     NISN + tanggal) dengan field `photoBase64` & `photoVerified: true`.
   - Foto akan langsung muncul di **Galeri Verifikasi** dashboard admin.

2. **Hapus Mendalam — pesan error jelas + per-doc delete.**
   - Tidak lagi pakai batch (yang gagal total kalau 1 doc ditolak).
   - Hapus per-doc paralel (chunk 10), jadi kalau sebagian boleh hapus,
     yang itu tetap kehapus.
   - Kalau muncul "missing or insufficient permissions", panel akan
     menampilkan **aturan Firestore Rules yang harus di-paste** ke
     Firebase Console.

## Cara Pasang (sama seperti v1.2)

Edit `index.html`, tambahkan di `<head>`:
```html
<link rel="stylesheet" href="mpls-extra.css" />
```

Tambahkan di akhir `<body>` (SETELAH `firebase-sync.js`):
```html
<script src="mpls-extra.js" defer></script>
```

Lalu redeploy. **Hard refresh** (Ctrl+Shift+R / clear cache) di browser.

## ⚠️ Firestore Rules (WAJIB untuk Hapus Mendalam)

Buka **Firebase Console → Firestore Database → Rules**, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /absensi_mpls/{doc} {
      allow read, write, delete: if true;
    }
  }
}
```

Klik **Publish**. Tanpa ini, "Hapus Mendalam" akan gagal dengan
"missing or insufficient permissions".

> Catatan: rules `if true` hanya untuk admin internal sekolah. Kalau
> dashboard admin terbuka untuk publik, ganti dengan auth check.

## Fitur

1. Anti-duplikat 1 NISN per hari (cek Firestore)
2. Verifikasi kamera Izin/Sakit (countdown 3 detik, frame oval)
3. Foto tersimpan base64 di Firestore (auto-attach via post-write update)
4. Tab gugus 1–8 + export CSV/JSON per gugus
5. Analitik (Hadir, Izin, Sakit) + grafik bar per gugus
6. Galeri foto siswa Izin/Sakit (lightbox)
7. Hapus Mendalam (ketik HAPUS SEMUA + Firestore Rules)

## Troubleshooting

**Foto tidak muncul di galeri:**
- Buka DevTools → Console, cari log `[MPLS-Extra] foto sukses ter-attach ke ...`
- Kalau muncul `attach foto gagal: permission`, Firestore Rules belum
  izinkan UPDATE → pakai rules di atas.
- Pastikan absensi Izin/Sakit benar-benar lewat verifikasi kamera (foto diambil setelah countdown 3-2-1).

**Hapus Mendalam gagal "missing permissions":**
- Pasti Firestore Rules. Pakai rules di atas, klik **Publish**, refresh halaman.
