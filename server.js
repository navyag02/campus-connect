// CampusConnect backend: Express REST API with JSON-file persistence
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const REG_FILE = path.join(DATA_DIR, 'registrations.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- storage helpers ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  // write to temp file then rename so a crash never corrupts data
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
if (!fs.existsSync(REG_FILE)) writeJSON(REG_FILE, []);

const getEvents = () => readJSON(EVENTS_FILE, []);
const getRegs = () => readJSON(REG_FILE, []);

function withSeats(ev, regs) {
  const taken = regs.filter(r => r.eventId === ev.id && r.status === 'confirmed').length;
  return { ...ev, registered: taken, seatsLeft: Math.max(ev.capacity - taken, 0) };
}

// ---------- validation ----------
function validateRegistration(b) {
  const errors = {};
  const name = (b.name || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const roll = (b.rollNo || '').trim().toUpperCase();
  const phone = (b.phone || '').trim();
  const dept = (b.department || '').trim();
  const year = String(b.year || '').trim();

  if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) errors.name = 'Enter a valid full name (letters only, 2-60 chars).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!/^[A-Z0-9-]{5,15}$/.test(roll)) errors.rollNo = 'Roll number must be 5-15 letters/digits.';
  if (!/^[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (!dept) errors.department = 'Select your department.';
  if (!['1', '2', '3', '4'].includes(year)) errors.year = 'Select your year of study.';

  return { errors, clean: { name, email, rollNo: roll, phone, department: dept, year } };
}

// ---------- API ----------
// List events (supports ?q=, ?category=, ?from=, ?to=, ?sort=)
app.get('/api/events', (req, res) => {
  const { q, category, from, to, sort, availableOnly } = req.query;
  const regs = getRegs();
  let list = getEvents().map(e => withSeats(e, regs));

  if (q) {
    const s = q.toLowerCase();
    list = list.filter(e => [e.title, e.description, e.venue, e.organizer].join(' ').toLowerCase().includes(s));
  }
  if (category && category !== 'All') list = list.filter(e => e.category === category);
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);
  if (availableOnly === 'true') list = list.filter(e => e.seatsLeft > 0);

  if (sort === 'popular') list.sort((a, b) => b.registered - a.registered);
  else list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  res.json(list);
});


// Organizer: create a new event (protected by a simple organizer PIN)
const ORGANIZER_PIN = process.env.ORGANIZER_PIN || 'campus123';
app.post('/api/events', (req, res) => {
  const b = req.body || {};
  if (String(b.pin || '') !== ORGANIZER_PIN) return res.status(403).json({ error: 'Invalid organizer PIN.' });
  const errors = {};
  const title = String(b.title || '').trim();
  const venue = String(b.venue || '').trim();
  const organizer = String(b.organizer || '').trim();
  const description = String(b.description || '').trim();
  const capacity = parseInt(b.capacity, 10);
  if (title.length < 3 || title.length > 80) errors.title = 'Title must be 3-80 characters.';
  if (!['Workshop', 'Competition', 'Cultural', 'Sports', 'Seminar'].includes(b.category)) errors.category = 'Choose a category.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || isNaN(Date.parse(b.date))) errors.date = 'Enter a valid date.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || '')) errors.time = 'Enter a valid time.';
  if (!venue) errors.venue = 'Venue is required.';
  if (!organizer) errors.organizer = 'Organizer / club is required.';
  if (!(capacity >= 1 && capacity <= 5000)) errors.capacity = 'Capacity must be 1-5000.';
  if (description.length < 10) errors.description = 'Add a description (10+ characters).';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });
  const events = getEvents();
  const emojis = { Workshop: '🛠️', Competition: '🏆', Cultural: '🎭', Sports: '⚽', Seminar: '🎤' };
  const ev = { id: events.reduce((m, e) => Math.max(m, e.id), 0) + 1, title, category: b.category, date: b.date, time: b.time, venue, organizer, capacity, description, emoji: emojis[b.category] };
  events.push(ev);
  writeJSON(EVENTS_FILE, events);
  res.status(201).json(withSeats(ev, getRegs()));
});

app.get('/api/categories', (req, res) => {
  res.json([...new Set(getEvents().map(e => e.category))].sort());
});

app.get('/api/events/:id', (req, res) => {
  const ev = getEvents().find(e => e.id === Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json(withSeats(ev, getRegs()));
});

// Register for an event
app.post('/api/events/:id/register', (req, res) => {
  const ev = getEvents().find(e => e.id === Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'Event not found' });

  const { errors, clean } = validateRegistration(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Validation failed', errors });

  const regs = getRegs();
  const info = withSeats(ev, regs);
  if (info.seatsLeft <= 0) return res.status(409).json({ error: 'Sorry, this event is full.' });

  const duplicate = regs.find(r => r.eventId === ev.id && r.email === clean.email && r.status === 'confirmed');
  if (duplicate) return res.status(409).json({ error: 'You have already registered for this event with this email.', registration: duplicate });

  const reg = {
    id: 'CC-' + ev.id + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    eventId: ev.id,
    ...clean,
    status: 'confirmed',
    registeredAt: new Date().toISOString()
  };
  regs.push(reg);
  writeJSON(REG_FILE, regs);
  res.status(201).json({ registration: reg, event: withSeats(ev, regs) });
});

// My Events: all registrations for an email
app.get('/api/my-events', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email query parameter is required' });
  const events = getEvents();
  const regs = getRegs();
  const mine = regs.filter(r => r.email === email && r.status === 'confirmed').map(r => ({
    ...r,
    event: withSeats(events.find(e => e.id === r.eventId), regs)
  }));
  mine.sort((a, b) => (a.event.date + a.event.time).localeCompare(b.event.date + b.event.time));
  res.json(mine);
});

// Look up a single registration (confirmation screen / reload)
app.get('/api/registrations/:id', (req, res) => {
  const reg = getRegs().find(r => r.id === req.params.id);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  const ev = getEvents().find(e => e.id === reg.eventId);
  res.json({ registration: reg, event: withSeats(ev, getRegs()) });
});

// Cancel a registration (must supply the matching email)
app.delete('/api/registrations/:id', (req, res) => {
  const email = ((req.body && req.body.email) || req.query.email || '').trim().toLowerCase();
  const regs = getRegs();
  const reg = regs.find(r => r.id === req.params.id);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  if (reg.email !== email) return res.status(403).json({ error: 'Email does not match this registration.' });
  reg.status = 'cancelled';
  reg.cancelledAt = new Date().toISOString();
  writeJSON(REG_FILE, regs);
  res.json({ ok: true });
});

// Portal-wide stats for the home banner
app.get('/api/stats', (req, res) => {
  const events = getEvents();
  const regs = getRegs().filter(r => r.status === 'confirmed');
  res.json({ events: events.length, registrations: regs.length, categories: new Set(events.map(e => e.category)).size });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route' }));

app.listen(PORT, () => console.log(`CampusConnect running at http://localhost:${PORT}`));
