// src/client/api.ts
var basePrefix = window.__BASE_PREFIX__ || "";
function getApiUrl(path) {
  return `${basePrefix}${path.startsWith("/") ? path : `/${path}`}`;
}
async function apiRequest(path, options = {}) {
  const url = getApiUrl(path);
  const fetchOptions = { ...options };
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    fetchOptions.headers = {
      "Content-Type": "application/json",
      ...options.headers || {}
    };
    fetchOptions.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, fetchOptions);
  if (res.status === 401) {
    window.location.href = `${basePrefix}/login`;
    throw new Error("\u672A\u6388\u6743\u6216\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u6B63\u5728\u8DF3\u8F6C\u767B\u5F55\u9875...");
  }
  const contentType = res.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    return { ok: res.ok, status: res.status, ...data };
  }
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// src/client/ui.ts
function showToast(msg, isError = false) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.style.borderLeftColor = isError ? "var(--danger)" : "var(--success)";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// src/client/login.ts
var basePrefix2 = window.__BASE_PREFIX__ || "";
document.addEventListener("DOMContentLoaded", () => {
  const btnTheme = document.getElementById("btn-login-theme-toggle");
  const themeIcon = document.getElementById("login-theme-icon");
  function updateLoginThemeIcon(theme) {
    if (themeIcon) {
      themeIcon.className = theme === "light" ? "ri-moon-line" : "ri-sun-line";
    }
  }
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  updateLoginThemeIcon(currentTheme);
  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      const now = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", now);
      localStorage.setItem("theme", now);
      updateLoginThemeIcon(now);
    });
  }
  const btnTogglePwd = document.getElementById("btn-toggle-pwd");
  const tokenInput = document.getElementById("admin-token-input");
  const togglePwdIcon = document.getElementById("toggle-pwd-icon");
  if (btnTogglePwd && tokenInput) {
    btnTogglePwd.addEventListener("click", () => {
      const isPassword = tokenInput.type === "password";
      tokenInput.type = isPassword ? "text" : "password";
      if (togglePwdIcon) {
        togglePwdIcon.className = isPassword ? "ri-eye-off-line" : "ri-eye-line";
      }
    });
  }
  const loginForm = document.getElementById("login-form");
  const btnSubmit = document.getElementById("btn-submit-login");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = tokenInput ? tokenInput.value.trim() : "";
      if (!token) return;
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> <span>\u9A8C\u8BC1\u4E2D...</span>';
      }
      try {
        const result = await apiRequest("/api/login", {
          method: "POST",
          body: { token }
        });
        if (result.success) {
          showToast("\u767B\u5F55\u6210\u529F\uFF0C\u6B63\u5728\u8FDB\u5165\u63A7\u5236\u53F0...");
          setTimeout(() => {
            window.location.href = `${basePrefix2}/control`;
          }, 400);
        } else {
          showToast(result.error || "Token \u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5BC6\u7801", true);
          if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<span>\u8FDB\u5165\u7BA1\u7406\u9762\u677F</span> <i class="ri-arrow-right-line"></i>';
          }
        }
      } catch {
        showToast("\u7F51\u7EDC\u8BF7\u6C42\u5F02\u5E38\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", true);
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '<span>\u8FDB\u5165\u7BA1\u7406\u9762\u677F</span> <i class="ri-arrow-right-line"></i>';
        }
      }
    });
  }
});
