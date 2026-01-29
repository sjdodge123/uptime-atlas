(() => {
  const timezoneSelect = document.querySelector("[data-profile-timezone]");
  if (timezoneSelect) {
    timezoneSelect.addEventListener("change", () => {
      fetch("/api/profile/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: timezoneSelect.value }),
      }).catch(() => null);
    });
  }

  const passwordForm = document.querySelector("[data-password-form]");
  const passwordStatus = document.querySelector("[data-password-status]");
  if (passwordForm) {
    passwordForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(passwordForm);
      const payload = Object.fromEntries(formData.entries());
      if (passwordStatus) passwordStatus.textContent = "Updating...";
      fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then((result) => {
          if (passwordStatus) {
            passwordStatus.textContent = result.ok ? "Password updated." : result.data.detail || "Update failed.";
          }
          if (result.ok) passwordForm.reset();
        })
        .catch(() => {
          if (passwordStatus) passwordStatus.textContent = "Update failed.";
        });
    });
  }

  const saveOauth = document.querySelector("[data-save-oauth]");
  if (saveOauth) {
    saveOauth.addEventListener("click", () => {
      const payload = {};
      document.querySelectorAll("[data-oauth-allow]").forEach((input) => {
        payload[input.dataset.oauthAllow] = input.value;
      });
      fetch("/api/oauth/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);
    });
  }

  const usersTable = document.querySelector("[data-users-table]");
  if (usersTable) {
    const loadUsers = () => {
      fetch("/api/users")
        .then((res) => res.json())
        .then((payload) => {
          usersTable.innerHTML = "";
          (payload.users || []).forEach((user) => {
            const row = document.createElement("div");
            row.className = "user-row";

            const name = document.createElement("div");
            name.textContent = user.username;

            const role = document.createElement("select");
            ["user", "admin", "root"].forEach((optionValue) => {
              const option = document.createElement("option");
              option.value = optionValue;
              option.textContent = optionValue;
              if (user.role === optionValue) option.selected = true;
              role.appendChild(option);
            });

            role.addEventListener("change", () => {
              fetch(`/api/users/${encodeURIComponent(user.username)}/role`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: role.value }),
              }).catch(() => null);
            });

            row.appendChild(name);
            row.appendChild(role);
            usersTable.appendChild(row);
          });
        })
        .catch(() => null);
    };

    loadUsers();
  }
})();