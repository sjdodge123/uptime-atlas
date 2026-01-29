# Uptime Atlas
A dashboard to manage a game community and game server automation. A single dashboard to manage engagement, monitor server availability, and track scheduled game time.

## What's in this MVP
- Public dashboard with Kuma status, calendar placeholder, and Discord placeholder widgets.
- Admin portal for login, widget layout controls, and integration settings.
- Light/dark/auto theme toggle (defaults to auto).
- SQLite-backed configuration stored in `./data/uptime_atlas.db`.

## Run locally (Python)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:UPTIME_ATLAS_SESSION_SECRET = "change-me"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```
Then visit:
- Dashboard: `http://localhost:8080/`
- Admin setup: `http://localhost:8080/admin/setup`

## Run with Docker
```powershell
docker build -t uptime-atlas .
docker run -p 8080:8080 -v ${PWD}\data:/app/data `
  -e UPTIME_ATLAS_SESSION_SECRET=change-me `
  uptime-atlas
```

### Bootstrap admin credentials
- If no users exist and you do NOT provide `UPTIME_ATLAS_ADMIN_USER`/`UPTIME_ATLAS_ADMIN_PASSWORD`, the container will create a `root` admin automatically and print the generated password in the Docker logs on first start.
- View it with:
```powershell
docker logs uptime-atlas | Select-String -Pattern "Bootstrap admin"
```
- If you don't see the line, the database already has users. Remove `data/uptime_atlas.db` (or start with a fresh volume) and restart the container.
- If you prefer fixed credentials, set `UPTIME_ATLAS_ADMIN_USER` and `UPTIME_ATLAS_ADMIN_PASSWORD`.

## Docker Compose
```powershell
docker compose up --build
```

## Environment variables
- `UPTIME_ATLAS_SESSION_SECRET`: Session signing key (required for stable sessions).
- `UPTIME_ATLAS_ADMIN_USER`: Optional. Auto-creates admin if no user exists.
- `UPTIME_ATLAS_ADMIN_PASSWORD`: Optional. Used with `UPTIME_ATLAS_ADMIN_USER`.
- `UPTIME_ATLAS_DB`: Optional. Override SQLite path (default `./data/uptime_atlas.db`).
- `UPTIME_ATLAS_GOOGLE_CLIENT_ID`: Enable Google OAuth login.
- `UPTIME_ATLAS_GOOGLE_CLIENT_SECRET`: Enable Google OAuth login.
- `UPTIME_ATLAS_DISCORD_CLIENT_ID`: Enable Discord OAuth login.
- `UPTIME_ATLAS_DISCORD_CLIENT_SECRET`: Enable Discord OAuth login.
- `UPTIME_ATLAS_GOOGLE_ALLOWED_EMAILS`: Optional comma-separated allowlist of Google emails.
- `UPTIME_ATLAS_DISCORD_ALLOWED_IDS`: Optional comma-separated allowlist of Discord user IDs.
- `UPTIME_ATLAS_STEAM_ALLOWED_IDS`: Optional comma-separated allowlist of Steam IDs.

## Profile settings
- Profile page (`/profile`) lets each user change their timezone and password.
- Root users can manage OAuth allowlists and admin roles from the same page.

## Next integration steps
- Uptime Kuma status: configure Base URL + auth header or status page slug.
- Pelican schedule sync: list schedules + create schedules via the Calendar widget (client API).
- Discord: connect via bot + OAuth to read/post/pin messages.
- WOL automation: schedule WOL packets from the calendar engine.

## OAuth redirect URLs
Set these in each provider's console:
- Google: `http://localhost:8080/auth/google/callback`
- Discord: `http://localhost:8080/auth/discord/callback`
- Steam: `http://localhost:8080/auth/steam/callback`
