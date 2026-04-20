const targetDate = new Date('2026-07-13T07:00:00').getTime();

const canvas = document.getElementById('space-canvas');
const ctx = canvas.getContext('2d');
let width = 0;
let height = 0;
let particles = [];
let pointer = { x: 0, y: 0 };

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  particles = Array.from({ length: Math.min(90, Math.floor(width / 16)) }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random() * 1 + 0.25,
    vx: (Math.random() - 0.5) * 0.32,
    vy: (Math.random() - 0.5) * 0.32,
    r: Math.random() * 2.1 + 0.7
  }));
}

function drawBackground() {
  ctx.clearRect(0, 0, width, height);
  particles.forEach((p, index) => {
    p.x += p.vx + pointer.x * 0.0009 * p.z;
    p.y += p.vy + pointer.y * 0.0009 * p.z;

    if (p.x < -30) p.x = width + 30;
    if (p.x > width + 30) p.x = -30;
    if (p.y < -30) p.y = height + 30;
    if (p.y > height + 30) p.y = -30;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.z, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(37, 99, 235, ${0.10 * p.z})`;
    ctx.fill();

    for (let j = index + 1; j < particles.length; j += 1) {
      const other = particles[j];
      const dx = p.x - other.x;
      const dy = p.y - other.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 120) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(other.x, other.y);
        ctx.strokeStyle = `rgba(14, 165, 233, ${(1 - distance / 120) * 0.13})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  });
  requestAnimationFrame(drawBackground);
}

function updateCountdown() {
  const distance = targetDate - Date.now();
  const safe = Math.max(distance, 0);
  const days = Math.floor(safe / 86400000);
  const hours = Math.floor((safe % 86400000) / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const write = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value).padStart(2, '0');
  };
  write('days', days);
  write('hours', hours);
  write('minutes', minutes);
  write('seconds', seconds);
}

function setupLogoMotion() {
  const stage = document.getElementById('logo-stage');
  if (!stage) return;

  const setTilt = (x, y) => {
    stage.style.transform = `rotateX(${y}deg) rotateY(${x}deg) translateZ(0)`;
  };

  stage.addEventListener('mousemove', (event) => {
    const rect = stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 26;
    const y = -((event.clientY - rect.top) / rect.height - 0.5) * 26;
    setTilt(x, y);
  });

  stage.addEventListener('mouseleave', () => setTilt(0, 0));

  window.addEventListener('deviceorientation', (event) => {
    if (event.gamma === null || event.beta === null) return;
    const x = Math.max(-18, Math.min(18, event.gamma));
    const y = Math.max(-18, Math.min(18, event.beta - 45));
    setTilt(x, -y);
  });
}

function setupScrollEffects() {
  const navbar = document.getElementById('navbar');
  const updateNav = () => {
    if (!navbar) return;
    navbar.classList.toggle('shadow-xl', window.scrollY > 40);
    navbar.classList.toggle('bg-white/90', window.scrollY > 40);
  };
  window.addEventListener('scroll', updateNav);
  updateNav();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
}

function setupFaq() {
  document.querySelectorAll('.faq-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      const alreadyOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach((faq) => faq.classList.remove('open'));
      if (!alreadyOpen) item.classList.add('open');
    });
  });
}

function getAttendanceRows() {
  try {
    return JSON.parse(localStorage.getItem('mplsAttendanceRows') || '[]');
  } catch {
    return [];
  }
}

function setAttendanceRows(rows) {
  localStorage.setItem('mplsAttendanceRows', JSON.stringify(rows));
}

function setupAttendance() {
  const form = document.getElementById('attendance-form');
  const result = document.getElementById('attendance-result');
  if (!form || !result) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const record = {
      waktu: new Date().toLocaleString('id-ID'),
      nama: document.getElementById('attendance-name').value.trim(),
      nisn: document.getElementById('attendance-nisn').value.trim(),
      gugus: document.getElementById('attendance-group').value,
      hari: document.getElementById('attendance-day').value,
      status: document.getElementById('attendance-status').value,
      catatan: document.getElementById('attendance-note').value.trim() || '-'
    };

    const rows = getAttendanceRows();
    rows.push(record);
    setAttendanceRows(rows);

    result.innerHTML = `<strong>Absensi berhasil.</strong><span>${record.nama} tercatat ${record.status} untuk ${record.hari}, Gugus ${record.gugus}. Total rekap di perangkat ini: ${rows.length} data.</span>`;
    result.classList.add('success');
    form.reset();
  });
}

/* ===== Hamburger menu mobile ===== */
function setupHamburger() {
  const btn = document.getElementById('hamburger-btn');
  const menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', () => {
    btn.classList.toggle('is-open');
    menu.classList.toggle('is-open');
  });
  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      btn.classList.remove('is-open');
      menu.classList.remove('is-open');
    });
  });
}

/* ===== Admin login + dashboard (tanpa database) ===== */
const ADMIN_CREDENTIALS = {
  email: 'admin@sman5tuban.sch.id',
  password: 'mpls2026'
};

function setupAdminAuth() {
  const modal = document.getElementById('admin-login-modal');
  const dashboard = document.getElementById('admin-dashboard');
  const openBtn = document.getElementById('open-admin-login');
  const openBtnMobile = document.getElementById('open-admin-login-mobile');
  const form = document.getElementById('admin-login-form');
  const errorBox = document.getElementById('admin-login-error');
  const logoutBtn = document.getElementById('admin-logout');
  if (!modal || !dashboard || !form) return;

  const openModal = () => {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('admin-active');
  };
  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('admin-active');
    errorBox.hidden = true;
    form.reset();
  };
  const openDashboard = () => {
    closeModal();
    dashboard.classList.add('is-open');
    dashboard.setAttribute('aria-hidden', 'false');
    document.body.classList.add('admin-active');
    sessionStorage.setItem('mplsAdminLogged', '1');
    renderAdminTable();
  };
  const closeDashboard = () => {
    dashboard.classList.remove('is-open');
    dashboard.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('admin-active');
    sessionStorage.removeItem('mplsAdminLogged');
  };

  openBtn && openBtn.addEventListener('click', openModal);
  openBtnMobile && openBtnMobile.addEventListener('click', () => {
    document.getElementById('hamburger-btn')?.classList.remove('is-open');
    document.getElementById('mobile-menu')?.classList.remove('is-open');
    openModal();
  });

  modal.querySelectorAll('[data-close-admin]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('admin-email').value.trim().toLowerCase();
    const password = document.getElementById('admin-password').value;
    if (email === ADMIN_CREDENTIALS.email && password === ADMIN_CREDENTIALS.password) {
      openDashboard();
    } else {
      errorBox.hidden = false;
    }
  });

  logoutBtn && logoutBtn.addEventListener('click', closeDashboard);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal.classList.contains('is-open')) closeModal();
    }
  });

  // Restore session
  if (sessionStorage.getItem('mplsAdminLogged') === '1') {
    dashboard.classList.add('is-open');
    document.body.classList.add('admin-active');
    renderAdminTable();
  }

  // Dashboard actions
  document.getElementById('admin-download-csv')?.addEventListener('click', downloadCsv);
  document.getElementById('admin-download-json')?.addEventListener('click', downloadJson);
  document.getElementById('admin-clear')?.addEventListener('click', () => {
    if (confirm('Hapus semua data absensi? Tindakan ini tidak bisa dibatalkan.')) {
      setAttendanceRows([]);
      renderAdminTable();
    }
  });
}

function renderAdminTable() {
  const rows = getAttendanceRows();
  const tbody = document.getElementById('admin-table-body');
  const empty = document.getElementById('admin-empty');
  const total = document.getElementById('admin-total-rows');
  if (!tbody) return;
  total.textContent = String(rows.length);
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.waktu)}</td>
      <td>${escapeHtml(r.nama)}</td>
      <td>${escapeHtml(r.nisn)}</td>
      <td>${escapeHtml(r.gugus)}</td>
      <td>${escapeHtml(r.hari)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.catatan)}</td>
    </tr>
  `).join('');
  if (rows.length === 0) empty.classList.add('show'); else empty.classList.remove('show');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function downloadCsv() {
  const rows = getAttendanceRows();
  if (!rows.length) { alert('Belum ada data absensi.'); return; }
  const header = ['Waktu', 'Nama', 'NISN/Nomor', 'Gugus', 'Hari', 'Status', 'Catatan'];
  const csvRows = rows.map((row) => [row.waktu, row.nama, row.nisn, row.gugus, row.hari, row.status, row.catatan]);
  const csv = [header, ...csvRows].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `absensi-mpls-sman5-tuban-${Date.now()}.csv`);
}

function downloadJson() {
  const rows = getAttendanceRows();
  if (!rows.length) { alert('Belum ada data absensi.'); return; }
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `absensi-mpls-sman5-tuban-${Date.now()}.json`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setupGallery3d() {
  document.querySelectorAll('.gallery-tile').forEach((tile) => {
    tile.addEventListener('mousemove', (event) => {
      const rect = tile.getBoundingClientRect();
      const rotateY = ((event.clientX - rect.left) / rect.width - 0.5) * 18;
      const rotateX = -((event.clientY - rect.top) / rect.height - 0.5) * 18;
      tile.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-12px) scale(1.03)`;
    });
    tile.addEventListener('mouseleave', () => {
      tile.style.transform = '';
    });
  });
}

window.addEventListener('mousemove', (event) => {
  pointer.x = event.clientX - width / 2;
  pointer.y = event.clientY - height / 2;
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
drawBackground();
updateCountdown();
setInterval(updateCountdown, 1000);
setupLogoMotion();
setupScrollEffects();
setupFaq();
setupAttendance();
setupGallery3d();
setupHamburger();
setupAdminAuth();

/* ===== 3D VIDEO CARDS (DOKUMENTASI) ===== */
function setupCard3d() {
  const cards = document.querySelectorAll('.card3d');
  cards.forEach((card) => {
    const front = card.querySelector('.card3d-front');
    const back = card.querySelector('.card3d-back');
    const video = card.querySelector('video');
    const closeBtn = card.querySelector('.card3d-close');

    // Tilt effect on hover (mouse move)
    card.addEventListener('mousemove', (e) => {
      if (card.classList.contains('is-flipped')) return;
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `rotateX(${(-y * 14).toFixed(2)}deg) rotateY(${(x * 16).toFixed(2)}deg) translateZ(12px)`;
    });
    card.addEventListener('mouseleave', () => {
      if (card.classList.contains('is-flipped')) return;
      card.style.transform = '';
    });

    // Flip on click (front)
    front && front.addEventListener('click', () => {
      card.classList.add('is-flipped');
      card.style.transform = '';
      if (video) {
        try { video.play().catch(() => {}); } catch (_) {}
      }
    });

    // Close button -> flip back
    closeBtn && closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.remove('is-flipped');
      if (video) { try { video.pause(); video.currentTime = 0; } catch (_) {} }
    });
  });
}
setupCard3d();
