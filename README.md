# CampusConnect — College Event Portal

A full-stack website where students discover college events, workshops and competitions, and register online.

## Features
- Event cards with category badges, dates, venue, live seat bar
- Search, category chips, date-range filter, sort by soonest/popular, "seats available" toggle
- Registration form with client-side AND server-side validation
- Duplicate-registration and full-event protection (seat limits)
- **Standout:** monthly event calendar + registration confirmation screen (ticket with unique ID, add-to-calendar `.ics`, print)
- My Events page (lookup by email, view ticket, cancel registration)
- Live countdown timers on every event
- Dark mode, responsive layout

## Tech stack
Frontend: HTML5, CSS3, vanilla JavaScript (SPA with hash routing)
Backend: Node.js + Express REST API
Storage: JSON files in `data/` (events.json, registrations.json)

## Run
```bash
npm install
npm start
# open http://localhost:3000
```

## REST API
| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/events?q=&category=&from=&to=&sort=&availableOnly= | List / search / filter events |
| GET | /api/events/:id | Single event with seats left |
| GET | /api/categories | Category list |
| POST | /api/events/:id/register | Register (validated) |
| GET | /api/my-events?email= | A student's registrations |
| GET | /api/registrations/:id | Look up one registration |
| DELETE | /api/registrations/:id | Cancel (email must match) |
| GET | /api/stats | Totals for the home banner |

## Project structure
```
campusconnect/
  server.js
  package.json
  data/events.json, registrations.json
  public/index.html, style.css, app.js
```
