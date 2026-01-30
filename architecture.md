# Architecture

## Overview
Uptime Atlas is a FastAPI + Jinja2 application that serves a widget-based dashboard for game community ops. It uses a small SQLite database for user accounts, settings, widget layouts, and calendar metadata, with static assets handled by vanilla HTML/CSS/JS and a Docker-first deployment model.

## Data Storage
### SQLite Location
- Default path: `data/uptime_atlas.db`
- Override via env var: `UPTIME_ATLAS_DB`

### Schema
**users**
- `id` INTEGER PK
- `username` TEXT UNIQUE
- `password_hash` TEXT
- `role` TEXT (default `admin`)
- `timezone` TEXT (default `America/New_York`)
- `created_at` TEXT (UTC ISO)

**settings**
- `key` TEXT PK
- `value` TEXT (JSON-encoded)
- `updated_at` TEXT (UTC ISO)

Default keys (JSON objects):
- `kuma_config`: enabled, base_url, status_page_slug, metrics_path, auth_header, timeout_sec
- `pelican_config`: enabled, base_url, api_key, server_id, server_name, timeout_sec
- `discord_config`: enabled, bot_token, channel_id, guild_id
- `oauth_allowlist`: google_emails, discord_ids, steam_ids

**widgets**
- `widget_key` TEXT PK
- `enabled` INTEGER (0/1)
- `x`, `y`, `w`, `h` INTEGER (grid layout)
- `config_json` TEXT (JSON-encoded)
- `updated_at` TEXT (UTC ISO)

**games**
- `id` INTEGER PK
- `name` TEXT UNIQUE
- `created_at` TEXT (UTC ISO)

**calendar_events**
- `id` INTEGER PK
- `schedule_id` TEXT (Pelican schedule ID or local event id)
- `game_id` INTEGER (FK → games.id)
- `event_name` TEXT
- `start_utc` TEXT (UTC ISO)
- `stop_utc` TEXT (UTC ISO, nullable)
- `description` TEXT
- `created_by` TEXT
- `is_deleted` INTEGER (0/1)

## Tools & Stack
- Backend: Python 3.12, FastAPI, Starlette SessionMiddleware (signed cookie sessions, 24h TTL), Jinja2 templates
- Auth: Authlib for OAuth (Google/Discord); Steam OpenID via direct request flow
- Storage: SQLite (single-file, persisted via `./data` volume)
- Integrations: Pelican Panel API, Uptime Kuma API (HTTP requests via stdlib `urllib`)
- Frontend: Vanilla HTML/CSS/JS; no framework
- Runtime: Uvicorn ASGI server
- Infra: Docker image + volume mount `./data:/app/data`
- Testing workflow: Playwright MCP (per `AGENTS.md`)

## UX/UI Flow
### Public Dashboard
- Route: `/`
- Read-only dashboard with widgets (calendar, kuma, discord) if enabled.
- Top bar includes theme toggle and login button.

### Admin Login & Setup
- Login: `/admin/login` (local user/pass; OAuth enabled when configured).
- Setup: `/admin/setup` only when no users exist; creates root admin.
- After login, admins land on `/admin`; non-admins land on `/`.

### Admin Dashboard
- Route: `/admin`
- Same widget grid as public dashboard, plus integrations panel.
- Edit mode toggle: enables drag/resize, widget remove, and add-widget modal.
- Layout changes persist via `/api/widgets/layout`.
- Widget enable/disable updates via `/api/widgets/{widget_key}/enabled`.

### Calendar Experience
- Month grid with source filters and color coding.
- Timezone selection stored in `ua_timezone` cookie for anonymous users.
- Admin-only Create Event modal with basic date/time inputs.
- Event details modal for day-level inspection.
- Pelican schedules are read-only, expanded for the next 3 months, and stored in `calendar_events`.
- Calendar create/delete actions only touch local storage (no Pelican writes); deletions persist as local markers.

### Profile & Access Management
- Route: `/profile`
- Timezone selection writes to `/api/profile/timezone`.
- Password change via `/api/profile/password`.
- Root-only OAuth allowlist management and user role assignment.

### Theme & Session Behavior
- Theme toggle stored in `localStorage` (`ua-theme`).
- Edit mode stored in `localStorage` (`ua-edit-mode`).
- Auth uses signed session cookies with 24-hour max age; sign out clears session keys.
