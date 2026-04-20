(function () {
  "use strict";

  const TAG = "[MPLS-Master]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const FORM_ID = "attendance-form";
  const RESULT_ID = "attendance-result";
  const COLLECTION = "absensi_mpls";
  const NEED_PHOTO = ["Izin", "Sakit"];
  const NEED_GPS = ["Hadir"];
  const SCHOOL = (window.SCHOOL_LOCATION && typeof window.SCHOOL_LOCATION.lat === "number")
    ? window.SCHOOL_LOCATION
    : { lat: -6.9352461, lng: 112.0568592, radiusMeter: 300 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function setResult(kind, title, body) {
    const r = $(RESULT_ID);
    if (!r) return;
    r.classList.remove("success");
    if (kind === "success") r.classList.add("success");
    const color = kind === "error" ? "#b91c1c" : kind === "success" ? "" : "#1e3a8a";
    r.innerHTML = `<strong${color ? ` style="color:${color}"` : ""}>${title}</strong><span>${body}</span>`;
  }

  /* ---------- Firestore ---------- */
  function getDb() {
    if (typeof firebase === "undefined" || !firebase.firestore) return null;
    if (!firebase.apps || firebase.apps.length === 0) return null;
    try { return firebase.firestore(); } catch { return null; }
  }

  function dateKey(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  async function isDuplicateNisn(nisn) {
    const db = getDb();
    if (!db || !nisn) return false;
    try {
      const snap = await db.collection(COLLECTION).where("nisn", "==", nisn).get();
      const today = dateKey();
      return snap.docs.find((d) => dateKey(d.data().ts) === today) || null;
    } catch (e) {
      warn("dup check fail:", e);
      return false;
    }
  }

  /* ---------- GPS ---------- */
  function distanceMeter(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function getLocation() {
    return new Promise((resolve, reject) => {
      // Pakai cache dari add-on lain kalau ada
      const cached = window.lastKnownLocation;
      if (cached && typeof cached.lat === "number" && (Date.now() - (cached.ts || 0) < 30000)) {
        return resolve(cached);
      }
      if (!navigator.geolocation) return reject(new Error("Browser tidak mendukung GPS."));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy || 0,
          ts: Date.now(),
        }),
        (err) => {
          let msg = "Gagal baca GPS.";
          if (err.code === 1) msg = "Izin lokasi ditolak. Buka pengaturan situs → Location → Allow, lalu refresh.";
          else if (err.code === 2) msg = "Lokasi tidak tersedia. Coba pindah ke tempat dengan sinyal lebih baik.";
          else if (err.code === 3) msg = "GPS timeout. Pastikan GPS aktif lalu coba lagi.";
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 5000 }
      );
    });
  }

  /* ---------- Camera Overlay (standalone, ringan) ---------- */
  const OVERLAY_ID = "mpls-master-cam";
  let overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = OVERLAY_ID;
    overlayEl.style.cssText = `
      position:fixed;inset:0;z-index:99999;background:rgba(7,12,28,.95);
      display:none;flex-direction:column;align-items:center;justify-content:center;
      padding:20px;color:#fff;font-family:system-ui,sans-serif;`;
    overlayEl.innerHTML = `
      <div style="max-width:480px;width:100%;text-align:center;">
        <h3 style="margin:0 0 8px;font-size:18px">Verifikasi Wajah</h3>
        <p id="mpg-msg" style="margin:0 0 12px;font-size:13px;opacity:.85">Posisikan wajah di dalam frame.</p>
        <div style="position:relative;background:#000;border-radius:16px;overflow:hidden;aspect-ratio:3/4;">
          <video id="mpg-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"></video>
          <div style="position:absolute;inset:8%;border:3px dashed rgba(255,255,255,.6);border-radius:50%;pointer-events:none"></div>
          <div id="mpg-count" style="position:absolute;top:12px;right:12px;background:rgba(0,0,0,.6);padding:6px 12px;border-radius:999px;font-weight:700"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button id="mpg-cancel" type="button" style="flex:1;padding:12px;border:none;border-radius:10px;background:#374151;color:#fff;font-weight:600;cursor:pointer">Batal</button>
          <button id="mpg-snap" type="button" style="flex:2;padding:12px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">Mulai Hitung Mundur</button>
        </div>
      </div>`;
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function takePhoto(stream) {
    return new Promise((resolve, reject) => {
      const ov = ensureOverlay();
      ov.style.display = "flex";
      const video = ov.querySelector("#mpg-video");
      const msg = ov.querySelector("#mpg-msg");
      const cnt = ov.querySelector("#mpg-count");
      const btnSnap = ov.querySelector("#mpg-snap");
      const btnCancel = ov.querySelector("#mpg-cancel");
      video.srcObject = stream;

      let countdownTimer = null;
      let resolved = false;

      const cleanup = () => {
        if (countdownTimer) clearInterval(countdownTimer);
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        ov.style.display = "none";
        btnSnap.onclick = null;
        btnCancel.onclick = null;
      };

      const cancel = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(null);
      };

      const snap = () => {
        if (resolved) return;
        const c = document.createElement("canvas");
        c.width = video.videoWidth || 480;
        c.height = video.videoHeight || 640;
        const ctx = c.getContext("2d");
        // mirror agar match preview
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/jpeg", 0.78);
        resolved = true;
        cleanup();
        resolve(data);
      };

      btnCancel.onclick = cancel;
      btnSnap.onclick = () => {
        btnSnap.disabled = true;
        btnSnap.textContent = "Bersiap...";
        let n = 3;
        cnt.textContent = String(n);
        countdownTimer = setInterval(() => {
          n--;
          if (n <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            cnt.textContent = "📸";
            snap();
          } else {
            cnt.textContent = String(n);
          }
        }, 1000);
      };
    });
  }

  async function captureFace() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Browser tidak mendukung kamera.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
      audio: false,
    });
    return takePhoto(stream);
  }

  /* ---------- Submit handler tunggal ---------- */
  let submitting = false;

  async function handleSubmit(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (submitting) return;
    submitting = true;

    const form = ev.currentTarget;
    const submitBtn = form.querySelector('button[type="submit"]');
    const oldText = submitBtn ? submitBtn.textContent : "Kirim Absensi";
    const setBtn = (txt, disabled) => {
      if (!submitBtn) return;
      submitBtn.disabled = !!disabled;
      submitBtn.textContent = txt;
    };

    try {
      const nama = ($("attendance-name")?.value || "").trim();
      const nisn = ($("attendance-nisn")?.value || "").trim();
      const gugus = $("attendance-group")?.value || "";
      const hari = $("attendance-day")?.value || "";
      const status = $("attendance-status")?.value || "";
      const catatan = ($("attendance-note")?.value || "").trim() || "-";

      if (!nama || !nisn || !gugus || !hari || !status) {
        throw new Error("Lengkapi semua field absensi dulu ya.");
      }

      setBtn("Mengecek data...", true);
      const dup = await isDuplicateNisn(nisn);
      if (dup) {
        const dupStatus = dup.data?.().status || dup.data?.()?.status || "";
        throw new Error(`NISN ${nisn} sudah absen hari ini${dupStatus ? " (status: " + dupStatus + ")" : ""}. 1 NISN hanya boleh 1x per hari.`);
      }

      let location = null;
      let dist = null;
      let photoBase64 = null;

      if (NEED_GPS.includes(status)) {
        // ===== HADIR: WAJIB GPS, TIDAK PERLU FOTO =====
        setBtn("Validasi lokasi...", true);
        location = await getLocation();
        dist = distanceMeter(location.lat, location.lng, SCHOOL.lat, SCHOOL.lng);
        const radius = SCHOOL.radiusMeter || 300;
        if (!location.bypass && dist > radius) {
          throw new Error(`Lokasi kamu ${Math.round(dist)}m dari sekolah (max ${radius}m). Absensi hanya bisa di area sekolah.`);
        }
      } else if (NEED_PHOTO.includes(status)) {
        // ===== IZIN / SAKIT: WAJIB FOTO, SKIP GPS =====
        setBtn("Membuka kamera...", true);
        photoBase64 = await captureFace();
        if (!photoBase64) {
          throw new Error("Verifikasi wajah dibatalkan. Foto wajib untuk status Izin/Sakit.");
        }
      }

      // ===== Kirim ke Firestore =====
      setBtn("Mengirim...", true);
      const db = getDb();
      const payload = {
        waktu: new Date().toLocaleString("id-ID"),
        ts: Date.now(),
        nama, nisn, gugus, hari, status, catatan,
        lat: location ? location.lat : null,
        lng: location ? location.lng : null,
        akurasiMeter: location ? Math.round(location.acc || 0) : null,
        jarakMeter: dist != null ? Math.round(dist) : null,
        photoBase64: photoBase64 || null,
        photoVerified: !!photoBase64,
        ua: navigator.userAgent.slice(0, 120),
        sumber: "master-guard-v1",
      };

      let docId = "(local)";
      if (db) {
        const ref = await db.collection(COLLECTION).add(payload);
        docId = ref.id;
        log("Tersimpan cloud:", docId);
      } else {
        // Fallback localStorage saja kalau cloud belum siap
        try {
          const KEY = "mplsAttendanceRows";
          const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
          arr.push(payload);
          localStorage.setItem(KEY, JSON.stringify(arr));
        } catch {}
        warn("Cloud belum siap, simpan local");
      }

      const distText = dist != null ? ` Lokasi valid ${Math.round(dist)}m dari sekolah.` : "";
      const photoText = photoBase64 ? " Foto verifikasi tersimpan." : "";
      setResult(
        "success",
        "Absensi berhasil terkirim.",
        `${esc(nama)} tercatat <b>${esc(status)}</b> untuk ${esc(hari)}, Gugus ${esc(gugus)}.${distText}${photoText} ID: ${esc(docId)}`
      );
      form.reset();
    } catch (err) {
      console.error(TAG, err);
      setResult("error", "Absensi gagal terkirim.", esc(err.message || String(err)));
    } finally {
      setBtn(oldText, false);
      submitting = false;
    }
  }

  /* ---------- Bersihkan listener legacy dengan cloning form ---------- */
  function takeOverForm() {
    const old = document.getElementById(FORM_ID);
    if (!old) {
      warn("form belum ada, retry 400ms");
      setTimeout(takeOverForm, 400);
      return;
    }
    if (old.dataset.masterHooked === "1") return;

    // Clone form (tanpa listener) lalu replace, supaya semua handler bentrok mati.
    const fresh = old.cloneNode(true);
    fresh.dataset.masterHooked = "1";
    old.parentNode.replaceChild(fresh, old);

    fresh.addEventListener("submit", handleSubmit);
    log("form di-take-over. Semua submit handler legacy dinonaktifkan.");
  }

  function boot() {
    takeOverForm();
    // Re-take-over kalau ada script yg ganti DOM form belakangan
    const obs = new MutationObserver(() => {
      const f = document.getElementById(FORM_ID);
      if (f && f.dataset.masterHooked !== "1") takeOverForm();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    log("Master guard aktif (v1).");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
