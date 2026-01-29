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
    if (!(target instanceof HTMLElement)) return;
    const widget = target.closest(".widget");
    if (!widget) return;

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
  const modalCloses = document.querySelectorAll("[data-modal-close]");
  const modalForm = document.querySelector("[data-calendar-form]");
  const modalStatus = document.querySelector("[data-calendar-status]");

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

  const filterKey = "ua-calendar-filters";
  let current = new Date();
  current.setDate(1);

  const serverName = calendar?.dataset.pelicanServerName || "Server";
  const parseSource = (name) => {
    if (!name) return serverName;
    if (name.includes(":")) {
      return name.split(":")[0].trim() || serverName;
    }
    return serverName;
  };

  const parseCronField = (value) => {
    if (!value || value === "*") return ["*"];
    if (typeof value !== "string") return [String(value)];
    if (value.includes("/")) return [];
    const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
    const result = [];
    parts.forEach((part) => {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map((num) => Number(num));
        if (Number.isFinite(start) && Number.isFinite(end)) {
          for (let i = start; i <= end; i += 1) result.push(String(i));
        }
      } else {
        result.push(part);
      }
    });
    return result.length ? result : [];
  };

  const normalizeDayOfWeek = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    if (num === 7) return 0;
    if (num < 0 || num > 6) return null;
    return num;
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
    const firstDay = new Date(current.getFullYear(), current.getMonth(), 1);
    const start = new Date(firstDay);
    start.setDate(start.getDate() - start.getDay());
    const today = new Date();

    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const cell = document.createElement("div");
      const isCurrentMonth = date.getMonth() === current.getMonth();
      const isToday =
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate();
      cell.className = `calendar-cell${isCurrentMonth ? "" : " muted"}${isToday ? " today" : ""}`;

      const label = document.createElement("div");
      label.className = "calendar-date";
      label.textContent = date.getDate();
      cell.appendChild(label);

      const dayEvents = events.filter((event) => {
        if (!filterState[event.source]) return false;
        return (
          event.date.getFullYear() === date.getFullYear() &&
          event.date.getMonth() === date.getMonth() &&
          event.date.getDate() === date.getDate()
        );
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
          label: event.label,
          source: event.source,
          color: event.color,
        })),
      );

      cells.appendChild(cell);
    }
  };

  const buildFilters = (sources) => {
    filters.innerHTML = "";
    const state = loadFilters();
    sources.forEach((source) => {
      if (!(source in state)) state[source] = true;
    });
    saveFilters(state);

    sources.forEach((source) => {
      const label = document.createElement("label");
      label.className = "toggle source-pill";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!state[source];
      const color = state.__colors?.[source];
      if (color) label.style.setProperty("--source-color", color);
      input.addEventListener("change", () => {
        state[source] = input.checked;
        saveFilters(state);
        refreshView();
      });
      const span = document.createElement("span");
      span.textContent = source;
      const dot = document.createElement("span");
      dot.className = "source-dot";
      label.appendChild(dot);
      label.appendChild(input);
      label.appendChild(span);
      filters.appendChild(label);
    });
  };

  const baseTimeZone = "America/New_York";
  const userTimeZone = document.body.dataset.timezone || baseTimeZone;

  const getTimeZoneOffset = (date, timeZone) => {
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
    const asUTC = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    return (asUTC - date.getTime()) / 60000;
  };

  const timeInZone = (date, timeZone) => {
    const offset = getTimeZoneOffset(date, timeZone);
    return new Date(date.getTime() - offset * 60000);
  };

  const formatTimeLabel = (hourValue, minuteValue, date) => {
    if (hourValue === "*" || minuteValue === "*") {
      return "Anytime";
    }
    const hour = Number(hourValue);
    const minute = Number(minuteValue);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return "Anytime";
    }
    const baseDate = timeInZone(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0)), baseTimeZone);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: userTimeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    return formatter.format(baseDate);
  };

  const getTimezoneLabel = () => {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: userTimeZone, timeZoneName: "short" });
      return formatter.format(new Date()).split(" ").pop() || userTimeZone;
    } catch {
      return userTimeZone;
    }
  };

  const scheduleEventsForMonth = (schedules) => {
    const events = [];
    const sources = new Set();
    const month = current.getMonth();
    const year = current.getFullYear();
    const lastDay = new Date(year, month + 1, 0).getDate();

    const colorMap = {};
    schedules.forEach((schedule, idx) => {
      const source = parseSource(schedule.name || "");
      sources.add(source);
      if (!colorMap[source]) {
        colorMap[source] = `hsl(${(idx * 57) % 360} 60% 55%)`;
      }

      const cron = schedule.cron || {};
      const daysOfWeek = parseCronField(cron.day_of_week || "*")
        .map((value) => normalizeDayOfWeek(value))
        .filter((value) => value !== null);
      const daysOfMonth = parseCronField(cron.day_of_month || "*").filter((value) => value !== "*");

      const hour = cron.hour || "*";
      const minute = cron.minute || "*";

      const active = schedule.is_active !== false;
      const label = schedule.name || "Schedule";
      const labelSuffix = active ? "" : " · Paused";
      const color = colorMap[source];

      if (daysOfMonth.length) {
        daysOfMonth.forEach((dayValue) => {
          const day = Number(dayValue);
          if (!Number.isFinite(day) || day < 1 || day > lastDay) return;
          const date = new Date(year, month, day);
          const timeLabel = formatTimeLabel(hour, minute, date);
          events.push({
            date,
            label: `${label} · ${timeLabel}${labelSuffix}`,
            source,
            color: active ? color : "hsl(210 10% 55%)",
          });
        });
      } else if (daysOfWeek.length) {
        for (let day = 1; day <= lastDay; day += 1) {
          const date = new Date(year, month, day);
          if (daysOfWeek.includes(date.getDay())) {
            const timeLabel = formatTimeLabel(hour, minute, date);
            events.push({
              date,
              label: `${label} · ${timeLabel}${labelSuffix}`,
              source,
              color: active ? color : "hsl(210 10% 55%)",
            });
          }
        }
      } else {
        for (let day = 1; day <= lastDay; day += 1) {
          const date = new Date(year, month, day);
          const timeLabel = formatTimeLabel(hour, minute, date);
          events.push({
            date,
            label: `${label} · ${timeLabel}${labelSuffix}`,
            source,
            color: active ? color : "hsl(210 10% 55%)",
          });
        }
      }
    });

    return { events, sources: Array.from(sources).sort(), colors: colorMap };
  };

  let scheduleCache = [];
  const render = (payload) => {
    if (!payload.ok) {
      if (meta) meta.textContent = payload.reason === "disabled" ? "Pelican disabled" : "Pelican offline";
      cells.innerHTML = "";
      return;
    }
    scheduleCache = payload.schedules || [];
    if (meta) meta.textContent = `${scheduleCache.length} schedules · ${getTimezoneLabel()}`;
    refreshView();
  };

  const refreshView = () => {
    if (title) {
      title.textContent = `${monthLabels[current.getMonth()]} ${current.getFullYear()}`;
    }
    buildWeekdays();
    const { events, sources, colors } = scheduleEventsForMonth(scheduleCache);
    const filterState = loadFilters();
    filterState.__colors = colors;
    saveFilters(filterState);
    if (!sources.length) {
      cells.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "calendar-empty";
      empty.textContent = "No schedules yet.";
      cells.appendChild(empty);
      return;
    }
    buildFilters(sources);
    buildCells(events, loadFilters());
  };

  const fetchSchedules = () => {
    fetch("/api/pelican/schedules")
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

  const closeModal = () => {
    if (modal) modal.classList.remove("open");
  };

  createButton?.addEventListener("click", () => {
    if (modal) modal.classList.add("open");
  });
  modalCloses.forEach((btn) => btn.addEventListener("click", closeModal));

  if (modalForm) {
    modalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(modalForm);
      const payload = {};
      formData.forEach((value, key) => {
        payload[key] = value;
      });
      const source = (payload.source || "").trim();
      if (source) {
        payload.name = `${source}: ${payload.name}`;
      }
      delete payload.source;
      payload.is_active = !!modalForm.querySelector("[name='is_active']")?.checked;
      payload.only_when_online = !!modalForm.querySelector("[name='only_when_online']")?.checked;
      if (modalStatus) modalStatus.textContent = "Creating schedule...";
      fetch("/api/pelican/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((res) => res.json())
        .then((result) => {
          if (modalStatus) {
            modalStatus.textContent = result.ok ? "Schedule created." : `Failed: ${result.reason}`;
          }
          if (result.ok) {
            modalForm.reset();
            modalForm.querySelector("[name='is_active']").checked = true;
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

  const closePopover = () => {
    popover.classList.remove("open");
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const cell = target.closest(".calendar-cell");
    if (!cell || !cells.contains(cell)) {
      closePopover();
      return;
    }
    const data = cell.dataset.events;
    if (!data) return;
    const events = JSON.parse(data);
    if (!events.length) return;
    popover.innerHTML = "";
    const list = document.createElement("div");
    list.className = "calendar-popover-list";
    events.forEach((item) => {
      const row = document.createElement("div");
      row.className = "calendar-popover-item";
      row.style.setProperty("--event-color", item.color);
      row.textContent = `${item.source}: ${item.label}`;
      list.appendChild(row);
    });
    popover.appendChild(list);
    const rect = cell.getBoundingClientRect();
    popover.style.top = `${rect.top + window.scrollY + 8}px`;
    popover.style.left = `${Math.min(rect.left + window.scrollX + 8, window.innerWidth - 260)}px`;
    popover.classList.add("open");
  });

  fetchSchedules();
  setInterval(fetchSchedules, 60000);
})();
