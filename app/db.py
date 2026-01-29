import json
import os
import sqlite3
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

DB_ENV = "UPTIME_ATLAS_DB"
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "uptime_atlas.db")


def _utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def get_db_path() -> str:
    return os.environ.get(DB_ENV, DEFAULT_DB_PATH)


def connect() -> sqlite3.Connection:
    path = get_db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info({table})")
    columns = {row["name"] for row in cur.fetchall()}
    if column not in columns:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db() -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS widgets (
            widget_key TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            w INTEGER NOT NULL,
            h INTEGER NOT NULL,
            config_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    _ensure_column(conn, "users", "role", "role TEXT NOT NULL DEFAULT 'admin'")
    _ensure_column(conn, "users", "timezone", "timezone TEXT NOT NULL DEFAULT 'America/New_York'")
    conn.close()


def get_setting(key: str) -> Optional[Any]:
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        return row["value"]


def get_settings(keys: Iterable[str]) -> Dict[str, Optional[Any]]:
    key_list = list(keys)
    if not key_list:
        return {}
    conn = connect()
    cur = conn.cursor()
    placeholders = ",".join("?" for _ in key_list)
    cur.execute(f"SELECT key, value FROM settings WHERE key IN ({placeholders})", key_list)
    rows = cur.fetchall()
    conn.close()
    result: Dict[str, Any] = {}
    for row in rows:
        try:
            result[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            result[row["key"]] = row["value"]
    for key in key_list:
        result.setdefault(key, None)
    return result


def set_setting(key: str, value: Any) -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, json.dumps(value), _utc_now()),
    )
    conn.commit()
    conn.close()


def get_all_settings() -> Dict[str, Any]:
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT key, value FROM settings")
    rows = cur.fetchall()
    conn.close()
    result: Dict[str, Any] = {}
    for row in rows:
        try:
            result[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            result[row["key"]] = row["value"]
    return result


def has_users() -> bool:
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM users LIMIT 1")
    row = cur.fetchone()
    conn.close()
    return row is not None


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "password_hash": row["password_hash"],
        "role": row["role"],
        "timezone": row["timezone"],
    }

def create_user(username: str, password_hash: str, role: str = "admin", timezone: str = "America/New_York") -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (username, password_hash, role, timezone, created_at) VALUES (?, ?, ?, ?, ?)",
        (username, password_hash, role, timezone, _utc_now()),
    )
    conn.commit()
    conn.close()


def get_or_create_user(
    username: str, password_hash: str, role: str = "user", timezone: str = "America/New_York"
) -> Dict[str, Any]:
    existing = get_user_by_username(username)
    if existing:
        return existing
    create_user(username, password_hash, role=role, timezone=timezone)
    return get_user_by_username(username) or {"username": username, "password_hash": password_hash}


def update_user_role(username: str, role: str) -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute("UPDATE users SET role = ? WHERE username = ?", (role, username))
    conn.commit()
    conn.close()


def update_user_timezone(username: str, timezone: str) -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute("UPDATE users SET timezone = ? WHERE username = ?", (timezone, username))
    conn.commit()
    conn.close()


def update_user_password(username: str, password_hash: str) -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute("UPDATE users SET password_hash = ? WHERE username = ?", (password_hash, username))
    conn.commit()
    conn.close()


def list_users() -> List[Dict[str, Any]]:
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT username, role, timezone, created_at FROM users ORDER BY created_at ASC")
    rows = cur.fetchall()
    conn.close()
    return [
        {"username": row["username"], "role": row["role"], "timezone": row["timezone"], "created_at": row["created_at"]}
        for row in rows
    ]


def get_widgets() -> List[Dict[str, Any]]:
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT * FROM widgets ORDER BY widget_key")
    rows = cur.fetchall()
    conn.close()
    widgets: List[Dict[str, Any]] = []
    for row in rows:
        config = {}
        try:
            config = json.loads(row["config_json"])
        except json.JSONDecodeError:
            config = {}
        widgets.append(
            {
                "widget_key": row["widget_key"],
                "enabled": bool(row["enabled"]),
                "x": row["x"],
                "y": row["y"],
                "w": row["w"],
                "h": row["h"],
                "config": config,
                "updated_at": row["updated_at"],
            }
        )
    return widgets


def upsert_widget(
    widget_key: str,
    enabled: bool,
    x: int,
    y: int,
    w: int,
    h: int,
    config: Optional[Dict[str, Any]] = None,
) -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO widgets (widget_key, enabled, x, y, w, h, config_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(widget_key) DO UPDATE SET
            enabled = excluded.enabled,
            x = excluded.x,
            y = excluded.y,
            w = excluded.w,
            h = excluded.h,
            config_json = excluded.config_json,
            updated_at = excluded.updated_at
        """,
        (
            widget_key,
            1 if enabled else 0,
            x,
            y,
            w,
            h,
            json.dumps(config or {}),
            _utc_now(),
        ),
    )
    conn.commit()
    conn.close()


def update_widget_layouts(layouts: Iterable[Dict[str, Any]]) -> None:
    conn = connect()
    cur = conn.cursor()
    now = _utc_now()
    for item in layouts:
        cur.execute(
            """
            UPDATE widgets
            SET x = ?, y = ?, w = ?, h = ?, updated_at = ?
            WHERE widget_key = ?
            """,
            (item["x"], item["y"], item["w"], item["h"], now, item["widget_key"]),
        )
    conn.commit()
    conn.close()


def update_widget_enabled(widget_key: str, enabled: bool) -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE widgets SET enabled = ?, updated_at = ? WHERE widget_key = ?
        """,
        (1 if enabled else 0, _utc_now(), widget_key),
    )
    conn.commit()
    conn.close()
