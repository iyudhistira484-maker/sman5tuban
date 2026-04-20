/* =====================================================================
 * MPLS SMAN 5 Tuban — Extra Add-on v1.3
 * FIX v1.3:
 *   - Foto verifikasi DIJAMIN tersimpan via post-write update
 *     (tidak lagi tergantung monkey-patch CollectionReference.add)
 *   - Hapus Mendalam: hapus per-doc (parallel) + pesan rules jelas
 *
 * Strategi v1.2:
 *  - Intercept di tombol submit pakai 'click' CAPTURE phase
 *    → jalan SEBELUM submit event apapun (main.js & firebase-sync.js)
 *  - Saat status = Izin/Sakit → langsung buka kamera (sync, gesture aman)
 *  - Block submit asli sampai foto selesai
 *  - Setelah foto, re-dispatch submit dengan flag __mplsVerified
 *
 * Fitur:
 *  1. Anti-duplikat 1 NISN per hari (cek Firestore)
 *  2. Verifikasi kamera Izin/Sakit (countdown 3 detik, frame oval)
 *  3. Foto tersimpan base64 di Firestore
 *  4. Tab gugus 1-8 + export CSV/JSON per gugus
 *  5. Analitik (Hadir, Izin, Sakit) + grafik bar per gugus
 *  6. Galeri foto siswa Izin/Sakit (lightbox)
 *  7. Hapus Mendalam (ketik HAPUS SEMUA)
 * ===================================================================*/
(function () {
  "use strict";

  const COLLECTION = "absensi_mpls"; // sesuaikan kalau beda
  const VERIFY_FLAG = "__mplsVerified";
  const VERIFY_DATA = "__mplsPhoto";
  const NEED_VERIFY = ["Izin", "Sakit"];

  let db = null;
  let cachedRows = []; // di-update via onSnapshot piggyback

  /* Pending photo queue: foto yg menunggu di-attach ke doc Firestore yang baru.
     key = `${nisn}|${dateKey}`  → { photo, status, ts }
     Listener cachedRows akan otomatis cari doc baru dgn nisn+tanggal sama
     yang BELUM punya photoBase64, lalu update doc tsb. */
  let lastVerifiedPhoto = null;

function buildPhotoPayload(data) {
  if (!data || !NEED_VERIFY.includes(data.status)) return data;

  const cached = lastVerifiedPhoto;
  if (!cached?.photo) return data;
  if (cached.nisn && data.nisn && cached.nisn !== data.nisn) return data;

  return {
    ...data,
    photoBase64: cached.photo,
    photoVerified: true,
  };
}

function clearVerifiedPhoto() {
  lastVerifiedPhoto = null;
}

function installFirestoreWritePatch() {
  const appDb = initDb();
  if (!appDb || installFirestoreWritePatch.__done) return;
  installFirestoreWritePatch.__done = true;

  const ColRef = firebase.firestore.CollectionReference.prototype;
  const DocRef = firebase.firestore.DocumentReference.prototype;

  const origAdd = ColRef.add;
  ColRef.add = function (data) {
    const payload = this.id === COLLECTION ? buildPhotoPayload(data) : data;
    return origAdd.call(this, payload).then((res) => {
      clearVerifiedPhoto();
      return res;
    });
  };

  const origSet = DocRef.set;
  DocRef.set = function (data, options) {
    const payload = this.parent?.id === COLLECTION ? buildPhotoPayload(data) : data;
    return origSet.call(this, payload, options).then((res) => {
      clearVerifiedPhoto();
      return res;
    });
  };
}


  /* ---------- Util ---------- */
  const $ = (id) => document.getElementById(id);
  const dateKey = (ts) => {
    const d = ts ? new Date(ts) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const log = (...a) => console.log("[MPLS-Extra]", ...a);

  /* ---------- Firestore init (re-use kalau firebase sudah ada) ---------- */
  function initDb() {
    if (db) return db;
    if (typeof firebase === "undefined" || !firebase.firestore) {
      log("firebase belum siap");
      return null;
    }
    if (!firebase.apps || firebase.apps.length === 0) {
      log("firebase app belum di-init");
      return null;
    }
    db = firebase.firestore();
    return db;
  }

  /* ============================================================
   * 1. CAMERA VERIFICATION — overlay fullscreen
   * ============================================================ */
  function buildVerifyOverlay() {
    if ($("mpls-verify-overlay")) return $("mpls-verify-overlay");
    const o = document.createElement("div");
    o.id = "mpls-verify-overlay";
    o.className = "mpls-verify-overlay";
    o.innerHTML = `
      <div class="mpls-verify-box">
        <h3>Verifikasi Wajah</h3>
        <p class="mpls-verify-sub">Posisikan wajah di dalam frame oval. Foto otomatis setelah hitung mundur.</p>
        <div class="mpls-verify-stage">
          <video id="mpls-verify-video" autoplay playsinline muted></video>
          <div class="mpls-verify-frame"></div>
          <div id="mpls-verify-count" class="mpls-verify-count"></div>
        </div>
        <div class="mpls-verify-actions">
          <button type="button" id="mpls-verify-cancel" class="mpls-btn-ghost">Batal</button>
          <button type="button" id="mpls-verify-start" class="mpls-btn-primary">Mulai Hitung Mundur</button>
        </div>
        <canvas id="mpls-verify-canvas" style="display:none"></canvas>
      </div>`;
    document.body.appendChild(o);
    return o;
  }

  /**
   * Open camera SYNC (must be in user-gesture stack).
   * Returns Promise<MediaStream>
   */
  function openCameraStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error("Browser tidak mendukung kamera."));
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
      audio: false,
    });
  }

  /**
   * Show overlay with already-acquired stream, run countdown, capture.
   * @returns Promise<string|null>  base64 dataURL or null kalau dibatalkan
   */
  function runVerification(stream) {
    return new Promise((resolve) => {
      const overlay = buildVerifyOverlay();
      overlay.classList.add("is-open");
      const video = $("mpls-verify-video");
      const countEl = $("mpls-verify-count");
      const startBtn = $("mpls-verify-start");
      const cancelBtn = $("mpls-verify-cancel");
      const canvas = $("mpls-verify-canvas");
      let timer = null;

      video.srcObject = stream;
      countEl.textContent = "";

      const cleanup = (result) => {
        if (timer) clearInterval(timer);
        try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
        video.srcObject = null;
        overlay.classList.remove("is-open");
        resolve(result);
      };

      cancelBtn.onclick = () => cleanup(null);

      startBtn.onclick = () => {
        startBtn.disabled = true;
        cancelBtn.disabled = true;
        let n = 3;
        countEl.textContent = n;
        countEl.classList.add("pulse");
        timer = setInterval(() => {
          n -= 1;
          if (n > 0) {
            countEl.textContent = n;
          } else {
            clearInterval(timer);
            countEl.textContent = "📸";
            // capture
            const w = video.videoWidth || 600;
            const h = video.videoHeight || 800;
            const targetW = 600;
            const targetH = Math.round((h / w) * targetW);
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext("2d");
            // mirror selfie
            ctx.translate(targetW, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, targetW, targetH);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
            startBtn.disabled = false;
            cancelBtn.disabled = false;
            setTimeout(() => cleanup(dataUrl), 350);
          }
        }, 1000);
      };
    });
  }

  /* ============================================================
   * 2. SUBMIT INTERCEPTOR — capture click on submit button
   * ============================================================ */
  function hookSubmitInterceptor() {
    const form = $("attendance-form");
    if (!form) {
      log("form belum ada, retry 500ms");
      setTimeout(hookSubmitInterceptor, 500);
      return;
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    if (!submitBtn) return;
    installFirestoreWritePatch();


    // CLICK on button — capture phase, paling awal
    submitBtn.addEventListener(
      "click",
      function (ev) {
        // skip kalau sudah verified (re-trigger dari kita)
        if (form[VERIFY_FLAG]) return;

        const status = $("attendance-status")?.value;
        const nisn = $("attendance-nisn")?.value?.trim();
        const nama = $("attendance-name")?.value?.trim();

        if (!NEED_VERIFY.includes(status)) return; // Hadir lewat normal

        // Validasi minimum sebelum buka kamera
        if (!nama || !nisn) {
          // biarkan native required handle
          return;
        }

        // BLOCK submit native sampai verifikasi selesai
        ev.preventDefault();
        ev.stopImmediatePropagation();

        log("intercept Izin/Sakit → buka kamera");

        // PENTING: getUserMedia harus dipanggil sekarang (gesture)
        let streamPromise;
        try {
          streamPromise = openCameraStream();
        } catch (e) {
          alert("Gagal akses kamera: " + e.message);
          return;
        }

        const oldText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Membuka kamera...";

        streamPromise
          .then((stream) => {
            submitBtn.textContent = "Verifikasi wajah...";
            return runVerification(stream);
          })
          .then((photoDataUrl) => {
  submitBtn.disabled = false;
  submitBtn.textContent = oldText;
  if (!photoDataUrl) {
    log("verifikasi dibatalkan");
    return;
  }

  lastVerifiedPhoto = {
    photo: photoDataUrl,
    nisn,
    status,
    ts: Date.now(),
  };

  form[VERIFY_FLAG] = true;
  form[VERIFY_DATA] = photoDataUrl;
  log("foto siap, inject ke create Firestore, lalu re-submit form");

            // Set flags + re-trigger submit
            form[VERIFY_FLAG] = true;
            form[VERIFY_DATA] = photoDataUrl;
            log("foto siap, re-submit form");
            // dispatch submit event so existing handlers (firebase-sync) run
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit(submitBtn);
            } else {
              form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
            }
          })
          .catch((err) => {
            submitBtn.disabled = false;
            submitBtn.textContent = oldText;
            console.error(err);
            let msg = err.message || String(err);
            if (err.name === "NotAllowedError") msg = "Izin kamera ditolak. Aktifkan kamera di pengaturan browser.";
            else if (err.name === "NotFoundError") msg = "Tidak ada kamera terdeteksi.";
            else if (err.name === "NotReadableError") msg = "Kamera sedang dipakai aplikasi lain.";
            alert("Verifikasi wajah gagal: " + msg);
          });
      },
      true // CAPTURE phase
    );

    // Submit listener (capture, paling awal) untuk inject foto + cek duplikat
    form.addEventListener(
      "submit",
      async function (ev) {
        const status = $("attendance-status")?.value;
        const nisn = $("attendance-nisn")?.value?.trim();

        // Anti-duplikat: cek Firestore (1 NISN/hari)
        if (!form.__mplsDupChecked && nisn && initDb()) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          form.__mplsDupChecked = true;
          try {
            const today = dateKey();
            const snap = await db
              .collection(COLLECTION)
              .where("nisn", "==", nisn)
              .get();
            const dup = snap.docs.find((d) => dateKey(d.data().ts) === today);
            if (dup) {
              const r = $("attendance-result");
              if (r) {
                r.classList.remove("success");
                r.innerHTML = `<strong style="color:#b91c1c">Absensi ditolak.</strong><span>NISN ${esc(nisn)} sudah absen hari ini (status: ${esc(dup.data().status)}). 1 NISN hanya boleh 1x per hari.</span>`;
              }
              form.__mplsDupChecked = false;
              form[VERIFY_FLAG] = false;
              return;
            }
          } catch (e) {
            log("cek duplikat gagal, lanjut:", e.message);
          }
          // re-submit lanjut
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
          return;
        }

        // Daftarkan foto di pending queue — listener cachedRows akan auto-update
        // doc Firestore yg baru muncul (nisn + tanggal sama) dgn photoBase64.
        if (NEED_VERIFY.includes(status) && form[VERIFY_DATA] && nisn) {
  const key = `${nisn}|${dateKey()}`;
  pendingPhotos.set(key, {
    photo: form[VERIFY_DATA],
    status,
    ts: Date.now(),
  });
  log("foto ter-queue untuk", key);
  setTimeout(() => pendingPhotos.delete(key), 60_000);
}


        // reset flag setelah submit selesai (next tick)
        setTimeout(() => {
  form[VERIFY_FLAG] = false;
  form.__mplsDupChecked = false;
}, 100);
      },
      true // CAPTURE
    );

    log("submit interceptor terpasang");
  }

  /* ============================================================
   * 3. ADMIN DASHBOARD ENHANCEMENTS
   * ============================================================ */
  function hookDashboard() {
    const dashboard = $("admin-dashboard");
    if (!dashboard) {
      setTimeout(hookDashboard, 600);
      return;
    }
    if ($("mpls-extra-panel")) return; // sudah dipasang

    const panel = document.createElement("div");
    panel.id = "mpls-extra-panel";
    panel.className = "mpls-extra-panel";
    panel.innerHTML = `
      <div class="mpls-stats">
        <div class="mpls-stat"><span class="mpls-stat-label">Total Absensi</span><strong id="mpls-stat-total">0</strong></div>
        <div class="mpls-stat is-hadir"><span class="mpls-stat-label">Hadir</span><strong id="mpls-stat-hadir">0</strong></div>
        <div class="mpls-stat is-izin"><span class="mpls-stat-label">Izin</span><strong id="mpls-stat-izin">0</strong></div>
        <div class="mpls-stat is-sakit"><span class="mpls-stat-label">Sakit</span><strong id="mpls-stat-sakit">0</strong></div>
      </div>

      <div class="mpls-section">
        <h3>📊 Analisis Per Gugus</h3>
        <div id="mpls-chart" class="mpls-chart"></div>
      </div>

      <div class="mpls-section">
        <h3>👥 Data Per Gugus + Export</h3>
        <div class="mpls-tabs" id="mpls-tabs"></div>
        <div class="mpls-export-bar">
          <button type="button" class="mpls-btn-primary" id="mpls-export-csv">⬇️ Download CSV (Gugus aktif)</button>
          <button type="button" class="mpls-btn-ghost" id="mpls-export-json">⬇️ Download JSON (Gugus aktif)</button>
        </div>
        <div class="mpls-table-wrap">
          <table class="mpls-table">
            <thead><tr><th>Waktu</th><th>Nama</th><th>Email</th><th>Hari</th><th>Status</th><th>Catatan</th></tr></thead>
            <tbody id="mpls-tab-body"><tr><td colspan="6" style="text-align:center;color:#94a3b8">Belum ada data.</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="mpls-section">
        <h3>📷 Galeri Verifikasi (Izin & Sakit)</h3>
        <div id="mpls-gallery" class="mpls-gallery"><p style="color:#94a3b8;font-size:14px">Belum ada foto verifikasi.</p></div>
      </div>

      <div class="mpls-section mpls-danger">
        <h3>⚠️ Danger Zone — Hapus Mendalam</h3>
        <p>Menghapus SEMUA data absensi di Firestore secara permanen. Ketik <code>HAPUS SEMUA</code> untuk konfirmasi.</p>
        <div class="mpls-danger-row">
          <input type="text" id="mpls-danger-input" placeholder='Ketik: HAPUS SEMUA' />
          <button type="button" id="mpls-danger-btn" class="mpls-btn-danger" disabled>Hapus Mendalam</button>
        </div>
        <p id="mpls-danger-status" class="mpls-danger-status"></p>
      </div>
    `;
    dashboard.appendChild(panel);

    // Build gugus tabs
    const tabsEl = $("mpls-tabs");
    let activeGugus = "1";
    for (let g = 1; g <= 8; g++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mpls-tab" + (g === 1 ? " is-active" : "");
      b.textContent = `Gugus ${g}`;
      b.dataset.gugus = String(g);
      b.onclick = () => {
        activeGugus = b.dataset.gugus;
        tabsEl.querySelectorAll(".mpls-tab").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        renderGugusTable(activeGugus);
      };
      tabsEl.appendChild(b);
    }

    // Export buttons
    $("mpls-export-csv").onclick = () => exportGugus(activeGugus, "csv");
    $("mpls-export-json").onclick = () => exportGugus(activeGugus, "json");

    // Danger zone
    const dInput = $("mpls-danger-input");
    const dBtn = $("mpls-danger-btn");
    dInput.addEventListener("input", () => {
      dBtn.disabled = dInput.value !== "HAPUS SEMUA";
    });
    dBtn.onclick = deepDelete;

    // Mulai stream Firestore sendiri (read-only) untuk feed cachedRows
    startCachedStream();

    // Re-render setiap 1.5s (kalau cachedRows update)
    setInterval(() => {
      renderStats();
      renderChart();
      renderGugusTable(activeGugus);
      renderGallery();
    }, 1500);

    log("dashboard panel terpasang");

    function renderGugusTable(g) {
      const rows = cachedRows.filter((r) => String(r.gugus) === String(g));
      const body = $("mpls-tab-body");
      if (!body) return;
      if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8">Belum ada data untuk Gugus ${g}.</td></tr>`;
        return;
      }
      body.innerHTML = rows
        .map(
          (r) => `<tr>
            <td>${esc(r.waktu || new Date(r.ts || 0).toLocaleString("id-ID"))}</td>
            <td>${esc(r.nama)}</td>
            <td>${esc(r.nisn)}</td>
            <td>${esc(r.hari)}</td>
            <td><span class="mpls-badge mpls-${(r.status || "").toLowerCase()}">${esc(r.status)}</span></td>
            <td>${esc(r.catatan || "-")}</td>
          </tr>`
        )
        .join("");
    }

    function exportGugus(g, format) {
      const rows = cachedRows.filter((r) => String(r.gugus) === String(g));
      if (rows.length === 0) {
        alert(`Gugus ${g} belum ada data.`);
        return;
      }
      const filenameBase = `absensi-gugus-${g}-${dateKey()}`;
      if (format === "json") {
        download(`${filenameBase}.json`, JSON.stringify(rows, null, 2), "application/json");
      } else {
        const headers = ["waktu", "nama", "nisn", "gugus", "hari", "status", "catatan"];
        const csv = [headers.join(",")]
          .concat(
            rows.map((r) =>
              headers
                .map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`)
                .join(",")
            )
          )
          .join("\n");
        download(`${filenameBase}.csv`, "\uFEFF" + csv, "text/csv");
      }
    }
  }

  function renderStats() {
    const total = cachedRows.length;
    const hadir = cachedRows.filter((r) => r.status === "Hadir").length;
    const izin = cachedRows.filter((r) => r.status === "Izin").length;
    const sakit = cachedRows.filter((r) => r.status === "Sakit").length;
    if ($("mpls-stat-total")) $("mpls-stat-total").textContent = total;
    if ($("mpls-stat-hadir")) $("mpls-stat-hadir").textContent = hadir;
    if ($("mpls-stat-izin")) $("mpls-stat-izin").textContent = izin;
    if ($("mpls-stat-sakit")) $("mpls-stat-sakit").textContent = sakit;
  }

  function renderChart() {
    const el = $("mpls-chart");
    if (!el) return;
    const groups = {};
    for (let g = 1; g <= 8; g++) groups[g] = { Hadir: 0, Izin: 0, Sakit: 0 };
    cachedRows.forEach((r) => {
      const g = String(r.gugus);
      if (groups[g] && groups[g][r.status] !== undefined) groups[g][r.status]++;
    });
    const max = Math.max(1, ...Object.values(groups).flatMap((v) => Object.values(v)));
    el.innerHTML = Object.entries(groups)
      .map(([g, v]) => {
        const bar = (val, cls) =>
          `<div class="mpls-bar ${cls}" style="height:${(val / max) * 100}%" title="${cls}: ${val}"><span>${val || ""}</span></div>`;
        return `<div class="mpls-chart-group">
          <div class="mpls-bars">${bar(v.Hadir, "h")}${bar(v.Izin, "i")}${bar(v.Sakit, "s")}</div>
          <div class="mpls-chart-label">G${g}</div>
        </div>`;
      })
      .join("");
  }

  function renderGallery() {
    const el = $("mpls-gallery");
    if (!el) return;
    const photos = cachedRows.filter((r) => r.photoBase64 && (r.status === "Izin" || r.status === "Sakit"));
    if (photos.length === 0) {
      el.innerHTML = `<p style="color:#94a3b8;font-size:14px">Belum ada foto verifikasi.</p>`;
      return;
    }
    el.innerHTML = photos
      .map(
        (r) => `<figure class="mpls-photo" data-id="${esc(r.id)}" data-img="${esc(r.photoBase64)}" data-name="${esc(r.nama)}" style="position:relative">
          <button type="button" class="mpls-photo-del" data-del-id="${esc(r.id)}" data-del-name="${esc(r.nama)}" title="Hapus foto"
            style="position:absolute;top:6px;right:6px;z-index:2;width:28px;height:28px;border-radius:999px;border:none;background:rgba(220,38,38,.95);color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);line-height:1">🗑️</button>
          <img src="${esc(r.photoBase64)}" alt="${esc(r.nama)}" loading="lazy" />
          <figcaption>
            <strong>${esc(r.nama)}</strong>
            <span>Gugus ${esc(r.gugus)} · ${esc(r.status)} · ${esc(r.hari)}</span>
          </figcaption>
        </figure>`
      )
      .join("");
    el.querySelectorAll(".mpls-photo").forEach((f) => {
      f.onclick = (e) => {
        if (e.target.closest(".mpls-photo-del")) return;
        openLightbox(f.dataset.img, f.dataset.name);
      };
    });
    el.querySelectorAll(".mpls-photo-del").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        deleteGalleryPhoto(btn.dataset.delId, btn.dataset.delName);
      };
    });
  }

  /* Hapus foto dari dokumen absensi (field photoBase64 + photoVerified) */
  async function deleteGalleryPhoto(id, nama) {
    if (!id) return;
    if (!initDb()) {
      alert("Database belum siap. Coba lagi.");
      return;
    }
    const ok = confirm(
      `Hapus foto verifikasi milik "${nama}" dari arsip absensi?\n\n` +
      `Data absensi (nama, NISN, status) tetap tersimpan, hanya foto yang dihapus.`
    );
    if (!ok) return;
    try {
      const FieldValue = firebase.firestore.FieldValue;
      await db.collection(COLLECTION).doc(id).update({
        photoBase64: FieldValue.delete(),
        photoVerified: FieldValue.delete(),
      });
      log("foto galeri terhapus:", id);
    } catch (e) {
      log("gagal hapus foto galeri:", e.message);
      alert(
        "Gagal menghapus foto: " + e.message +
        "\n\nKemungkinan Firestore Rules belum mengizinkan update pada collection '" + COLLECTION + "'."
      );
    }
  }

  function openLightbox(src, name) {
    let lb = $("mpls-lightbox");
    if (!lb) {
      lb = document.createElement("div");
      lb.id = "mpls-lightbox";
      lb.className = "mpls-lightbox";
      lb.innerHTML = `<div class="mpls-lightbox-inner"><img id="mpls-lb-img" alt="" /><p id="mpls-lb-cap"></p><button type="button" id="mpls-lb-close">Tutup</button></div>`;
      document.body.appendChild(lb);
      lb.onclick = (e) => {
        if (e.target === lb || e.target.id === "mpls-lb-close") lb.classList.remove("is-open");
      };
    }
    $("mpls-lb-img").src = src;
    $("mpls-lb-cap").textContent = name;
    lb.classList.add("is-open");
  }

  function startCachedStream() {
    if (!initDb()) {
      setTimeout(startCachedStream, 800);
      return;
    }
    db.collection(COLLECTION)
      .orderBy("ts", "desc")
      .onSnapshot(
        (snap) => {
          cachedRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          log("cached rows update:", cachedRows.length);
          attachPendingPhotos(snap);
        },
        (err) => log("snapshot err:", err.message)
      );
  }

  /* Untuk setiap doc Izin/Sakit yg BELUM punya photoBase64,
     kalau ada di pendingPhotos (key nisn|tanggal), update doc tsb. */
  function attachPendingPhotos(snap) {
    if (pendingPhotos.size === 0) return;
    snap.docs.forEach((doc) => {
      const d = doc.data();
      if (!d || !NEED_VERIFY.includes(d.status)) return;
      if (d.photoBase64) return;
      const key = `${d.nisn}|${dateKey(d.ts)}`;
      const pending = pendingPhotos.get(key);
      if (!pending) return;
      if (pending.status !== d.status) return;
      pendingPhotos.delete(key);
      log("attach foto ke doc", doc.id);
      doc.ref
        .update({ photoBase64: pending.photo, photoVerified: true })
        .then(() => log("foto sukses ter-attach ke", doc.id))
        .catch((e) => log("attach foto gagal:", e.message));
    });
  }

  async function deepDelete() {
    const status = $("mpls-danger-status");
    const btn = $("mpls-danger-btn");
    if (!initDb()) {
      status.textContent = "Firebase belum siap.";
      return;
    }
    btn.disabled = true;
    status.textContent = "Mengambil daftar dokumen...";
    const RULES_HINT = `<br><br><b>Solusi:</b> Firestore Rules belum mengizinkan DELETE.<br>` +
      `Buka <b>Firebase Console → Firestore Database → Rules</b>, tempel aturan berikut, lalu klik <b>Publish</b>:` +
      `<pre style="background:#1e293b;color:#e2e8f0;padding:10px;border-radius:6px;font-size:11px;overflow:auto;margin-top:6px;white-space:pre">rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /absensi_mpls/{doc} {\n      allow read, write, delete: if true;\n    }\n  }\n}</pre>`;
    try {
      const snap = await db.collection(COLLECTION).get();
      const total = snap.docs.length;
      if (total === 0) {
        status.textContent = "Tidak ada data untuk dihapus.";
        btn.disabled = false;
        return;
      }
      let ok = 0, fail = 0, firstErr = null;
      const docs = snap.docs.slice();
      const CHUNK = 10;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const chunk = docs.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map((d) =>
            d.ref.delete().then(
              () => { ok++; },
              (e) => { fail++; if (!firstErr) firstErr = e; }
            )
          )
        );
        status.textContent = `Menghapus ${ok + fail} / ${total}...`;
      }
      if (fail === 0) {
        status.innerHTML = `✅ Berhasil hapus <b>${ok}</b> dokumen.`;
        $("mpls-danger-input").value = "";
      } else {
        const isPerm = firstErr && /permission|insufficient/i.test(firstErr.message || "");
        status.innerHTML =
          `⚠️ Hapus selesai: <b>${ok} sukses</b>, <b>${fail} gagal</b>.<br>Error: ${esc(firstErr?.message || "unknown")}` +
          (isPerm ? RULES_HINT : "");
        btn.disabled = false;
      }
    } catch (e) {
      const isPerm = /permission|insufficient/i.test(e.message || "");
      status.innerHTML = `❌ Gagal: ${esc(e.message)}` + (isPerm ? RULES_HINT : "");
      btn.disabled = false;
    }
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Boot ---------- */
  function boot() {
    log("v1.3 boot");
    hookSubmitInterceptor();
    hookDashboard();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
