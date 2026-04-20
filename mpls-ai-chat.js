(function () {
  'use strict';

  const ENDPOINT = 'https://yazmejgjayocgoionvan.supabase.co/functions/v1/ai-chat';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlhem1lamdqYXlvY2dvaW9udmFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjA1MDksImV4cCI6MjA5MjE5NjUwOX0.417qzwpRGvKGRrpwRkvqElCCqR8FZkXA-6kSvyn5vBc';
  const REMINDER_DISMISS_KEY = 'mpls_ai_reminder_dismissed_v1';
  const HISTORY_KEY = 'mpls_ai_history_v1';

  const $ = (sel, root = document) => root.querySelector(sel);

  /* -------------------- STYLES -------------------- */
  function injectStyle() {
    if (document.getElementById('mpls-ai-style')) return;
    const css = `
      .mpls-ai-fab-wrap{position:fixed;right:18px;bottom:18px;z-index:99998;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
      .mpls-ai-reminder{position:relative;max-width:240px;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;padding:12px 30px 12px 14px;border-radius:14px;font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08);animation:mplsAiPop .35s cubic-bezier(.34,1.56,.64,1)}
      .mpls-ai-reminder::after{content:"";position:absolute;right:22px;bottom:-7px;width:14px;height:14px;background:linear-gradient(135deg,#16213e,#16213e);transform:rotate(45deg);border-right:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08)}
      .mpls-ai-reminder b{color:#a78bfa;font-weight:600}
      .mpls-ai-rem-label{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#a78bfa;margin-bottom:4px}
      .mpls-ai-rem-text{color:#e2e8f0;font-size:13px;line-height:1.45}
      .mpls-ai-reminder .mpls-ai-x{position:absolute;top:6px;right:8px;width:20px;height:20px;border:0;background:rgba(255,255,255,.08);color:#fff;border-radius:50%;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;transition:.15s}
      .mpls-ai-reminder .mpls-ai-x:hover{background:rgba(255,255,255,.18)}
      .mpls-ai-fab{position:relative;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:linear-gradient(135deg,#8b5cf6 0%,#6366f1 50%,#3b82f6 100%);box-shadow:0 10px 30px rgba(99,102,241,.45),0 0 0 0 rgba(139,92,246,.45);display:flex;align-items:center;justify-content:center;color:#fff;transition:transform .2s ease,box-shadow .2s ease;animation:mplsAiPulse 2.4s ease-in-out infinite}
      .mpls-ai-fab:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 34px rgba(99,102,241,.55)}
      .mpls-ai-fab:active{transform:scale(.96)}
      .mpls-ai-fab svg{width:26px;height:26px}
      .mpls-ai-fab .mpls-ai-spark{position:absolute;top:6px;right:6px;width:10px;height:10px;background:#fbbf24;border-radius:50%;box-shadow:0 0 8px #fbbf24;animation:mplsAiBlink 1.6s ease-in-out infinite}

      @keyframes mplsAiPulse{0%,100%{box-shadow:0 10px 30px rgba(99,102,241,.45),0 0 0 0 rgba(139,92,246,.5)}50%{box-shadow:0 10px 30px rgba(99,102,241,.45),0 0 0 14px rgba(139,92,246,0)}}
      @keyframes mplsAiBlink{0%,100%{opacity:1}50%{opacity:.4}}
      @keyframes mplsAiPop{from{opacity:0;transform:translateY(8px) scale(.92)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes mplsAiFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes mplsAiSlideUp{from{opacity:0;transform:translateY(20px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}

      .mpls-ai-overlay{position:fixed;inset:0;background:rgba(8,8,20,.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:12px;animation:mplsAiFadeIn .25s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
      .mpls-ai-modal{width:100%;max-width:520px;height:min(88vh,720px);background:linear-gradient(160deg,#0f0f1e 0%,#1a1a2e 60%,#16213e 100%);border:1px solid rgba(255,255,255,.08);border-radius:24px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.55);animation:mplsAiSlideUp .35s cubic-bezier(.34,1.56,.64,1)}
      @media (min-width:640px){.mpls-ai-overlay{align-items:center}}

      .mpls-ai-head{padding:16px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,.06);background:linear-gradient(180deg,rgba(139,92,246,.08),transparent)}
      .mpls-ai-avatar{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;box-shadow:0 6px 18px rgba(99,102,241,.4)}
      .mpls-ai-avatar svg{width:22px;height:22px}
      .mpls-ai-title{flex:1;min-width:0}
      .mpls-ai-title h3{margin:0;color:#fff;font-size:15px;font-weight:600;letter-spacing:-.01em}
      .mpls-ai-title p{margin:2px 0 0;color:#a5b4fc;font-size:11px;display:flex;align-items:center;gap:6px}
      .mpls-ai-title p::before{content:"";width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px #34d399;animation:mplsAiBlink 1.8s ease-in-out infinite}
      .mpls-ai-head-btn{width:34px;height:34px;border:0;background:rgba(255,255,255,.06);color:#fff;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
      .mpls-ai-head-btn:hover{background:rgba(255,255,255,.14)}
      .mpls-ai-head-btn svg{width:16px;height:16px}

      .mpls-ai-body{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:14px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent}
      .mpls-ai-body::-webkit-scrollbar{width:6px}
      .mpls-ai-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:3px}

      .mpls-ai-empty{margin:auto;text-align:center;color:#cbd5e1;padding:20px}
      .mpls-ai-empty .mpls-ai-em-icon{width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,rgba(139,92,246,.2),rgba(59,130,246,.2));border:1px solid rgba(139,92,246,.3);margin:0 auto 14px;display:flex;align-items:center;justify-content:center;color:#a78bfa}
      .mpls-ai-empty .mpls-ai-em-icon svg{width:30px;height:30px}
      .mpls-ai-empty h4{margin:0 0 6px;color:#fff;font-size:17px;font-weight:600}
      .mpls-ai-empty p{margin:0 0 16px;font-size:13px;color:#94a3b8;line-height:1.5}
      .mpls-ai-suggests{display:flex;flex-direction:column;gap:8px;max-width:320px;margin:0 auto}
      .mpls-ai-sugg{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#e2e8f0;padding:10px 14px;border-radius:12px;font-size:13px;text-align:left;cursor:pointer;transition:.15s;font-family:inherit}
      .mpls-ai-sugg:hover{background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.35);color:#fff}

      .mpls-ai-msg{display:flex;gap:10px;animation:mplsAiSlideUp .25s ease}
      .mpls-ai-msg.user{flex-direction:row-reverse}
      .mpls-ai-bubble{max-width:78%;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
      .mpls-ai-msg.user .mpls-ai-bubble{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border-bottom-right-radius:4px;box-shadow:0 4px 14px rgba(99,102,241,.3)}
      .mpls-ai-msg.ai .mpls-ai-bubble{background:rgba(255,255,255,.06);color:#e2e8f0;border:1px solid rgba(255,255,255,.06);border-bottom-left-radius:4px}
      .mpls-ai-mavatar{width:30px;height:30px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600}
      .mpls-ai-msg.ai .mpls-ai-mavatar{background:linear-gradient(135deg,#8b5cf6,#3b82f6)}
      .mpls-ai-msg.user .mpls-ai-mavatar{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12)}
      .mpls-ai-mavatar svg{width:14px;height:14px}

      .mpls-ai-typing{display:inline-flex;gap:4px;padding:4px 0}
      .mpls-ai-typing span{width:7px;height:7px;border-radius:50%;background:#a78bfa;animation:mplsAiBounce 1.2s ease-in-out infinite}
      .mpls-ai-typing span:nth-child(2){animation-delay:.15s}
      .mpls-ai-typing span:nth-child(3){animation-delay:.3s}
      @keyframes mplsAiBounce{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-5px);opacity:1}}

      .mpls-ai-foot{padding:12px;border-top:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.2)}
      .mpls-ai-input-wrap{display:flex;gap:8px;align-items:flex-end;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:8px 8px 8px 14px;transition:border-color .2s}
      .mpls-ai-input-wrap:focus-within{border-color:rgba(139,92,246,.5);box-shadow:0 0 0 3px rgba(139,92,246,.12)}
      .mpls-ai-input{flex:1;background:transparent;border:0;outline:0;color:#fff;font-size:14px;font-family:inherit;resize:none;max-height:120px;min-height:24px;line-height:1.5;padding:4px 0}
      .mpls-ai-input::placeholder{color:#64748b}
      .mpls-ai-send{width:38px;height:38px;border:0;border-radius:12px;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;flex-shrink:0}
      .mpls-ai-send:hover:not(:disabled){transform:scale(1.06)}
      .mpls-ai-send:disabled{opacity:.4;cursor:not-allowed}
      .mpls-ai-send svg{width:16px;height:16px}
      .mpls-ai-foot small{display:block;text-align:center;color:#64748b;font-size:10px;margin-top:8px;letter-spacing:.02em}
    `;
    const style = document.createElement('style');
    style.id = 'mpls-ai-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* -------------------- HISTORY -------------------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  }
  function saveHistory(arr) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(-30))); } catch {}
  }

  /* -------------------- FLOATING BUTTON + REMINDER -------------------- */
  function buildFab() {
    if (document.getElementById('mpls-ai-fab-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mpls-ai-fab-wrap';
    wrap.className = 'mpls-ai-fab-wrap';

    const dismissed = localStorage.getItem(REMINDER_DISMISS_KEY) === '1';
    if (!dismissed) {
      const rem = document.createElement('div');
      rem.className = 'mpls-ai-reminder';
      rem.innerHTML = `<span class="mpls-ai-rem-label">Reminder</span><div class="mpls-ai-rem-text">Jangan lupa <b>absen</b> ya!!</div><button class="mpls-ai-x" aria-label="Tutup">×</button>`;
      rem.querySelector('.mpls-ai-x').addEventListener('click', (e) => {
        e.stopPropagation();
        localStorage.setItem(REMINDER_DISMISS_KEY, '1');
        rem.style.transition = 'opacity .2s, transform .2s';
        rem.style.opacity = '0';
        rem.style.transform = 'translateY(8px) scale(.95)';
        setTimeout(() => rem.remove(), 200);
      });
      wrap.appendChild(rem);
    }

    const fab = document.createElement('button');
    fab.className = 'mpls-ai-fab';
    fab.setAttribute('aria-label', 'Buka AI Chat');
    fab.innerHTML = `
      <span class="mpls-ai-spark"></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5z"/>
      </svg>`;
    fab.addEventListener('click', openModal);
    wrap.appendChild(fab);

    document.body.appendChild(wrap);
  }

  /* -------------------- MODAL -------------------- */
  let modalEl = null;
  let isStreaming = false;
  let abortCtrl = null;

  function openModal() {
    if (modalEl) return;
    const overlay = document.createElement('div');
    overlay.className = 'mpls-ai-overlay';
    overlay.innerHTML = `
      <div class="mpls-ai-modal" role="dialog" aria-label="AI Assistant">
        <div class="mpls-ai-head">
          <div class="mpls-ai-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5z"/>
            </svg>
          </div>
          <div class="mpls-ai-title">
            <h3>MPLS Assistant</h3>
            <p>Online — siap membantu</p>
          </div>
          <button class="mpls-ai-head-btn" data-act="clear" title="Hapus chat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
          </button>
          <button class="mpls-ai-head-btn" data-act="close" title="Tutup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="mpls-ai-body" id="mpls-ai-body"></div>
        <div class="mpls-ai-foot">
          <div class="mpls-ai-input-wrap">
            <textarea class="mpls-ai-input" id="mpls-ai-input" rows="1" placeholder="Tanyakan sesuatu..."></textarea>
            <button class="mpls-ai-send" id="mpls-ai-send" aria-label="Kirim">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <small>Powered by Gemini · Made by MIY</small>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    modalEl = overlay;
    document.documentElement.style.overflow = 'hidden';

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('[data-act="close"]').addEventListener('click', closeModal);
    overlay.querySelector('[data-act="clear"]').addEventListener('click', () => {
      saveHistory([]); renderMessages();
    });

    const input = $('#mpls-ai-input', overlay);
    const sendBtn = $('#mpls-ai-send', overlay);
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    sendBtn.addEventListener('click', send);

    renderMessages();
    setTimeout(() => input.focus(), 200);
  }

  function closeModal() {
    if (!modalEl) return;
    if (abortCtrl) try { abortCtrl.abort(); } catch {}
    modalEl.style.animation = 'mplsAiFadeIn .2s reverse';
    const m = modalEl;
    setTimeout(() => m.remove(), 180);
    modalEl = null;
    document.documentElement.style.overflow = '';
  }

  function renderMessages() {
    if (!modalEl) return;
    const body = $('#mpls-ai-body', modalEl);
    const hist = loadHistory();
    body.innerHTML = '';
    if (hist.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mpls-ai-empty';
      empty.innerHTML = `
        <div class="mpls-ai-em-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5z"/></svg>
        </div>
        <h4>Halo</h4>
        <p>Asisten MPLS siap membantu. Pilih pertanyaan di bawah atau tulis sendiri.</p>
        <div class="mpls-ai-suggests">
          <button class="mpls-ai-sugg" data-q="Jam berapa absensi dibuka?">Jam berapa absensi dibuka?</button>
          <button class="mpls-ai-sugg" data-q="Bagaimana cara absen yang benar?">Cara absen yang benar</button>
          <button class="mpls-ai-sugg" data-q="Berikan tips agar semangat mengikuti MPLS.">Tips semangat ikut MPLS</button>
        </div>`;
      empty.querySelectorAll('.mpls-ai-sugg').forEach(b => {
        b.addEventListener('click', () => {
          $('#mpls-ai-input', modalEl).value = b.dataset.q;
          send();
        });
      });
      body.appendChild(empty);
      return;
    }
    hist.forEach(m => body.appendChild(buildMsgEl(m.role, m.content)));
    body.scrollTop = body.scrollHeight;
  }

  function buildMsgEl(role, content) {
    const wrap = document.createElement('div');
    wrap.className = `mpls-ai-msg ${role === 'user' ? 'user' : 'ai'}`;
    const av = document.createElement('div');
    av.className = 'mpls-ai-mavatar';
    av.innerHTML = role === 'user'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5z"/></svg>`;
    const bub = document.createElement('div');
    bub.className = 'mpls-ai-bubble';
    bub.textContent = content;
    wrap.appendChild(av);
    wrap.appendChild(bub);
    return wrap;
  }

  async function send() {
    if (!modalEl || isStreaming) return;
    const input = $('#mpls-ai-input', modalEl);
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    const hist = loadHistory();
    hist.push({ role: 'user', content: text });
    saveHistory(hist);
    renderMessages();

    const body = $('#mpls-ai-body', modalEl);
    const aiWrap = buildMsgEl('assistant', '');
    const aiBub = aiWrap.querySelector('.mpls-ai-bubble');
    aiBub.innerHTML = `<div class="mpls-ai-typing"><span></span><span></span><span></span></div>`;
    body.appendChild(aiWrap);
    body.scrollTop = body.scrollHeight;

    const sendBtn = $('#mpls-ai-send', modalEl);
    sendBtn.disabled = true;
    isStreaming = true;
    abortCtrl = new AbortController();

    let acc = '';
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ messages: hist }),
        signal: abortCtrl.signal,
      });

      if (!resp.ok || !resp.body) {
        let msg = 'Gagal menghubungi asisten.';
        if (resp.status === 429) msg = 'Terlalu banyak permintaan. Coba lagi sebentar.';
        else if (resp.status === 402) msg = 'Kuota habis. Hubungi admin.';
        try { const j = await resp.json(); if (j?.error) msg = j.error; } catch {}
        aiBub.textContent = msg;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', done = false, started = false;

      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { done = true; break; }
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              if (!started) { aiBub.textContent = ''; started = true; }
              acc += delta;
              aiBub.textContent = acc;
              body.scrollTop = body.scrollHeight;
            }
          } catch {
            buf = line + '\n' + buf;
            break;
          }
        }
      }

      if (!started) aiBub.textContent = 'Tidak ada jawaban. Coba lagi.';
      else {
        const h = loadHistory();
        h.push({ role: 'assistant', content: acc });
        saveHistory(h);
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.error('[mpls-ai-chat]', e);
      aiBub.textContent = 'Koneksi bermasalah. Periksa internet Anda.';
    } finally {
      isStreaming = false;
      abortCtrl = null;
      if (modalEl) $('#mpls-ai-send', modalEl).disabled = false;
    }
  }

  /* -------------------- INIT -------------------- */
  function init() {
    injectStyle();
    buildFab();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[mpls-ai-chat v1] aktif — floating AI button siap');
})();
