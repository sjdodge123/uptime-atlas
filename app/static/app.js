(() => {
  const root = document.documentElement;
  const storageKey = "ua-theme";
  const buttons = document.querySelectorAll("[data-theme-choice]");
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const applyTheme = (mode) => {
    root.dataset.themeMode = mode;
    let resolved = mode;
    if (mode === "auto") {
      resolved = media.matches ? "dark" : "light";
    }
    root.dataset.theme = resolved;
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeChoice === mode);
    });
  };

  const stored = localStorage.getItem(storageKey) || "auto";
  applyTheme(stored);

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.themeChoice;
      localStorage.setItem(storageKey, mode);
      applyTheme(mode);
    });
  });

  media.addEventListener("change", () => {
    if ((localStorage.getItem(storageKey) || "auto") === "auto") {
      applyTheme("auto");
    }
  });
})();

(() => {
  const grid = document.getElementById("widgetGrid");
  if (!grid) return;
  const isAdmin = document.body.dataset.admin === "true";
  if (!isAdmin) return;

  const editToggle = document.querySelector("[data-edit-toggle]");
  const editKey = "ua-edit-mode";
  const maxCols = 12;
  const minW = 3;
  const minH = 2;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const updateWidget = (widget, x, y, w, h) => {
    widget.dataset.x = x;
    widget.dataset.y = y;
    widget.dataset.w = w;
    widget.dataset.h = h;
    widget.style.setProperty("--x", x);
    widget.style.setProperty("--y", y);
    widget.style.setProperty("--w", w);
    widget.style.setProperty("--h", h);
  };

  const getMetrics = () => {
    const rect = grid.getBoundingClientRect();
    const colWidth = rect.width / maxCols;
    const rowHeight = parseFloat(getComputedStyle(grid).getPropertyValue("grid-auto-rows")) || 120;
    return { colWidth, rowHeight };
  };

  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const layouts = Array.from(document.querySelectorAll(".widget")).map((widget) => ({
        widget_key: widget.dataset.widgetKey,
        x: Number(widget.dataset.x),
        y: Number(widget.dataset.y),
        w: Number(widget.dataset.w),
        h: Number(widget.dataset.h),
      }));
      fetch("/api/widgets/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layouts }),
      }).catch(() => null);
    }, 400);
  };

  const setEditMode = (enabled) => {
    document.body.classList.toggle("edit-mode", enabled);
    localStorage.setItem(editKey, enabled ? "1" : "0");
    if (editToggle) {
      editToggle.textContent = enabled ? "Done" : "Edit";
    }
  };

  const stored = localStorage.getItem(editKey) === "1";
  setEditMode(stored);
  editToggle?.addEventListener("click", () => {
    setEditMode(!document.body.classList.contains("edit-mode"));
  });

  const startDrag = (event, widget, mode) => {
    const { colWidth, rowHeight } = getMetrics();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = {
      x: Number(widget.dataset.x),
      y: Number(widget.dataset.y),
      w: Number(widget.dataset.w),
      h: Number(widget.dataset.h),
    };

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (mode === "move") {
        const x = clamp(Math.round(start.x + dx / colWidth), 1, maxCols);
        const y = clamp(Math.round(start.y + dy / rowHeight), 1, 99);
        updateWidget(widget, x, y, start.w, start.h);
        return;
      }

      let x = start.x;
      let y = start.y;
      let w = start.w;
      let h = start.h;
      const dw = Math.round(dx / colWidth);
      const dh = Math.round(dy / rowHeight);

      if (mode.includes("r")) {
        w = clamp(start.w + dw, minW, maxCols - start.x + 1);
      }
      if (mode.includes("l")) {
        w = clamp(start.w - dw, minW, maxCols);
        x = clamp(start.x + dw, 1, maxCols - w + 1);
      }
      if (mode.includes("b")) {
        h = clamp(start.h + dh, minH, 99);
      }
      if (mode.includes("t")) {
        h = clamp(start.h - dh, minH, 99);
        y = clamp(start.y + dh, 1, 99 - h + 1);
      }
      updateWidget(widget, x, y, w, h);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scheduleSave();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  grid.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("edit-mode")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const widget = target.closest(".widget");
    if (!widget) return;
    if (target.closest("[data-widget-remove]")) return;

    if (target.dataset.resize) {
      event.preventDefault();
      startDrag(event, widget, target.dataset.resize);
      return;
    }

    if (target.closest(".widget-header")) {
      event.preventDefault();
      startDrag(event, widget, "move");
    }
  });

  grid.addEventListener("click", (event) => {
    if (!document.body.classList.contains("edit-mode")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const removeBtn = target.closest("[data-widget-remove]");
    if (!removeBtn) return;
    const widget = removeBtn.closest(".widget");
    if (!widget) return;
    event.preventDefault();
    const widgetKey = widget.dataset.widgetKey;
    if (!widgetKey) return;
    fetch(`/api/widgets/${widgetKey}/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
      .then(() => {
        widget.remove();
        scheduleSave();
      })
      .catch(() => null);
  });
})();

(() => {
  const statusContainer = document.querySelector("[data-kuma-status]");
  if (!statusContainer) return;

  const render = (payload) => {
    statusContainer.innerHTML = "";
    if (!payload.ok) {
      const empty = document.createElement("div");
      empty.className = "status-empty";
      empty.textContent = payload.reason === "disabled"
        ? "Kuma widget disabled."
        : "Configure Uptime Kuma in Admin.";
      statusContainer.appendChild(empty);
      return;
    }
    const monitors = payload.monitors || [];
    if (!monitors.length) {
      const empty = document.createElement("div");
      empty.className = "status-empty";
      empty.textContent = "No monitors returned yet.";
      statusContainer.appendChild(empty);
      return;
    }
    monitors.forEach((monitor) => {
      const pill = document.createElement("div");
      const isUp = monitor.status === 1 || monitor.status === true;
      pill.className = `status-pill ${isUp ? "up" : "down"}`;
      pill.innerHTML = `<span>${monitor.name}</span><span>${isUp ? "Up" : "Down"}</span>`;
      statusContainer.appendChild(pill);
    });
  };

  const fetchStatus = () => {
    fetch("/api/kuma/summary")
      .then((res) => res.json())
      .then(render)
      .catch(() => render({ ok: false, reason: "unreachable" }));
  };

  fetchStatus();
  setInterval(fetchStatus, 30000);
})();

(() => {
  const calendar = document.querySelector(".calendar");
  const cells = document.querySelector("[data-calendar-cells]");
  if (!cells) return;
  const weekdays = document.querySelector("[data-calendar-weekdays]");
  const filters = document.querySelector("[data-calendar-filters]");
  const title = document.querySelector("[data-calendar-title]");
  const meta = document.getElementById("meta-calendar");
  const btnPrev = document.querySelector("[data-cal-prev]");
  const btnNext = document.querySelector("[data-cal-next]");
  const btnToday = document.querySelector("[data-cal-today]");
  const createButton = document.querySelector("[data-calendar-create]");
  const modal = document.querySelector("[data-modal='calendar']");
  const modalCloses = modal ? modal.querySelectorAll("[data-modal-close]") : [];
  const modalForm = document.querySelector("[data-calendar-form]");
  const modalStatus = document.querySelector("[data-calendar-status]");
  const timezoneButton = document.querySelector("[data-calendar-tz]");
  const timezoneModal = document.querySelector("[data-modal='timezone']");
  const timezoneSelect = timezoneModal?.querySelector("[data-timezone-select]");
  const timezoneSave = timezoneModal?.querySelector("[data-timezone-save]");
  const timezoneCloses = timezoneModal ? timezoneModal.querySelectorAll("[data-modal-close]") : [];
  const detailsModal = document.querySelector("[data-modal='calendar-details']");
  const detailsDate = detailsModal?.querySelector("[data-calendar-detail-date]");
  const detailsList = detailsModal?.querySelector("[data-calendar-detail-list]");
  const detailsCloses = detailsModal ? detailsModal.querySelectorAll("[data-modal-close]") : [];

  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthLabels = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const weekdayMap = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const DAY_MS = 24 * 60 * 60 * 1000;

  const filterKey = "ua-calendar-filters";
  const timezoneCookie = "ua_timezone";
  const calendarUser = document.body?.dataset.user?.trim() || "User";
  const calendarIsAdmin = document.body?.dataset.admin === "true";

  const getCookie = (name) => {
    const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split("=")[1]) : "";
  };

  const setCookie = (name, value, days = 365) => {
    const expires = new Date();
    expires.setDate(expires.getDate() + days);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
  };
  let current = new Date();
  current.setDate(1);

  const serverName = calendar?.dataset.pelicanServerName || "Server";

  const sourcePalette = [
    "#f25f5c",
    "#f6aa1c",
    "#2ec4b6",
    "#9b5de5",
    "#00bbf9",
    "#f15bb5",
    "#90be6d",
    "#ff7b00",
    "#577590",
    "#ef476f",
  ];

  const hashString = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  };

  const pickSourceColor = (source, used) => {
    if (!sourcePalette.length) return "hsl(210 10% 55%)";
    const baseIndex = hashString(source) % sourcePalette.length;
    for (let i = 0; i < sourcePalette.length; i += 1) {
      const color = sourcePalette[(baseIndex + i) % sourcePalette.length];
      if (!Object.values(used).includes(color)) return color;
    }
    return sourcePalette[baseIndex];
  };

  const loadFilters = () => {
    try {
      return JSON.parse(localStorage.getItem(filterKey) || "{}");
    } catch {
      return {};
    }
  };

  const saveFilters = (state) => {
    localStorage.setItem(filterKey, JSON.stringify(state));
  };

  const buildWeekdays = () => {
    weekdays.innerHTML = "";
    weekdayLabels.forEach((label) => {
      const cell = document.createElement("div");
      cell.className = "calendar-weekday";
      cell.textContent = label;
      weekdays.appendChild(cell);
    });
  };

  const buildCells = (events, filterState) => {
    cells.innerHTML = "";
    const viewYear = current.getFullYear();
    const viewMonth = current.getMonth();
    const firstDay = getZonedMiddayDate(viewYear, viewMonth, 1, userTimeZone);
    const startWeekday = getZonedWeekdayIndex(firstDay, userTimeZone);
    const start = new Date(firstDay.getTime() - startWeekday * DAY_MS);
    const todayKey = getDateKey(new Date(), userTimeZone);

    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start.getTime() + i * DAY_MS);
      const parts = getZonedParts(date, userTimeZone);
      const cell = document.createElement("div");
      const isCurrentMonth = parts.year === viewYear && parts.month === viewMonth + 1;
      const cellKey = getDateKey(date, userTimeZone);
      const isToday = cellKey === todayKey;
      cell.className = `calendar-cell${isCurrentMonth ? "" : " muted"}${isToday ? " today" : ""}`;
      cell.dataset.dateKey = cellKey;
      cell.dataset.dateLabel = formatDateLabel(date);

      const label = document.createElement("div");
      label.className = "calendar-date";
      label.textContent = parts.day;
      cell.appendChild(label);

      const dayEvents = events.filter((event) => {
        if (!filterState[event.source]) return false;
        return event.dateKey === cellKey;
      });
      dayEvents.sort((a, b) => {
        const aKey = Number.isFinite(a.sortKey) ? a.sortKey : 9999;
        const bKey = Number.isFinite(b.sortKey) ? b.sortKey : 9999;
        if (aKey !== bKey) return aKey - bKey;
        return String(a.title).localeCompare(String(b.title));
      });

      dayEvents.slice(0, 3).forEach((event) => {
        const bar = document.createElement("div");
        bar.className = "calendar-event-bar";
        bar.style.setProperty("--event-color", event.color);
        cell.appendChild(bar);
      });

      if (dayEvents.length) {
        const summary = document.createElement("div");
        summary.className = "calendar-summary";
        summary.textContent = `${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`;
        cell.appendChild(summary);
      }

      if (dayEvents.length > 3) {
        const more = document.createElement("div");
        more.className = "calendar-more";
        more.textContent = `+${dayEvents.length - 3} more`;
        cell.appendChild(more);
      }

      cell.dataset.events = JSON.stringify(
        dayEvents.map((event) => ({
          id: event.id,
          title: event.title,
          timeLabel: event.timeLabel,
          source: event.source,
          color: event.color,
          sortKey: event.sortKey,
          scheduleId: event.scheduleId,
          startUtc: event.startUtc,
          stopUtc: event.stopUtc,
          description: event.description,
          createdBy: event.createdBy,
          gameName: event.gameName,
          eventName: event.eventName,
        })),
      );

      cells.appendChild(cell);
    }
  };

  const buildFilters = (sources, state) => {
    filters.innerHTML = "";
    const safeSources = sources.map((source) => ({
      id: source.id || 0,
      name: source.name || source,
      pelicanCount: source.pelican_count || 0,
      activeCount: source.active_count || 0,
      deletedCount: source.deleted_count || 0,
    }));
    safeSources.forEach((source) => {
      if (!(source.name in state)) state[source.name] = true;
    });
    saveFilters(state);

    safeSources.forEach((source) => {
      const row = document.createElement("div");
      row.className = "source-row";
      row.dataset.sourceRow = "true";
      row.dataset.source = source.name;
      row.dataset.gameId = String(source.id || "");
      const label = document.createElement("label");
      label.className = "toggle source-pill";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!state[source.name];
      let color = state.__colors?.[source.name];
      if (!color) {
        color = pickSourceColor(source.name, state.__colors || {});
        state.__colors = state.__colors || {};
        state.__colors[source.name] = color;
        saveFilters(state);
      }
      if (color) label.style.setProperty("--source-color", color);
      input.addEventListener("change", () => {
        state[source.name] = input.checked;
        saveFilters(state);
        refreshView();
      });
      const span = document.createElement("span");
      span.textContent = source.name;
      const dot = document.createElement("span");
      dot.className = "source-dot";
      label.appendChild(dot);
      label.appendChild(input);
      label.appendChild(span);
      row.appendChild(label);

      const actions = document.createElement("div");
      actions.className = "source-actions";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn danger source-delete";
      del.dataset.sourceDelete = "true";
      del.textContent = "✕";
      del.title = "Delete all events for this source.";
      actions.appendChild(del);
      row.appendChild(actions);

      filters.appendChild(row);
    });
  };

  filters.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const deleteButton = target.closest("[data-source-delete]");
    if (!deleteButton) return;
    const row = target.closest("[data-source-row]");
    if (!row) return;
    const sourceName = row.dataset.source || "source";
    const gameId = row.dataset.gameId || "";
    if (!gameId) return;

    if (!window.confirm(`Delete all events for ${sourceName}?`)) return;
    deleteButton.disabled = true;
    fetch(`/api/calendar/sources/${gameId}`, { method: "DELETE" })
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.ok) {
          window.alert("Failed to delete source.");
          deleteButton.disabled = false;
          return;
        }
        if (window.UptimeAtlas?.refreshSchedules) window.UptimeAtlas.refreshSchedules();
      })
      .catch(() => {
        window.alert("Failed to delete source.");
        deleteButton.disabled = false;
      });
  });

  let userTimeZone = getCookie(timezoneCookie) || document.body.dataset.timezone || "America/New_York";

  const getZonedParts = (date, timeZone) => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
    };
  };

  const getZonedWeekdayIndex = (date, timeZone) => {
    try {
      const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
        .format(date)
        .toLowerCase();
      return weekdayMap[label] ?? 0;
    } catch {
      return date.getUTCDay();
    }
  };

  const getZonedMiddayDate = (year, monthIndex, day, timeZone) => {
    let date = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
    for (let i = 0; i < 3; i += 1) {
      const parts = getZonedParts(date, timeZone);
      if (parts.year === year && parts.month === monthIndex + 1 && parts.day === day) {
        break;
      }
      const targetUtc = Date.UTC(year, monthIndex, day);
      const actualUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
      const diffDays = Math.round((targetUtc - actualUtc) / DAY_MS);
      if (!diffDays) break;
      date = new Date(date.getTime() + diffDays * DAY_MS);
    }
    return date;
  };

  const getDateKey = (date, timeZone) => {
    const parts = getZonedParts(date, timeZone);
    const month = String(parts.month).padStart(2, "0");
    const day = String(parts.day).padStart(2, "0");
    return `${parts.year}-${month}-${day}`;
  };

  const formatTime = (date) => new Intl.DateTimeFormat("en-US", {
    timeZone: userTimeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  const formatDateTime = (date) => new Intl.DateTimeFormat("en-US", {
    timeZone: userTimeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  const getTimezoneLabel = () => {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: userTimeZone, timeZoneName: "short" });
      return formatter.format(new Date()).split(" ").pop() || userTimeZone;
    } catch {
      return userTimeZone;
    }
  };

  const formatDateLabel = (date) => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: userTimeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
    } catch {
      return date.toDateString();
    }
  };

  const parseDateInput = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      return {
        year: Number(isoMatch[1]),
        month: Number(isoMatch[2]),
        day: Number(isoMatch[3]),
      };
    }
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      return {
        year: Number(slashMatch[3]),
        month: Number(slashMatch[1]),
        day: Number(slashMatch[2]),
      };
    }
    return null;
  };

  const parseTimeInput = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampmMatch) {
      let hour = Number(ampmMatch[1]) % 12;
      const minute = Number(ampmMatch[2]);
      if (ampmMatch[3].toLowerCase() === "pm") hour += 12;
      return { hour, minute };
    }
    const hmMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hmMatch) {
      return { hour: Number(hmMatch[1]), minute: Number(hmMatch[2]) };
    }
    return null;
  };

  const toUtcDate = (dateParts, timeParts, timeZone, dayOffset = 0) => {
    const base = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + dayOffset, 12, 0, 0));
    const target = {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
    };
    let utc = new Date(
      Date.UTC(target.year, target.month - 1, target.day, timeParts.hour, timeParts.minute, 0),
    );
    for (let i = 0; i < 3; i += 1) {
      const parts = getZonedParts(utc, timeZone);
      const desiredUtc = Date.UTC(target.year, target.month - 1, target.day, timeParts.hour, timeParts.minute, 0);
      const actualUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
      const diffMs = desiredUtc - actualUtc;
      if (!diffMs) break;
      utc = new Date(utc.getTime() + diffMs);
    }
    return utc;
  };

  const timezoneOptions = (() => {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
    return [
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Phoenix",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Tokyo",
    ];
  })();

  const updateTimezoneLabel = () => {
    if (timezoneButton) timezoneButton.textContent = getTimezoneLabel();
  };

  const openTimezoneModal = () => {
    if (!timezoneModal || !timezoneSelect) return;
    if (!timezoneSelect.options.length) {
      timezoneOptions.forEach((zone) => {
        const option = document.createElement("option");
        option.value = zone;
        option.textContent = zone;
        timezoneSelect.appendChild(option);
      });
    }
    timezoneSelect.value = userTimeZone;
    timezoneModal.classList.add("open");
  };

  const closeTimezoneModal = () => {
    timezoneModal?.classList.remove("open");
  };

  const applyTimezone = (zone) => {
    if (!zone) return;
    userTimeZone = zone;
    setCookie(timezoneCookie, zone);
    updateTimezoneLabel();
    if (meta) meta.textContent = `${eventCache.length} events · ${getTimezoneLabel()}`;
    refreshView();
  };

  const formatWeekdayLabel = (date) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: userTimeZone, weekday: "short" }).format(date);
    } catch {
      return "";
    }
  };

  const eventsForMonth = (events) => {
    const colorMap = {};
    const normalized = [];
    events.forEach((event) => {
      const gameName = (event.game_name || "").trim() || serverName;
      const eventName = (event.event_name || "").trim() || "Event";
      const gameId = event.game_id || 0;
      const start = new Date(event.start_utc);
      if (!Number.isFinite(start.getTime())) return;
      const stop = event.stop_utc ? new Date(event.stop_utc) : null;
      const source = gameName || serverName;
      if (!colorMap[source]) {
        colorMap[source] = pickSourceColor(source, colorMap);
      }
      const parts = getZonedParts(start, userTimeZone);
      const dateKey = getDateKey(start, userTimeZone);
      const sortKey = Number.isFinite(parts.hour) && Number.isFinite(parts.minute)
        ? parts.hour * 60 + parts.minute
        : 9999;
      let timeLabel = formatTime(start);
      if (stop && Number.isFinite(stop.getTime())) {
        const stopLabel = formatTime(stop);
        const stopKey = getDateKey(stop, userTimeZone);
        if (stopKey !== dateKey) {
          timeLabel = `${timeLabel}–${formatWeekdayLabel(stop)} ${stopLabel}`;
        } else {
          timeLabel = `${timeLabel}–${stopLabel}`;
        }
      }
      normalized.push({
        id: event.id,
        title: gameName ? `${gameName}: ${eventName}` : eventName,
        timeLabel,
        source,
        color: colorMap[source],
        sortKey,
        dateKey,
        scheduleId: event.schedule_id,
        startUtc: event.start_utc,
        stopUtc: event.stop_utc,
        description: (event.description || "").trim(),
        createdBy: (event.created_by || "").trim(),
        gameName,
        eventName,
        gameId,
      });
    });
    return { events: normalized, colors: colorMap };
  };

  const buildSourceListFromEvents = (events) => {
    const map = new Map();
    events.forEach((event) => {
      const name = (event.game_name || "").trim() || serverName;
      const id = event.game_id || 0;
      if (!map.has(name)) {
        map.set(name, { id, name, active_count: 0, deleted_count: 0, pelican_count: 0 });
      }
      const entry = map.get(name);
      entry.active_count += 1;
      if (String(event.schedule_id || "").startsWith("local_")) {
        return;
      }
      entry.pelican_count += 1;
    });
    return Array.from(map.values());
  };

  let eventCache = [];
  let sourceCache = [];
  const statusLabel = (reason) => {
    if (!reason) return "";
    if (reason === "disabled") return "Pelican disabled";
    if (reason.startsWith("missing_")) return "Pelican config incomplete";
    if (reason === "http_401" || reason === "http_403") return "Pelican auth failed";
    if (reason === "invalid_json") return "Pelican response invalid";
    return "Pelican offline";
  };
  const render = (payload) => {
    const hasEvents = Array.isArray(payload.events);
    const hasSources = Array.isArray(payload.sources);
    if (!payload.ok && !hasEvents) {
      if (meta) meta.textContent = statusLabel(payload.reason);
      cells.innerHTML = "";
      return;
    }
    eventCache = hasEvents ? payload.events : [];
    sourceCache = hasSources ? payload.sources : [];
    if (meta) {
      const metaParts = [];
      if (payload.stale || !payload.ok) {
        const status = statusLabel(payload.reason);
        if (status) metaParts.push(status);
      }
      metaParts.push(`${eventCache.length} events · ${getTimezoneLabel()}`);
      meta.textContent = metaParts.join(" · ");
    }
    refreshView();
  };

  const refreshView = () => {
    if (title) {
      title.textContent = `${monthLabels[current.getMonth()]} ${current.getFullYear()}`;
    }
    buildWeekdays();
    const { events, colors } = eventsForMonth(eventCache);
    const filterState = loadFilters();
    filterState.__colors = { ...(filterState.__colors || {}), ...colors };
    const sources = sourceCache.length ? sourceCache : buildSourceListFromEvents(eventCache);
    if (!sources.length) {
      filters.innerHTML = "";
      cells.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "calendar-empty";
      empty.textContent = "No events yet.";
      cells.appendChild(empty);
      return;
    }
    buildFilters(sources, filterState);
    buildCells(events, filterState);
  };

  const fetchSchedules = () => {
    fetch("/api/calendar/events")
      .then((res) => res.json())
      .then(render)
      .catch(() => render({ ok: false, reason: "unreachable" }));
  };

  btnPrev?.addEventListener("click", () => {
    current.setMonth(current.getMonth() - 1);
    refreshView();
  });
  btnNext?.addEventListener("click", () => {
    current.setMonth(current.getMonth() + 1);
    refreshView();
  });
  btnToday?.addEventListener("click", () => {
    const now = new Date();
    current = new Date(now.getFullYear(), now.getMonth(), 1);
    refreshView();
  });

  window.UptimeAtlas = window.UptimeAtlas || {};
  window.UptimeAtlas.refreshSchedules = fetchSchedules;

  updateTimezoneLabel();
  timezoneButton?.addEventListener("click", openTimezoneModal);
  timezoneCloses.forEach((btn) => btn.addEventListener("click", closeTimezoneModal));
  timezoneSave?.addEventListener("click", () => {
    if (!timezoneSelect) return;
    applyTimezone(timezoneSelect.value);
    closeTimezoneModal();
  });

  const closeModal = () => {
    if (modal) modal.classList.remove("open");
  };

  const seedDateTime = () => {
    if (!modalForm) return;
    const dateInput = modalForm.querySelector("[name='date']");
    const startInput = modalForm.querySelector("[name='start_time']");
    const endInput = modalForm.querySelector("[name='end_time']");
    if (
      !(dateInput instanceof HTMLInputElement) ||
      !(startInput instanceof HTMLInputElement) ||
      !(endInput instanceof HTMLInputElement)
    ) {
      return;
    }
    const now = new Date();
    if (!dateInput.value) {
      dateInput.value = now.toISOString().slice(0, 10);
    }
    const minutes = Math.ceil(now.getMinutes() / 5) * 5;
    const rounded = new Date(now);
    rounded.setMinutes(minutes);
    rounded.setSeconds(0);
    if (!startInput.value) {
      const hh = String(rounded.getHours()).padStart(2, "0");
      const mm = String(rounded.getMinutes()).padStart(2, "0");
      startInput.value = `${hh}:${mm}`;
    }
    if (!endInput.value) {
      const end = new Date(rounded);
      end.setHours(end.getHours() + 1);
      const hh = String(end.getHours()).padStart(2, "0");
      const mm = String(end.getMinutes()).padStart(2, "0");
      endInput.value = `${hh}:${mm}`;
    }
  };

  createButton?.addEventListener("click", () => {
    if (modal) modal.classList.add("open");
    seedDateTime();
  });
  modalCloses.forEach((btn) => btn.addEventListener("click", closeModal));

  if (modalForm) {
    modalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(modalForm);
      const game = String(formData.get("game") || "").trim();
      const eventName = String(formData.get("name") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const dateParts = parseDateInput(formData.get("date"));
      const startParts = parseTimeInput(formData.get("start_time"));
      const endParts = parseTimeInput(formData.get("end_time"));
      if (!game) {
        if (modalStatus) modalStatus.textContent = "Game is required.";
        return;
      }
      if (!eventName) {
        if (modalStatus) modalStatus.textContent = "Event name is required.";
        return;
      }
      if (!dateParts || !startParts || !endParts) {
        if (modalStatus) modalStatus.textContent = "Pick a date and start/end time.";
        return;
      }
      const startTotal = startParts.hour * 60 + startParts.minute;
      const endTotal = endParts.hour * 60 + endParts.minute;
      const endOffset = endTotal <= startTotal ? 1 : 0;
      const startUtc = toUtcDate(dateParts, startParts, userTimeZone, 0);
      const endUtc = toUtcDate(dateParts, endParts, userTimeZone, endOffset);
      if (modalStatus) modalStatus.textContent = "Creating event...";
      fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game,
          name: eventName,
          description,
          start_utc: startUtc.toISOString(),
          stop_utc: endUtc.toISOString(),
        }),
      })
        .then((res) => res.json())
        .then((result) => {
          const failureReason = result?.reason || result?.detail || "unknown";
          if (modalStatus) {
            modalStatus.textContent = result.ok ? "Event created." : `Failed: ${failureReason}`;
          }
          if (result.ok) {
            modalForm.reset();
            closeModal();
            if (window.UptimeAtlas?.refreshSchedules) window.UptimeAtlas.refreshSchedules();
          }
        })
        .catch(() => {
          if (modalStatus) modalStatus.textContent = "Failed: unreachable";
        });
    });
  }

  const popover = document.createElement("div");
  popover.className = "calendar-popover";
  document.body.appendChild(popover);

  const tooltip = document.createElement("div");
  tooltip.className = "calendar-tooltip";
  document.body.appendChild(tooltip);

  const closePopover = () => {
    popover.classList.remove("open");
  };

  const closeTooltip = () => {
    tooltip.classList.remove("open");
  };

  const closeDetails = () => {
    detailsModal?.classList.remove("open");
  };

  detailsCloses.forEach((btn) => btn.addEventListener("click", closeDetails));

  const openDetails = (events, dateLabel) => {
    if (!detailsModal || !detailsList) return;
    if (detailsDate) detailsDate.textContent = dateLabel || "Event details";
    detailsList.innerHTML = "";
    events.forEach((item) => {
      const row = document.createElement("div");
      row.className = "calendar-detail-item";
      row.style.setProperty("--event-color", item.color);
      const canDelete = calendarIsAdmin || (item.createdBy && item.createdBy === calendarUser);
      const deleteLabel = "Delete event";
      const deleteButton = canDelete
        ? `<button class="icon-btn danger calendar-detail-delete" type="button" data-delete-event="${item.id}" title="${deleteLabel}">✕</button>`
        : "";
      const metaParts = [];
      if (item.startUtc) {
        const startLabel = formatDateTime(new Date(item.startUtc));
        metaParts.push(`Start: ${startLabel}`);
      }
      if (item.stopUtc) {
        const stopLabel = formatDateTime(new Date(item.stopUtc));
        metaParts.push(`End: ${stopLabel}`);
      }
      if (item.scheduleId) metaParts.push(`Schedule ID: ${item.scheduleId}`);
      const description = item.description ? item.description : "";
      const createdBy = item.createdBy ? item.createdBy : "";
      row.innerHTML = `
        <div class="calendar-detail-header">
          <div class="calendar-detail-title">${item.title}</div>
          ${deleteButton}
        </div>
        ${item.gameName ? `<div class="calendar-detail-source">Game: ${item.gameName}</div>` : ""}
        <div class="calendar-detail-time">${item.timeLabel || "Scheduled"}</div>
        ${description ? `<div class="calendar-detail-description">${description}</div>` : ""}
        ${createdBy ? `<div class="calendar-detail-creator">Created by ${createdBy}</div>` : ""}
        <div class="calendar-detail-meta">${metaParts.map((part) => `<span class="calendar-detail-chip">${part}</span>`).join("")}</div>
      `;
      detailsList.appendChild(row);
    });
    detailsModal.classList.add("open");
  };

  detailsList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-delete-event]");
    if (!button || !(button instanceof HTMLButtonElement)) return;
    const eventId = button.dataset.deleteEvent || "";
    if (!eventId) return;
    if (!window.confirm("Delete this event?")) return;
    button.disabled = true;
    fetch(`/api/calendar/events/${eventId}`, { method: "DELETE" })
      .then((res) => res.json())
      .then((result) => {
        if (!result.ok) {
          window.alert("Failed to delete event.");
          button.disabled = false;
          return;
        }
        closeDetails();
        if (window.UptimeAtlas?.refreshSchedules) window.UptimeAtlas.refreshSchedules();
      })
      .catch(() => {
        window.alert("Failed to delete event.");
        button.disabled = false;
      });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (popover.contains(target) || detailsModal?.contains(target)) return;
    const cell = target.closest(".calendar-cell");
    if (!cell || !cells.contains(cell)) {
      closePopover();
      return;
    }
    const data = cell.dataset.events;
    if (!data) return;
    const events = JSON.parse(data);
    if (!events.length) return;
    closeTooltip();
    popover.innerHTML = "";
    const list = document.createElement("div");
    list.className = "calendar-popover-list";
    events.forEach((item) => {
      const row = document.createElement("div");
      row.className = "calendar-popover-item";
      row.style.setProperty("--event-color", item.color);
      const metaParts = [];
      if (item.timeLabel) metaParts.push(item.timeLabel);
      row.innerHTML = `
        <div class="calendar-popover-title">${item.title}</div>
        <div class="calendar-popover-meta">${metaParts.join(" · ")}</div>
      `;
      list.appendChild(row);
    });
    popover.appendChild(list);
    const actions = document.createElement("div");
    actions.className = "calendar-popover-actions";
    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "btn subtle calendar-popover-btn";
    detailButton.textContent = "View details";
    detailButton.addEventListener("click", (evt) => {
      evt.stopPropagation();
      openDetails(events, cell.dataset.dateLabel);
      closePopover();
    });
    actions.appendChild(detailButton);
    popover.appendChild(actions);
    const rect = cell.getBoundingClientRect();
    popover.style.top = `${rect.top + window.scrollY + 8}px`;
    popover.style.left = `${Math.min(rect.left + window.scrollX + 8, window.innerWidth - 260)}px`;
    popover.classList.add("open");
  });

  cells.addEventListener("mousemove", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const cell = target.closest(".calendar-cell");
    if (!cell || !cells.contains(cell)) {
      closeTooltip();
      return;
    }
    const data = cell.dataset.events;
    if (!data) {
      closeTooltip();
      return;
    }
    const events = JSON.parse(data);
    if (!events.length || popover.classList.contains("open")) {
      closeTooltip();
      return;
    }
    tooltip.innerHTML = "";
    const title = document.createElement("div");
    title.className = "calendar-tooltip-title";
    title.textContent = cell.dataset.dateLabel || "Events";
    tooltip.appendChild(title);
    events.slice(0, 3).forEach((item) => {
      const line = document.createElement("div");
      line.className = "calendar-tooltip-item";
      line.textContent = `${item.title} · ${item.timeLabel || "Anytime"}`;
      tooltip.appendChild(line);
    });
    if (events.length > 3) {
      const more = document.createElement("div");
      more.className = "calendar-tooltip-item";
      more.textContent = `+${events.length - 3} more`;
      tooltip.appendChild(more);
    }
    const offset = 12;
    tooltip.style.top = `${event.pageY + offset}px`;
    tooltip.style.left = `${Math.min(event.pageX + offset, window.innerWidth - 240)}px`;
    tooltip.classList.add("open");
  });

  cells.addEventListener("mouseleave", closeTooltip);

  fetchSchedules();
  setInterval(fetchSchedules, 60000);
})();

(() => {
  const addButton = document.querySelector("[data-widget-add-open]");
  const modal = document.querySelector("[data-modal='widget-add']");
  if (!addButton || !modal) return;

  const closeButtons = modal.querySelectorAll("[data-modal-close]");
  const options = modal.querySelectorAll("[data-widget-type]");
  const status = modal.querySelector("[data-widget-add-status]");

  const updateOptionState = () => {
    const existing = new Set(
      Array.from(document.querySelectorAll(".widget")).map((widget) => widget.dataset.widgetKey)
    );
    options.forEach((option) => {
      const key = option.dataset.widgetType;
      const isPresent = existing.has(key);
      option.disabled = isPresent;
      if (isPresent) {
        option.setAttribute("title", "Already on canvas");
      } else {
        option.removeAttribute("title");
      }
    });
  };

  const openModal = () => {
    if (status) status.textContent = "";
    updateOptionState();
    modal.classList.add("open");
  };

  const closeModal = () => {
    modal.classList.remove("open");
  };

  addButton.addEventListener("click", openModal);
  closeButtons.forEach((btn) => btn.addEventListener("click", closeModal));

  options.forEach((option) => {
    option.addEventListener("click", () => {
      if (option.disabled) return;
      const widgetKey = option.dataset.widgetType;
      if (!widgetKey) return;
      if (status) status.textContent = "Adding widget...";
      fetch("/api/widgets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widget_key: widgetKey }),
      })
        .then((res) => res.json())
        .then((payload) => {
          if (!payload.ok) {
            if (status) status.textContent = payload.message || "Unable to add widget.";
            return;
          }
          if (status) status.textContent = "Widget added.";
          window.location.reload();
        })
        .catch(() => {
          if (status) status.textContent = "Unable to add widget.";
        });
    });
  });
})();
