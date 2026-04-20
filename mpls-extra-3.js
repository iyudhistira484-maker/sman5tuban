(function () {
  "use strict";

  const ARCHIVE_COLLECTION = "face_verifications";
  const LS_KEY = "__mplsPendingPhotosV1";
  const $ = (id) => document.getElementById(id);
  const log = (...a) => console.log("[MPLS-Extra-3]", ...a);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  let db = null;
  let archiveRows = [];

  function initDb() {
    if (db) return db;
    if (typeof firebase === "undefined" || !firebase.firestore) return null;
    if (!firebase.apps || firebase.apps.length === 0) return null;
    db = firebase.firestore();
    return db;
  }

  /* ---------- 1. Save foto permanen ke Firestore ---------- */
  async function saveArchive(photoDataUrl) {
    if (!initDb()) {
      log("db belum siap, skip arsip");
      return;
    }
    const nisn = $("attendance-nisn")?.value?.trim() || "";
    const nama = $("attendance-name")?.value?.trim() || "";
    const status = $("attendance-status")?.value || "";
    const gugus = $("attendance-gugus")?.value || "";
    const hari = $("attendance-day")?.value || "";
    const now = new Date();
    const payload = {
      nisn,
      nama,
      status,
      gugus,
      hari,
      photoBase64: photoDataUrl,
      ts: now.getTime(),
      waktu: now.toLocaleString("id-ID"),
      createdAt: firebase.firestore.FieldValue.serverTimestamp
        ? firebase.firestore.FieldValue.serverTimestamp()
        : now.getTime(),
    };
    try {
      const ref = await db.collection(ARCHIVE_COLLECTION).add(payload);
      log("foto arsip tersimpan permanen:", ref.id);
      // Auto cleanup cache localStorage
      cleanupLocalCache(nisn);
    } catch (e) {
      log("gagal simpan arsip:", e.message);
    }
  }

  function cleanupLocalCache(nisn) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return;
      let changed = false;
      Object.keys(obj).forEach((k) => {
        if (k.startsWith(nisn + "|")) {
          delete obj[k];
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(LS_KEY, JSON.stringify(obj));
        log("cache localStorage dibersihkan untuk", nisn);
      }
    } catch (_) {}
  }

  /* ---------- 2. Hook runVerification tanpa modifikasi mpls-extra.js ----------
     Strategi: monkey-patch HTMLCanvasElement.prototype.toDataURL agar setiap
     pemanggilan dari verify-canvas otomatis trigger saveArchive(). */
  function hookCanvasCapture() {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const result = origToDataURL.apply(this, args);
      try {
        if (this.id === "mpls-verify-canvas" && typeof result === "string" && result.startsWith("data:image")) {
          // Delay sedikit biar form values sudah final
          setTimeout(() => saveArchive(result), 50);
        }
      } catch (_) {}
      return result;
    };
    log("canvas capture hook terpasang");
  }

  /* ---------- 3. Stream arsip & render di dashboard ---------- */
  function startArchiveStream() {
    if (!initDb()) {
      setTimeout(startArchiveStream, 800);
      return;
    }
    db.collection(ARCHIVE_COLLECTION)
      .orderBy("ts", "desc")
      .onSnapshot(
        (snap) => {
          archiveRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          log("arsip rows:", archiveRows.length);
          renderArchive();
        },
        (err) => log("arsip snapshot err:", err.message)
      );
  }

  function buildArchivePanel() {
    const dashboard = $("admin-dashboard");
    if (!dashboard) {
      setTimeout(buildArchivePanel, 600);
      return;
    }
    if ($("mpls-archive-section")) return;

    // Tunggu mpls-extra-panel sudah ada agar ditempatkan sesudahnya
    const host = $("mpls-extra-panel") || dashboard;
    const sec = document.createElement("div");
    sec.id = "mpls-archive-section";
    sec.className = "mpls-section";
    sec.style.cssText = "margin-top:24px;padding:20px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)";
    sec.innerHTML = `
      <h3 style="margin:0 0 12px;display:flex;align-items:center;gap:8px;font-size:16px">
        📸 Arsip Absensi siswa/siswi yang izin/sakit.
        <span id="mpls-archive-count" style="font-size:12px;font-weight:500;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:999px">0</span>
        <span style="font-size:11px;font-weight:400;color:#94a3b8;margin-left:auto">Permanen di Firestore</span>
      </h3>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <input id="mpls-archive-search" type="text" placeholder="Cari nama / Email..."
          style="flex:1;min-width:160px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px" />
        <button id="mpls-archive-export" type="button"
          style="padding:8px 14px;background:#4338ca;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:500">⬇️ Export JSON</button>
      </div>
      <div id="mpls-archive-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px">
        <p style="color:#94a3b8;font-size:13px;grid-column:1/-1">Belum ada arsip foto.</p>
      </div>`;
    if (host.parentNode === dashboard || host === dashboard) {
      dashboard.appendChild(sec);
    } else {
      host.parentNode.insertBefore(sec, host.nextSibling);
    }

    $("mpls-archive-search").addEventListener("input", renderArchive);
    $("mpls-archive-export").onclick = () => {
      if (archiveRows.length === 0) {
        alert("Arsip masih kosong.");
        return;
      }
      const json = JSON.stringify(archiveRows, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arsip-verifikasi-wajah-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    log("archive panel terpasang");
  }

  function renderArchive() {
    const grid = $("mpls-archive-grid");
    const countEl = $("mpls-archive-count");
    if (!grid) return;
    const q = ($("mpls-archive-search")?.value || "").toLowerCase().trim();
    const filtered = q
      ? archiveRows.filter(
          (r) =>
            String(r.nama || "").toLowerCase().includes(q) ||
            String(r.nisn || "").toLowerCase().includes(q)
        )
      : archiveRows;
    if (countEl) countEl.textContent = String(filtered.length);
    if (filtered.length === 0) {
      grid.innerHTML = `<p style="color:#94a3b8;font-size:13px;grid-column:1/-1">${
        q ? "Tidak ada hasil pencarian." : "Belum ada arsip foto."
      }</p>`;
      return;
    }
    grid.innerHTML = filtered
      .map((r) => {
        const badgeColor =
          r.status === "Sakit" ? "#fecaca;color:#991b1b" :
          r.status === "Izin"  ? "#fde68a;color:#92400e" :
                                 "#bbf7d0;color:#166534";
        return `<figure data-id="${esc(r.id)}" data-img="${esc(r.photoBase64 || "")}" data-name="${esc(r.nama || "-")}"
          style="position:relative;margin:0;background:#f8fafc;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
          <button type="button" class="mpls-arc-del" data-del-id="${esc(r.id)}" data-del-name="${esc(r.nama || "-")}" title="Hapus foto"
            style="position:absolute;top:6px;right:6px;z-index:2;width:28px;height:28px;border-radius:999px;border:none;background:rgba(220,38,38,.95);color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);line-height:1">🗑️</button>
          <div class="mpls-arc-open" style="cursor:pointer">
            <img src="${esc(r.photoBase64 || "")}" alt="${esc(r.nama || "")}" loading="lazy"
              style="width:100%;height:140px;object-fit:cover;display:block" />
            <figcaption style="padding:8px 10px;font-size:12px;line-height:1.35">
              <strong style="display:block;color:#0f172a;font-size:13px">${esc(r.nama || "-")}</strong>
              <span style="color:#64748b;display:block">NISN ${esc(r.nisn || "-")}</span>
              <span style="display:inline-block;margin-top:4px;padding:1px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${badgeColor}">${esc(r.status || "-")}</span>
              <span style="color:#94a3b8;display:block;margin-top:4px;font-size:10px">${esc(r.waktu || "")}</span>
            </figcaption>
          </div>
        </figure>`;
      })
      .join("");
    grid.querySelectorAll(".mpls-arc-open").forEach((el) => {
      el.onclick = () => {
        const fig = el.closest("figure");
        if (fig) openLightbox(fig.dataset.img, fig.dataset.name);
      };
    });
    grid.querySelectorAll(".mpls-arc-del").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        deleteArchive(btn.dataset.delId, btn.dataset.delName);
      };
    });
  }

  /* ---------- Hapus arsip foto (Firestore + UI) ---------- */
  async function deleteArchive(id, nama) {
    if (!id) return;
    if (!initDb()) {
      alert("Database belum siap. Coba lagi.");
      return;
    }
    const ok = confirm(
      `Hapus foto verifikasi milik "${nama}" secara permanen?\n\n` +
      `Foto akan dihapus dari Firestore (collection "${ARCHIVE_COLLECTION}") dan tidak bisa dikembalikan.`
    );
    if (!ok) return;
    try {
      await db.collection(ARCHIVE_COLLECTION).doc(id).delete();
      log("arsip terhapus:", id);
      // Optimistic UI: hapus dari array & re-render (snapshot juga akan menyusul)
      archiveRows = archiveRows.filter((r) => r.id !== id);
      renderArchive();
    } catch (e) {
      log("gagal hapus arsip:", e.message);
      alert(
        "Gagal menghapus foto: " + e.message +
        "\n\nKemungkinan Firestore Rules belum mengizinkan delete pada collection '" +
        ARCHIVE_COLLECTION + "'."
      );
    }
  }

  function openLightbox(src, name) {
    let lb = $("mpls-archive-lightbox");
    if (!lb) {
      lb = document.createElement("div");
      lb.id = "mpls-archive-lightbox";
      lb.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:99999;padding:20px";
      lb.innerHTML = `
        <div style="max-width:520px;width:100%;text-align:center">
          <img id="mpls-arc-lb-img" alt="" style="max-width:100%;max-height:75vh;border-radius:12px;display:block;margin:0 auto" />
          <p id="mpls-arc-lb-cap" style="color:#fff;margin:12px 0;font-size:14px"></p>
          <button type="button" id="mpls-arc-lb-close"
            style="padding:8px 20px;background:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500">Tutup</button>
        </div>`;
      document.body.appendChild(lb);
      lb.onclick = (e) => {
        if (e.target === lb || e.target.id === "mpls-arc-lb-close") lb.style.display = "none";
      };
    }
    $("mpls-arc-lb-img").src = src;
    $("mpls-arc-lb-cap").textContent = name;
    lb.style.display = "flex";
  }

  /* ---------- Boot ---------- */
  function boot() {
    log("v3 boot — arsip permanen + auto cleanup");
    hookCanvasCapture();
    buildArchivePanel();
    startArchiveStream();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
