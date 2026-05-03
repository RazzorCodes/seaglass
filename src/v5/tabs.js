window.SeaglassTabs = (function () {
  let _pollTimer = null;
  let _currentUrl = null;
  let _currentParams = {};

  // ── Fetch & inject ─────────────────────────────────────────────────────────

  async function _load() {
    if (!_currentUrl) return;
    const qs = new URLSearchParams(_currentParams).toString();
    const url = qs ? `${_currentUrl}?${qs}` : _currentUrl;
    try {
      const r = await fetch(url);
      if (r.ok) window.SeaglassDOM.tabPane.innerHTML = await r.text();
    } catch (_) {}
  }

  // ── Poll management ────────────────────────────────────────────────────────

  function _stopPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
  }

  // ── Batch bar sync ─────────────────────────────────────────────────────────

  function _syncBatchBar() {
    const pane = window.SeaglassDOM.tabPane;
    const bar = pane.querySelector("#batch-bar");
    if (!bar) return;
    const checked = pane.querySelectorAll(".row-check:checked");
    bar.classList.toggle("visible", checked.length > 0);
    const countEl = pane.querySelector("#batch-count");
    if (countEl) countEl.textContent = `${checked.length} selected`;
  }

  // ── Action dispatcher ──────────────────────────────────────────────────────

    async function _dispatchAction(btn) {
        const data = btn.dataset;

        if (data.confirm && !window.confirm(data.confirm)) return;

        switch (data.action) {
            case "retry":
                _load();
                return;

            case "batch-clear": {
                const pane = window.SeaglassDOM.tabPane;
                pane.querySelectorAll(".row-check, #check-all").forEach((c) => (c.checked = false));
                _syncBatchBar();
                return;
            }

            case "process-batch": {
                const pane = window.SeaglassDOM.tabPane;
                const hashes = [...pane.querySelectorAll(".row-check:checked")].map((c) => c.value);
                if (!hashes.length) return;
                await fetch(data.url, {
                    method: data.method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(hashes),
                });
                break;
            }

            default:
                await fetch(data.url, { method: data.method });
        }

        _load();
    }

  // ── Pane event delegation ──────────────────────────────────────────────────

  function _initDelegation() {
    const pane = window.SeaglassDOM.tabPane;

    pane.addEventListener("input", (e) => {
      const el = e.target.closest("[data-filter]");
      if (!el || !_currentUrl) return;
      _currentParams[el.dataset.filter] = el.value;
      _load();
    });

    pane.addEventListener("change", (e) => {
      if (
        e.target.classList.contains("row-check") ||
        e.target.id === "check-all"
      ) {
        if (e.target.id === "check-all") {
          pane
            .querySelectorAll(".row-check")
            .forEach((c) => (c.checked = e.target.checked));
        }
        _syncBatchBar();
      }
    });

    pane.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (th && _currentUrl) {
        const col = th.dataset.sort;
        const dir =
          _currentParams.sort === col && _currentParams.dir === "asc"
            ? "desc"
            : "asc";
        _currentParams.sort = col;
        _currentParams.dir = dir;
        _load();
        return;
      }

      const btn = e.target.closest("[data-action]");
      if (btn && !btn.disabled) {
        e.stopPropagation();
        _dispatchAction(btn);
      }
    });
  }

  // ── Tab activation ─────────────────────────────────────────────────────────

  function _activateTab(app, tab) {
    _stopPolling();
    _currentParams = {};

    if (!tab.url || app.status !== "online") {
      window.SeaglassContent.showState();
      return;
    }

    _currentUrl = tab.url;
    window.SeaglassContent.showPane();
    _load();

    if (tab.poll) {
      _pollTimer = setInterval(_load, tab.poll);
    }
  }

  // ── Tab bar rendering ──────────────────────────────────────────────────────

  function renderTabs(app) {
    const { tabbar, tabsRight } = window.SeaglassDOM;
    const state = window.SeaglassState;

    _stopPolling();
    _currentUrl = null;
    _currentParams = {};
    tabbar.querySelectorAll(".tab-btn").forEach((n) => n.remove());

    const tabs = Array.isArray(app.tabs) ? app.tabs : [];
    tabs.forEach((tab, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn";
      btn.dataset.tab = tab.id;
      btn.innerHTML = `${tab.label}${tab.badge ? ` <span class="badge">${tab.badge}</span>` : ""}`;

      if (index === 0) {
        btn.classList.add("active");
        state.activeTabId = tab.id;
        _activateTab(app, tab);
      }

      btn.addEventListener("click", () => {
        tabbar
          .querySelectorAll(".tab-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.activeTabId = tab.id;
        _activateTab(app, tab);
      });

      tabbar.insertBefore(btn, tabsRight);
    });

    tabsRight.textContent = `${app.label}: ${app.version || ""}`;
  }

  _initDelegation();

  return { renderTabs };
})();
