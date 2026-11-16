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
const TZ = { timeZone: 'Asia/Kolkata' }; // event times are campus-local
const startOf = ev => new Date(`${ev.date}T${ev.time}:00+05:30`);
const fmtDate = ev => startOf(ev).toLocaleDateString('en-IN', { ...TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = ev => startOf(ev).toLocaleTimeString('en-IN', { ...TZ, hour: 'numeric', minute: '2-digit' });
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
  const tick = () => {
    document.querySelectorAll('[data-cd]').forEach(el => {
      const c = countdownText({ date: el.dataset.date, time: el.dataset.time });
      el.textContent = c.text; el.classList.toggle('past', c.past);
    });
    document.querySelectorAll('[data-big]').forEach(el => {
      const diff = Math.max(0, startOf({ date: el.dataset.date, time: el.dataset.time }) - Date.now());
      const vals = [Math.floor(diff / 864e5), Math.floor(diff % 864e5 / 36e5), Math.floor(diff % 36e5 / 6e4), Math.floor(diff % 6e4 / 1e3)];
      el.querySelectorAll('b').forEach((b, i) => {
        const t = String(vals[i]).padStart(2, '0');
        if (b.textContent !== t) { b.textContent = t; b.classList.remove('flip'); void b.offsetWidth; b.classList.add('flip'); }
      });
    });
  };
  tick(); timerHandle = setInterval(tick, 1000);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const stub = ev => { const [, mo, d] = ev.date.split('-'); return `<span class="dt" aria-hidden="true"><b>${Number(d)}</b><i>${MONTHS[Number(mo) - 1]}</i></span>`; };
const isOrg = () => !!state.user && state.user.role === 'organizer';
let lastHash = null;
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
  organization: v => /^[A-Za-z0-9][A-Za-z0-9 &.,'()-]{1,59}$/.test(v.trim()) || 'Enter your club, committee or department name.',
  department: v => !!v || 'Select your department.',
  year: v => !!v || 'Select your year.'
};
const PROFILE_KEYS = ['name', 'rollNo', 'phone', 'department', 'year'];
const ORG_KEYS = ['name', 'organization', 'phone'];
const keysFor = role => role === 'organizer' ? ORG_KEYS : PROFILE_KEYS;

// form building blocks shared by signup, registration, profile and event forms
let uid = 0;
function fld(k, label, type = 'text', val = '', ph = '', extra = '') {
  const id = 'f' + (++uid);
  return `<div class="field" data-f="${k}"><label for="${id}">${label}</label><input id="${id}" name="${k}" type="${type}" placeholder="${esc(ph)}" value="${esc(val)}" ${extra}><div class="err"></div></div>`;
}
function sel(k, label, opts, val) {
  const id = 'f' + (++uid);
  return `<div class="field" data-f="${k}"><label for="${id}">${label}</label><select id="${id}" name="${k}"><option value="">Select</option>${opts.map(o => `<option ${String(val) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select><div class="err"></div></div>`;
}
const profileFields = (v = {}, role = 'student') => role === 'organizer' ?
  fld('name', 'Full name', 'text', v.name, 'e.g. Aarav Sharma') + fld('organization', 'Club / committee / department', 'text', v.organization, 'e.g. Coding Club') + fld('phone', 'Mobile number', 'tel', v.phone, '10-digit number') :
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
function setWallet(n) {
  const w = document.getElementById('wallet'), c = w.querySelector('.wcount');
  w.hidden = !(state.user && state.user.role !== 'organizer');
  c.textContent = n; c.hidden = !n;
}
async function refreshWallet() {
  if (!state.user || isOrg()) return setWallet(0);
  try { setWallet((await api('/api/me/registrations')).filter(r => !r.event.past).length); } catch {}
}
function renderNav() {
  const u = state.user;
  document.getElementById('authArea').innerHTML = u
    ? `<a href="#/profile" data-nav="profile" class="nav-user"><span class="mini-avatar">${esc(u.name[0].toUpperCase())}</span>${esc(u.name.split(' ')[0])}</a><a href="#" id="logoutLink">Log out</a>`
    : `<a href="#/login" data-nav="login">Log in</a><a href="#/signup" data-nav="signup" class="nav-cta">Sign up</a>`;
  document.getElementById('addNav').hidden = !isOrg();
  if (state.user && !isOrg()) refreshWallet(); else setWallet(0);
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
  const keepY = hash === lastHash ? window.scrollY : 0;
  lastHash = hash;
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
    app.innerHTML = `<div class="empty">Could not load data: ${esc(e.message)}<br>Is the server running?</div>`;
  }
  window.scrollTo(0, keepY);
}
window.addEventListener('hashchange', route);
window.addEventListener('load', async () => { await loadUser(); route(); });

// ---------- events page ----------
// students register; organizers manage their own events and get no register button
function actionBtn(e, { reg, owned, full }) {
  if (isOrg()) return owned ? '<button class="btn" data-manage>Manage</button>' : '';
  return `<button class="btn" data-register="${e.id}" ${reg || full || e.past ? 'disabled' : ''}>${reg ? 'Registered ✓' : e.past ? 'Ended' : full ? 'Full' : 'Register'}</button>`;
}
// one dot per seat (scaled down to 30 dots for big halls); the newest booking glows
function seatDots(e) {
  const N = Math.min(e.capacity, 30);
  const on = e.registered ? Math.min(N, Math.max(1, Math.round(e.registered / e.capacity * N))) : 0;
  let h = '';
  for (let i = 0; i < N; i++) h += `<i class="${i < on ? 'on' : ''}${i === on - 1 && !e.past ? ' last' : ''}" style="--i:${i}"></i>`;
  return `<div class="seatdots ${e.registered / e.capacity > .85 ? 'low' : ''}" role="img" aria-label="${e.registered} of ${e.capacity} seats taken">${h}</div>`;
}
function eventCard(e, { reg = false, owned = false } = {}) {
  const pct = Math.round(e.registered / e.capacity * 100);
  const full = e.seatsLeft <= 0;
  const hot = !e.past && !full && e.seatsLeft <= Math.max(3, e.capacity * .1);
  return `<article class="card ${e.past ? 'past' : ''}" style="--c:var(--${esc(e.category)})">
    <div class="card-top"><span><span class="badge ${esc(e.category)}">${esc(e.category)}</span>${owned ? '<span class="pill-note">Your event</span>' : ''}</span>${stub(e)}</div>
    <h3><span class="emoji">${esc(e.emoji)}</span> ${esc(e.title)}</h3>
    <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span><span>🏛️ ${esc(e.organizer)}</span></div>
    <p class="desc">${esc(e.description)}</p>
    ${cdSpan(e)}
    ${seatDots(e)}
    <div class="seats ${hot ? 'hot' : ''}">${e.past ? 'Event has ended' : full ? 'Fully booked' : hot ? `Only ${e.seatsLeft} seat${e.seatsLeft === 1 ? '' : 's'} left` : `${e.seatsLeft} of ${e.capacity} seats left`}</div>
    <div class="row">
      <button class="btn secondary" data-details="${e.id}">Details</button>
      ${actionBtn(e, { reg, owned, full })}
    </div>
  </article>`;
}

async function renderEvents() {
  const [cats, all, mine] = await Promise.all([api('/api/categories'), api('/api/events'), getMine()]);
  const next = all.find(e => !e.past);
  const base = new Date(todayISO() + 'T00:00:00Z');
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getTime() + i * 864e5), iso = d.toISOString().slice(0, 10);
    const evs = all.filter(e => e.date === iso && !e.past);
    return `<div class="wd ${i === 0 ? 'today' : ''}"><small>${i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</small><b>${d.getUTCDate()}</b><div class="wdots">${evs.slice(0, 4).map(e => `<button type="button" class="wdot" style="--c:var(--${esc(e.category)})" data-ev="${e.id}" title="${esc(e.title)}" aria-label="${esc(e.title)}"></button>`).join('')}${evs.length > 4 ? `<small>+${evs.length - 4}</small>` : ''}</div></div>`;
  }).join('');
  app.innerHTML = `
    <section class="hero">
      <h1>Find your next<br>campus event.</h1>
      <p>Workshops, competitions and fests. Pick one, get a ticket in seconds.</p>
      <div class="next">
        ${next ? `<div class="next-label">Next up: <b>${esc(next.emoji)} ${esc(next.title)}</b></div>
        <div class="digits" data-big data-date="${esc(next.date)}" data-time="${esc(next.time)}" role="timer" aria-label="Time until ${esc(next.title)}">${['days', 'hrs', 'min', 'sec'].map(l => `<div class="dg"><b>00</b><span>${l}</span></div>`).join('')}</div>` : '<div class="next-label">No upcoming events yet. Check back soon.</div>'}
      </div>
      <div class="week" aria-label="Events this week">${week}</div>
    </section>
    <div class="filters">
      <input id="fq" aria-label="Search events" type="search" placeholder="Search events, venues, clubs..." value="${esc(state.q)}">
      <input id="ffrom" type="date" title="From date" value="${state.from}">
      <input id="fto" type="date" title="To date" value="${state.to}">
      <select id="fsort"><option value="date">Sort: Soonest</option><option value="popular">Sort: Most popular</option></select>
      <label class="check"><input type="checkbox" id="favail" ${state.availableOnly ? 'checked' : ''}> Seats available</label>
    </div>
    <div class="chips" id="chips">${['All', ...cats].map(c => `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="results" class="grid"></div>`;
  document.getElementById('fsort').value = state.sort;
  app.querySelectorAll('.wdot').forEach(b => b.onclick = () => openDetails(Number(b.dataset.ev)));

  let reqId = 0;
  const load = async () => {
    const p = new URLSearchParams({ q: state.q, category: state.category, from: state.from, to: state.to, sort: state.sort, availableOnly: state.availableOnly });
    const my = ++reqId;
    const list = await api('/api/events?' + p);
    if (my !== reqId) return; // a newer search already replaced this one
    const box = document.getElementById('results');
    box.innerHTML = list.length ? list.map(e => eventCard(e, { reg: mine.reg.has(e.id), owned: mine.created.has(e.id) })).join('') : '<div class="empty" style="grid-column:1/-1">No events match your filters. Try clearing them.</div>';
    startCountdowns();
    box.querySelectorAll('[data-register]').forEach(b => b.onclick = () => openRegister(Number(b.dataset.register)));
    box.querySelectorAll('[data-details]').forEach(b => b.onclick = () => openDetails(Number(b.dataset.details)));
    box.querySelectorAll('[data-manage]').forEach(b => b.onclick = () => { state.profileTab = 'created'; location.hash = '#/profile'; });
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
  await load();
}

// ---------- calendar (standout feature) ----------
async function renderCalendar() {
  const [events, mine] = await Promise.all([api('/api/events'), getMine()]);
  const FILTERS = [['all', 'All events'], ...(isOrg() ? [['created', 'Created by me']] : state.user ? [['registered', 'My registrations']] : [])];
  const f = FILTERS.some(([k]) => k === state.calFilter) ? state.calFilter : 'all';
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
      return `<button type="button" class="pill ${esc(e.category)} ${mark ? 'mine' : ''}" data-ev="${e.id}" title="${esc(e.title)}">${mark}${esc(e.emoji)} ${esc(e.title)}</button>`;
    };
    cells += `<div class="day ${new Date(y, m, day).toDateString() === todayStr ? 'today' : ''}"><div class="num">${day}</div>${evs.slice(0, 2).map(pill).join('')}${evs.length > 2 ? `<button type="button" class="pill more" data-day="${iso}">+${evs.length - 2} more</button>` : ''}</div>`;
  }
  const empty = f !== 'all' && !shown.length
    ? `<div class="empty">${f === 'registered' ? 'You have not registered for any events yet.' : 'You have not created any events yet.'} <a href="${f === 'registered' ? '#/events' : '#/add'}">${f === 'registered' ? 'Browse events →' : 'Create one →'}</a></div>` : '';
  app.innerHTML = `
    ${FILTERS.length > 1 ? `<div class="chips" id="calFilter">${FILTERS.map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>` : ''}
    <div class="cal-head">
      <button class="btn secondary" id="prev">◀ Prev</button>
      <h2>${d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
      <button class="btn secondary" id="next">Next ▶</button>
    </div>
    <div class="cal">${cells}</div>
    ${empty}
    <div class="legend">${CATS.map(c => `<span style="--c:var(--${c})">${c}</span>`).join('')}</div>
    <p class="desc">Click any event to see details${isOrg() ? ' (★ marks events you created)' : state.user ? ' (✓ marks events you registered for)' : ''}.</p>`;
  const cf = document.getElementById('calFilter');
  if (cf) cf.onclick = e => {
    const k = e.target.dataset.f; if (!k) return;
    if (k !== 'all' && !state.user) { needLogin({ hash: '#/calendar' }, 'Log in to see your own events'); return; }
    state.calFilter = k; renderCalendar();
  };
  document.getElementById('prev').onclick = () => { state.calMonth = new Date(y, m - 1, 1); renderCalendar(); };
  document.getElementById('next').onclick = () => { state.calMonth = new Date(y, m + 1, 1); renderCalendar(); };
  app.querySelectorAll('[data-ev]').forEach(p => p.onclick = () => openDetails(Number(p.dataset.ev)));
  app.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day, shown));
}
function openDay(iso, list) {
  const evs = list.filter(e => e.date === iso);
  const title = new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  showModal(`<h2>${title}</h2><div class="daylist">${evs.map(e => `<button type="button" class="pill ${esc(e.category)}" data-ev="${e.id}">${esc(e.emoji)} ${esc(fmtTime(e))} · ${esc(e.title)}</button>`).join('')}</div><div class="row end"><button class="btn" id="dClose">Close</button></div>`);
  modalRoot.querySelectorAll('[data-ev]').forEach(p => p.onclick = () => openDetails(Number(p.dataset.ev)));
  document.getElementById('dClose').onclick = closeModal;
}

// ---------- modals ----------
function closeModal() { modalRoot.innerHTML = ''; }
function showModal(html, cls = '') {
  modalRoot.innerHTML = `<div class="overlay"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  modalRoot.querySelector('.overlay').onclick = e => { if (e.target.classList.contains('overlay')) closeModal(); };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function openDetails(id) {
  const [e, mine] = await Promise.all([api('/api/events/' + id), getMine()]);
  const reg = mine.reg.has(id);
  const primary = isOrg()
    ? (mine.created.has(id) ? '<button class="btn" id="mManage">Manage</button>' : '')
    : `<button class="btn" id="mReg" ${reg || e.seatsLeft <= 0 || e.past ? 'disabled' : ''}>${reg ? 'Registered ✓' : e.past ? 'Ended' : e.seatsLeft <= 0 ? 'Full' : 'Register'}</button>`;
  showModal(`<span class="badge ${esc(e.category)}">${esc(e.category)}</span>
    <h2>${esc(e.emoji)} ${esc(e.title)}</h2>
    <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span><span>🏛️ ${esc(e.organizer)}</span></div>
    <p>${esc(e.description)}</p>${cdSpan(e)}
    <p class="seats">${e.seatsLeft} of ${e.capacity} seats left</p>
    <div class="row"><button class="btn secondary" id="mClose">Close</button>${primary}</div>`);
  startCountdowns();
  document.getElementById('mClose').onclick = closeModal;
  const mr = document.getElementById('mReg'); if (mr) mr.onclick = () => openRegister(id);
  const mm = document.getElementById('mManage'); if (mm) mm.onclick = () => { closeModal(); state.profileTab = 'created'; location.hash = '#/profile'; };
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
      showConfirmation(out.registration, out.event, true);
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
const icsText = t => String(t).replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
function icsFor(reg, e) {
  const s = startOf(e), end = new Date(s.getTime() + 2 * 36e5);
  const z = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CampusConnect//EN', 'BEGIN:VEVENT', `UID:${reg.id}@campusconnect`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(s)}`, `DTEND:${z(end)}`, `SUMMARY:${icsText(e.title)}`, `LOCATION:${icsText(e.venue)}`, `DESCRIPTION:Registration ${reg.id}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="Ticket QR code"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#12142b"/></svg>`;
}
// the torn-off stub is copied, flies to "My tickets" in the nav, and the counter bumps
function flyStub() {
  const stub = document.querySelector('.tix-stub'), w = document.getElementById('wallet');
  const bump = () => refreshWallet().then(() => { w.classList.remove('bump'); void w.offsetWidth; w.classList.add('bump'); });
  const b = w.getBoundingClientRect();
  if (!stub || w.hidden || !b.width || matchMedia('(prefers-reduced-motion: reduce)').matches) { bump(); return; }
  const a = stub.getBoundingClientRect(), W = stub.offsetWidth, H = stub.offsetHeight;
  const g = stub.cloneNode(true);
  g.classList.add('flyer'); g.classList.remove('gone');
  g.style.setProperty('--c', getComputedStyle(stub).getPropertyValue('--c'));
  Object.assign(g.style, { left: a.left + a.width / 2 - W / 2 + 'px', top: a.top + a.height / 2 - H / 2 + 'px', width: W + 'px', height: H + 'px' });
  document.body.append(g); document.body.classList.add('flying'); stub.classList.add('gone');
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  g.animate([
    { transform: 'translate(0,0) rotate(6deg) scale(1)' },
    { transform: `translate(${dx * .35}px, ${dy * .35 + 40}px) rotate(-14deg) scale(1.1)`, offset: .4 },
    { transform: `translate(${dx}px, ${dy}px) rotate(24deg) scale(.12)`, opacity: .8 }
  ], { duration: 850, easing: 'cubic-bezier(.55,0,.3,1)', fill: 'forwards' }).onfinish = () => {
    g.remove(); bump(); setTimeout(() => document.body.classList.remove('flying'), 450);
  };
}
function showConfirmation(reg, e, fresh = false) {
  let qr = ''; try { qr = qrSvg(`CAMPUSCONNECT|${reg.id}|${e.id}`); } catch {}
  showModal(`<div class="confirm">
    <div class="tick">✓</div>
    <h2>${fresh ? "You're registered!" : 'Your ticket'}</h2>
    <p class="note">Show the QR code at the door. A copy is kept in <b>My tickets</b>.</p>
    <div class="tix ${fresh ? 'fresh' : ''}" style="--c:var(--${esc(e.category)})">
      <div class="tix-main">
        <div class="tix-info">
          <h3>${esc(e.emoji)} ${esc(e.title)}</h3>
          <dl>
            <dt>When</dt><dd>${fmtDate(e)} · ${fmtTime(e)}</dd>
            <dt>Venue</dt><dd>${esc(e.venue)}</dd>
            <dt>Name</dt><dd>${esc(reg.name)}</dd>
            <dt>Roll No.</dt><dd>${esc(reg.rollNo)}</dd>
            <dt>Email</dt><dd>${esc(reg.email)}</dd>
          </dl>
          ${cdSpan(e)}
        </div>
        ${qr ? `<div class="qr">${qr}<span>${esc(reg.id)}</span></div>` : ''}
      </div>
      <div class="tix-stub"><b>ADMIT ONE</b><span>${esc(reg.id)}</span></div>
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
  if (fresh) setTimeout(flyStub, 1600);
}

// ---------- login & signup ----------
function renderLogin() {
  if (state.user) { location.hash = '#/profile'; return; }
  app.innerHTML = `<div class="panel auth-card"><h2>Log in</h2>
    ${state.pending ? '<p class="hint">Log in to continue where you left off.</p>' : ''}
    <form id="loginForm" novalidate>
      ${fld('email', 'Email', 'email', '', 'you@college.edu', 'autocomplete="email"')}
      ${fld('password', 'Password', 'password', '', '', 'autocomplete="current-password"')}
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
  const ROLES = [['student', 'Student', 'Find events and register for them.'], ['organizer', 'Organizer', 'Create and manage events for a club or department.']];
  app.innerHTML = `<div class="panel auth-card"><h2>Create your account</h2>
    ${state.pending ? '<p class="hint">Sign up to continue where you left off.</p>' : ''}
    <form id="signupForm" novalidate>
      <div class="roles" role="radiogroup" aria-label="Account type">${ROLES.map(([k, t, d], i) => `<label class="role"><input type="radio" name="role" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
      ${fld('name', 'Full name', 'text', '', 'e.g. Aarav Sharma')}
      ${fld('email', 'Email', 'email', '', 'you@college.edu', 'autocomplete="email"')}
      ${fld('password', 'Password', 'password', '', '', 'autocomplete="new-password"')}
      <div class="hint" style="margin:-8px 0 12px">At least 8 characters, with a letter and a number.</div>
      <div id="roleFields"></div>
      <button class="btn" style="width:100%" id="signupBtn">Sign up</button>
    </form>
    <p class="switch">Already have an account? <a href="#/login">Log in</a></p></div>`;
  const form = document.getElementById('signupForm');
  let checkAll;
  const drawRole = () => {
    const role = form.elements.role.value;
    document.getElementById('roleFields').innerHTML = role === 'organizer'
      ? fld('organization', 'Club / committee / department', 'text', '', 'e.g. Coding Club') + fld('phone', 'Mobile number', 'tel', '', '10-digit number')
      : `<div class="two">${fld('rollNo', 'Roll number', 'text', '', 'e.g. 21CS1042')}${fld('phone', 'Mobile number', 'tel', '', '10-digit number')}</div><div class="two">${sel('department', 'Department', DEPTS, '')}${sel('year', 'Year', [1, 2, 3, 4], '')}</div>`;
    checkAll = formValidator(form, ['name', 'email', 'password', ...keysFor(role).slice(1)]);
  };
  form.querySelectorAll('[name="role"]').forEach(r => r.onchange = drawRole);
  drawRole();
  form.onsubmit = async ev => {
    ev.preventDefault();
    if (!checkAll()) return;
    const btn = document.getElementById('signupBtn'); btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const out = await api('/api/auth/signup', json('POST', Object.fromEntries(new FormData(form).entries())));
      state.user = out.user; state.profileTab = isOrg() ? 'created' : 'registered'; renderNav(); toast('Account created. Welcome, ' + out.user.name.split(' ')[0] + '!'); afterAuth();
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
  setWallet(regs.filter(r => !r.event.past).length);
  const u = state.user;
  const org = isOrg();
  const allowed = org ? ['created', 'details'] : ['registered', 'details'];
  if (!allowed.includes(state.profileTab)) state.profileTab = allowed[0];
  const tabs = (org ? [['created', 'Created', mine.length]] : [['registered', 'Registered', regs.length]]).concat([['details', 'Details', null]]);
  app.innerHTML = `
    <div class="profile-head">
      <div class="avatar">${esc(u.name[0].toUpperCase())}</div>
      <div class="who"><h2>${esc(u.name)} <span class="pill-note">${org ? 'Organizer' : 'Student'}</span></h2><div class="sub">${org ? `${esc(u.email)} · ${esc(u.organization || '')}` : `${esc(u.email)} · ${esc(u.rollNo)} · ${esc(u.department)}, Year ${esc(u.year)}`}</div></div>
      ${org ? '<a class="btn" href="#/add">Create event</a>' : '<a class="btn" href="#/events">Browse events</a>'}
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
  box.innerHTML = `<div class="grid">${regs.map(r => `<article class="card ${r.event.past ? 'past' : ''}" style="--c:var(--${esc(r.event.category)})">
    <div class="card-top"><span class="badge ${esc(r.event.category)}">${esc(r.event.category)}</span>${stub(r.event)}</div>
    <h3><span class="emoji">${esc(r.event.emoji)}</span> ${esc(r.event.title)}</h3>
    <div class="meta"><span>📅 ${fmtDate(r.event)} · ${fmtTime(r.event)}</span><span>📍 ${esc(r.event.venue)}</span></div>
    ${cdSpan(r.event)}
    <div class="seats">Ticket ${esc(r.id)}</div>
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
    return `<article class="card ${e.past ? 'past' : ''}" style="--c:var(--${esc(e.category)})">
      <div class="card-top"><span class="badge ${esc(e.category)}">${esc(e.category)}</span>${stub(e)}</div>
      <h3><span class="emoji">${esc(e.emoji)}</span> ${esc(e.title)}</h3>
      <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span></div>
      ${cdSpan(e)}
      ${seatDots(e)}
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
    ${profileFields(u, u.role)}
    <button class="btn">Save changes</button></form>`;
  const form = document.getElementById('detailsForm');
  const checkAll = formValidator(form, keysFor(u.role));
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
    const q = v => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; }; // blocks spreadsheet formula injection
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
const todayISO = () => new Date().toLocaleDateString('en-CA', TZ); // YYYY-MM-DD in the visitor's own timezone

function eventFields(v = {}, { minDate = '' } = {}) {
  return `${fld('title', 'Event title', 'text', v.title)}
    <div class="two"><div class="field" data-f="category"><label>Category</label><select name="category">${CATS.map(c => `<option ${v.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select><div class="err"></div></div>${fld('capacity', 'Capacity', 'number', v.capacity, '', 'min="1" max="5000"')}</div>
    <div class="two">${fld('date', 'Date', 'date', v.date, '', minDate ? `min="${minDate}"` : '')}${timeField(v.time)}</div>
    <div class="two">${fld('venue', 'Venue', 'text', v.venue)}${fld('organizer', 'Organizer / club', 'text', v.organizer)}</div>
    <div class="field" data-f="description"><label>Description</label><textarea name="description" rows="3">${esc(v.description || '')}</textarea><div class="err"></div></div>`;
}
const clearErrors = form => form.querySelectorAll('.field').forEach(w => { w.classList.remove('invalid'); const e = w.querySelector('.err'); if (e) e.textContent = ''; });

function renderAddEvent() {
  if (!state.user) { needLogin({ hash: '#/add' }, 'Log in or sign up as an organizer to create events'); return; }
  if (!isOrg()) { toast('Only organizer accounts can create events'); location.hash = '#/events'; return; }
  app.innerHTML = `<section class="hero"><h1>Create an event</h1><p>Publish a workshop, competition or fest. You can edit it and see who registered from your profile.</p></section>
  <form id="addForm" class="panel" novalidate style="max-width:640px">${eventFields({ organizer: state.user.organization || '' }, { minDate: todayISO() })}<button class="btn">Publish event</button></form>`;
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

// ---------- holographic tilt on cards (mouse only, skipped for reduced motion) ----------
document.getElementById('wallet').addEventListener('click', () => { state.profileTab = 'registered'; });
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let hot = null;
  const calm = c => { if (!c) return; c.classList.remove('tilt'); c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); };
  document.addEventListener('pointermove', ev => {
    const c = ev.target.closest ? ev.target.closest('.card') : null;
    if (hot && hot !== c) { calm(hot); hot = null; }
    if (!c || c.classList.contains('past')) return;
    if (!c.querySelector('.foil')) c.insertAdjacentHTML('beforeend', '<i class="foil" aria-hidden="true"></i>');
    const r = c.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height, pc = v => (v * 100).toFixed(1) + '%';
    c.style.setProperty('--ry', ((px - .5) * 12).toFixed(2) + 'deg');
    c.style.setProperty('--rx', ((.5 - py) * 9).toFixed(2) + 'deg');
    c.style.setProperty('--mx', pc(px)); c.style.setProperty('--my', pc(py));
    c.style.setProperty('--bx', pc(px)); c.style.setProperty('--by', pc(py));
    c.classList.add('tilt'); hot = c;
  });
  document.addEventListener('mouseleave', () => { calm(hot); hot = null; });
}
