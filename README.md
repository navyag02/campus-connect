# CampusConnect- College Event Portal

A full-stack website where students discover college events, workshops and competitions, and register online.

## Features
- Event cards with category badges, dates, venue, live seat bar
- Search, category chips, date-range filter, sort by soonest/popular, "seats available" toggle
- Registration form with client-side AND server-side validation
- Duplicate-registration and full-event protection (seat limits)
- **Standout:** monthly event calendar + registration confirmation screen (ticket with unique ID, add-to-calendar `.ics`, print)
- **Accounts:** sign up / log in (passwords hashed with scrypt, signed HttpOnly session cookie)
- **Profile page:** one place for your *Registered* tickets, the events you *Created* (edit, delete, attendee list + CSV), and your *Details*
- Registering for or creating an event requires an account; browsing stays public
- Calendar can be filtered to *All events*, *My registrations* or *Created by me* (✓ / ★ markers); cards show "Registered ✓"
- Event time is chosen with hour / minute / AM-PM dropdowns; events in the past cannot be created
- Past events are marked and closed for registration
- Live countdown timers on every event
- Dark mode, responsive layout

## Tech stack
Frontend: HTML5, CSS3, vanilla JavaScript (SPA with hash routing)
Backend: Node.js + Express REST API
Storage: JSON files in `data/` (events.json, registrations.json, users.json)

## Run
```bash
npm install
npm start
# open http://localhost:3000
```

## REST API
`Auth` = login required (session cookie). `Owner` = only the creator of that event / registration.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | /api/auth/signup | public | Create account (validated), starts session |
| POST | /api/auth/login | public | Log in (401 on bad credentials, 429 after 10 failures) |
| POST | /api/auth/logout | public | End session |
| GET | /api/auth/me | public | Current user or `{user:null}` |
| PATCH | /api/auth/me | Auth | Update profile details |
| GET | /api/events?q=&category=&from=&to=&sort=&availableOnly= | public | List / search / filter events |
| GET | /api/events/:id | public | Single event with seats left |
| GET | /api/categories, /api/stats | public | Filter chips, banner totals |
| POST | /api/events | Auth | Create event (you become the owner) |
| PATCH / DELETE | /api/events/:id | Owner | Edit / delete event |
| GET | /api/events/:id/attendees | Owner | Who registered |
| POST | /api/events/:id/register | Auth | Register (validated; 409 if full, past or duplicate) |
| GET | /api/me/registrations | Auth | My tickets |
| GET | /api/me/events | Auth | Events I created |
| GET / DELETE | /api/registrations/:id | Owner | View ticket / cancel |

Set `SESSION_SECRET` in the environment for production; otherwise a random secret is generated into `data/.secret`.

## Project structure
```
campusconnect/
  server.js
  package.json
  data/events.json (committed seed data); registrations.json, users.json, .secret are created at runtime and git-ignored
  public/index.html, style.css, app.js
```
