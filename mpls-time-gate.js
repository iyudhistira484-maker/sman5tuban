/* ============================================================
 * mpls-time-gate.js (v3 — strict Gmail lock + refined badge)
 * - Jam buka: 06:45 - 15:30 WIB
 * - Field NISN -> Gmail (@gmail.com only, strict)
 * - Limit 1x per hari per Gmail (gabungan hadir/izin/sakit)
 * - Standalone — tidak mengubah file lain.
 * ============================================================ */
(function () {
  'use strict';

  const OPEN_H = 6;
  const OPEN_M = 45;
  const CLOSE_H = 15;
  const CLOSE_M = 30;
  const LS_KEY = 'mpls_attend_log_v2';
  const ROWS_KEY = 'mplsAttendanceRows';
  const TRACKED_COLLECTIONS = ['absensi_mpls', 'absensi'];

  let bypassNext = false;
  let checkingSubmit = false;
  let pendingEmail = '';
  let lastAttemptEmail = '';
  let pendingTimer = null;

  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const nowMin = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const openMin = OPEN_H * 60 + OPEN_M;
  const closeMin = CLOSE_H * 60 + CLOSE_M;
  const isOpen = () => {
    const m = nowMin();
    return m >= openMin && m <= closeMin;
  };

  function sanitizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isStrictGmail(value) {
    const email = sanitizeEmail(value);
    const match = /^([a-z0-9.]+)@gmail\.com$/.exec(email);
    if (!match) return false;
    const local = match[1];
    return Boolean(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
  }

  function normalizeGmail(value) {
    if (!isStrictGmail(value)) return '';
    const [local] = sanitizeEmail(value).split('@');
    return `${local.replace(/\./g, '')}@gmail.com`;
  }

  function getEmailEl() {
    return document.getElementById('attendance-nisn') || document.getElementById('attendance-email');
  }

  function getCanonicalEmail(value) {
    return normalizeGmail(value || getEmailEl()?.value || '');
  }

  function readLog() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function writeLog(log) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(log));
    } catch {}
  }

  function readRows() {
    try {
      return JSON.parse(localStorage.getItem(ROWS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function unmarkAttended(email) {
    const canonical = getCanonicalEmail(email);
    if (!canonical) return;
    const log = readLog();
    const day = todayStr();
    const list = Array.isArray(log[day]) ? log[day] : [];
    log[day] = list.filter((entry) => entry !== canonical);
    writeLog(log);
  }

  function markAttended(email) {
    const canonical = getCanonicalEmail(email);
    if (!canonical) return;
    const log = readLog();
    const day = todayStr();
    const list = Array.isArray(log[day]) ? log[day] : [];
    if (!list.includes(canonical)) list.push(canonical);
    log[day] = list;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    Object.keys(log).forEach((dateKey) => {
      if (new Date(dateKey) < cutoff) delete log[dateKey];
    });

    writeLog(log);
    if (pendingEmail === canonical) pendingEmail = '';
  }

  function dateFromLegacyString(value) {
    const match = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return '';
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${pad(mm)}-${pad(dd)}`;
  }

  function isTodayRecord(record) {
    if (!record || typeof record !== 'object') return false;
    if (record.tanggal === todayStr()) return true;
    if (typeof record.ts === 'number' && Number.isFinite(record.ts)) {
      const d = new Date(record.ts);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === todayStr();
    }
    return dateFromLegacyString(record.waktu) === todayStr();
  }

  function localRowsHasAttended(email) {
    const canonical = getCanonicalEmail(email);
    if (!canonical) return false;
    return readRows().some((row) => isTodayRecord(row) && getCanonicalEmail(row.email || row.nisn) === canonical);
  }

  function hasAttendedToday(email) {
    const canonical = getCanonicalEmail(email);
    if (!canonical) return false;
    const list = Array.isArray(readLog()[todayStr()]) ? readLog()[todayStr()] : [];
    return list.includes(canonical) || localRowsHasAttended(canonical);
  }

  window.MPLS_markAttended = markAttended;
  window.MPLS_hasAttendedToday = hasAttendedToday;
  window.MPLS_isOpen = isOpen;

  function getFirestoreDb() {
    const fire = window.firebase;
    if (!fire?.apps?.length || typeof fire.firestore !== 'function') return null;
    try {
      return fire.firestore();
    } catch {
      return null;
    }
  }

  async function queryCollectionForToday(ref, field, value) {
    if (!value) return false;
    try {
      const snap = await ref.where(field, '==', value).limit(12).get();
      return snap.docs.some((doc) => isTodayRecord(doc.data()));
    } catch {
      return false;
    }
  }

  async function firestoreHasAttended(email) {
    const canonical = getCanonicalEmail(email);
    const raw = sanitizeEmail(email);
    if (!canonical) return false;

    const db = getFirestoreDb();
    if (!db) return false;

    for (const collectionName of TRACKED_COLLECTIONS) {
      const ref = db.collection(collectionName);
      if (await queryCollectionForToday(ref, 'email', canonical)) return true;
      if (await queryCollectionForToday(ref, 'mplsEmailNormalized', canonical)) return true;
      if (await queryCollectionForToday(ref, 'nisn', raw)) return true;
      if (raw !== canonical && await queryCollectionForToday(ref, 'nisn', canonical)) return true;
    }

    return false;
  }

  function patchFirestoreAdd() {
    const proto = window.firebase?.firestore?.CollectionReference?.prototype;
    if (!proto || typeof proto.add !== 'function' || proto.add.__mplsTimeGatePatched) return;

    const originalAdd = proto.add;
    proto.add = function patchedAdd(payload) {
      const collectionId = this?.id || '';
      if (!TRACKED_COLLECTIONS.includes(collectionId) || !payload || typeof payload !== 'object') {
        return originalAdd.call(this, payload);
      }

      const nextPayload = { ...payload };
      const rawEmail = sanitizeEmail(nextPayload.email || nextPayload.nisn || lastAttemptEmail);
      const canonical = getCanonicalEmail(rawEmail);

      if (canonical) {
        nextPayload.email = canonical;
        nextPayload.mplsEmailNormalized = canonical;
        nextPayload.tanggal = nextPayload.tanggal || todayStr();
        if (typeof nextPayload.nisn === 'string') nextPayload.nisn = rawEmail;
      }

      const request = originalAdd.call(this, nextPayload);
      if (!request?.then) return request;

      return request.then((result) => {
        if (canonical) markAttended(canonical);
        return result;
      }).catch((error) => {
        if (canonical && pendingEmail === canonical) pendingEmail = '';
        return Promise.reject(error);
      });
    };

    proto.add.__mplsTimeGatePatched = true;
  }

  function injectStyle() {
    if (document.getElementById('mpls-tg-style')) return;

    const style = document.createElement('style');
    style.id = 'mpls-tg-style';
    style.textContent = `
      .mpls-tg-badge {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        width: min(100%, 560px);
        margin: 18px auto 22px;
        padding: 14px 16px;
        border-radius: 20px;
        border: 1px solid hsl(210 28% 88% / .95);
        background:
          linear-gradient(135deg, hsl(0 0% 100% / .94), hsl(210 43% 98% / .96)),
          linear-gradient(135deg, hsl(217 91% 60% / .08), hsl(185 84% 45% / .06));
        box-shadow:
          0 16px 36px hsl(220 44% 18% / .08),
          inset 0 1px 0 hsl(0 0% 100% / .82);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        overflow: hidden;
        transition: border-color .25s ease, box-shadow .25s ease, transform .25s ease;
      }
      .mpls-tg-badge::before {
        content: '';
        position: absolute;
        inset: 0 auto 0 0;
        width: 4px;
        background: linear-gradient(180deg, hsl(217 91% 60%), hsl(186 100% 42%));
      }
      .mpls-tg-badge.is-open {
        border-color: hsl(157 54% 82% / .95);
        box-shadow:
          0 18px 42px hsl(160 50% 18% / .10),
          inset 0 1px 0 hsl(0 0% 100% / .82);
      }
      .mpls-tg-badge.is-open::before {
        background: linear-gradient(180deg, hsl(145 63% 42%), hsl(171 77% 40%));
      }
      .mpls-tg-badge.is-closed {
        border-color: hsl(6 72% 83% / .95);
        box-shadow:
          0 18px 42px hsl(0 46% 20% / .09),
          inset 0 1px 0 hsl(0 0% 100% / .82);
      }
      .mpls-tg-badge.is-closed::before {
        background: linear-gradient(180deg, hsl(0 72% 52%), hsl(14 82% 56%));
      }
      .mpls-tg-main {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      .mpls-tg-pulse {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        flex: 0 0 auto;
      }
      .mpls-tg-pulse::before,
      .mpls-tg-pulse::after {
        content: '';
        position: absolute;
        border-radius: 999px;
      }
      .mpls-tg-pulse::before {
        inset: 0;
        background: hsl(145 63% 42%);
        box-shadow: 0 0 0 5px hsl(145 63% 42% / .15);
      }
      .mpls-tg-pulse::after {
        inset: -5px;
        border: 1px solid hsl(145 63% 42% / .16);
        animation: mplsTgRing 2.4s ease-out infinite;
      }
      .mpls-tg-badge.is-closed .mpls-tg-pulse::before {
        background: hsl(0 72% 52%);
        box-shadow: 0 0 0 5px hsl(0 72% 52% / .14);
      }
      .mpls-tg-badge.is-closed .mpls-tg-pulse::after {
        border-color: hsl(0 72% 52% / .18);
      }
      .mpls-tg-copy {
        display: grid;
        gap: 2px;
      }
      .mpls-tg-kicker {
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .26em;
        text-transform: uppercase;
        color: hsl(220 18% 42%);
      }
      .mpls-tg-title {
        font-family: 'Outfit', 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: -.02em;
        color: hsl(224 36% 16%);
        line-height: 1.05;
      }
      .mpls-tg-meta {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
        margin-left: auto;
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 600;
        color: hsl(220 15% 38%);
        text-align: right;
      }
      .mpls-tg-window,
      .mpls-tg-time {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid hsl(210 28% 88% / .95);
        background: hsl(0 0% 100% / .72);
        font-variant-numeric: tabular-nums;
      }
      .mpls-tg-time {
        color: hsl(224 36% 16%);
      }
      .mpls-tg-badge.is-open .mpls-tg-time {
        border-color: hsl(157 54% 82% / .95);
        background: hsl(150 57% 97% / .96);
      }
      .mpls-tg-badge.is-closed .mpls-tg-time {
        border-color: hsl(6 72% 83% / .95);
        background: hsl(0 100% 98% / .96);
      }
      @keyframes mplsTgRing {
        0% { transform: scale(.86); opacity: .6; }
        70% { transform: scale(1.25); opacity: 0; }
        100% { transform: scale(1.25); opacity: 0; }
      }
      @media (max-width: 640px) {
        .mpls-tg-badge {
          align-items: flex-start;
          padding: 14px;
          border-radius: 18px;
        }
        .mpls-tg-title {
          font-size: 15px;
        }
        .mpls-tg-meta {
          width: 100%;
          justify-content: flex-start;
          margin-left: 0;
          text-align: left;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .mpls-tg-pulse::after {
          animation: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureBadge() {
    let badge = document.getElementById('mpls-tg-badge');
    if (badge) return badge;

    badge = document.createElement('div');
    badge.id = 'mpls-tg-badge';
    badge.className = 'mpls-tg-badge is-open';

    const form = document.getElementById('attendance-form');
    if (form?.parentNode) form.parentNode.insertBefore(badge, form);
    else document.body.prepend(badge);

    return badge;
  }

  function fmtLeft(mins) {
    const safe = Math.max(0, mins);
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    if (h <= 0) return `${m} menit lagi`;
    if (m === 0) return `${h} jam lagi`;
    return `${h}j ${m}m lagi`;
  }

  function renderBadge() {
    injectStyle();
    const badge = ensureBadge();
    const minuteNow = nowMin();

    let title = 'Absensi Dibuka';
    let time = `Tutup dalam ${fmtLeft(closeMin - minuteNow)}`;
    let badgeClass = 'mpls-tg-badge is-open';

    if (minuteNow < openMin) {
      title = 'Absensi Tertutup';
      time = `Buka dalam ${fmtLeft(openMin - minuteNow)}`;
      badgeClass = 'mpls-tg-badge is-closed';
    } else if (minuteNow > closeMin) {
      title = 'Absensi Tertutup';
      time = 'Buka lagi besok 06.45 WIB';
      badgeClass = 'mpls-tg-badge is-closed';
    }

    badge.className = badgeClass;
    badge.innerHTML = `
      <div class="mpls-tg-main">
        <span class="mpls-tg-pulse" aria-hidden="true"></span>
        <div class="mpls-tg-copy">
          <span class="mpls-tg-kicker">Jadwal Absensi</span>
          <strong class="mpls-tg-title">${title}</strong>
        </div>
      </div>
      <div class="mpls-tg-meta">
        <span class="mpls-tg-window">06.45–15.30 WIB</span>
        <span class="mpls-tg-time">${time}</span>
      </div>
    `;
  }

  function syncInputValidity(el) {
    const raw = sanitizeEmail(el.value);
    el.value = raw;
    if (!raw) {
      el.setCustomValidity('');
      return;
    }

    if (!isStrictGmail(raw)) {
      el.setCustomValidity('Gunakan Gmail valid dengan format nama@gmail.com.');
      return;
    }

    el.setCustomValidity('');
  }

  function morphNisnToGmail() {
    const input = document.getElementById('attendance-nisn');
    if (!input) return;

    input.type = 'email';
    input.placeholder = 'nama@gmail.com';
    input.autocomplete = 'email';
    input.inputMode = 'email';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.required = true;
    input.setAttribute('pattern', '[a-z0-9.]+@gmail\\.com');
    input.setAttribute('title', 'Gunakan Gmail valid tanpa alias.');
    input.dataset.mplsMorphed = '1';

    const label = document.querySelector('label[for="attendance-nisn"]');
    if (label) label.textContent = 'Email Gmail';

    if (!input.dataset.mplsStrictBound) {
      input.addEventListener('input', () => syncInputValidity(input));
      input.addEventListener('blur', () => syncInputValidity(input));
      input.dataset.mplsStrictBound = '1';
    }
  }

  function clearPendingState() {
    pendingEmail = '';
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function armPendingTimeout(email) {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (pendingEmail === email) pendingEmail = '';
      pendingTimer = null;
    }, 15000);
  }

  function watchResultBox() {
    const result = document.getElementById('attendance-result');
    if (!result || result.dataset.mplsObserved === '1') return;
    result.dataset.mplsObserved = '1';

    const syncState = () => {
      const text = sanitizeEmail(result.textContent);
      if (!text || !lastAttemptEmail) return;

      if (text.includes('berhasil')) {
        markAttended(lastAttemptEmail);
        clearPendingState();
      } else if (text.includes('gagal') || text.includes('ditolak')) {
        unmarkAttended(lastAttemptEmail);
        clearPendingState();
      }
    };

    new MutationObserver(syncState).observe(result, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });

    syncState();
  }

  function blockWith(message, focusEl) {
    alert(message);
    focusEl?.focus();
  }

  function attachGuard() {
    const form = document.getElementById('attendance-form');
    if (!form || form.dataset.mplsTimeGate === '1') return;
    form.dataset.mplsTimeGate = '1';

    form.addEventListener('submit', async function (ev) {
      if (bypassNext) {
        bypassNext = false;
        return;
      }

      const emailEl = getEmailEl();
      const rawEmail = sanitizeEmail(emailEl?.value || '');
      const canonical = getCanonicalEmail(rawEmail);

      if (checkingSubmit) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }

      checkingSubmit = true;
      try {
        if (!isOpen()) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          blockWith('Absensi hanya dibuka pukul 06.45 - 15.30 WIB.', emailEl);
          return;
        }

        if (!isStrictGmail(rawEmail)) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          blockWith('Wajib pakai Gmail valid dengan format nama@gmail.com.', emailEl);
          return;
        }

        if (pendingEmail && pendingEmail === canonical) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          blockWith(`Email ${rawEmail} sedang diproses. Tunggu hasil submit dulu.`, emailEl);
          return;
        }

        if (hasAttendedToday(canonical)) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          blockWith(`Email ${rawEmail} sudah absen hari ini.\nMau status Hadir, Izin, atau Sakit tetap harus menunggu besok.`, emailEl);
          return;
        }

        ev.preventDefault();
        ev.stopImmediatePropagation();

        const duplicateInCloud = await firestoreHasAttended(rawEmail);
        if (duplicateInCloud) {
          markAttended(canonical);
          blockWith(`Email ${rawEmail} sudah tercatat hari ini.\nSilakan kembali besok pukul 06.45 WIB.`, emailEl);
          return;
        }

        lastAttemptEmail = canonical;
        pendingEmail = canonical;
        armPendingTimeout(canonical);
        bypassNext = true;

        setTimeout(() => {
          try {
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
          } catch (error) {
            console.warn('[mpls-time-gate] resubmit gagal:', error);
            clearPendingState();
          }
        }, 0);
      } finally {
        checkingSubmit = false;
      }
    }, true);
  }

  function init() {
    injectStyle();
    morphNisnToGmail();
    ensureBadge();
    renderBadge();
    watchResultBox();
    attachGuard();
    patchFirestoreAdd();
    setInterval(renderBadge, 1000);
    setInterval(patchFirestoreAdd, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  new MutationObserver(() => {
    if (document.getElementById('attendance-form')) {
      morphNisnToGmail();
      watchResultBox();
      attachGuard();
      patchFirestoreAdd();
    }
  }).observe(document.body, { childList: true, subtree: true });

  console.log('[mpls-time-gate v3] aktif — Gmail strict, limit 1x/hari, badge refined');
})();
