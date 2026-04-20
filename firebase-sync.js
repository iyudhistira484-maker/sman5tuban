/* ============================================================
   FIREBASE SYNC + GEO-FENCE SECURITY (v2026.3 - FIX SUBMIT)
   - Sinkron absensi via Firestore (realtime, gratis)
   - Validasi GPS WAJIB: auto-request izin saat halaman dibuka
   - Anti-bypass: deteksi mock location & izin ditolak
   - FIX v3: By Muhammad Ilham Yudhistira 
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBJhY-Ay5T0Sf_XAZvbu0QTIQVqy3_BQ3E",
  authDomain: "mpls-sman5-tuban.firebaseapp.com",
  projectId: "mpls-sman5-tuban",
  storageBucket: "mpls-sman5-tuban.firebasestorage.app",
  messagingSenderId: "955652492982",
  appId: "1:955652492982:web:249b973940422081bae017",
  measurementId: "G-KZ7ECFBRG0"
};

const SCHOOL_LOCATION = {
  lat: -6.9352461,
  lng: 112.0568592,
  radiusMeter: 300
};

const ALLOW_BYPASS_GEO = false;

(function () {
  const SCRIPT_VERSION = "v2026.3";
  console.log("[MPLS-Sync] booting", SCRIPT_VERSION);

  let db = null;
  let cloudReady = false;
  let lastKnownLocation = null;
  let geoWatchId = null;
  const COLLECTION = "absensi_mpls";

  /* ---------- Helpers UI ---------- */
  function makeBadge() {
    const form = document.getElementById("attendance-form");
    if (!form) return null;
    const badge = document.createElement("div");
    badge.className = "mpls-cloud-badge is-checking";
    badge.id = "mpls-cloud-badge";
    badge.innerHTML = `<i class="fas fa-cloud"></i><span>Menyambung server...</span>`;
    form.appendChild(badge);

    const geoBadge = document.createElement("div");
    geoBadge.className = "mpls-cloud-badge is-checking";
    geoBadge.id = "mpls-geo-badge";
    geoBadge.style.marginTop = "8px";
    geoBadge.innerHTML = `<i class="fas fa-location-crosshairs"></i><span>Meminta akses lokasi GPS...</span>`;
    form.appendChild(geoBadge);

    const warn = document.createElement("div");
    warn.className = "mpls-geo-warning";
    warn.id = "mpls-geo-warning";
    warn.innerHTML = `<b><i class="fas fa-shield-halved"></i> Keamanan Absensi</b>
      Lokasi GPS kamu akan dipantau otomatis. Absensi <b>HANYA</b> berhasil jika kamu
      benar-benar berada di area SMAN 5 Tuban (radius ${SCHOOL_LOCATION.radiusMeter} m).
      <b>Wajib aktifkan GPS & izinkan akses lokasi</b> — kalau ditolak, absensi ditolak.`;
    form.appendChild(warn);
    return badge;
  }
  function setBadge(id, state, text, icon) {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.remove("is-offline", "is-checking");
    if (state === "offline") b.classList.add("is-offline");
    if (state === "checking") b.classList.add("is-checking");
    b.innerHTML = `<i class="fas fa-${icon || "cloud"}"></i><span>${text}</span>`;
  }

  /* ---------- Firebase init ---------- */
  function initFirebase() {
    try {
      if (typeof firebase === "undefined") {
        console.error("[MPLS-Sync] Library firebase belum dimuat. Pastikan <script firebase-app-compat & firestore-compat> ada di index.html SEBELUM firebase-sync.js");
        setBadge("mpls-cloud-badge", "offline", "Library Firebase tidak ditemukan", "triangle-exclamation");
        return;
      }
      if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith("GANTI")) {
        console.warn("[MPLS-Sync] Firebase belum dikonfigurasi.");
        setBadge("mpls-cloud-badge", "offline", "Server belum dikonfigurasi (mode lokal)", "triangle-exclamation");
        return;
      }
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.firestore();
      cloudReady = true;
      setBadge("mpls-cloud-badge", "ok", "Terhubung ke server", "cloud-arrow-up");
      attachRealtimeListener();
    } catch (err) {
      console.error("[MPLS-Sync] init error", err);
      setBadge("mpls-cloud-badge", "offline", "Gagal sambung server: " + (err.message || err), "triangle-exclamation");
    }
  }

  function attachRealtimeListener() {
    if (!cloudReady) return;
    db.collection(COLLECTION).orderBy("ts", "desc").onSnapshot((snap) => {
      const rows = [];
      snap.forEach((doc) => {
        const d = doc.data();
        rows.push({
          waktu: d.waktu || new Date(d.ts || Date.now()).toLocaleString("id-ID"),
          nama: d.nama, nisn: d.nisn, gugus: d.gugus,
          hari: d.hari, status: d.status, catatan: d.catatan || "-",
          _lat: d.lat, _lng: d.lng, _jarak: d.jarakMeter
        });
      });
      localStorage.setItem("mplsAttendanceRows", JSON.stringify(rows));
      ["renderAttendanceTable", "renderAdminTable", "renderAdminDashboard", "refreshAdmin"].forEach((fn) => {
        if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} }
      });
      const empty = document.getElementById("admin-empty");
      if (empty) empty.style.display = rows.length ? "none" : "";
    }, (err) => {
      console.error("[MPLS-Sync] listener error", err);
      setBadge("mpls-cloud-badge", "offline", "Listener gagal: " + (err.code || err.message), "triangle-exclamation");
    });
  }

  /* ---------- Geo-fence ---------- */
  function distanceMeter(lat1, lng1, lat2, lng2) {
    const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* AUTO request GPS — langsung jalan saat halaman dibuka, no klik dulu */
  function startGeoWatch() {
    if (ALLOW_BYPASS_GEO) {
      lastKnownLocation = { lat: SCHOOL_LOCATION.lat, lng: SCHOOL_LOCATION.lng, bypass: true, acc: 5 };
      setBadge("mpls-geo-badge", "ok", "Lokasi terverifikasi (mode dev)", "location-dot");
      return;
    }
    if (!("geolocation" in navigator)) {
      setBadge("mpls-geo-badge", "offline", "Browser tidak mendukung GPS — absensi ditolak", "triangle-exclamation");
      return;
    }

    setBadge("mpls-geo-badge", "checking", "Meminta izin lokasi — klik IZINKAN di popup", "location-crosshairs");

    geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        // Anti mock: akurasi < 0.3m hampir pasti palsu (HP nyata minimal 1-3m)
        if (acc < 0.3) {
          setBadge("mpls-geo-badge", "offline", `Akurasi GPS mencurigakan (${acc.toFixed(2)}m) — terdeteksi mock location`, "triangle-exclamation");
          lastKnownLocation = null;
          return;
        }
        lastKnownLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: acc };
        const dist = distanceMeter(lastKnownLocation.lat, lastKnownLocation.lng, SCHOOL_LOCATION.lat, SCHOOL_LOCATION.lng);
        if (dist > SCHOOL_LOCATION.radiusMeter) {
          setBadge("mpls-geo-badge", "offline", `Di luar area sekolah (${Math.round(dist)}m, max ${SCHOOL_LOCATION.radiusMeter}m)`, "location-dot");
        } else {
          setBadge("mpls-geo-badge", "ok", `Lokasi terverifikasi — di area sekolah (${Math.round(dist)}m, akurasi ±${Math.round(acc)}m)`, "location-dot");
        }
      },
      (err) => {
        let msg = "Gagal dapat lokasi";
        if (err.code === 1) msg = "IZIN LOKASI DITOLAK — buka pengaturan browser → izinkan lokasi → refresh";
        else if (err.code === 2) msg = "GPS HP mati — nyalakan GPS lalu refresh";
        else if (err.code === 3) msg = "GPS timeout — pindah ke tempat terbuka & refresh";
        setBadge("mpls-geo-badge", "offline", msg, "triangle-exclamation");
        lastKnownLocation = null;
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  /* ---------- Hook ke form absensi ---------- */
  function hookAttendanceForm() {
    const form = document.getElementById("attendance-form");
    const result = document.getElementById("attendance-result");
    if (!form || !result) return;

    // Pakai capture phase + preventDefault dulu, supaya handler localStorage
    // (main.js) tidak ikut menambah duplikat saat sukses kirim cloud
    form.addEventListener("submit", async function (event) {
      // Selalu cegah submit native (refresh halaman)
      event.preventDefault();

      // Status Izin / Sakit -> tidak butuh GPS, cukup verifikasi wajah.
      // Biarkan handler lain (mpls-extra.js) yang menangani submit-nya.
      const statusVal = document.getElementById("attendance-status")?.value || "";
      if (statusVal === "Izin" || statusVal === "Sakit") {
        console.log("[MPLS-Sync] skip GPS check — status:", statusVal, "(pakai verif wajah)");
        return;
      }

      // Kalau cloud belum siap, kasih pesan jelas, biarkan main.js handle local
      if (!cloudReady) {
        console.warn("[MPLS-Sync] cloud belum ready, fallback ke localStorage (main.js)");
        // Jangan stop propagation — main.js akan tetap simpan lokal
        return;
      }

      // Cloud siap → handle penuh di sini, blok handler main.js biar tidak dobel
      event.stopImmediatePropagation();

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : "";

      try {
        if (!lastKnownLocation) {
          throw new Error("Lokasi GPS belum terbaca. Aktifkan GPS, izinkan akses lokasi, lalu refresh halaman.");
        }
        const loc = lastKnownLocation;
        const dist = distanceMeter(loc.lat, loc.lng, SCHOOL_LOCATION.lat, SCHOOL_LOCATION.lng);
        if (!loc.bypass && dist > SCHOOL_LOCATION.radiusMeter) {
          throw new Error(`Kamu ${Math.round(dist)}m dari sekolah. Absensi hanya dalam radius ${SCHOOL_LOCATION.radiusMeter}m.`);
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Mengirim..."; }

        const record = {
          waktu: new Date().toLocaleString("id-ID"),
          ts: Date.now(),
          nama: document.getElementById("attendance-name").value.trim(),
          nisn: document.getElementById("attendance-nisn").value.trim(),
          gugus: document.getElementById("attendance-group").value,
          hari: document.getElementById("attendance-day").value,
          status: document.getElementById("attendance-status").value,
          catatan: document.getElementById("attendance-note").value.trim() || "-",
          lat: loc.lat, lng: loc.lng,
          akurasiMeter: Math.round(loc.acc || 0),
          jarakMeter: Math.round(dist),
          ua: navigator.userAgent.slice(0, 120)
        };

        if (!record.nama || !record.nisn) {
          throw new Error("Nama dan NISN wajib diisi.");
        }

        console.log("[MPLS-Sync] kirim ke Firestore:", record);
        const docRef = await db.collection(COLLECTION).add(record);
        console.log("[MPLS-Sync] sukses, doc id:", docRef.id);

        result.classList.add("success");
        result.innerHTML = `<strong>Absensi berhasil terkirim ke server.</strong>
          <span>${record.nama} tercatat <b>${record.status}</b> untuk ${record.hari}, Gugus ${record.gugus}.
          Lokasi terverifikasi (${Math.round(dist)} m dari sekolah, akurasi ±${record.akurasiMeter}m).
          Doc ID: ${docRef.id}</span>`;
        form.reset();
      } catch (err) {
        console.error("[MPLS-Sync] submit error:", err);
        result.classList.remove("success");
        const code = err.code ? ` (${err.code})` : "";
        let hint = "";
        if (err.code === "permission-denied") {
          hint = "<br><b>Solusi:</b> buka Firebase Console → Firestore → Rules, pakai test mode atau allow write.";
        } else if (err.code === "unavailable") {
          hint = "<br><b>Solusi:</b> cek koneksi internet kamu.";
        }
        result.innerHTML = `<strong style="color:#b91c1c">Absensi gagal terkirim${code}.</strong>
          <span>${err.message || err}${hint}</span>`;
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText || "Kirim Absensi"; }
      }
    }, true); // capture phase = jalan duluan sebelum main.js
  }

  function boot() {
    makeBadge();
    initFirebase();
    hookAttendanceForm();
    startGeoWatch();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
