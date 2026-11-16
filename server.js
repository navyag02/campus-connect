// CampusConnect backend: Express REST API with user accounts and JSON-file persistence
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const REG_FILE = path.join(DATA_DIR, 'registrations.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');
const EMOJIS = { Workshop: '🛠️', Competition: '🏆', Cultural: '🎭', Sports: '⚽', Seminar: '🎤' };
const ROLES = ['student', 'organizer'];
const CATEGORIES = ['Workshop', 'Competition', 'Cultural', 'Sports', 'Seminar'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- storage helpers ----------
function readJSON(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  // never silently treat a damaged file as empty: the next write would erase everyone's data
  try { return JSON.parse(raw); }
  catch { throw new Error(path.basename(file) + ' is damaged. Restore it before continuing; refusing to overwrite your data.'); }
}
function writeJSON(file, data) {
  // write to a temp file then rename, so a crash never leaves a half-written file
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
if (!fs.existsSync(REG_FILE)) writeJSON(REG_FILE, []);
if (!fs.existsSync(USERS_FILE)) writeJSON(USERS_FILE, []);

const getEvents = () => readJSON(EVENTS_FILE, []);
const getRegs = () => readJSON(REG_FILE, []);
const getUsers = () => readJSON(USERS_FILE, []);

// event times are campus-local (IST) no matter where the server runs
const isPast = ev => new Date(`${ev.date}T${ev.time}:00+05:30`) <= new Date();
function withSeats(ev, regs) {
  const taken = regs.filter(r => r.eventId === ev.id && r.status === 'confirmed').length;
  return { ...ev, registered: taken, seatsLeft: Math.max(ev.capacity - taken, 0), past: isPast(ev) };
}

// ---------- passwords (scrypt: slow, salted, one-way) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}
const DUMMY_HASH = hashPassword('not-a-real-password'); // keeps login timing similar for unknown emails

// ---------- sessions (signed cookie, no server-side session table) ----------
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
  catch { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET); }
}
const COOKIE = 'cc_session';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const hmac = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body);
}
function readToken(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(hmac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // tampered
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i <= 0) return;
    const raw = part.slice(i + 1).trim();
    let val;
    try { val = decodeURIComponent(raw); } catch { val = raw; }
    out[part.slice(0, i).trim()] = val;
  });
  return out;
}
const startSession = (res, user) =>
  res.setHeader('Set-Cookie', `${COOKIE}=${makeToken({ uid: user.id, exp: Date.now() + WEEK_MS })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK_MS / 1000}`);
const endSession = res =>
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

function currentUser(req) {
  const p = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  return p ? getUsers().find(u => u.id === p.uid) || null : null;
}
// middleware: protects a route so only logged-in users get through
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in to continue.' });
  req.user = { role: 'student', ...user }; // accounts made before roles existed count as students
  next();
}
const requireOrganizer = (req, res, next) =>
  req.user.role === 'organizer' ? next() : res.status(403).json({ error: 'Only organizer accounts can create events.' });
const publicUser = ({ passHash, ...rest }) => ({ role: 'student', ...rest });

// small in-memory rate limiter. Login: 10 FAILED tries per email+IP per 15 minutes (a shared
// college Wi-Fi address must not lock everybody out). Signup: 50 per IP per 15 minutes.
const buckets = new Map();
function hit(key, max) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) b = { count: 0, reset: now + 15 * 60 * 1000 };
  b.count++;
  buckets.set(key, b);
  return b.count > max;
}
const blocked = (key, max) => { const b = buckets.get(key); return !!b && b.reset > Date.now() && b.count >= max; };

// ---------- validation ----------
function validateProfile(b, role = 'student') {
  const errors = {};
  const name = (b.name || '').trim();
  const phone = (b.phone || '').trim();
  if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) errors.name = 'Enter a valid full name (letters only, 2-60 chars).';
  if (!/^[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (role === 'organizer') {
    const organization = String(b.organization || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 &.,'()-]{1,59}$/.test(organization)) errors.organization = 'Enter your club, committee or department name.';
    return { errors, clean: { name, phone, organization } };
  }
  const roll = (b.rollNo || '').trim().toUpperCase();
  const dept = (b.department || '').trim();
  const year = String(b.year || '').trim();
  if (!/^[A-Z0-9-]{5,15}$/.test(roll)) errors.rollNo = 'Roll number must be 5-15 letters/digits.';
  if (!dept) errors.department = 'Select your department.';
  if (!['1', '2', '3', '4'].includes(year)) errors.year = 'Select your year of study.';
  return { errors, clean: { name, rollNo: roll, phone, department: dept, year } };
}
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 100 && /[A-Za-z]/.test(p) && /\d/.test(p);

function validateEvent(b) {
  const errors = {};
  const title = String(b.title || '').trim();
  const venue = String(b.venue || '').trim();
  const organizer = String(b.organizer || '').trim();
  const description = String(b.description || '').trim();
  const capacity = parseInt(b.capacity, 10);
  if (title.length < 3 || title.length > 80) errors.title = 'Title must be 3-80 characters.';
  if (!CATEGORIES.includes(b.category)) errors.category = 'Choose a category.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || isNaN(Date.parse(b.date))) errors.date = 'Enter a valid date.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || '')) errors.time = 'Enter a valid time.';
  if (!venue) errors.venue = 'Venue is required.';
  if (!organizer) errors.organizer = 'Organizer / club is required.';
  if (!(capacity >= 1 && capacity <= 5000)) errors.capacity = 'Capacity must be 1-5000.';
  if (description.length < 10) errors.description = 'Add a description (10+ characters).';
  return { errors, clean: { title, category: b.category, date: b.date, time: b.time, venue, organizer, capacity, description } };
}

// ---------- AUTH ----------
app.post('/api/auth/signup', (req, res) => {
  if (hit('signup|' + req.ip, 50)) return res.status(429).json({ error: 'Too many sign-ups from this network. Try again in a few minutes.' });
  const b = req.body || {};
  const role = ROLES.includes(b.role) ? b.role : 'student';
  const { errors, clean } = validateProfile(b, role);
  const email = String(b.email || '').trim().toLowerCase();
  if (!validEmail(email)) errors.email = 'Enter a valid email address.';
  if (!validPassword(b.password)) errors.password = 'Password must be 8+ characters with at least one letter and one number.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });

  const users = getUsers();
  if (users.some(u => u.email === email)) {
    return res.status(409).json({ error: 'An account with this email already exists.', errors: { email: 'An account with this email already exists.' } });
  }
  const user = { id: 'u_' + crypto.randomBytes(4).toString('hex'), email, role, ...clean, passHash: hashPassword(b.password), createdAt: new Date().toISOString() };
  users.push(user);
  writeJSON(USERS_FILE, users);
  startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const key = 'login|' + req.ip + '|' + email;
  if (blocked(key, 10)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const user = getUsers().find(u => u.email === email);
  const ok = checkPassword(password, user ? user.passHash : DUMMY_HASH);
  if (!user || !ok) { hit(key, 10); return res.status(401).json({ error: 'Incorrect email or password.' }); }
  buckets.delete(key);
  startSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => { endSession(res); res.json({ ok: true }); });

// who am I? (always 200 so the page can ask on load without an error)
app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.patch('/api/auth/me', requireAuth, (req, res) => {
  const { errors, clean } = validateProfile(req.body || {}, req.user.role);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });
  const users = getUsers();
  const u = users.find(x => x.id === req.user.id);
  Object.assign(u, clean);
  writeJSON(USERS_FILE, users);
  res.json({ user: publicUser(u) });
});

// ---------- EVENTS (public reads) ----------
app.get('/api/events', (req, res) => {
  const { q, category, from, to, sort, availableOnly } = req.query;
  const regs = getRegs();
  let list = getEvents().map(e => withSeats(e, regs));

  if (q) {
    const s = String(Array.isArray(q) ? q[0] : q).toLowerCase();
    list = list.filter(e => [e.title, e.description, e.venue, e.organizer].join(' ').toLowerCase().includes(s));
  }
  if (category && category !== 'All') list = list.filter(e => e.category === category);
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);
  if (availableOnly === 'true') list = list.filter(e => e.seatsLeft > 0 && !e.past);

  const byDate = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
  if (sort === 'popular') list.sort((a, b) => b.registered - a.registered);
  else list.sort(byDate);
  list.sort((a, b) => Number(a.past) - Number(b.past)); // upcoming first (stable sort keeps the order above)

  res.json(list);
});

app.get('/api/categories', (req, res) => {
  res.json([...new Set(getEvents().map(e => e.category))].sort());
});

app.get('/api/events/:id', (req, res) => {
  const ev = getEvents().find(e => e.id === Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json(withSeats(ev, getRegs()));
});

// ---------- EVENTS (logged-in: create, edit, delete, attendees) ----------
app.post('/api/events', requireAuth, requireOrganizer, (req, res) => {
  const { errors, clean } = validateEvent(req.body || {});
  if (!errors.date && !errors.time && isPast(clean)) errors.date = 'Pick a date and time in the future.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });
  const events = getEvents();
  // ids are never reused, even after an event is deleted
  const ev = { id: Math.max(0, ...events.map(e => e.id), ...getRegs().map(r => r.eventId)) + 1, ...clean, emoji: EMOJIS[clean.category], ownerId: req.user.id, ownerName: req.user.name };
  events.push(ev);
  writeJSON(EVENTS_FILE, events);
  res.status(201).json(withSeats(ev, getRegs()));
});

// helper: load an event and make sure the logged-in user owns it
function ownedEvent(req, res) {
  const events = getEvents();
  const ev = events.find(e => e.id === Number(req.params.id));
  if (!ev) { res.status(404).json({ error: 'Event not found' }); return null; }
  if (ev.ownerId !== req.user.id) { res.status(403).json({ error: 'Only the event creator can do this.' }); return null; }
  return { events, ev };
}

app.patch('/api/events/:id', requireAuth, (req, res) => {
  const found = ownedEvent(req, res); if (!found) return;
  const { events, ev } = found;
  if (isPast(ev)) return res.status(409).json({ error: 'Past events cannot be edited.' });
  const { errors, clean } = validateEvent(req.body || {});
  if (!errors.date && !errors.time && isPast(clean)) errors.date = 'Pick a date and time in the future.';
  const regs = getRegs();
  const taken = withSeats(ev, regs).registered;
  if (!errors.capacity && clean.capacity < taken) errors.capacity = `Already ${taken} people registered; capacity cannot be lower.`;
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });
  const oldCategory = ev.category;
  Object.assign(ev, clean);
  if (ev.emoji === EMOJIS[oldCategory]) ev.emoji = EMOJIS[ev.category]; // keep the icon in step with the category
  writeJSON(EVENTS_FILE, events);
  res.json(withSeats(ev, regs));
});

app.delete('/api/events/:id', requireAuth, (req, res) => {
  const found = ownedEvent(req, res); if (!found) return;
  const { events, ev } = found;
  writeJSON(EVENTS_FILE, events.filter(e => e.id !== ev.id));
  const regs = getRegs();
  regs.forEach(r => { if (r.eventId === ev.id && r.status === 'confirmed') { r.status = 'cancelled'; r.cancelledAt = new Date().toISOString(); r.cancelReason = 'event deleted'; } });
  writeJSON(REG_FILE, regs);
  res.json({ ok: true });
});

app.get('/api/events/:id/attendees', requireAuth, (req, res) => {
  const found = ownedEvent(req, res); if (!found) return;
  const list = getRegs().filter(r => r.eventId === found.ev.id && r.status === 'confirmed')
    .map(({ id, name, email, rollNo, phone, department, year, registeredAt }) => ({ id, name, email, rollNo, phone, department, year, registeredAt }));
  res.json(list);
});

// ---------- REGISTRATION (logged-in) ----------
app.post('/api/events/:id/register', requireAuth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Organizer accounts manage events. Only student accounts can register.' });
  const ev = getEvents().find(e => e.id === Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'Event not found' });

  const { errors, clean } = validateProfile(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });

  const regs = getRegs();
  const info = withSeats(ev, regs);
  if (info.past) return res.status(409).json({ error: 'Registration is closed: this event has already started.' });
  if (info.seatsLeft <= 0) return res.status(409).json({ error: 'Sorry, this event is full.' });

  const duplicate = regs.find(r => r.eventId === ev.id && r.userId === req.user.id && r.status === 'confirmed');
  if (duplicate) return res.status(409).json({ error: 'You have already registered for this event.', registration: duplicate });

  const reg = {
    id: 'CC-' + ev.id + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    eventId: ev.id,
    userId: req.user.id,
    ...clean,
    email: req.user.email, // always the account email, never taken from the request body
    status: 'confirmed',
    registeredAt: new Date().toISOString()
  };
  regs.push(reg);
  writeJSON(REG_FILE, regs);
  res.status(201).json({ registration: reg, event: withSeats(ev, regs) });
});

// ---------- PROFILE: my registrations and my created events ----------
app.get('/api/me/registrations', requireAuth, (req, res) => {
  const events = getEvents();
  const regs = getRegs();
  const mine = regs.filter(r => r.userId === req.user.id && r.status === 'confirmed')
    .map(r => ({ ...r, event: events.find(e => e.id === r.eventId) }))
    .filter(r => r.event)
    .map(r => ({ ...r, event: withSeats(r.event, regs) }));
  mine.sort((a, b) => (a.event.date + a.event.time).localeCompare(b.event.date + b.event.time));
  res.json(mine);
});

app.get('/api/me/events', requireAuth, (req, res) => {
  const regs = getRegs();
  const list = getEvents().filter(e => e.ownerId === req.user.id).map(e => withSeats(e, regs));
  list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(list);
});

function ownedRegistration(req, res) {
  const regs = getRegs();
  const reg = regs.find(r => r.id === req.params.id);
  if (!reg) { res.status(404).json({ error: 'Registration not found' }); return null; }
  if (reg.userId !== req.user.id) { res.status(403).json({ error: 'This registration belongs to another account.' }); return null; }
  return { regs, reg };
}

app.get('/api/registrations/:id', requireAuth, (req, res) => {
  const found = ownedRegistration(req, res); if (!found) return;
  const ev = getEvents().find(e => e.id === found.reg.eventId);
  if (!ev || found.reg.status !== 'confirmed') return res.status(404).json({ error: 'This ticket is no longer available.' });
  res.json({ registration: found.reg, event: withSeats(ev, found.regs) });
});

app.delete('/api/registrations/:id', requireAuth, (req, res) => {
  const found = ownedRegistration(req, res); if (!found) return;
  found.reg.status = 'cancelled';
  found.reg.cancelledAt = new Date().toISOString();
  writeJSON(REG_FILE, found.regs);
  res.json({ ok: true });
});

// ---------- stats ----------
app.get('/api/stats', (req, res) => {
  const events = getEvents();
  const regs = getRegs().filter(r => r.status === 'confirmed');
  res.json({ events: events.filter(e => !isPast(e)).length, registrations: regs.length, categories: new Set(events.map(e => e.category)).size, users: getUsers().length });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route' }));

app.use((err, req, res, next) => {
  const badBody = err.type === 'entity.parse.failed';
  if (!badBody) console.error(err);
  res.status(badBody ? 400 : 500).json({ error: badBody ? 'The request could not be read.' : 'Something went wrong on the server.' });
});

app.listen(PORT, () => console.log(`CampusConnect running at http://localhost:${PORT}`));
