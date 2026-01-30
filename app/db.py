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


def _get_or_create_game_id(conn: sqlite3.Connection, name: str) -> int:
    game_name = (name or "").strip() or "General"
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR IGNORE INTO games (name, created_at)
        VALUES (?, ?)
        """,
        (game_name, _utc_now()),
    )
    cur.execute("SELECT id FROM games WHERE name = ?", (game_name,))
    row = cur.fetchone()
    return int(row["id"]) if row else 0


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
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
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
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_events'")
    has_events = cur.fetchone() is not None
    if has_events:
        cur.execute("PRAGMA table_info(calendar_events)")
        columns = [row["name"] for row in cur.fetchall()]
        needs_migration = any(column not in columns for column in ("id", "game_id", "event_name", "is_deleted"))
        if needs_migration:
            cur.execute("ALTER TABLE calendar_events RENAME TO calendar_events_old")
            cur.execute(
                """
                CREATE TABLE calendar_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    schedule_id TEXT NOT NULL,
                    game_id INTEGER NOT NULL,
                    event_name TEXT NOT NULL,
                    start_utc TEXT NOT NULL,
                    stop_utc TEXT,
                    description TEXT,
                    created_by TEXT,
                    is_deleted INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_schedule_start ON calendar_events (schedule_id, start_utc)"
            )
            default_game_id = _get_or_create_game_id(conn, "Imported")
            cur.execute(
                """
                INSERT INTO calendar_events (
                    schedule_id,
                    game_id,
                    event_name,
                    start_utc,
                    stop_utc,
                    description,
                    created_by,
                    is_deleted
                )
                SELECT
                    schedule_id,
                    ?,
                    COALESCE(schedule_id, 'Legacy Event'),
                    start_utc,
                    stop_utc,
                    description,
                    created_by,
                    0
                FROM calendar_events_old
                """,
                (default_game_id,),
            )
            cur.execute("DROP TABLE calendar_events_old")
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS calendar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_id TEXT NOT NULL,
            game_id INTEGER NOT NULL,
            event_name TEXT NOT NULL,
            start_utc TEXT NOT NULL,
            stop_utc TEXT,
            description TEXT,
            created_by TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_schedule_start ON calendar_events (schedule_id, start_utc)"
    )
    cur.execute("DROP TABLE IF EXISTS schedule_meta")
    cur.execute("DROP TABLE IF EXISTS schedule_exclusions")
    cur.execute("DROP TABLE IF EXISTS source_exclusions")
    cur.execute("DROP TABLE IF EXISTS schedule_cache")
    cur.execute("DROP TABLE IF EXISTS local_schedules")
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


def get_game_by_id(game_id: int) -> Optional[Dict[str, Any]]:
    if not game_id:
        return None
    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM games WHERE id = ?", (int(game_id),))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {"id": row["id"], "name": row["name"]}


def list_games_with_stats() -> List[Dict[str, Any]]:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            games.id AS id,
            games.name AS name,
            COALESCE(SUM(CASE WHEN calendar_events.is_deleted = 0 THEN 1 ELSE 0 END), 0) AS active_count,
            COALESCE(SUM(CASE WHEN calendar_events.is_deleted = 1 THEN 1 ELSE 0 END), 0) AS deleted_count,
            COALESCE(SUM(CASE WHEN calendar_events.schedule_id NOT LIKE 'local_%' THEN 1 ELSE 0 END), 0) AS pelican_count
        FROM games
        LEFT JOIN calendar_events ON calendar_events.game_id = games.id
        GROUP BY games.id
        ORDER BY games.name
        """
    )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "active_count": int(row["active_count"] or 0),
            "deleted_count": int(row["deleted_count"] or 0),
            "pelican_count": int(row["pelican_count"] or 0),
        }
        for row in rows
    ]


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


def get_or_create_game_id(name: str) -> int:
    conn = connect()
    game_id = _get_or_create_game_id(conn, name)
    conn.commit()
    conn.close()
    return game_id


def insert_calendar_event(
    schedule_id: str,
    game_id: int,
    event_name: str,
    start_utc: str,
    stop_utc: Optional[str],
    description: str,
    created_by: str,
) -> int:
    if not schedule_id or not start_utc or not event_name or not game_id:
        return 0
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO calendar_events (
            schedule_id,
            game_id,
            event_name,
            start_utc,
            stop_utc,
            description,
            created_by,
            is_deleted
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        """,
        (
            str(schedule_id),
            int(game_id),
            str(event_name),
            str(start_utc),
            stop_utc,
            description or None,
            created_by or None,
        ),
    )
    event_id = int(cur.lastrowid or 0)
    conn.commit()
    conn.close()
    return event_id


def upsert_calendar_event(
    schedule_id: str,
    game_id: int,
    event_name: str,
    start_utc: str,
    stop_utc: Optional[str],
    description: str,
    created_by: str,
) -> None:
    if not schedule_id or not start_utc or not event_name or not game_id:
        return
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO calendar_events (
            schedule_id,
            game_id,
            event_name,
            start_utc,
            stop_utc,
            description,
            created_by,
            is_deleted
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(schedule_id, start_utc) DO UPDATE SET
            game_id = excluded.game_id,
            event_name = excluded.event_name,
            stop_utc = excluded.stop_utc,
            description = excluded.description,
            created_by = excluded.created_by
        WHERE calendar_events.is_deleted = 0
        """,
        (
            str(schedule_id),
            int(game_id),
            str(event_name),
            str(start_utc),
            stop_utc,
            description or None,
            created_by or None,
        ),
    )
    conn.commit()
    conn.close()


def list_calendar_events(
    start_utc: Optional[str] = None,
    end_utc: Optional[str] = None,
    include_deleted: bool = False,
) -> List[Dict[str, Any]]:
    conn = connect()
    cur = conn.cursor()
    clauses = []
    params: List[Any] = []
    if not include_deleted:
        clauses.append("calendar_events.is_deleted = 0")
    if start_utc:
        clauses.append("calendar_events.start_utc >= ?")
        params.append(start_utc)
    if end_utc:
        clauses.append("calendar_events.start_utc < ?")
        params.append(end_utc)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    cur.execute(
        """
        SELECT
            calendar_events.id,
            calendar_events.schedule_id,
            calendar_events.game_id,
            games.name AS game_name,
            calendar_events.event_name,
            calendar_events.start_utc,
            calendar_events.stop_utc,
            calendar_events.description,
            calendar_events.created_by
        FROM calendar_events
        LEFT JOIN games ON games.id = calendar_events.game_id
        """
        f"{where} ORDER BY calendar_events.start_utc ASC",
        params,
    )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": row["id"],
            "schedule_id": row["schedule_id"],
            "game_id": row["game_id"],
            "game_name": row["game_name"] or "",
            "event_name": row["event_name"],
            "start_utc": row["start_utc"],
            "stop_utc": row["stop_utc"],
            "description": row["description"] or "",
            "created_by": row["created_by"] or "",
        }
        for row in rows
    ]


def get_calendar_event_by_id(event_id: int) -> Optional[Dict[str, Any]]:
    if not event_id:
        return None
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            calendar_events.id,
            calendar_events.schedule_id,
            calendar_events.game_id,
            games.name AS game_name,
            calendar_events.event_name,
            calendar_events.start_utc,
            calendar_events.stop_utc,
            calendar_events.description,
            calendar_events.created_by,
            calendar_events.is_deleted
        FROM calendar_events
        LEFT JOIN games ON games.id = calendar_events.game_id
        WHERE calendar_events.id = ?
        """,
        (int(event_id),),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "schedule_id": row["schedule_id"],
        "game_id": row["game_id"],
        "game_name": row["game_name"] or "",
        "event_name": row["event_name"],
        "start_utc": row["start_utc"],
        "stop_utc": row["stop_utc"],
        "description": row["description"] or "",
        "created_by": row["created_by"] or "",
        "is_deleted": bool(row["is_deleted"]),
    }


def mark_calendar_event_deleted(event_id: int) -> None:
    if not event_id:
        return
    conn = connect()
    cur = conn.cursor()
    cur.execute("UPDATE calendar_events SET is_deleted = 1 WHERE id = ?", (int(event_id),))
    conn.commit()
    conn.close()


def mark_calendar_events_deleted_by_game(game_id: int) -> int:
    if not game_id:
        return 0
    conn = connect()
    cur = conn.cursor()
    cur.execute("UPDATE calendar_events SET is_deleted = 1 WHERE game_id = ?", (int(game_id),))
    updated = cur.rowcount or 0
    conn.commit()
    conn.close()
    return updated


def delete_calendar_events_by_game(game_id: int) -> None:
    if not game_id:
        return
    conn = connect()
    cur = conn.cursor()
    cur.execute("DELETE FROM calendar_events WHERE game_id = ?", (int(game_id),))
    conn.commit()
    conn.close()


def delete_calendar_events_in_range(
    start_utc: str,
    end_utc: str,
    exclude_local: bool = True,
    include_deleted: bool = False,
) -> None:
    if not start_utc or not end_utc:
        return
    conn = connect()
    cur = conn.cursor()
    clauses = ["start_utc >= ?", "start_utc < ?"]
    params: List[Any] = [start_utc, end_utc]
    if not include_deleted:
        clauses.append("is_deleted = 0")
    if exclude_local:
        clauses.append("schedule_id NOT LIKE ?")
        params.append("local_%")
    cur.execute(
        f"DELETE FROM calendar_events WHERE {' AND '.join(clauses)}",
        params,
    )
    conn.commit()
    conn.close()


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
