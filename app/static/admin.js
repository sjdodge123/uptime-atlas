(() => {
  const saveButton = document.querySelector("[data-save-settings]");
  if (!saveButton) return;
  const pelicanEnabledInput = document.querySelector("[data-setting='pelican_config.enabled']");
  let lastPelicanEnabled =
    pelicanEnabledInput instanceof HTMLInputElement ? pelicanEnabledInput.checked : false;

  const collectSettings = () => {
    const payload = {};
    document.querySelectorAll("[data-setting]").forEach((input) => {
      const path = input.dataset.setting;
      if (!path || !path.includes(".")) return;
      const [group, key] = path.split(".");
      if (!payload[group]) payload[group] = {};
      let value;
      if (input.type === "checkbox") {
        value = input.checked;
      } else {
        value = input.value;
      }
      payload[group][key] = value;
    });
    return payload;
  };

  saveButton.addEventListener("click", () => {
    const payload = collectSettings();
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(() => {
        saveButton.textContent = "Saved";
        const pelicanEnabled = !!payload.pelican_config?.enabled;
        const toggledOn = !lastPelicanEnabled && pelicanEnabled;
        lastPelicanEnabled = pelicanEnabled;
        if (window.UptimeAtlas?.refreshSchedules) window.UptimeAtlas.refreshSchedules();
        setTimeout(() => {
          saveButton.textContent = "Save settings";
        }, 1500);
      })
      .catch(() => null);
  });

  const testButton = document.querySelector("[data-test-kuma]");
  const testOutput = document.querySelector("[data-kuma-status-msg]");
  if (testButton && testOutput) {
    testButton.addEventListener("click", () => {
      testOutput.textContent = "Testing...";
      fetch("/api/kuma/summary")
        .then((res) => res.json())
        .then((payload) => {
          if (payload.ok) {
            testOutput.textContent = `Connected via ${payload.source || "unknown"}.`;
          } else {
            testOutput.textContent = `Failed: ${payload.reason}`;
          }
        })
        .catch(() => {
          testOutput.textContent = "Failed: unreachable";
        });
    });
  }

  const pelicanResyncButton = document.querySelector("[data-pelican-resync]");
  const pelicanStatus = document.querySelector("[data-pelican-status-msg]");
  if (pelicanResyncButton) {
    const defaultStatus = pelicanStatus?.textContent || "";
    const formatPelicanFailure = (reason) => {
      if (reason === "disabled") return "Resync failed: Pelican disabled.";
      if (reason && reason.startsWith("missing_")) return "Resync failed: Pelican config incomplete.";
      if (reason === "http_401" || reason === "http_403") return "Resync failed: Pelican auth failed.";
      if (reason === "invalid_json") return "Resync failed: Pelican response invalid.";
      if (reason) return "Resync failed: Pelican offline.";
      return "Resync failed.";
    };
    pelicanResyncButton.addEventListener("click", () => {
      if (!window.confirm(
        "Force resync Pelican schedules? This will re-create all previously deleted events."
      )) {
        return;
      }
      pelicanResyncButton.disabled = true;
      if (pelicanStatus) pelicanStatus.textContent = "Resyncing Pelican schedules...";
      fetch("/api/pelican/resync", { method: "POST" })
        .then((res) => res.json())
        .then((payload) => {
          if (!payload.ok) {
            if (pelicanStatus) pelicanStatus.textContent = formatPelicanFailure(payload.reason);
            pelicanResyncButton.disabled = false;
            return;
          }
          const count = Number(payload.events || 0);
          if (pelicanStatus) {
            pelicanStatus.textContent = count
              ? `Resync complete: ${count} events updated.`
              : "Resync complete.";
          }
          if (window.UptimeAtlas?.refreshSchedules) window.UptimeAtlas.refreshSchedules();
          pelicanResyncButton.disabled = false;
          if (pelicanStatus && defaultStatus) {
            setTimeout(() => {
              pelicanStatus.textContent = defaultStatus;
            }, 4000);
          }
        })
        .catch(() => {
          if (pelicanStatus) pelicanStatus.textContent = "Resync failed: unreachable.";
          pelicanResyncButton.disabled = false;
        });
    });
  }
})();
