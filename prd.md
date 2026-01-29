# Uptime Atlas PRD

## 1. Overview
Uptime Atlas is a self-hosted, always-on dashboard for game communities. It centralizes server uptime visibility, scheduling, automation, and community engagement (Discord) into a single, customizable web interface.

## 2. Goals
- Provide a unified, user-friendly dashboard for server status, schedules, and community messaging.
- Allow admins to configure and personalize widgets, layout, and theme.
- Sync schedules bi-directionally with Pelican Panel and reflect them in a real calendar view.
- Automate server power actions (WOL/shutdown) based on schedules.
- Integrate Discord for read/post/pin messaging tied to schedules.
- Support secure authentication with role-based access (root/admin/user) and OAuth.

## 3. Non-Goals
- Replace Pelican Panel or Uptime Kuma; only integrate with them.
- Act as a general-purpose chat platform beyond Discord integration.
- Provide full calendar productivity suite (focus on server schedule view).

## 4. Target Users
- Root owner (full control, role assignment, allowlists)
- Admins (configure integrations, layout, widgets)
- Users (view dashboard; limited settings like personal timezone)

## 5. Core Features
### 5.1 Authentication & Access Control
- Local username/password login.
- OAuth login (Google, Discord, Steam).
- Root user can assign admin roles to users.
- Profile page with timezone selection and password change (current password required).

### 5.2 Dashboard & Widgets
- Public dashboard (no login) showing widgets.
- Admin-only edit mode for layout and resize (drag handles).
- Widget toggles and per-widget configuration.
- Light/Dark/Auto theme.

### 5.3 Uptime Kuma Widget
- Status fetched from Kuma API or metrics endpoint.
- Configurable base URL, auth header, and status page slug.

### 5.4 Calendar Widget
- Month-view calendar (Google Calendar-like grid).
- Events derived from Pelican schedules.
- Source filters with color coding.
- Event summary in cells + detail popover.
- Create schedule via modal (admins only).
- Schedule times rendered in EST by default and converted to user timezone.
- Server/source name driven by Pelican server name.

### 5.5 Pelican Panel Integration
- Read schedules from Pelican API.
- Create schedules from Uptime Atlas.
- Future: bi-directional sync updates and deletions.

### 5.6 Discord Integration
- Display live chat feed in widget.
- Post messages and pin/unpin based on calendar events.
- OAuth-based user posting.

### 5.7 Automation (WOL)
- Send WOL packet 10 minutes before scheduled uptime.
- Optional shutdown automation after downtime.
- Configurable grace periods and quiet hours.

## 6. UX / UI Requirements
- Calendar must be readable at default widget size.
- Resizing should scale calendar without overflow.
- Editing locked unless in explicit Edit mode.
- Source filters centered and color-coded.
- Avoid intrusive system messages; keep UI clean.

## 7. Data & Storage
- SQLite for user accounts, settings, widgets, allowlists.
- Configuration persisted in `data/uptime_atlas.db`.

## 8. Deployment
- Docker container with volume for persistent data.
- Bootstrap root admin printed in logs if no users exist.

## 9. Security
- Passwords hashed (PBKDF2).
- Admin-only settings endpoints.
- Root-only role management and allowlists.
- OAuth allowlists optional.

## 10. Open Questions
- Pelican API parity with Pterodactyl endpoints (confirm schedules schema).
- WOL automation target list and network boundaries.
- Discord permissions and bot scope requirements.
- Final list of supported timezones for dropdown.