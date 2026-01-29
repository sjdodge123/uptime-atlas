import base64
import binascii
import hashlib
import json
import os
import secrets
import logging
import urllib.parse
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth, OAuthError

from . import db

APP_TITLE = "Uptime Atlas"
SESSION_SECRET_ENV = "UPTIME_ATLAS_SESSION_SECRET"
ADMIN_USER_ENV = "UPTIME_ATLAS_ADMIN_USER"
ADMIN_PASSWORD_ENV = "UPTIME_ATLAS_ADMIN_PASSWORD"
GOOGLE_CLIENT_ID_ENV = "UPTIME_ATLAS_GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET_ENV = "UPTIME_ATLAS_GOOGLE_CLIENT_SECRET"
DISCORD_CLIENT_ID_ENV = "UPTIME_ATLAS_DISCORD_CLIENT_ID"
DISCORD_CLIENT_SECRET_ENV = "UPTIME_ATLAS_DISCORD_CLIENT_SECRET"
ALLOWED_GOOGLE_EMAILS_ENV = "UPTIME_ATLAS_GOOGLE_ALLOWED_EMAILS"
ALLOWED_DISCORD_IDS_ENV = "UPTIME_ATLAS_DISCORD_ALLOWED_IDS"
ALLOWED_STEAM_IDS_ENV = "UPTIME_ATLAS_STEAM_ALLOWED_IDS"

DEFAULT_WIDGETS = [
    {
        "widget_key": "kuma",
        "title": "Uptime Kuma",
        "x": 1,
        "y": 1,
        "w": 7,
        "h": 4,
        "enabled": True,
        "config": {},
    },
    {
        "widget_key": "calendar",
        "title": "Server Calendar",
        "x": 8,
        "y": 1,
        "w": 5,
        "h": 4,
        "enabled": True,
        "config": {},
    },
    {
        "widget_key": "discord",
        "title": "Discord Live Chat",
        "x": 1,
        "y": 5,
        "w": 12,
        "h": 4,
        "enabled": True,
        "config": {},
    },
]

DEFAULT_SETTINGS = {
    "kuma_config": {
        "enabled": False,
        "base_url": "",
        "status_page_slug": "",
        "metrics_path": "/metrics",
        "auth_header": "",
        "timeout_sec": 6,
    },
    "pelican_config": {
        "enabled": False,
        "base_url": "",
        "api_key": "",
        "server_id": "",
        "server_name": "Server",
        "timeout_sec": 6,
    },
    "discord_config": {
        "enabled": False,
        "bot_token": "",
        "channel_id": "",
        "guild_id": "",
    },
    "oauth_allowlist": {
        "google_emails": "",
        "discord_ids": "",
        "steam_ids": "",
    },
}

app = FastAPI(title=APP_TITLE)

logger = logging.getLogger("uptime_atlas")

session_secret = os.environ.get(SESSION_SECRET_ENV)
if not session_secret:
    session_secret = secrets.token_hex(32)

app.add_middleware(SessionMiddleware, secret_key=session_secret)

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))

oauth = OAuth()

if os.environ.get(GOOGLE_CLIENT_ID_ENV) and os.environ.get(GOOGLE_CLIENT_SECRET_ENV):
    oauth.register(
        name="google",
        client_id=os.environ.get(GOOGLE_CLIENT_ID_ENV),
        client_secret=os.environ.get(GOOGLE_CLIENT_SECRET_ENV),
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

if os.environ.get(DISCORD_CLIENT_ID_ENV) and os.environ.get(DISCORD_CLIENT_SECRET_ENV):
    oauth.register(
        name="discord",
        client_id=os.environ.get(DISCORD_CLIENT_ID_ENV),
        client_secret=os.environ.get(DISCORD_CLIENT_SECRET_ENV),
        authorize_url="https://discord.com/api/oauth2/authorize",
        access_token_url="https://discord.com/api/oauth2/token",
        api_base_url="https://discord.com/api/",
        client_kwargs={"scope": "identify email"},
    )


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return base64.b64encode(salt + dk).decode("utf-8")


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        raw = base64.b64decode(stored_hash.encode("utf-8"))
    except (ValueError, binascii.Error):
        return False
    if len(raw) < 17:
        return False
    salt = raw[:16]
    expected = raw[16:]
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return secrets.compare_digest(dk, expected)


def _ensure_defaults() -> None:
    db.init_db()
    existing = {widget["widget_key"] for widget in db.get_widgets()}
    for widget in DEFAULT_WIDGETS:
        if widget["widget_key"] not in existing:
            db.upsert_widget(
                widget_key=widget["widget_key"],
                enabled=widget["enabled"],
                x=widget["x"],
                y=widget["y"],
                w=widget["w"],
                h=widget["h"],
                config=widget["config"],
            )

    for key, value in DEFAULT_SETTINGS.items():
        if db.get_setting(key) is None:
            db.set_setting(key, value)

    if not db.has_users():
        env_user = os.environ.get(ADMIN_USER_ENV)
        env_password = os.environ.get(ADMIN_PASSWORD_ENV)
        if env_user and env_password:
            db.create_user(env_user, _hash_password(env_password), role="root")
            logger.info("Bootstrap admin created from env vars.")
        else:
            bootstrap_user = "root"
            bootstrap_password = secrets.token_urlsafe(14)
            db.create_user(bootstrap_user, _hash_password(bootstrap_password), role="root")
            print(
                "[Uptime Atlas] Bootstrap admin created. "
                f"Username: {bootstrap_user} Password: {bootstrap_password}",
                flush=True,
            )
    else:
        logger.info("Existing users detected; bootstrap skipped.")


@app.on_event("startup")
async def startup() -> None:
    _ensure_defaults()


def _is_admin(request: Request) -> bool:
    return bool(request.session.get("user")) and request.session.get("role") in {"admin", "root"}


def _is_root(request: Request) -> bool:
    return bool(request.session.get("user")) and request.session.get("role") == "root"


def _is_authenticated(request: Request) -> bool:
    return bool(request.session.get("user"))


def _allowlist(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [entry.strip() for entry in value.split(",") if entry.strip()]


def _oauth_allowed(provider: str, claim: Optional[str]) -> bool:
    if not claim:
        return False
    allow_settings = db.get_setting("oauth_allowlist")
    if not isinstance(allow_settings, dict):
        allow_settings = {}
    if provider == "google":
        allowed = _allowlist(os.environ.get(ALLOWED_GOOGLE_EMAILS_ENV))
        allowed += _allowlist(allow_settings.get("google_emails"))
    elif provider == "discord":
        allowed = _allowlist(os.environ.get(ALLOWED_DISCORD_IDS_ENV))
        allowed += _allowlist(allow_settings.get("discord_ids"))
    elif provider == "steam":
        allowed = _allowlist(os.environ.get(ALLOWED_STEAM_IDS_ENV))
        allowed += _allowlist(allow_settings.get("steam_ids"))
    else:
        allowed = []
    if not allowed:
        return True
    return claim in allowed


def _login_user(request: Request, user: Dict[str, Any]) -> None:
    request.session["user"] = user["username"]
    request.session["role"] = user.get("role", "user")
    request.session["timezone"] = user.get("timezone", "America/New_York")


def require_admin(request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(status_code=401, detail="Not authenticated")


def require_root(request: Request) -> None:
    if not _is_root(request):
        raise HTTPException(status_code=403, detail="Root access required")


def require_login(request: Request) -> None:
    if not request.session.get("user"):
        raise HTTPException(status_code=401, detail="Not authenticated")


def _load_settings() -> Dict[str, Any]:
    settings = db.get_all_settings()
    for key, value in DEFAULT_SETTINGS.items():
        settings.setdefault(key, value)
    return settings


def _load_widgets() -> List[Dict[str, Any]]:
    widgets = db.get_widgets()
    widget_map = {widget["widget_key"]: widget for widget in widgets}
    ordered: List[Dict[str, Any]] = []
    for template in DEFAULT_WIDGETS:
        entry = widget_map.get(template["widget_key"], template.copy())
        entry.setdefault("title", template["title"])
        ordered.append(entry)
    return ordered


def _fetch_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 6) -> Any:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read().decode("utf-8")
        return json.loads(data)


def _fetch_text(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 6) -> str:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def _steam_openid_endpoint() -> str:
    return "https://steamcommunity.com/openid/login"


def _request_json(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 6,
) -> Any:
    req_headers = headers.copy() if headers else {}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body)


def _request_form(url: str, payload: Dict[str, str], timeout: int = 6) -> str:
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def _parse_prometheus_metrics(payload: str) -> List[Dict[str, Any]]:
    monitors: List[Dict[str, Any]] = []
    for line in payload.splitlines():
        if not line.startswith("monitor_status{"):
            continue
        try:
            label_block, value = line.split("}")
            labels_raw = label_block[len("monitor_status{") :]
            label_pairs = []
            current = ""
            in_quotes = False
            for char in labels_raw:
                if char == '"':
                    in_quotes = not in_quotes
                if char == "," and not in_quotes:
                    label_pairs.append(current)
                    current = ""
                else:
                    current += char
            if current:
                label_pairs.append(current)
            labels: Dict[str, str] = {}
            for pair in label_pairs:
                if "=" not in pair:
                    continue
                key, raw_val = pair.split("=", 1)
                labels[key.strip()] = raw_val.strip().strip('"')
            status_value = value.strip().split(" ")[-1]
            status = int(float(status_value))
            name = labels.get("monitor_name") or labels.get("monitor") or "Unknown"
            monitors.append({"name": name, "status": status, "type": labels.get("monitor_type")})
        except ValueError:
            continue
    return monitors


def _fetch_kuma_summary(config: Dict[str, Any]) -> Dict[str, Any]:
    if not config.get("enabled"):
        return {"ok": False, "reason": "disabled"}
    base_url = (config.get("base_url") or "").rstrip("/")
    if not base_url:
        return {"ok": False, "reason": "missing_base_url"}
    timeout = int(config.get("timeout_sec") or 6)
    headers: Dict[str, str] = {}
    auth_header = (config.get("auth_header") or "").strip()
    if auth_header:
        headers["Authorization"] = auth_header
    try:
        slug = (config.get("status_page_slug") or "").strip()
        if slug:
            url = f"{base_url}/api/status-page/{slug}"
            data = _fetch_json(url, headers=headers, timeout=timeout)
            status_list = data.get("statusList") or {}
            if isinstance(status_list, list):
                status_list = {str(idx): value for idx, value in enumerate(status_list)}
            monitors: List[Dict[str, Any]] = []
            for group in data.get("publicGroupList", []):
                for monitor in group.get("monitorList", []):
                    monitor_id = str(monitor.get("id"))
                    status = status_list.get(monitor_id)
                    monitors.append(
                        {
                            "name": monitor.get("name") or f"Monitor {monitor_id}",
                            "status": status,
                            "type": monitor.get("type"),
                        }
                    )
            return {"ok": True, "source": "status_page", "monitors": monitors}
        metrics_path = (config.get("metrics_path") or "/metrics").strip()
        if not metrics_path.startswith("/"):
            metrics_path = "/" + metrics_path
        url = f"{base_url}{metrics_path}"
        payload = _fetch_text(url, headers=headers, timeout=timeout)
        monitors = _parse_prometheus_metrics(payload)
        return {"ok": True, "source": "metrics", "monitors": monitors}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "reason": f"http_{exc.code}"}
    except urllib.error.URLError:
        return {"ok": False, "reason": "unreachable"}
    except json.JSONDecodeError:
        return {"ok": False, "reason": "invalid_json"}


def _pelican_headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Accept": "Application/vnd.pterodactyl.v1+json",
    }


def _fetch_pelican_schedules(config: Dict[str, Any]) -> Dict[str, Any]:
    if not config.get("enabled"):
        return {"ok": False, "reason": "disabled"}
    base_url = (config.get("base_url") or "").rstrip("/")
    if not base_url:
        return {"ok": False, "reason": "missing_base_url"}
    api_key = (config.get("api_key") or "").strip()
    if not api_key:
        return {"ok": False, "reason": "missing_api_key"}
    server_id = (config.get("server_id") or "").strip()
    if not server_id:
        return {"ok": False, "reason": "missing_server_id"}
    timeout = int(config.get("timeout_sec") or 6)

    url = f"{base_url}/api/client/servers/{server_id}/schedules"
    try:
        data = _request_json(url, headers=_pelican_headers(api_key), timeout=timeout)
        raw_list = data.get("data", []) if isinstance(data, dict) else []
        schedules: List[Dict[str, Any]] = []
        for entry in raw_list:
            attrs = entry.get("attributes", {}) if isinstance(entry, dict) else {}
            def _cron_value(value: Any) -> str:
                if value is None or value == "":
                    return "*"
                return str(value)

            cron = {
                "minute": _cron_value(attrs.get("minute")),
                "hour": _cron_value(attrs.get("hour")),
                "day_of_month": _cron_value(attrs.get("day_of_month")),
                "month": _cron_value(attrs.get("month")),
                "day_of_week": _cron_value(attrs.get("day_of_week")),
            }
            cron_expression = " ".join(
                cron.get(key, "*") for key in ("minute", "hour", "day_of_month", "month", "day_of_week")
            )
            schedules.append(
                {
                    "id": attrs.get("id") or attrs.get("uuid") or entry.get("id"),
                    "name": attrs.get("name") or "Schedule",
                    "cron": cron,
                    "cron_expression": cron_expression,
                    "is_active": attrs.get("is_active"),
                    "only_when_online": attrs.get("only_when_online"),
                    "updated_at": attrs.get("updated_at"),
                }
            )
        return {"ok": True, "schedules": schedules}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "reason": f"http_{exc.code}"}
    except urllib.error.URLError:
        return {"ok": False, "reason": "unreachable"}
    except json.JSONDecodeError:
        return {"ok": False, "reason": "invalid_json"}


def _create_pelican_schedule(config: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    if not config.get("enabled"):
        return {"ok": False, "reason": "disabled"}
    base_url = (config.get("base_url") or "").rstrip("/")
    if not base_url:
        return {"ok": False, "reason": "missing_base_url"}
    api_key = (config.get("api_key") or "").strip()
    if not api_key:
        return {"ok": False, "reason": "missing_api_key"}
    server_id = (config.get("server_id") or "").strip()
    if not server_id:
        return {"ok": False, "reason": "missing_server_id"}
    timeout = int(config.get("timeout_sec") or 6)

    required = ["name", "minute", "hour", "day_of_month", "month", "day_of_week"]
    if not all(key in payload and str(payload[key]).strip() != "" for key in required):
        return {"ok": False, "reason": "missing_fields"}

    body = {
        "name": str(payload["name"]).strip(),
        "minute": str(payload["minute"]).strip(),
        "hour": str(payload["hour"]).strip(),
        "day_of_month": str(payload["day_of_month"]).strip(),
        "month": str(payload["month"]).strip(),
        "day_of_week": str(payload["day_of_week"]).strip(),
        "is_active": bool(payload.get("is_active", True)),
        "only_when_online": bool(payload.get("only_when_online", False)),
    }

    url = f"{base_url}/api/client/servers/{server_id}/schedules"
    try:
        data = _request_json(
            url,
            method="POST",
            headers=_pelican_headers(api_key),
            payload=body,
            timeout=timeout,
        )
        attrs = data.get("attributes", data) if isinstance(data, dict) else {}
        return {
            "ok": True,
            "schedule": {
                "id": attrs.get("id") or attrs.get("uuid"),
                "name": attrs.get("name") or body["name"],
                "cron_expression": " ".join(
                    body[key] for key in ("minute", "hour", "day_of_month", "month", "day_of_week")
                ),
                "is_active": attrs.get("is_active", body["is_active"]),
            },
        }
    except urllib.error.HTTPError as exc:
        return {"ok": False, "reason": f"http_{exc.code}"}
    except urllib.error.URLError:
        return {"ok": False, "reason": "unreachable"}
    except json.JSONDecodeError:
        return {"ok": False, "reason": "invalid_json"}


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request) -> HTMLResponse:
    widgets = _load_widgets()
    settings = _load_settings()
    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "title": APP_TITLE,
            "widgets": widgets,
            "settings": settings,
            "is_admin": False,
            "is_authenticated": _is_authenticated(request),
            "user_timezone": request.session.get("timezone", "America/New_York"),
        },
    )


@app.get("/admin", response_class=HTMLResponse)
async def admin_dashboard(request: Request) -> HTMLResponse:
    if not _is_admin(request):
        return RedirectResponse("/admin/login", status_code=303)
    widgets = _load_widgets()
    settings = _load_settings()
    return templates.TemplateResponse(
        "admin.html",
        {
            "request": request,
            "title": APP_TITLE,
            "widgets": widgets,
            "settings": settings,
            "is_admin": True,
            "is_authenticated": True,
            "is_root": _is_root(request),
            "user_timezone": request.session.get("timezone", "America/New_York"),
        },
    )


@app.get("/admin/login", response_class=HTMLResponse)
async def login_page(request: Request) -> HTMLResponse:
    if _is_admin(request):
        return RedirectResponse("/admin", status_code=303)
    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "title": APP_TITLE,
            "is_admin": False,
            "is_authenticated": _is_authenticated(request),
            "setup_available": not db.has_users(),
            "oauth_google_enabled": "google" in oauth._clients,
            "oauth_discord_enabled": "discord" in oauth._clients,
            "oauth_steam_enabled": True,
            "user_timezone": "America/New_York",
        },
    )


@app.post("/admin/login")
async def login(request: Request, username: str = Form(...), password: str = Form(...)) -> RedirectResponse:
    user = db.get_user_by_username(username)
    if not user or not _verify_password(password, user["password_hash"]):
        return RedirectResponse("/admin/login?error=1", status_code=303)
    _login_user(request, user)
    return RedirectResponse("/admin" if _is_admin(request) else "/", status_code=303)


@app.get("/admin/setup", response_class=HTMLResponse)
async def setup_page(request: Request) -> HTMLResponse:
    if db.has_users():
        return RedirectResponse("/admin/login", status_code=303)
    return templates.TemplateResponse(
        "setup.html",
        {
            "request": request,
            "title": APP_TITLE,
            "is_admin": False,
            "is_authenticated": False,
            "user_timezone": "America/New_York",
        },
    )


@app.post("/admin/setup")
async def setup_user(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    confirm_password: str = Form(...),
    timezone: str = Form("America/New_York"),
) -> RedirectResponse:
    if db.has_users():
        return RedirectResponse("/admin/login", status_code=303)
    if password != confirm_password:
        return RedirectResponse("/admin/setup?error=1", status_code=303)
    db.create_user(username, _hash_password(password), role="root", timezone=timezone or "America/New_York")
    _login_user(request, {"username": username, "role": "root", "timezone": timezone or "America/New_York"})
    return RedirectResponse("/admin", status_code=303)


@app.post("/admin/logout")
async def logout(request: Request) -> RedirectResponse:
    request.session.pop("user", None)
    request.session.pop("role", None)
    request.session.pop("timezone", None)
    return RedirectResponse("/", status_code=303)


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request) -> HTMLResponse:
    if not _is_authenticated(request):
        return RedirectResponse("/admin/login", status_code=303)
    settings = _load_settings()
    return templates.TemplateResponse(
        "profile.html",
        {
            "request": request,
            "title": APP_TITLE,
            "is_admin": _is_admin(request),
            "is_authenticated": True,
            "is_root": _is_root(request),
            "user_timezone": request.session.get("timezone", "America/New_York"),
            "settings": settings,
        },
    )


@app.get("/auth/{provider}/login")
async def oauth_login(provider: str, request: Request) -> RedirectResponse:
    if provider == "steam":
        realm = str(request.base_url).rstrip("/")
        return_to = str(request.url_for("oauth_callback", provider=provider))
        params = {
            "openid.ns": "http://specs.openid.net/auth/2.0",
            "openid.mode": "checkid_setup",
            "openid.return_to": return_to,
            "openid.realm": realm,
            "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
            "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
        }
        url = f"{_steam_openid_endpoint()}?{urllib.parse.urlencode(params)}"
        return RedirectResponse(url, status_code=303)

    if provider not in oauth._clients:
        raise HTTPException(status_code=404, detail="Provider not configured")
    client = oauth.create_client(provider)
    redirect_uri = request.url_for("oauth_callback", provider=provider)
    return await client.authorize_redirect(request, redirect_uri)


@app.get("/auth/{provider}/callback")
async def oauth_callback(provider: str, request: Request) -> RedirectResponse:
    if provider == "steam":
        params = dict(request.query_params)
        if params.get("openid.mode") != "id_res":
            return RedirectResponse("/admin/login?error=oauth", status_code=303)
        check_payload = params.copy()
        check_payload["openid.mode"] = "check_authentication"
        try:
            response = _request_form(_steam_openid_endpoint(), check_payload, timeout=6)
        except urllib.error.URLError:
            return RedirectResponse("/admin/login?error=oauth", status_code=303)
        if "is_valid:true" not in response:
            return RedirectResponse("/admin/login?error=oauth", status_code=303)
        claimed_id = params.get("openid.claimed_id", "")
        steam_id = claimed_id.rstrip("/").split("/")[-1] if claimed_id else ""
        if not _oauth_allowed("steam", steam_id):
            return RedirectResponse("/admin/login?error=oauth_denied", status_code=303)
        username = f"steam:{steam_id}"
        user = db.get_or_create_user(username, _hash_password(secrets.token_urlsafe(24)), role="user")
        _login_user(request, user)
        return RedirectResponse("/admin" if _is_admin(request) else "/", status_code=303)

    if provider not in oauth._clients:
        raise HTTPException(status_code=404, detail="Provider not configured")

    try:
        client = oauth.create_client(provider)
        token = await client.authorize_access_token(request)
    except OAuthError:
        return RedirectResponse("/admin/login?error=oauth", status_code=303)

    if provider == "google":
        userinfo = await client.parse_id_token(request, token)
        email = userinfo.get("email")
        subject = userinfo.get("sub")
        if not _oauth_allowed("google", email):
            return RedirectResponse("/admin/login?error=oauth_denied", status_code=303)
        username = f"google:{subject}"
    elif provider == "discord":
        resp = await client.get("users/@me", token=token)
        userinfo = resp.json()
        discord_id = userinfo.get("id")
        if not _oauth_allowed("discord", discord_id):
            return RedirectResponse("/admin/login?error=oauth_denied", status_code=303)
        username = f"discord:{discord_id}"
    else:
        return RedirectResponse("/admin/login?error=oauth", status_code=303)

    user = db.get_or_create_user(username, _hash_password(secrets.token_urlsafe(24)), role="user")
    _login_user(request, user)
    return RedirectResponse("/admin" if _is_admin(request) else "/", status_code=303)


@app.get("/api/bootstrap")
async def bootstrap() -> JSONResponse:
    return JSONResponse({"widgets": _load_widgets(), "settings": _load_settings()})


@app.get("/api/kuma/summary")
async def kuma_summary() -> JSONResponse:
    config = _load_settings().get("kuma_config", {})
    summary = _fetch_kuma_summary(config)
    return JSONResponse(summary)


@app.get("/api/pelican/schedules")
async def pelican_schedules() -> JSONResponse:
    config = _load_settings().get("pelican_config", {})
    result = _fetch_pelican_schedules(config)
    return JSONResponse(result)


@app.post("/api/pelican/schedules")
async def create_pelican_schedule(request: Request, _: None = Depends(require_admin)) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    config = _load_settings().get("pelican_config", {})
    result = _create_pelican_schedule(config, payload)
    return JSONResponse(result)


@app.get("/api/widgets")
async def widgets_api() -> JSONResponse:
    return JSONResponse({"widgets": _load_widgets()})


@app.post("/api/widgets/layout")
async def update_layout(request: Request, _: None = Depends(require_admin)) -> JSONResponse:
    payload = await request.json()
    layouts = payload.get("layouts") if isinstance(payload, dict) else None
    if not isinstance(layouts, list):
        raise HTTPException(status_code=400, detail="Invalid layout payload")
    normalized = []
    for item in layouts:
        if not all(key in item for key in ("widget_key", "x", "y", "w", "h")):
            continue
        normalized.append(
            {
                "widget_key": item["widget_key"],
                "x": int(item["x"]),
                "y": int(item["y"]),
                "w": int(item["w"]),
                "h": int(item["h"]),
            }
        )
    if normalized:
        db.update_widget_layouts(normalized)
    return JSONResponse({"ok": True})


@app.post("/api/widgets/{widget_key}/enabled")
async def update_widget_enabled(widget_key: str, request: Request, _: None = Depends(require_admin)) -> JSONResponse:
    payload = await request.json()
    enabled = bool(payload.get("enabled")) if isinstance(payload, dict) else False
    db.update_widget_enabled(widget_key, enabled)
    return JSONResponse({"ok": True, "enabled": enabled})


@app.post("/api/settings")
async def update_settings(request: Request, _: None = Depends(require_admin)) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    for key, default_value in DEFAULT_SETTINGS.items():
        if key not in payload:
            continue
        value = payload[key]
        if not isinstance(value, dict):
            continue
        merged = default_value.copy()
        merged.update(value)
        db.set_setting(key, merged)
    return JSONResponse({"ok": True})


@app.get("/api/settings")
async def get_settings(_: None = Depends(require_admin)) -> JSONResponse:
    return JSONResponse(_load_settings())


@app.get("/api/users")
async def list_users(_: None = Depends(require_root)) -> JSONResponse:
    return JSONResponse({"users": db.list_users()})


@app.post("/api/users/{username}/role")
async def update_user_role(username: str, request: Request, _: None = Depends(require_root)) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    role = payload.get("role")
    if role not in {"user", "admin", "root"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    db.update_user_role(username, role)
    return JSONResponse({"ok": True, "role": role})


@app.post("/api/users/{username}/timezone")
async def update_user_timezone(username: str, request: Request, _: None = Depends(require_root)) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    timezone = str(payload.get("timezone") or "").strip()
    if not timezone:
        raise HTTPException(status_code=400, detail="Invalid timezone")
    db.update_user_timezone(username, timezone)
    return JSONResponse({"ok": True, "timezone": timezone})


@app.post("/api/profile/timezone")
async def update_profile_timezone(request: Request, _: None = Depends(require_login)) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    timezone = str(payload.get("timezone") or "").strip()
    if not timezone:
        raise HTTPException(status_code=400, detail="Invalid timezone")
    username = request.session.get("user")
    db.update_user_timezone(username, timezone)
    request.session["timezone"] = timezone
    return JSONResponse({"ok": True, "timezone": timezone})


@app.post("/api/profile/password")
async def update_profile_password(request: Request, _: None = Depends(require_login)) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    current_password = str(payload.get("current_password") or "")
    new_password = str(payload.get("new_password") or "")
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Missing password")
    user = db.get_user_by_username(request.session.get("user"))
    if not user or not _verify_password(current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid current password")
    db.update_user_password(user["username"], _hash_password(new_password))
    return JSONResponse({"ok": True})


@app.post("/api/oauth/allowlist")
async def update_oauth_allowlist(request: Request, _: None = Depends(require_root)) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    merged = DEFAULT_SETTINGS["oauth_allowlist"].copy()
    merged.update({key: str(payload.get(key, "") or "") for key in merged})
    db.set_setting("oauth_allowlist", merged)
    return JSONResponse({"ok": True})
