(() => {
  const saveButton = document.querySelector("[data-save-settings]");
  if (!saveButton) return;

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
        setTimeout(() => {
          saveButton.textContent = "Save settings";
        }, 1500);
      })
      .catch(() => null);
  });

  document.querySelectorAll("[data-widget-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      fetch(`/api/widgets/${toggle.value}/enabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: toggle.checked }),
      }).catch(() => null);
    });
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
})();