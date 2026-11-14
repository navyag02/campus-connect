/* CampusConnect front-end: hash-routed single page app talking to the Express API */
const app = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const CATS = ['Workshop', 'Competition', 'Cultural', 'Sports', 'Seminar'];
const DEPTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Electrical', 'Management', 'Other'];
let timerHandle = null;
const state = { q: '', category: 'All', from: '', to: '', sort: 'date', availableOnly: false, calMonth: new Date(), user: null, pending: null, profileTab: 'registered', calFilter: 'all' };

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.data = data; e.status = res.status; throw e; }
  return data;
};
const startOf = ev => new Date(`${ev.date}T${ev.time}:00`);
const fmtDate = ev => startOf(ev).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = ev => startOf(ev).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2800);
}
function countdownText(ev) {
  const diff = startOf(ev) - Date.now();
  if (diff <= 0) return { text: 'Event started / ended', past: true };
  const d = Math.floor(diff / 864e5), h = Math.floor(diff % 864e5 / 36e5), m = Math.floor(diff % 36e5 / 6e4), s = Math.floor(diff % 6e4 / 1e3);
  return { text: `⏳ ${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`, past: false };
}
function startCountdowns() {
  clearInterval(timerHandle);
  const tick = () => document.querySelectorAll('[data-cd]').forEach(el => {
    const c = countdownText({ date: el.dataset.date, time: el.dataset.time });
    el.textContent = c.text; el.classList.toggle('past', c.past);
  });
  tick(); timerHandle = setInterval(tick, 1000);
}
const cdSpan = ev => `<div class="countdown" data-cd data-date="${esc(ev.date)}" data-time="${esc(ev.time)}"></div>`;

// ---------- theme ----------
const themeBtn = document.getElementById('themeToggle');
function applyTheme(t) { document.documentElement.dataset.theme = t; themeBtn.textContent = t === 'dark' ? '☀️' : '🌙'; localStorage.setItem('cc_theme', t); }
applyTheme(localStorage.getItem('cc_theme') || 'light');
themeBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// ---------- accounts ----------
const RULES = {
  name: v => /^[A-Za-z][A-Za-z .'-]{1,59}$/.test(v.trim()) || 'Enter a valid full name (letters only).',
  email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Enter a valid email address.',
  password: v => (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v)) || 'Use 8+ characters with at least one letter and one number.',
  rollNo: v => /^[A-Za-z0-9-]{5,15}$/.test(v.trim()) || 'Roll number must be 5-15 letters/digits.',
  phone: v => /^[6-9]\d{9}$/.test(v.trim()) || 'Enter a valid 10-digit mobile number.',
  department: v => !!v || 'Select your department.',
  year: v => !!v || 'Select your year.'
};
const PROFILE_KEYS = ['name', 'rollNo', 'phone', 'department', 'year'];

// form building blocks shared by signup, registration, profile and event forms
function fld(k, label, type = 'text', val = '', ph = '', extra = '') {
  return `<div class="field" data-f="${k}"><label>${label}</label><input name="${k}" type="${type}" placeholder="${esc(ph)}" value="${esc(val)}" ${extra}><div class="err"></div></div>`;
}
function sel(k, label, opts, val) {
  return `<div class="field" data-f="${k}"><label>${label}</label><select name="${k}"><option value="">Select</option>${opts.map(o => `<option ${String(val) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select><div class="err"></div></div>`;
}
const profileFields = (v = {}) =>
  fld('name', 'Full name', 'text', v.name, 'e.g. Aarav Sharma') +
  `<div class="two">${fld('rollNo', 'Roll number', 'text', v.rollNo, 'e.g. 21CS1042')}${fld('phone', 'Mobile number', 'tel', v.phone, '10-digit number')}</div>` +
  `<div class="two">${sel('department', 'Department', DEPTS, v.department)}${sel('year', 'Year', [1, 2, 3, 4], v.year)}</div>`;

function setFieldError(form, k, msg) {
  const w = form.querySelector(`[data-f="${k}"]`); if (!w) return;
  w.classList.toggle('invalid', !!msg); w.querySelector('.err').textContent = msg || '';
}
const showServerErrors = (form, errors) => Object.entries(errors).forEach(([k, m]) => setFieldError(form, k, m));
// attaches blur-validation to the given fields; returns checkAll() for submit time
function formValidator(form, keys) {
  const check = k => { const r = RULES[k](form.elements[k].value); setFieldError(form, k, r === true ? '' : r); return r === true; };
  keys.forEach(k => form.elements[k].addEventListener('blur', () => check(k)));
  return () => keys.map(check).every(Boolean);
}
// one delegated listener for every form: as soon as a field is edited, its old error message goes away
['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const w = e.target.closest && e.target.closest('.field[data-f]');
  if (w && w.classList.contains('invalid')) { w.classList.remove('invalid'); const m = w.querySelector('.err'); if (m) m.textContent = ''; }
}));
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function loadUser() {
  try { state.user = (await api('/api/auth/me')).user; } catch { state.user = null; }
  renderNav();
}
// which events is the logged-in user registered for / owner of? (empty sets when logged out)
async function getMine() {
  const out = { reg: new Set(), created: new Set() };
  if (!state.user) return out;
  try {
    const [regs, made] = await Promise.all([api('/api/me/registrations'), api('/api/me/events')]);
    regs.forEach(r => out.reg.add(r.event.id)); made.forEach(e => out.created.add(e.id));
  } catch {}
  return out;
}
function setActiveNav() {
  const cur = (location.hash.replace(/^#\/?/, '') || 'events').split('/')[0];
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === cur));
}
function renderNav() {
  const u = state.user;
  document.getElementById('authArea').innerHTML = u
    ? `<a href="#/profile" data-nav="profile" class="nav-user"><span class="mini-avatar">${esc(u.name[0].toUpperCase())}</span>${esc(u.name.split(' ')[0])}</a><a href="#" id="logoutLink">Log out</a>`
    : `<a href="#/login" data-nav="login">Log in</a><a href="#/signup" data-nav="signup" class="nav-cta">Sign up</a>`;
  const lo = document.getElementById('logoutLink');
  if (lo) lo.onclick = async e => {
    e.preventDefault();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    state.user = null; state.pending = null; state.calFilter = 'all'; renderNav(); toast('Logged out');
    if (location.hash === '#/events') route(); else location.hash = '#/events';
  };
  setActiveNav();
}
// send a logged-out visitor to log in, remembering what they were trying to do
function needLogin(pending, msg) { state.pending = pending; toast(msg); location.hash = '#/login'; }
function sessionExpired(pending) { state.user = null; renderNav(); needLogin(pending, 'Your session expired. Please log in again.'); }
function afterAuth() {
  const p = state.pending; state.pending = null;
  if (p && p.type === 'register') { location.hash = '#/events'; setTimeout(() => openRegister(p.id), 200); }
  else location.hash = (p && p.hash) || '#/events';
}

// ---------- router ----------
async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'events';
  setActiveNav();
  clearInterval(timerHandle);
  if (!/^(login|signup)/.test(hash)) state.pending = null; // a remembered intent only lives while the visitor stays on login/signup
  try {
    if (hash.startsWith('calendar')) await renderCalendar();
    else if (hash.startsWith('profile')) await renderProfile();
    else if (hash.startsWith('my-events')) location.hash = '#/profile';
    else if (hash.startsWith('login')) renderLogin();
    else if (hash.startsWith('signup')) renderSignup();
    else if (hash.startsWith('add')) renderAddEvent();
    else await renderEvents();
  } catch (e) {
    app.innerHTML = `<div class="empty">⚠️ Could not load data: ${esc(e.message)}<br>Is the server running?</div>`;
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('load', async () => { await loadUser(); route(); });

// ---------- events page ----------
function eventCard(e, { reg = false, owned = false } = {}) {
  const pct = Math.round(e.registered / e.capacity * 100);
  const full = e.seatsLeft <= 0;
  return `<article class="card ${e.past ? 'past' : ''}">
    <div class="card-top"><span><span class="badge ${esc(e.category)}">${esc(e.category)}</span>${owned ? '<span class="pill-note">Your event</span>' : ''}</span><span class="emoji">${esc(e.emoji)}</span></div>
    <h3>${esc(e.title)}</h3>
    <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span><span>🏛️ ${esc(e.organizer)}</span></div>
    <p class="desc">${esc(e.description)}</p>
    ${cdSpan(e)}
    <div class="bar"><i class="${pct > 85 ? 'low' : ''}" style="width:${pct}%"></i></div>
    <div class="seats">${e.past ? 'Event has ended' : full ? 'Fully booked' : `${e.seatsLeft} of ${e.capacity} seats left`}</div>
    <div class="row">
      <button class="btn secondary" data-details="${e.id}">Details</button>
      <button class="btn" data-register="${e.id}" ${reg || full || e.past ? 'disabled' : ''}>${reg ? 'Registered ✓' : e.past ? 'Ended' : full ? 'Full' : 'Register'}</button>
    </div>
  </article>`;
}

async function renderEvents() {
  const [cats, stats, mine] = await Promise.all([api('/api/categories'), api('/api/stats'), getMine()]);
  app.innerHTML = `
    <section class="hero">
      <h1>Discover what's happening on campus 🎓</h1>
      <p>Workshops, competitions, cultural fests and more. Find an event, register in seconds.</p>
      <div class="stats">
        <div class="stat"><b>${stats.events}</b><span>Upcoming events</span></div>
        <div class="stat"><b>${stats.categories}</b><span>Categories</span></div>
        <div class="stat"><b>${stats.registrations}</b><span>Registrations</span></div>
      </div>
    </section>
    <div class="filters">
      <input id="fq" type="search" placeholder="Search events, venues, clubs..." value="${esc(state.q)}">
      <input id="ffrom" type="date" title="From date" value="${state.from}">
      <input id="fto" type="date" title="To date" value="${state.to}">
      <select id="fsort"><option value="date">Sort: Soonest</option><option value="popular">Sort: Most popular</option></select>
      <label class="check"><input type="checkbox" id="favail" ${state.availableOnly ? 'checked' : ''}> Seats available</label>
    </div>
    <div class="chips" id="chips">${['All', ...cats].map(c => `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="results" class="grid"></div>`;
  document.getElementById('fsort').value = state.sort;

  const load = async () => {
    const p = new URLSearchParams({ q: state.q, category: state.category, from: state.from, to: state.to, sort: state.sort, availableOnly: state.availableOnly });
    const list = await api('/api/events?' + p);
    const box = document.getElementById('results');
    box.innerHTML = list.length ? list.map(e => eventCard(e, { reg: mine.reg.has(e.id), owned: mine.created.has(e.id) })).join('') : '<div class="empty" style="grid-column:1/-1">No events match your filters. Try clearing them.</div>';
    startCountdowns();
    box.querySelectorAll('[data-register]').forEach(b => b.onclick = () => openRegister(Number(b.dataset.register)));
    box.querySelectorAll('[data-details]').forEach(b => b.onclick = () => openDetails(Number(b.dataset.details)));
  };
  let deb; const debounced = () => { clearTimeout(deb); deb = setTimeout(load, 250); };
  document.getElementById('fq').oninput = e => { state.q = e.target.value; debounced(); };
  document.getElementById('ffrom').onchange = e => { state.from = e.target.value; load(); };
  document.getElementById('fto').onchange = e => { state.to = e.target.value; load(); };
  document.getElementById('fsort').onchange = e => { state.sort = e.target.value; load(); };
  document.getElementById('favail').onchange = e => { state.availableOnly = e.target.checked; load(); };
  document.getElementById('chips').onclick = e => {
    const c = e.target.dataset.cat; if (!c) return;
    state.category = c;
    document.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x.dataset.cat === c));
    load();
  };
  load();
}

// ---------- calendar (standout feature) ----------
async function renderCalendar() {
  const [events, mine] = await Promise.all([api('/api/events'), getMine()]);
  const f = state.user ? state.calFilter : 'all';
  const shown = f === 'registered' ? events.filter(e => mine.reg.has(e.id)) : f === 'created' ? events.filter(e => mine.created.has(e.id)) : events;
  const d = state.calMonth, y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1), startDow = first.getDay(), days = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toDateString();
  let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(x => `<div class="dow">${x}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div class="day other"></div>';
  for (let day = 1; day <= days; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const evs = shown.filter(e => e.date === iso);
    const pill = e => {
      const mark = mine.reg.has(e.id) ? '✓ ' : mine.created.has(e.id) ? '★ ' : '';
      return `<span class="pill ${esc(e.category)} ${mark ? 'mine' : ''}" data-ev="${e.id}" title="${esc(e.title)}">${mark}${esc(e.emoji)} ${esc(e.title)}</span>`;
    };
    cells += `<div class="day ${new Date(y, m, day).toDateString() === todayStr ? 'today' : ''}"><div class="num">${day}</div>${evs.map(pill).join('')}</div>`;
  }
  const FILTERS = [['all', 'All events'], ['registered', 'My registrations'], ['created', 'Created by me']];
  const empty = f !== 'all' && !shown.length
    ? `<div class="empty">${f === 'registered' ? 'You have not registered for any events yet.' : 'You have not created any events yet.'} <a href="${f === 'registered' ? '#/events' : '#/add'}">${f === 'registered' ? 'Browse events →' : 'Create one →'}</a></div>` : '';
  app.innerHTML = `
    <div class="chips" id="calFilter">${FILTERS.map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div class="cal-head">
      <button class="btn secondary" id="prev">◀ Prev</button>
      <h2>${d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
      <button class="btn secondary" id="next">Next ▶</button>
    </div>
    <div class="cal">${cells}</div>
    ${empty}
    <div class="legend">${CATS.map(c => `<span style="--c:var(--${c})">${c}</span>`).join('')}</div>
    <p class="desc">Click any event to see details${state.user ? '. ✓ = you are registered, ★ = you created it' : '. Log in to see your own events here'}.</p>`;
  document.getElementById('calFilter').onclick = e => {
    const k = e.target.dataset.f; if (!k) return;
    if (k !== 'all' && !state.user) { needLogin({ hash: '#/calendar' }, 'Log in to see your own events'); return; }
    state.calFilter = k; renderCalendar();
  };
  document.getElementById('prev').onclick = () => { state.calMonth = new Date(y, m - 1, 1); renderCalendar(); };
  document.getElementById('next').onclick = () => { state.calMonth = new Date(y, m + 1, 1); renderCalendar(); };
  app.querySelectorAll('[data-ev]').forEach(p => p.onclick = () => openDetails(Number(p.dataset.ev)));
}

// ---------- modals ----------
function closeModal() { modalRoot.innerHTML = ''; }
function showModal(html, cls = '') {
  modalRoot.innerHTML = `<div class="overlay"><div class="modal ${cls}">${html}</div></div>`;
  modalRoot.querySelector('.overlay').onclick = e => { if (e.target.classList.contains('overlay')) closeModal(); };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function openDetails(id) {
  const [e, mine] = await Promise.all([api('/api/events/' + id), getMine()]);
  const reg = mine.reg.has(id);
  showModal(`<span class="badge ${esc(e.category)}">${esc(e.category)}</span>
    <h2>${esc(e.emoji)} ${esc(e.title)}</h2>
    <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span><span>🏛️ ${esc(e.organizer)}</span></div>
    <p>${esc(e.description)}</p>${cdSpan(e)}
    <p class="seats">${e.seatsLeft} of ${e.capacity} seats left</p>
    <div class="row"><button class="btn secondary" id="mClose">Close</button><button class="btn" id="mReg" ${reg || e.seatsLeft <= 0 || e.past ? 'disabled' : ''}>${reg ? 'Registered ✓' : e.past ? 'Ended' : 'Register'}</button></div>`);
  startCountdowns();
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('mReg').onclick = () => openRegister(id);
}

async function openRegister(id) {
  if (!state.user) { closeModal(); needLogin({ type: 'register', id }, 'Log in or sign up to register for events'); return; }
  const e = await api('/api/events/' + id);
  showModal(`<h2>Register: ${esc(e.title)}</h2>
    <p class="meta">📅 ${fmtDate(e)} · ${fmtTime(e)} &nbsp; 📍 ${esc(e.venue)}</p>
    <p class="hint">Registering as <b>${esc(state.user.email)}</b>. Details are pre-filled from your profile; change them here if needed.</p>
    <form id="regForm" novalidate>
      ${profileFields(state.user)}
      <div class="row"><button type="button" class="btn secondary" id="cancel">Cancel</button><button class="btn" id="submit">Confirm registration</button></div>
    </form>`);
  document.getElementById('cancel').onclick = closeModal;
  const form = document.getElementById('regForm');
  const checkAll = formValidator(form, PROFILE_KEYS);

  form.onsubmit = async ev => {
    ev.preventDefault();
    if (!checkAll()) return;
    const body = Object.fromEntries(new FormData(form).entries());
    const btn = document.getElementById('submit'); btn.disabled = true; btn.textContent = 'Registering...';
    try {
      const out = await api(`/api/events/${id}/register`, json('POST', body));
      showConfirmation(out.registration, out.event);
      route();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Confirm registration';
      if (err.status === 401) { closeModal(); sessionExpired({ type: 'register', id }); }
      else if (err.data && err.data.errors) showServerErrors(form, err.data.errors);
      else toast(err.message);
    }
  };
}

// ---------- confirmation screen (standout feature) ----------
function icsFor(reg, e) {
  const s = startOf(e), end = new Date(s.getTime() + 2 * 36e5);
  const z = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CampusConnect//EN', 'BEGIN:VEVENT', `UID:${reg.id}@campusconnect`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(s)}`, `DTEND:${z(end)}`, `SUMMARY:${e.title}`, `LOCATION:${e.venue}`, `DESCRIPTION:Registration ${reg.id}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
function showConfirmation(reg, e) {
  showModal(`<div class="confirm">
    <div class="tick">✓</div>
    <h2>You're registered!</h2>
    <p class="meta">This ticket is saved in your <b>Profile</b>.</p>
    <div class="ticket">
      <div class="meta">Confirmation ID</div><div class="code">${esc(reg.id)}</div>
      <dl>
        <dt>Event</dt><dd>${esc(e.title)}</dd>
        <dt>When</dt><dd>${fmtDate(e)} · ${fmtTime(e)}</dd>
        <dt>Venue</dt><dd>${esc(e.venue)}</dd>
        <dt>Name</dt><dd>${esc(reg.name)}</dd>
        <dt>Roll No.</dt><dd>${esc(reg.rollNo)}</dd>
        <dt>Email</dt><dd>${esc(reg.email)}</dd>
      </dl>
      ${cdSpan(e)}
    </div>
    <div class="row"><button class="btn secondary" id="ics">📅 Add to calendar</button><button class="btn secondary" id="print">🖨️ Print</button><button class="btn" id="done">Done</button></div>
  </div>`);
  startCountdowns();
  document.getElementById('done').onclick = closeModal;
  document.getElementById('print').onclick = () => window.print();
  document.getElementById('ics').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([icsFor(reg, e)], { type: 'text/calendar' }));
    a.download = `${reg.id}.ics`; a.click();
  };
}

// ---------- login & signup ----------
function renderLogin() {
  if (state.user) { location.hash = '#/profile'; return; }
  app.innerHTML = `<div class="panel auth-card"><h2>Welcome back 👋</h2>
    ${state.pending ? '<p class="hint">Log in to continue where you left off.</p>' : ''}
    <form id="loginForm" novalidate>
      ${fld('email', 'Email', 'email', '', 'you@college.edu')}
      ${fld('password', 'Password', 'password')}
      <button class="btn" style="width:100%" id="loginBtn">Log in</button>
    </form>
    <p class="switch">New here? <a href="#/signup">Create an account</a></p></div>`;
  const form = document.getElementById('loginForm');
  const checkAll = formValidator(form, ['email']);
  form.onsubmit = async ev => {
    ev.preventDefault();
    const ok = checkAll();
    if (!form.elements.password.value) { setFieldError(form, 'password', 'Enter your password.'); return; }
    if (!ok) return;
    const btn = document.getElementById('loginBtn'); btn.disabled = true; btn.textContent = 'Logging in...';
    try {
      const out = await api('/api/auth/login', json('POST', { email: form.elements.email.value, password: form.elements.password.value }));
      state.user = out.user; renderNav(); toast('Welcome back, ' + out.user.name.split(' ')[0] + '!'); afterAuth();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Log in';
      setFieldError(form, 'password', err.message);
    }
  };
}

function renderSignup() {
  if (state.user) { location.hash = '#/profile'; return; }
  app.innerHTML = `<div class="panel auth-card"><h2>Create your account 🎓</h2>
    ${state.pending ? '<p class="hint">Sign up to continue where you left off.</p>' : ''}
    <form id="signupForm" novalidate>
      ${fld('name', 'Full name', 'text', '', 'e.g. Aarav Sharma')}
      ${fld('email', 'Email', 'email', '', 'you@college.edu')}
      ${fld('password', 'Password', 'password', '', '', 'autocomplete="new-password"')}
      <div class="hint" style="margin:-8px 0 12px">At least 8 characters, with a letter and a number.</div>
      <div class="two">${fld('rollNo', 'Roll number', 'text', '', 'e.g. 21CS1042')}${fld('phone', 'Mobile number', 'tel', '', '10-digit number')}</div>
      <div class="two">${sel('department', 'Department', DEPTS, '')}${sel('year', 'Year', [1, 2, 3, 4], '')}</div>
      <button class="btn" style="width:100%" id="signupBtn">Sign up</button>
    </form>
    <p class="switch">Already have an account? <a href="#/login">Log in</a></p></div>`;
  const form = document.getElementById('signupForm');
  const checkAll = formValidator(form, ['name', 'email', 'password', ...PROFILE_KEYS.slice(1)]);
  form.onsubmit = async ev => {
    ev.preventDefault();
    if (!checkAll()) return;
    const btn = document.getElementById('signupBtn'); btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const out = await api('/api/auth/signup', json('POST', Object.fromEntries(new FormData(form).entries())));
      state.user = out.user; renderNav(); toast('Account created. Welcome, ' + out.user.name.split(' ')[0] + '!'); afterAuth();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Sign up';
      if (err.data && err.data.errors) showServerErrors(form, err.data.errors); else toast(err.message);
    }
  };
}

// ---------- profile (registered / created / details) ----------
async function renderProfile() {
  if (!state.user) { needLogin({ hash: '#/profile' }, 'Log in to see your profile'); return; }
  let regs, mine;
  try { [regs, mine] = await Promise.all([api('/api/me/registrations'), api('/api/me/events')]); }
  catch (e) { if (e.status === 401) { sessionExpired({ hash: '#/profile' }); return; } throw e; }
  const u = state.user;
  const tabs = [['registered', 'Registered', regs.length], ['created', 'Created', mine.length], ['details', 'Details', null]];
  app.innerHTML = `
    <div class="profile-head">
      <div class="avatar">${esc(u.name[0].toUpperCase())}</div>
      <div class="who"><h2>${esc(u.name)}</h2><div class="sub">${esc(u.email)} · ${esc(u.rollNo)} · ${esc(u.department)}, Year ${esc(u.year)}</div></div>
      <a class="btn" href="#/add">+ Create event</a>
    </div>
    <div class="tabs">${tabs.map(([k, label, n]) => `<button class="tab" data-tab="${k}">${label}${n === null ? '' : `<span class="count">${n}</span>`}</button>`).join('')}</div>
    <div id="tabBody"></div>`;
  const body = document.getElementById('tabBody');

  const draw = tab => {
    state.profileTab = tab;
    app.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    clearInterval(timerHandle);
    if (tab === 'registered') drawRegistered(body, regs);
    else if (tab === 'created') drawCreated(body, mine);
    else drawDetails(body);
  };
  app.querySelectorAll('.tab').forEach(t => t.onclick = () => draw(t.dataset.tab));
  draw(state.profileTab);
}

function drawRegistered(box, regs) {
  if (!regs.length) { box.innerHTML = '<div class="empty">You have not registered for anything yet. <a href="#/events">Browse events →</a></div>'; return; }
  box.innerHTML = `<div class="grid">${regs.map(r => `<article class="card ${r.event.past ? 'past' : ''}">
    <div class="card-top"><span class="badge ${esc(r.event.category)}">${esc(r.event.category)}</span><span class="emoji">${esc(r.event.emoji)}</span></div>
    <h3>${esc(r.event.title)}</h3>
    <div class="meta"><span>📅 ${fmtDate(r.event)} · ${fmtTime(r.event)}</span><span>📍 ${esc(r.event.venue)}</span><span>🎫 ${esc(r.id)}</span></div>
    ${cdSpan(r.event)}
    <div class="row"><button class="btn secondary" data-ticket="${esc(r.id)}">View ticket</button>${r.event.past ? '' : `<button class="btn danger" data-cancel="${esc(r.id)}">Cancel</button>`}</div>
  </article>`).join('')}</div>`;
  startCountdowns();
  box.querySelectorAll('[data-ticket]').forEach(b => b.onclick = async () => {
    try { const o = await api('/api/registrations/' + b.dataset.ticket); showConfirmation(o.registration, o.event); } catch (e) { toast(e.message); }
  });
  box.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('Cancel this registration?')) return;
    try { await api('/api/registrations/' + b.dataset.cancel, { method: 'DELETE' }); toast('Registration cancelled'); renderProfile(); }
    catch (e) { toast(e.message); }
  });
}

function drawCreated(box, mine) {
  if (!mine.length) { box.innerHTML = '<div class="empty">You have not created any events yet. <a href="#/add">Create your first event →</a></div>'; return; }
  box.innerHTML = `<div class="grid">${mine.map(e => {
    const pct = Math.round(e.registered / e.capacity * 100);
    return `<article class="card ${e.past ? 'past' : ''}">
      <div class="card-top"><span class="badge ${esc(e.category)}">${esc(e.category)}</span><span class="emoji">${esc(e.emoji)}</span></div>
      <h3>${esc(e.title)}</h3>
      <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span></div>
      ${cdSpan(e)}
      <div class="bar"><i class="${pct > 85 ? 'low' : ''}" style="width:${pct}%"></i></div>
      <div class="seats">${e.registered} of ${e.capacity} registered</div>
      <div class="row"><button class="btn secondary" data-att="${e.id}">Attendees</button><button class="btn secondary" data-edit="${e.id}">Edit</button><button class="btn danger" data-del="${e.id}">Delete</button></div>
    </article>`; }).join('')}</div>`;
  startCountdowns();
  box.querySelectorAll('[data-att]').forEach(b => b.onclick = () => openAttendees(mine.find(e => e.id === Number(b.dataset.att))));
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditEvent(mine.find(e => e.id === Number(b.dataset.edit))));
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const e = mine.find(x => x.id === Number(b.dataset.del));
    const warn = e.registered ? `\n\n${e.registered} registered student(s) will lose their tickets.` : '';
    if (!confirm(`Delete "${e.title}"?${warn}`)) return;
    try { await api('/api/events/' + e.id, { method: 'DELETE' }); toast('Event deleted'); renderProfile(); }
    catch (err) { toast(err.message); }
  });
}

function drawDetails(box) {
  const u = state.user;
  box.innerHTML = `<form id="detailsForm" class="panel" style="max-width:560px" novalidate>
    <div class="field"><label>Email</label><input value="${esc(u.email)}" disabled><div class="hint">Your email is your login and cannot be changed.</div></div>
    ${profileFields(u)}
    <button class="btn">Save changes</button></form>`;
  const form = document.getElementById('detailsForm');
  const checkAll = formValidator(form, PROFILE_KEYS);
  form.onsubmit = async ev => {
    ev.preventDefault();
    if (!checkAll()) return;
    try {
      const out = await api('/api/auth/me', json('PATCH', Object.fromEntries(new FormData(form).entries())));
      state.user = out.user; renderNav(); toast('Profile updated'); renderProfile();
    } catch (err) {
      if (err.status === 401) sessionExpired({ hash: '#/profile' });
      else if (err.data && err.data.errors) showServerErrors(form, err.data.errors);
      else toast(err.message);
    }
  };
}

async function openAttendees(e) {
  let list;
  try { list = await api(`/api/events/${e.id}/attendees`); } catch (err) { toast(err.message); return; }
  const rows = list.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.rollNo)}</td><td>${esc(a.email)}</td><td>${esc(a.phone)}</td><td>${esc(a.department)}</td><td>${esc(a.year)}</td></tr>`).join('');
  showModal(`<h2>Attendees <span class="pill-note">${list.length} of ${e.capacity}</span></h2><p class="meta">${esc(e.title)}</p>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Roll no.</th><th>Email</th><th>Mobile</th><th>Dept</th><th>Year</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No registrations yet.</div>'}
    <div class="row end">${list.length ? '<button class="btn secondary" id="csv">⬇ Download CSV</button>' : ''}<button class="btn" id="aClose">Close</button></div>`, 'wide');
  document.getElementById('aClose').onclick = closeModal;
  const csvBtn = document.getElementById('csv');
  if (csvBtn) csvBtn.onclick = () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [['Name', 'Roll no', 'Email', 'Mobile', 'Department', 'Year', 'Ticket ID'], ...list.map(a => [a.name, a.rollNo, a.email, a.phone, a.department, a.year, a.id])].map(r => r.map(q).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `attendees-${e.id}.csv`; link.click();
  };
}

// ---------- create / edit event (login required) ----------
// time is picked with three dropdowns (hour, minute, AM/PM) instead of the browser's confusing time box
function timeField(val) {
  let h = '', m = '', p = '';
  const mt = /^(\d{2}):(\d{2})$/.exec(val || '');
  if (mt) { const H = Number(mt[1]); p = H >= 12 ? 'PM' : 'AM'; h = String(H % 12 || 12); m = mt[2]; }
  const mins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  if (m && !mins.includes(m)) { mins.push(m); mins.sort(); }
  const opt = (v, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${v}</option>`;
  return `<div class="field" data-f="time"><label>Time</label><div class="timepick">
    <select name="th" aria-label="Hour"><option value="">Hr</option>${Array.from({ length: 12 }, (_, i) => opt(i + 1, h)).join('')}</select><span>:</span>
    <select name="tm" aria-label="Minute"><option value="">Min</option>${mins.map(x => opt(x, m)).join('')}</select>
    <select name="tp" aria-label="AM or PM"><option value="">AM/PM</option>${opt('AM', p)}${opt('PM', p)}</select>
  </div><div class="err"></div></div>`;
}
// reads an event form and turns the three time dropdowns into one "HH:MM" (24-hour) value for the API
function collectEventForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const { th, tm, tp } = data; delete data.th; delete data.tm; delete data.tp;
  if (th && tm !== '' && tp) data.time = String((Number(th) % 12) + (tp === 'PM' ? 12 : 0)).padStart(2, '0') + ':' + tm;
  else data.time = '';
  return data;
}
const todayISO = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the visitor's own timezone

function eventFields(v = {}, { minDate = '' } = {}) {
  return `${fld('title', 'Event title', 'text', v.title)}
    <div class="two"><div class="field" data-f="category"><label>Category</label><select name="category">${CATS.map(c => `<option ${v.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select><div class="err"></div></div>${fld('capacity', 'Capacity', 'number', v.capacity, '', 'min="1" max="5000"')}</div>
    <div class="two">${fld('date', 'Date', 'date', v.date, '', minDate ? `min="${minDate}"` : '')}${timeField(v.time)}</div>
    <div class="two">${fld('venue', 'Venue', 'text', v.venue)}${fld('organizer', 'Organizer / club', 'text', v.organizer)}</div>
    <div class="field" data-f="description"><label>Description</label><textarea name="description" rows="3">${esc(v.description || '')}</textarea><div class="err"></div></div>`;
}
const clearErrors = form => form.querySelectorAll('.field').forEach(w => { w.classList.remove('invalid'); const e = w.querySelector('.err'); if (e) e.textContent = ''; });

function renderAddEvent() {
  if (!state.user) { needLogin({ hash: '#/add' }, 'Log in or sign up to create an event'); return; }
  app.innerHTML = `<section class="hero"><h1>Create an event 📣</h1><p>Publish a workshop, competition or fest. You can edit it and see who registered from your profile.</p></section>
  <form id="addForm" class="panel" novalidate style="max-width:640px">${eventFields({ organizer: '' }, { minDate: todayISO() })}<button class="btn">Publish event</button></form>`;
  const form = document.getElementById('addForm');
  form.onsubmit = async ev => {
    ev.preventDefault(); clearErrors(form);
    try {
      const out = await api('/api/events', json('POST', collectEventForm(form)));
      toast('Event published: ' + out.title);
      state.profileTab = 'created'; location.hash = '#/profile';
    } catch (err) {
      if (err.status === 401) sessionExpired({ hash: '#/add' });
      else if (err.data && err.data.errors) showServerErrors(form, err.data.errors);
      else toast(err.message);
    }
  };
}

function openEditEvent(e) {
  showModal(`<h2>Edit event</h2><form id="editForm" novalidate>${eventFields(e)}
    <div class="row"><button type="button" class="btn secondary" id="eCancel">Cancel</button><button class="btn">Save changes</button></div></form>`);
  document.getElementById('eCancel').onclick = closeModal;
  const form = document.getElementById('editForm');
  form.onsubmit = async ev => {
    ev.preventDefault(); clearErrors(form);
    try {
      await api('/api/events/' + e.id, json('PATCH', collectEventForm(form)));
      closeModal(); toast('Event updated'); renderProfile();
    } catch (err) {
      if (err.data && err.data.errors) showServerErrors(form, err.data.errors); else toast(err.message);
    }
  };
}
