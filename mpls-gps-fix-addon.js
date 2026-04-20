(() => {
  const FORM_ID = "attendance-form";
  const RESULT_ID = "attendance-result";
  const GEO_BADGE_ID = "mpls-geo-badge";
  const CLOUD_BADGE_ID = "mpls-cloud-badge";
  const COLLECTION = "absensi_mpls";
  const SCHOOL_LOCATION = {
    lat: -6.9352461,
    lng: 112.0568592,
    radiusMeter: 300,
  };
  const EXTRA_RADIUS_FROM_ACCURACY = 120;

  const state = {
    watchId: null,
    position: null,
    submitting: false,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setBadge(id, mode, text, icon) {
    const badge = byId(id);
    if (!badge) return;
    badge.classList.remove("is-offline", "is-checking");
    if (mode === "offline") badge.classList.add("is-offline");
    if (mode === "checking") badge.classList.add("is-checking");
    badge.innerHTML = `<i class="fas fa-${icon || "circle-info"}"></i><span>${text}</span>`;
  }

  function setResult(kind, title, body) {
    const box = byId(RESULT_ID);
    if (!box) return;
    box.classList.toggle("success", kind === "success");
    const strongStyle = kind === "error" ? ' style="color:#b91c1c"' : "";
    box.innerHTML = `<strong${strongStyle}>${title}</strong><span>${body}</span>`;
  }

  function distanceMeter(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function normalizePosition(pos) {
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      acc: Number(pos.coords.accuracy || 0),
      ts: Date.now(),
    };
  }

  function allowedRadius(acc) {
    const safeAcc = Number.isFinite(acc) ? Math.max(acc, 0) : 0;
    return SCHOOL_LOCATION.radiusMeter + Math.min(safeAcc, EXTRA_RADIUS_FROM_ACCURACY);
  }

  function explainGeoError(err) {
    if (!err) return "Lokasi GPS belum siap. Tunggu sebentar lalu coba lagi.";
    if (err.code === 1 || err.code === "permission-denied") {
      return "Izin lokasi browser untuk situs ini masih ditolak. Buka ikon gembok/browser menu → Site settings → Location → Allow, lalu refresh halaman.";
    }
    if (err.code === 2) {
      return "Lokasi perangkat belum ketemu. Aktifkan mode akurasi tinggi dan tunggu GPS stabil.";
    }
    if (err.code === 3) {
      return "GPS timeout. Coba pindah ke area lebih terbuka lalu kirim lagi.";
    }
    return err.message || String(err);
  }

  function ensureFirebaseDb() {
    if (typeof firebase === "undefined") {
      throw new Error("Library Firebase belum termuat di halaman ini.");
    }
    if (!firebase.apps || !firebase.apps.length) {
      throw new Error("Database belum aktif. Pastikan firebase-sync.js tetap dimuat sebelum add-on ini.");
    }
    return firebase.firestore();
  }

  function readForm() {
    return {
      nama: byId("attendance-name")?.value.trim() || "",
      nisn: byId("attendance-nisn")?.value.trim() || "",
      gugus: byId("attendance-group")?.value || "",
      hari: byId("attendance-day")?.value || "",
      status: byId("attendance-status")?.value || "",
      catatan: byId("attendance-note")?.value.trim() || "-",
    };
  }

  function saveLocal(record) {
    try {
      const rows = JSON.parse(localStorage.getItem("mplsAttendanceRows") || "[]");
      rows.unshift({
        waktu: record.waktu,
        nama: record.nama,
        nisn: record.nisn,
        gugus: record.gugus,
        hari: record.hari,
        status: record.status,
        catatan: record.catatan,
        _lat: record.lat,
        _lng: record.lng,
        _jarak: record.jarakMeter,
      });
      localStorage.setItem("mplsAttendanceRows", JSON.stringify(rows));
      ["renderAttendanceTable", "renderAdminTable", "renderAdminDashboard", "refreshAdmin"].forEach((fn) => {
        if (typeof window[fn] === "function") {
          try {
            window[fn]();
          } catch (_) {}
        }
      });
    } catch (_) {}
  }

  function updateGeoBadge(position) {
    if (!position) return;
    const dist = distanceMeter(position.lat, position.lng, SCHOOL_LOCATION.lat, SCHOOL_LOCATION.lng);
    const maxDist = allowedRadius(position.acc);
    if (dist <= maxDist) {
      setBadge(
        GEO_BADGE_ID,
        "ok",
        `Lokasi siap dikirim (${Math.round(dist)}m dari sekolah, akurasi ±${Math.round(position.acc || 0)}m)`,
        "location-dot",
      );
    } else {
      setBadge(
        GEO_BADGE_ID,
        "offline",
        `Lokasi masih ${Math.round(dist)}m dari sekolah. Maksimal dinilai aman ${Math.round(maxDist)}m dari titik sekolah.`,
        "triangle-exclamation",
      );
    }
  }

  function getFreshPosition(timeout = 18000) {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Browser ini tidak mendukung geolocation."));
        return;
      }

      let done = false;
      let watchId = null;
      const finish = (handler, value) => {
        if (done) return;
        done = true;
        if (watchId !== null) {
          try {
            navigator.geolocation.clearWatch(watchId);
          } catch (_) {}
        }
        handler(value);
      };

      const success = (pos) => {
        const normalized = normalizePosition(pos);
        state.position = normalized;
        updateGeoBadge(normalized);
        finish(resolve, normalized);
      };

      const fallbackWatch = () => {
        watchId = navigator.geolocation.watchPosition(
          success,
          (err) => finish(reject, err),
          { enableHighAccuracy: true, timeout, maximumAge: 0 },
        );
      };

      navigator.geolocation.getCurrentPosition(
        success,
        () => fallbackWatch(),
        { enableHighAccuracy: true, timeout, maximumAge: 0 },
      );
    });
  }

  async function warmLocation() {
    if (!("geolocation" in navigator)) {
      setBadge(GEO_BADGE_ID, "offline", "Browser tidak mendukung GPS.", "triangle-exclamation");
      return null;
    }

    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({ name: "geolocation" });
        if (permission.state === "denied") {
          setBadge(
            GEO_BADGE_ID,
            "offline",
            "Izin lokasi browser masih ditolak. Ubah ke Allow lalu refresh.",
            "triangle-exclamation",
          );
          return null;
        }
      }
    } catch (_) {}

    setBadge(GEO_BADGE_ID, "checking", "Mengambil lokasi GPS terbaru...", "location-crosshairs");
    try {
      return await getFreshPosition();
    } catch (err) {
      setBadge(GEO_BADGE_ID, "offline", explainGeoError(err), "triangle-exclamation");
      return null;
    }
  }

  function startBackgroundWatch() {
    if (!("geolocation" in navigator) || state.watchId !== null) return;
    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        state.position = normalizePosition(pos);
        updateGeoBadge(state.position);
      },
      (err) => {
        if (err?.code === 1) {
          setBadge(GEO_BADGE_ID, "offline", explainGeoError(err), "triangle-exclamation");
        }
      },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 5000 },
    );
  }

  // Status yang TIDAK butuh validasi GPS — cukup verifikasi wajah (ditangani mpls-extra.js)
  const SKIP_GPS_STATUS = ["Izin", "Sakit"];

  async function handleAttendanceSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== FORM_ID) return;

    // Cek status DULU sebelum preventDefault — kalau Izin/Sakit, jangan ganggu
    // submit flow-nya (biar mpls-extra.js yang handle verifikasi wajah + kirim).
    const statusEl = document.getElementById("attendance-status");
    const currentStatus = statusEl?.value || "";
    if (SKIP_GPS_STATUS.includes(currentStatus)) {
      console.log("[MPLS GPS FIX] skip validasi GPS — status:", currentStatus, "(pakai verifikasi wajah)");
      return; // biarkan event lanjut ke handler lain (mpls-extra.js)
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (state.submitting) return;
    state.submitting = true;

    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton?.textContent || "Kirim Absensi";

    try {
      const formData = readForm();
      if (!formData.nama || !formData.nisn || !formData.gugus || !formData.hari || !formData.status) {
        throw new Error("Lengkapi semua field absensi dulu ya.");
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Validasi lokasi...";
      }

      const location = await warmLocation();
      if (!location) {
        throw new Error("Lokasi belum bisa dipakai. Pastikan izin lokasi browser untuk situs ini sudah Allow.");
      }

      const dist = distanceMeter(location.lat, location.lng, SCHOOL_LOCATION.lat, SCHOOL_LOCATION.lng);
      const maxDist = allowedRadius(location.acc);
      if (dist > maxDist) {
        throw new Error(
          `Lokasi kamu terbaca ${Math.round(dist)}m dari sekolah. Anda tidak di area sekolahan!.`,
        );
      }

      if (submitButton) {
        submitButton.textContent = "Mengirim...";
      }

      const db = ensureFirebaseDb();
      const payload = {
        waktu: new Date().toLocaleString("id-ID"),
        ts: Date.now(),
        nama: formData.nama,
        nisn: formData.nisn,
        gugus: formData.gugus,
        hari: formData.hari,
        status: formData.status,
        catatan: formData.catatan,
        lat: location.lat,
        lng: location.lng,
        akurasiMeter: Math.round(location.acc || 0),
        jarakMeter: Math.round(dist),
        ua: navigator.userAgent.slice(0, 120),
        sumber: "gps-fix-addon-v1",
      };

      const docRef = await db.collection(COLLECTION).add(payload);
      saveLocal(payload);
      setBadge(CLOUD_BADGE_ID, "ok", "Absensi masuk ke Firestore", "cloud-arrow-up");
      setResult(
        "success",
        "Absensi berhasil terkirim.",
        `${payload.nama} tercatat ${payload.status} untuk ${payload.hari}. Lokasi valid ${Math.round(dist)}m dari sekolah. ID: ${docRef.id}`,
      );
      form.reset();
    } catch (err) {
      const code = err?.code ? ` (${err.code})` : "";
      setResult("error", `Absensi gagal terkirim${code}.`, explainGeoError(err));
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
      state.submitting = false;
    }
  }

  function boot() {
    startBackgroundWatch();
    warmLocation();
    window.addEventListener("focus", warmLocation);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) warmLocation();
    });
    window.addEventListener("submit", handleAttendanceSubmit, true);
    console.log("[MPLS GPS FIX] add-on aktif");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
