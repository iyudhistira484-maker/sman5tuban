/* ============================================================
   MPLS ADD-ONS (v2.0) — TIDAK MENGUBAH FILE LAMA
   Fitur:
     1) Export absensi Firestore ke Excel (.xlsx) & CSV di dashboard admin
     2) Verifikasi selfie kamera FULLSCREEN dgn auto-capture (countdown 3 dtk)
     3) Anti-duplikasi NISN per hari (cek Firestore sebelum kirim)
   v2.0 fix: setelah selfie, data dikirim LANGSUNG ke Firestore oleh add-on
            (tidak re-trigger form) -> tidak ada race / data tidak terkirim.
   Cara pakai (di index.html, sebelum </body>):
     <link rel="stylesheet" href="mpls-addons.css">
     <script src="mpls-addons.js" defer></script>
   ============================================================ */
(function () {
  const COLLECTION = "absensi_mpls";
  const SHEETJS_CDN = "https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js";
  const TAG = "[MPLS-Addons]";
  const CAPTURE_COUNTDOWN = 3; // detik

  /* ---------- util ---------- */
  function log() { console.log.apply(console, [TAG].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); }
  function $(id) { return document.getElementById(id); }
  function getDb() {
    try {
      if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) return null;
      return firebase.firestore();
    } catch (e) { return null; }
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Gagal load " + src)); };
      document.head.appendChild(s);
    });
  }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function notify(html, ok) {
    const r = $("attendance-result");
    if (!r) { return; }
    r.classList.toggle("success", !!ok);
    r.innerHTML = html;
  }

  /* ============================================================
     1) EXPORT EXCEL / CSV DI HALAMAN ADMIN
     ============================================================ */
  async function fetchAllAttendance() {
    const db = getDb();
    if (!db) throw new Error("Firebase belum siap. Refresh halaman & tunggu badge 'Tersambung'.");
    const snap = await db.collection(COLLECTION).orderBy("ts", "desc").get();
    const rows = [];
    snap.forEach(function (doc) {
      const d = doc.data() || {};
      rows.push({
        ID: doc.id,
        Waktu: d.waktu || (d.ts ? new Date(d.ts).toLocaleString("id-ID") : "-"),
        Nama: d.nama || "-",
        NISN: d.nisn || "-",
        Gugus: d.gugus || "-",
        Hari: d.hari || "-",
        Status: d.status || "-",
        Catatan: d.catatan || "-",
        Lat: d.lat != null ? d.lat : "",
        Lng: d.lng != null ? d.lng : "",
        JarakMeter: d.jarakMeter != null ? d.jarakMeter : "",
        AkurasiMeter: d.akurasiMeter != null ? d.akurasiMeter : "",
        Selfie: d.selfieDataUrl ? "(tersimpan)" : "",
        UA: d.ua || ""
      });
    });
    return rows;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function rowsToCsv(rows) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const esc = function (v) {
      const s = String(v == null ? "" : v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [headers.join(",")].concat(rows.map(function (r) {
      return headers.map(function (h) { return esc(r[h]); }).join(",");
    })).join("\r\n");
  }

  async function exportExcel() {
    const btn = $("addon-download-xlsx");
    try {
      if (btn) { btn.disabled = true; btn.dataset.old = btn.textContent; btn.textContent = "Memuat..."; }
      const rows = await fetchAllAttendance();
      if (!rows.length) { alert("Belum ada data absensi di server."); return; }
      if (typeof XLSX === "undefined") await loadScript(SHEETJS_CDN);
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = Object.keys(rows[0]).map(function (k) {
        return { wch: Math.min(28, Math.max(k.length + 2, 12)) };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Absensi MPLS");
      XLSX.writeFile(wb, "absensi-mpls-" + todayKey() + ".xlsx");
      log("Export Excel:", rows.length, "baris");
    } catch (e) {
      console.error(e); alert("Export Excel gagal: " + (e.message || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.old || "⬇ Download Excel (Cloud)"; }
    }
  }

  async function exportCsvFromCloud() {
    try {
      const rows = await fetchAllAttendance();
      if (!rows.length) { alert("Belum ada data absensi di server."); return; }
      const csv = "\uFEFF" + rowsToCsv(rows);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }),
        "absensi-mpls-" + todayKey() + ".csv");
    } catch (e) { alert("Export CSV gagal: " + (e.message || e)); }
  }

  function injectAdminButtons() {
    const dash = $("admin-dashboard");
    if (!dash) return false;
    const actions = dash.querySelector(".admin-actions");
    if (!actions || $("addon-download-xlsx")) return true;

    const btnX = document.createElement("button");
    btnX.id = "addon-download-xlsx"; btnX.type = "button";
    btnX.className = "admin-btn-primary";
    btnX.style.background = "linear-gradient(135deg,#16a34a,#15803d)";
    btnX.textContent = "⬇ Download Excel (Cloud)";
    btnX.addEventListener("click", exportExcel);

    const btnC = document.createElement("button");
    btnC.id = "addon-download-csv-cloud"; btnC.type = "button";
    btnC.className = "admin-btn-secondary";
    btnC.textContent = "⬇ CSV (Cloud)";
    btnC.addEventListener("click", exportCsvFromCloud);

    actions.appendChild(btnX);
    actions.appendChild(btnC);
    log("Tombol export Excel/CSV ditambahkan ke dashboard admin");
    return true;
  }

  /* ============================================================
     2) HALAMAN KAMERA FULLSCREEN + AUTO-CAPTURE
     ============================================================ */
  let camStream = null;
  let camResolve = null;

  function buildCameraPage() {
    if ($("addon-cam-page")) return;
    const wrap = document.createElement("div");
    wrap.id = "addon-cam-page";
    wrap.innerHTML =
      '<div class="addon-cam-bg"></div>' +
      '<div class="addon-cam-inner">' +
        '<header class="addon-cam-header">' +
          '<div class="addon-cam-title"><i class="fas fa-camera"></i> Verifikasi Selfie</div>' +
          '<button type="button" class="addon-cam-cancel" id="addon-cam-cancel" aria-label="Batal">×</button>' +
        '</header>' +
        '<div class="addon-cam-stage">' +
          '<video id="addon-cam-video" autoplay playsinline muted></video>' +
          '<canvas id="addon-cam-canvas" hidden></canvas>' +
          '<img id="addon-cam-preview" alt="Hasil selfie" hidden />' +
          '<div class="addon-cam-frame"></div>' +
          '<div class="addon-cam-count" id="addon-cam-count" hidden></div>' +
          '<div class="addon-cam-flash" id="addon-cam-flash"></div>' +
        '</div>' +
        '<p class="addon-cam-hint" id="addon-cam-hint">Memuat kamera…</p>' +
        '<div class="addon-cam-actions">' +
          '<button type="button" id="addon-cam-retake" class="addon-cam-btn-secondary" hidden><i class="fas fa-rotate"></i> Ulangi</button>' +
          '<button type="button" id="addon-cam-confirm" class="addon-cam-btn-primary" hidden><i class="fas fa-check"></i> Pakai Foto & Kirim</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    $("addon-cam-cancel").addEventListener("click", function () { closeCam(null); });
  }

  function stopCam() {
    if (camStream) {
      camStream.getTracks().forEach(function (t) { t.stop(); });
      camStream = null;
    }
  }
  function closeCam(dataUrl) {
    stopCam();
    const m = $("addon-cam-page");
    if (m) m.classList.remove("is-open");
    document.documentElement.style.overflow = "";
    if (camResolve) { const r = camResolve; camResolve = null; r(dataUrl); }
  }

  async function startStream() {
    const video = $("addon-cam-video");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new Error("Browser tidak mendukung kamera.");
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = camStream;
    await new Promise(function (res) {
      if (video.readyState >= 2) return res();
      video.onloadedmetadata = function () { res(); };
    });
  }

  function captureFrame() {
    const video = $("addon-cam-video");
    const canvas = $("addon-cam-canvas");
    const w = video.videoWidth || 640, h = video.videoHeight || 480;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  }

  function flash() {
    const f = $("addon-cam-flash");
    if (!f) return;
    f.classList.add("is-on");
    setTimeout(function () { f.classList.remove("is-on"); }, 220);
  }

  function showCountdown(n) {
    const el = $("addon-cam-count");
    el.hidden = false;
    el.textContent = n;
    el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse");
  }
  function hideCountdown() { const el = $("addon-cam-count"); if (el) el.hidden = true; }

  function openCameraPage() {
    return new Promise(async function (resolve) {
      buildCameraPage();
      camResolve = resolve;
      const page = $("addon-cam-page");
      const hint = $("addon-cam-hint");
      const video = $("addon-cam-video");
      const preview = $("addon-cam-preview");
      const btnRet = $("addon-cam-retake");
      const btnOk = $("addon-cam-confirm");

      page.classList.add("is-open");
      document.documentElement.style.overflow = "hidden";
      preview.hidden = true; video.hidden = false;
      btnRet.hidden = true; btnOk.hidden = true;
      hideCountdown();

      try {
        hint.textContent = "Meminta izin kamera…";
        await startStream();
      } catch (e) {
        hint.innerHTML = '<b style="color:#fecaca">Kamera tidak bisa diakses:</b> ' +
          (e.message || e) + '.<br>Izinkan kamera lalu coba lagi.';
        return;
      }

      // Auto countdown lalu capture
      hint.textContent = "Posisikan wajah di dalam bingkai. Foto akan diambil otomatis…";
      let n = CAPTURE_COUNTDOWN;
      showCountdown(n);
      const iv = setInterval(function () {
        n -= 1;
        if (n > 0) { showCountdown(n); return; }
        clearInterval(iv);
        hideCountdown();
        flash();
        const dataUrl = captureFrame();
        preview.src = dataUrl; preview.hidden = false;
        video.hidden = true; stopCam();
        btnRet.hidden = false; btnOk.hidden = false;
        hint.textContent = "Foto siap. Tekan 'Pakai Foto & Kirim' untuk lanjut.";

        btnOk.onclick = function () { closeCam(dataUrl); };
        btnRet.onclick = async function () {
          preview.hidden = true; video.hidden = false;
          btnRet.hidden = true; btnOk.hidden = true;
          hint.textContent = "Memulai ulang kamera…";
          try {
            await startStream();
            hint.textContent = "Posisikan wajah di dalam bingkai. Foto akan diambil otomatis…";
            let m = CAPTURE_COUNTDOWN;
            showCountdown(m);
            const iv2 = setInterval(function () {
              m -= 1;
              if (m > 0) { showCountdown(m); return; }
              clearInterval(iv2);
              hideCountdown(); flash();
              const dUrl = captureFrame();
              preview.src = dUrl; preview.hidden = false;
              video.hidden = true; stopCam();
              btnRet.hidden = false; btnOk.hidden = false;
              hint.textContent = "Foto siap. Tekan 'Pakai Foto & Kirim' untuk lanjut.";
              btnOk.onclick = function () { closeCam(dUrl); };
            }, 1000);
          } catch (e) { hint.textContent = "Gagal mulai ulang kamera."; }
        };
      }, 1000);
    });
  }

  /* ============================================================
     3) ANTI-DUPLIKASI NISN PER HARI
     ============================================================ */
  async function isDuplicate(nisn) {
    const db = getDb();
    if (!db) return false;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    try {
      const snap = await db.collection(COLLECTION)
        .where("nisn", "==", nisn)
        .where("ts", ">=", startOfDay.getTime())
        .limit(1).get();
      return !snap.empty;
    } catch (e) { warn("Cek duplikasi gagal, dilewati:", e.message); return false; }
  }

  /* ============================================================
     HOOK SUBMIT — capture phase
     Strategi v2: hentikan SEMUA handler lain, lalu kirim sendiri
     langsung ke Firestore (termasuk selfieDataUrl).
     ============================================================ */
  // Haversine
  function distanceMeter(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = function (d) { return d * Math.PI / 180; };
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function getSchoolLoc() {
    // Coba ambil dari window (di-set firebase-sync.js kalau di-export), fallback default
    if (window.SCHOOL_LOCATION && typeof window.SCHOOL_LOCATION.lat === "number") return window.SCHOOL_LOCATION;
    // Default SMAN 5 Tuban (sesuai firebase-sync.js)
    return { lat: -6.8945, lng: 112.0625, radiusMeter: 300 };
  }

  function hookSubmit() {
    const form = $("attendance-form");
    if (!form || form.dataset.addonHooked === "1") return;
    form.dataset.addonHooked = "1";

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : "";

      const nama = ($("attendance-name").value || "").trim();
      const nisn = ($("attendance-nisn").value || "").trim();
      const gugus = $("attendance-group").value;
      const hari = $("attendance-day").value;
      const status = $("attendance-status").value;
      const catatan = ($("attendance-note").value || "").trim() || "-";

      if (!nama || !nisn) {
        notify('<strong style="color:#b91c1c">Nama dan NISN wajib diisi.</strong>', false);
        return;
      }

      try {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Memvalidasi..."; }

        // 1) Anti-duplikasi NISN per hari
        notify('<strong>Mengecek data…</strong><span>Memastikan NISN belum absen hari ini.</span>', false);
        const dup = await isDuplicate(nisn);
        if (dup) {
          notify('<strong style="color:#b91c1c">NISN ' + nisn + ' sudah absen hari ini.</strong>' +
            '<span>Tidak boleh absen 2x dalam satu hari.</span>', false);
          return;
        }

        // 2) Buka halaman kamera fullscreen + auto-capture
        notify('<strong>Buka kamera…</strong><span>Verifikasi wajah dimulai otomatis.</span>', false);
        const selfie = await openCameraPage();
        if (!selfie) {
          notify('<strong style="color:#b91c1c">Selfie dibatalkan.</strong>' +
            '<span>Verifikasi selfie wajib untuk absensi.</span>', false);
          return;
        }

        // 3) Validasi lokasi (kalau cloud + GPS tersedia)
        const db = getDb();
        const loc = window.lastKnownLocation || null;
        let dist = null;
        if (loc && typeof loc.lat === "number") {
          const sch = getSchoolLoc();
          dist = distanceMeter(loc.lat, loc.lng, sch.lat, sch.lng);
          if (!loc.bypass && dist > sch.radiusMeter) {
            notify('<strong style="color:#b91c1c">Kamu ' + Math.round(dist) +
              'm dari sekolah.</strong><span>Absensi hanya dalam radius ' + sch.radiusMeter + 'm.</span>', false);
            return;
          }
        }

        // 4) Kirim ke Firestore langsung (termasuk selfie)
        if (submitBtn) submitBtn.textContent = "Mengirim...";
        const record = {
          waktu: new Date().toLocaleString("id-ID"),
          ts: Date.now(),
          nama: nama, nisn: nisn, gugus: gugus, hari: hari,
          status: status, catatan: catatan,
          lat: loc ? loc.lat : null,
          lng: loc ? loc.lng : null,
          akurasiMeter: loc ? Math.round(loc.acc || 0) : null,
          jarakMeter: dist != null ? Math.round(dist) : null,
          selfieDataUrl: selfie,
          ua: navigator.userAgent.slice(0, 120)
        };

        if (db) {
          const ref = await db.collection(COLLECTION).add(record);
          log("Tersimpan di cloud:", ref.id);
          notify('<strong>Absensi berhasil terkirim ke server.</strong>' +
            '<span>' + nama + ' tercatat <b>' + status + '</b> untuk ' + hari +
            ', Gugus ' + gugus + '.' +
            (dist != null ? ' Lokasi terverifikasi (' + Math.round(dist) + ' m dari sekolah).' : '') +
            ' Selfie tersimpan. Doc ID: ' + ref.id + '</span>', true);
          form.reset();
        } else {
          // Fallback simpan lokal kalau cloud tidak ready
          try {
            const KEY = "mpls_attendance";
            const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
            arr.unshift(record);
            localStorage.setItem(KEY, JSON.stringify(arr));
          } catch (e) { /* noop */ }
          notify('<strong>Absensi tersimpan lokal.</strong>' +
            '<span>Cloud belum terhubung, data akan ada di perangkat.</span>', true);
          form.reset();
        }
      } catch (err) {
        console.error(err);
        notify('<strong style="color:#b91c1c">Absensi gagal terkirim.</strong>' +
          '<span>' + (err.message || err) + '</span>', false);
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText || "Kirim Absensi"; }
      }
    }, true); // capture phase => jalan duluan, blokir handler firebase-sync & main.js
    log("Submit form di-hook (v2: handle penuh di add-on).");
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    hookSubmit();
    let tries = 0;
    const iv = setInterval(function () {
      if (injectAdminButtons() || ++tries > 60) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
