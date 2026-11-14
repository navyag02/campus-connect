/* CampusConnect front-end: hash-routed single page app talking to the Express API */
const app = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const CATS = ['Workshop', 'Competition', 'Cultural', 'Sports', 'Seminar'];
const DEPTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Electrical', 'Management', 'Other'];
let timerHandle = null;
const state = { q: '', category: 'All', from: '', to: '', sort: 'date', availableOnly: false, calMonth: new Date() };

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
const getEmail = () => localStorage.getItem('cc_email') || '';
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

// ---------- router ----------
async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'events';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === hash.split('/')[0]));
  clearInterval(timerHandle);
  try {
    if (hash.startsWith('calendar')) await renderCalendar();
    else if (hash.startsWith('my-events')) await renderMyEvents();
    else if (hash.startsWith('add')) renderAddEvent();
    else await renderEvents();
  } catch (e) {
    app.innerHTML = `<div class="empty">⚠️ Could not load data: ${esc(e.message)}<br>Is the server running?</div>`;
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// ---------- events page ----------
function eventCard(e, { mine } = {}) {
  const pct = Math.round(e.registered / e.capacity * 100);
  const full = e.seatsLeft <= 0;
  return `<article class="card">
    <div class="card-top"><span class="badge ${esc(e.category)}">${esc(e.category)}</span><span class="emoji">${esc(e.emoji)}</span></div>
    <h3>${esc(e.title)}</h3>
    <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span><span>🏛️ ${esc(e.organizer)}</span></div>
    <p class="desc">${esc(e.description)}</p>
    ${cdSpan(e)}
    <div class="bar"><i class="${pct > 85 ? 'low' : ''}" style="width:${pct}%"></i></div>
    <div class="seats">${full ? 'Fully booked' : `${e.seatsLeft} of ${e.capacity} seats left`}</div>
    <div class="row">
      <button class="btn secondary" data-details="${e.id}">Details</button>
      <button class="btn" data-register="${e.id}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Register'}</button>
    </div>
  </article>`;
}

async function renderEvents() {
  const [cats, stats] = await Promise.all([api('/api/categories'), api('/api/stats')]);
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
    box.innerHTML = list.length ? list.map(e => eventCard(e)).join('') : '<div class="empty" style="grid-column:1/-1">No events match your filters. Try clearing them.</div>';
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
  const events = await api('/api/events');
  const d = state.calMonth, y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1), startDow = first.getDay(), days = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toDateString();
  let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(x => `<div class="dow">${x}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div class="day other"></div>';
  for (let day = 1; day <= days; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const evs = events.filter(e => e.date === iso);
    cells += `<div class="day ${new Date(y, m, day).toDateString() === todayStr ? 'today' : ''}"><div class="num">${day}</div>${evs.map(e => `<span class="pill ${esc(e.category)}" data-ev="${e.id}" title="${esc(e.title)}">${esc(e.emoji)} ${esc(e.title)}</span>`).join('')}</div>`;
  }
  app.innerHTML = `
    <div class="cal-head">
      <button class="btn secondary" id="prev">◀ Prev</button>
      <h2>${d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
      <button class="btn secondary" id="next">Next ▶</button>
    </div>
    <div class="cal">${cells}</div>
    <div class="legend">${CATS.map(c => `<span style="--c:var(--${c})">${c}</span>`).join('')}</div>
    <p class="desc">Tip: click any event on the calendar to see details and register.</p>`;
  document.getElementById('prev').onclick = () => { state.calMonth = new Date(y, m - 1, 1); renderCalendar(); };
  document.getElementById('next').onclick = () => { state.calMonth = new Date(y, m + 1, 1); renderCalendar(); };
  app.querySelectorAll('[data-ev]').forEach(p => p.onclick = () => openDetails(Number(p.dataset.ev)));
}

// ---------- modals ----------
function closeModal() { modalRoot.innerHTML = ''; }
function showModal(html) {
  modalRoot.innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
  modalRoot.querySelector('.overlay').onclick = e => { if (e.target.classList.contains('overlay')) closeModal(); };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function openDetails(id) {
  const e = await api('/api/events/' + id);
  showModal(`<span class="badge ${esc(e.category)}">${esc(e.category)}</span>
    <h2>${esc(e.emoji)} ${esc(e.title)}</h2>
    <div class="meta"><span>📅 ${fmtDate(e)} · ${fmtTime(e)}</span><span>📍 ${esc(e.venue)}</span><span>🏛️ ${esc(e.organizer)}</span></div>
    <p>${esc(e.description)}</p>${cdSpan(e)}
    <p class="seats">${e.seatsLeft} of ${e.capacity} seats left</p>
    <div class="row"><button class="btn secondary" id="mClose">Close</button><button class="btn" id="mReg" ${e.seatsLeft <= 0 ? 'disabled' : ''}>Register</button></div>`);
  startCountdowns();
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('mReg').onclick = () => openRegister(id);
}

async function openRegister(id) {
  const e = await api('/api/events/' + id);
  const saved = JSON.parse(localStorage.getItem('cc_profile') || '{}');
  const f = (k, label, type = 'text', ph = '') => `<div class="field" data-f="${k}"><label>${label}</label><input name="${k}" type="${type}" placeholder="${ph}" value="${esc(saved[k] || '')}"><div class="err"></div></div>`;
  showModal(`<h2>Register: ${esc(e.title)}</h2>
    <p class="meta">📅 ${fmtDate(e)} · ${fmtTime(e)} &nbsp; 📍 ${esc(e.venue)}</p>
    <form id="regForm" novalidate>
      ${f('name', 'Full name', 'text', 'e.g. Aarav Sharma')}
      ${f('email', 'College email', 'email', 'you@college.edu')}
      <div class="two">${f('rollNo', 'Roll number', 'text', 'e.g. 21CS1042')}${f('phone', 'Mobile number', 'tel', '10-digit number')}</div>
      <div class="two">
        <div class="field" data-f="department"><label>Department</label><select name="department"><option value="">Select</option>${DEPTS.map(d => `<option ${saved.department === d ? 'selected' : ''}>${d}</option>`).join('')}</select><div class="err"></div></div>
        <div class="field" data-f="year"><label>Year</label><select name="year"><option value="">Select</option>${[1, 2, 3, 4].map(y => `<option ${String(saved.year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select><div class="err"></div></div>
      </div>
      <div class="row"><button type="button" class="btn secondary" id="cancel">Cancel</button><button class="btn" id="submit">Confirm registration</button></div>
    </form>`);
  document.getElementById('cancel').onclick = closeModal;
  const form = document.getElementById('regForm');

  // client-side validation (mirrors the server rules)
  const rules = {
    name: v => /^[A-Za-z][A-Za-z .'-]{1,59}$/.test(v.trim()) || 'Enter a valid full name (letters only).',
    email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Enter a valid email address.',
    rollNo: v => /^[A-Za-z0-9-]{5,15}$/.test(v.trim()) || 'Roll number must be 5-15 letters/digits.',
    phone: v => /^[6-9]\d{9}$/.test(v.trim()) || 'Enter a valid 10-digit mobile number.',
    department: v => !!v || 'Select your department.',
    year: v => !!v || 'Select your year.'
  };
  const setErr = (k, msg) => { const w = form.querySelector(`[data-f="${k}"]`); w.classList.toggle('invalid', !!msg); w.querySelector('.err').textContent = msg || ''; };
  const check = k => { const r = rules[k](form.elements[k].value); setErr(k, r === true ? '' : r); return r === true; };
  Object.keys(rules).forEach(k => form.elements[k].addEventListener('blur', () => check(k)));

  form.onsubmit = async ev => {
    ev.preventDefault();
    const ok = Object.keys(rules).map(check).every(Boolean);
    if (!ok) return;
    const body = Object.fromEntries(new FormData(form).entries());
    const btn = document.getElementById('submit'); btn.disabled = true; btn.textContent = 'Registering...';
    try {
      const out = await api(`/api/events/${id}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      localStorage.setItem('cc_email', out.registration.email);
      localStorage.setItem('cc_profile', JSON.stringify(body));
      showConfirmation(out.registration, out.event);
      if (location.hash.includes('my-events') || !location.hash || location.hash.includes('events')) route();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Confirm registration';
      if (err.data && err.data.errors) Object.entries(err.data.errors).forEach(([k, m]) => setErr(k, m));
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
    <p class="meta">A confirmation has been saved to <b>My Events</b>.</p>
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

// ---------- My Events ----------
async function renderMyEvents() {
  app.innerHTML = `<h2>My Events</h2>
    <div class="emailbar"><input id="myEmail" type="email" placeholder="Enter the email you registered with" value="${esc(getEmail())}"><button class="btn" id="go">Show</button></div>
    <div id="mine"></div>`;
  const load = async () => {
    const email = document.getElementById('myEmail').value.trim();
    const box = document.getElementById('mine');
    if (!email) { box.innerHTML = '<div class="empty">Enter your email to see your registrations.</div>'; return; }
    localStorage.setItem('cc_email', email);
    const list = await api('/api/my-events?email=' + encodeURIComponent(email));
    if (!list.length) { box.innerHTML = '<div class="empty">No registrations yet. <a href="#/events">Browse events →</a></div>'; return; }
    box.innerHTML = `<div class="grid">${list.map(r => `<article class="card">
      <div class="card-top"><span class="badge ${esc(r.event.category)}">${esc(r.event.category)}</span><span class="emoji">${esc(r.event.emoji)}</span></div>
      <h3>${esc(r.event.title)}</h3>
      <div class="meta"><span>📅 ${fmtDate(r.event)} · ${fmtTime(r.event)}</span><span>📍 ${esc(r.event.venue)}</span><span>🎫 ${esc(r.id)}</span></div>
      ${cdSpan(r.event)}
      <div class="row"><button class="btn secondary" data-ticket="${esc(r.id)}">View ticket</button><button class="btn danger" data-cancel="${esc(r.id)}">Cancel</button></div>
    </article>`).join('')}</div>`;
    startCountdowns();
    box.querySelectorAll('[data-ticket]').forEach(b => b.onclick = async () => { const o = await api('/api/registrations/' + b.dataset.ticket); showConfirmation(o.registration, o.event); });
    box.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      if (!confirm('Cancel this registration?')) return;
      try { await api('/api/registrations/' + b.dataset.cancel, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); toast('Registration cancelled'); load(); }
      catch (e) { toast(e.message); }
    });
  };
  document.getElementById('go').onclick = () => load().catch(e => toast(e.message));
  if (getEmail()) load();
  else document.getElementById('mine').innerHTML = '<div class="empty">Enter your email to see your registrations.</div>';
}


// ---------- organizer: add event ----------
function renderAddEvent() {
  const fld = (k, label, type = 'text', extra = '') => `<div class="field" data-f="${k}"><label>${label}</label><input name="${k}" type="${type}" ${extra}><div class="err"></div></div>`;
  app.innerHTML = `<section class="hero"><h1>Organizer: add an event 📣</h1><p>Clubs and faculty can publish a new event. An organizer PIN is required (demo PIN: <b>campus123</b>).</p></section>
  <form id="addForm" class="panel" novalidate style="max-width:640px">
    ${fld('title', 'Event title')}
    <div class="two"><div class="field" data-f="category"><label>Category</label><select name="category">${CATS.map(c => `<option>${c}</option>`).join('')}</select><div class="err"></div></div>${fld('capacity', 'Capacity', 'number', 'min="1" max="5000"')}</div>
    <div class="two">${fld('date', 'Date', 'date')}${fld('time', 'Time', 'time')}</div>
    <div class="two">${fld('venue', 'Venue')}${fld('organizer', 'Organizer / club')}</div>
    <div class="field" data-f="description"><label>Description</label><textarea name="description" rows="3"></textarea><div class="err"></div></div>
    ${fld('pin', 'Organizer PIN', 'password')}
    <button class="btn">Publish event</button></form>`;
  const form = document.getElementById('addForm');
  form.onsubmit = async ev => {
    ev.preventDefault();
    form.querySelectorAll('.field').forEach(w => { w.classList.remove('invalid'); w.querySelector('.err').textContent = ''; });
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      const out = await api('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      toast('Event published: ' + out.title);
      location.hash = '#/events';
    } catch (err) {
      if (err.data && err.data.errors) Object.entries(err.data.errors).forEach(([k, m]) => { const w = form.querySelector(`[data-f="${k}"]`); if (w) { w.classList.add('invalid'); w.querySelector('.err').textContent = m; } });
      else toast(err.message);
    }
  };
}
