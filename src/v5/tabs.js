window.SeaglassTabs = (function () {
    let _pollTimer = null;
    let _refreshTimer = null;
    let _currentUrl = null;
    let _currentParams = {};      // sort, dir, q (from search input)
    let _activeFilters = [];      // [{ field, op, val, label }]

    const FILTER_FIELDS = {
        status:  { label: "Status",  ops: ["is", "is not"], values: ["Pending", "Done", "Error", "Running"] },
        codec:   { label: "Codec",   ops: ["is", "is not"], values: ["H.264", "H.265", "AV1"] },
        quality: { label: "Quality", ops: ["is", "is not"], values: ["4K", "1080p", "720p", "480p"] },
        ar:      { label: "AR",      ops: ["is", "is not"], values: null, type: "text" },
        mbs:     { label: "Mb/s",    ops: [">=", "<="],     values: null, type: "number" },
    };

    let INFO_SORT_CYCLE = ["quality", "size", "duration", "mbs", "codec", "ar"];

    // ── Filter state ───────────────────────────────────────────────────────────

    function _filtersToParams() {
        const out = {};
        for (const f of _activeFilters) {
            if (f.field === "mbs") {
                out[f.op === ">=" ? "mbs_gte" : "mbs_lte"] = f.val;
            } else {
                const key = f.op === "is not" ? `${f.field}_ne` : f.field;
                const arr = Array.isArray(out[key]) ? out[key] : [];
                arr.push(f.val);
                out[key] = arr;
            }
        }
        return out;
    }

    function _startRefreshTimer() {
        if (_refreshTimer) return;
        _refreshTimer = setInterval(async () => {
            try { await fetch('/api/brinecrypt/refresh', { method: 'POST' }); } catch (_) {}
        }, 10 * 60 * 1000);
    }

    function _renderFilterTags() {
        const el = window.SeaglassDOM.tabToolbar.querySelector("#filter-tags");
        if (!el) return;
        el.innerHTML = _activeFilters.map((f, i) =>
            `<span class="filter-tag">${f.label}<button class="filter-tag-x" data-fi="${i}" title="Remove">×</button></span>`
        ).join("");
    }

    // ── Filter builder init (called after toolbar HTML is injected) ────────────

    function _initFilterBuilder() {
        const toolbar  = window.SeaglassDOM.tabToolbar;
        if (!FILTER_FIELDS) return;

        // reset AR values each activation, then re-populate from server data
        FILTER_FIELDS.ar.values = null;
        const arEl = toolbar.querySelector("#fb-ar-values");
        if (arEl) {
            try {
                const vals = JSON.parse(arEl.dataset.values);
                if (vals.length) FILTER_FIELDS.ar.values = vals;
            } catch (_) {}
        }
        INFO_SORT_CYCLE = FILTER_FIELDS.ar.values
            ? ["quality", "size", "duration", "mbs", "codec", "ar"]
            : ["quality", "size", "duration", "mbs", "codec"];

        const fbField    = toolbar.querySelector("#fb-field");
        const fbControls = toolbar.querySelector("#fb-controls");
        const fbOp       = toolbar.querySelector("#fb-op");
        const fbValSel   = toolbar.querySelector("#fb-val-select");
        const fbValIn    = toolbar.querySelector("#fb-val-input");
        const fbAdd      = toolbar.querySelector("#fb-add");
        const filterTags = toolbar.querySelector("#filter-tags");
        if (!fbField || !filterTags) return;

        // populate field dropdown from config; skip AR if no data available
        Object.entries(FILTER_FIELDS).forEach(([key, cfg]) => {
            if (key === "ar" && !cfg.values) return;
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = cfg.label;
            fbField.appendChild(opt);
        });

        // field selection → update operator + value controls
        fbField.addEventListener("change", () => {
            const key = fbField.value;
            if (!key) { fbControls.hidden = true; return; }
            const cfg = FILTER_FIELDS[key];

            fbOp.innerHTML = cfg.ops.map(op => `<option>${op}</option>`).join("");
            fbOp.hidden = cfg.ops.length === 1;

            if (cfg.values) {
                fbValSel.innerHTML = cfg.values
                    .map(v => `<option value="${v.toLowerCase()}">${v}</option>`)
                    .join("");
                fbValSel.hidden = false;
                fbValIn.hidden  = true;
            } else {
                fbValIn.type  = cfg.type || "text";
                fbValIn.value = "";
                fbValSel.hidden = true;
                fbValIn.hidden  = false;
                fbValIn.focus();
            }
            fbControls.hidden = false;
        });

        // Enter key on value input submits
        fbValIn.addEventListener("keydown", (e) => {
            if (e.key === "Enter") fbAdd.click();
        });

        // Add Filter button
        fbAdd.addEventListener("click", () => {
            const key = fbField.value;
            if (!key) return;
            const cfg = FILTER_FIELDS[key];
            const op  = fbOp.value || cfg.ops[0];
            const val = cfg.values ? fbValSel.value : fbValIn.value.trim();
            if (!val) return;

            const displayVal = cfg.values
                ? (cfg.values.find(v => v.toLowerCase() === val) || val)
                : val;
            const label = op === "is"
                ? `${cfg.label}: ${displayVal}`
                : `${cfg.label} ${op} ${displayVal}`;

            _activeFilters.push({ field: key, op, val, label });
            _renderFilterTags();
            _loadResults();

            fbField.value = "";
            fbControls.hidden = true;
        });

        // Tag × removal (delegated on stable container)
        filterTags.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-fi]");
            if (!btn) return;
            const idx = parseInt(btn.dataset.fi, 10);
            _activeFilters.splice(idx, 1);
            _renderFilterTags();
            _loadResults();
        });
    }

    // ── Logout ─────────────────────────────────────────────────────────────────

    function _wireLogout(widget) {
        const btn = widget.querySelector('#bc-logout-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            await fetch('/api/brinecrypt/logout', { method: 'POST' }).catch(() => {});
            window.SeaglassBrinecrypt?.reset();
            resetLoginWidget();
        });
    }

    // ── Login widget injection ─────────────────────────────────────────────────

    function _injectLoginWidget() {
        const toolbar = window.SeaglassDOM.tabToolbar;
        const state = window.SeaglassState;

        // Only show for brinecrypt service
        if (!state.activeApp || state.activeApp.id !== 'brinecrypt') return;

        // Don't inject if already present
        if (toolbar.querySelector('#brinecrypt-login-widget')) return;

        const widget = document.createElement('div');
        widget.id = 'brinecrypt-login-widget';
        widget.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1e293b;border-radius:6px;margin-bottom:8px;';
        widget.innerHTML = `
            <input type="text" id="bc-user" placeholder="Username" style="padding:4px 8px;border:1px solid #334155;border-radius:4px;background:#0f172a;color:#e2e8f0;font-size:13px;width:140px;">
            <input type="password" id="bc-pass" placeholder="Password" style="padding:4px 8px;border:1px solid #334155;border-radius:4px;background:#0f172a;color:#e2e8f0;font-size:13px;width:140px;">
            <button id="bc-login-btn" style="padding:4px 12px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;">Login</button>
            <span id="bc-login-status" style="font-size:12px;color:#94a3b8;"></span>
        `;

        // Insert at the top of toolbar — works even if toolbar is empty
        toolbar.insertBefore(widget, toolbar.firstChild);

        // Fast path: in-memory (tab switches within the same page load)
        if (window.SeaglassBrinecrypt?.hasSession()) {
            const user = window.SeaglassBrinecrypt.getUser();
            widget.innerHTML = `<span style="color:#22c55e;font-size:13px;">Logged in as <strong>${user}</strong></span><button id="bc-logout-btn" style="margin-left:10px;padding:3px 10px;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.28);border-radius:4px;cursor:pointer;font-size:12px;">Logout</button>`;
            _wireLogout(widget);
            window.SeaglassBrinecrypt?.onLogin();
        } else {
            // Slow path: check Flask session (handles page reload with existing session)
            fetch('/api/brinecrypt/session').then(r => r.json()).then(data => {
                if (data.logged_in) {
                    window.SeaglassBrinecrypt?.setSession(data.user);
                    widget.innerHTML = `<span style="color:#22c55e;font-size:13px;">Logged in as <strong>${data.user}</strong></span><button id="bc-logout-btn" style="margin-left:10px;padding:3px 10px;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.28);border-radius:4px;cursor:pointer;font-size:12px;">Logout</button>`;
                    _wireLogout(widget);
                    _startRefreshTimer();
                    window.SeaglassBrinecrypt?.onLogin();
                }
            }).catch(() => {});
        }

        // Wire up login button
        const btn = widget.querySelector('#bc-login-btn');
        const userInput = widget.querySelector('#bc-user');
        const passInput = widget.querySelector('#bc-pass');
        const statusEl = widget.querySelector('#bc-login-status');

        async function attemptLogin() {
            const user = userInput.value.trim();
            const pass = passInput.value.trim();
            if (!user || !pass) {
                statusEl.textContent = 'User and pass required';
                statusEl.style.color = '#ef4444';
                return;
            }
            btn.disabled = true;
            statusEl.textContent = 'Logging in...';
            statusEl.style.color = '#94a3b8';

            const result = await window.SeaglassAPI.login(state.activeApp.id, user, pass);

            if (result.success) {
                window.SeaglassBrinecrypt?.setSession(result.user);
                widget.innerHTML = `<span style="color:#22c55e;font-size:13px;">Logged in as <strong>${result.user}</strong></span><button id="bc-logout-btn" style="margin-left:10px;padding:3px 10px;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.28);border-radius:4px;cursor:pointer;font-size:12px;">Logout</button>`;
                _wireLogout(widget);
                _startRefreshTimer();
                window.SeaglassBrinecrypt?.onLogin();
            } else {
                statusEl.textContent = result.error;
                statusEl.style.color = '#ef4444';
                btn.disabled = false;
            }
        }

        btn.addEventListener('click', attemptLogin);
        userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') attemptLogin(); });
        passInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') attemptLogin(); });
    }

    // ── Fetch & inject ─────────────────────────────────────────────────────────

    async function _loadToolbar(url) {
        try {
            const r = await fetch(url);
            if (r.ok) {
                window.SeaglassDOM.tabToolbar.innerHTML = await r.text();
                _initFilterBuilder();
            }
            // Always inject login widget for brinecrypt, even if toolbar fetch failed
            _injectLoginWidget();
        } catch (_) {
            // Even on network error, try to show login widget
            _injectLoginWidget();
        }
    }

    function _setSpinner(active) {
        const spinner = window.SeaglassDOM.tabToolbar.querySelector("[data-refresh-spinner]");
        if (!spinner) return;
        spinner.hidden = !active;
    }

    async function _loadResults() {
        if (!_currentUrl) return;
        const params = new URLSearchParams();
        const all = { ..._currentParams, ..._filtersToParams() };
        for (const [k, v] of Object.entries(all)) {
            if (Array.isArray(v)) v.forEach((val) => params.append(k, v));
            else params.append(k, v);
        }
        const qs = params.toString();
        const url = qs ? `${_currentUrl}?${qs}` : _currentUrl;
        _setSpinner(true);
        try {
            const r = await fetch(url);
            if (!r.ok) {
                // Show a friendly message instead of blank results
                window.SeaglassDOM.tabResults.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;">Service returned status ${r.status}. Try logging in above.</div>`;
                return;
            }
            window.SeaglassDOM.tabResults.innerHTML = await r.text();
            _afterResultsInject();
        } catch (_) {
            window.SeaglassDOM.tabResults.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;">Could not reach the service.</div>`;
        }
        finally { _setSpinner(false); }
    }

    function _afterResultsInject() {
        const { tabResults, tabbar } = window.SeaglassDOM;
        const countEl = tabResults.querySelector("[data-queue-count]");
        if (countEl) {
            const badge = tabbar.querySelector('[data-tab="queue"] .badge');
            if (badge) badge.textContent = countEl.dataset.queueCount;
        }
    }

    // ── Poll management ────────────────────────────────────────────────────────

    function _stopPolling() {
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = null;
    }

    // ── Batch bar sync ─────────────────────────────────────────────────────────

    function _syncBatchBar() {
        const { tabPane } = window.SeaglassDOM;
        const bar = tabPane.querySelector("#batch-bar");
        if (!bar) return;
        const checked = tabPane.querySelectorAll(".row-check:checked");
        bar.classList.toggle("visible", checked.length > 0);
        const countEl = tabPane.querySelector("#batch-count");
        if (countEl) countEl.textContent = `${checked.length} selected`;
    }

    // ── Action dispatcher ──────────────────────────────────────────────────────

    async function _dispatchAction(btn) {
        const data = btn.dataset;

        if (data.confirm && !window.confirm(data.confirm)) return;

        switch (data.action) {
            case "retry":
                _loadResults();
                return;

            case "bc-expand-ns":
            case "bc-expand-rs":
            case "bc-select-rs":
            case "bc-select-ver":
            case "bc-ns-refresh":
                window.SeaglassBrinecrypt?.handleAction(data.action, btn);
                return;

            case "batch-clear": {
                window.SeaglassDOM.tabPane.querySelectorAll(".row-check, #check-all")
                    .forEach((c) => (c.checked = false));
                _syncBatchBar();
                return;
            }

            case "process-batch": {
                const hashes = [...window.SeaglassDOM.tabPane.querySelectorAll(".row-check:checked")]
                    .map((c) => c.value);
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

        _loadResults();
    }

    // ── Pane event delegation ──────────────────────────────────────────────────

    function _initDelegation() {
        const pane = window.SeaglassDOM.tabPane;

        pane.addEventListener("input", (e) => {
            const el = e.target.closest("[data-filter]");
            if (!el || !_currentUrl) return;
            _currentParams[el.dataset.filter] = el.value;
            _loadResults();
        });

        pane.addEventListener("change", (e) => {
            if (e.target.classList.contains("row-check") || e.target.id === "check-all") {
                if (e.target.id === "check-all") {
                    pane.querySelectorAll(".row-check").forEach((c) => (c.checked = e.target.checked));
                }
                _syncBatchBar();
            }
        });

        pane.addEventListener("click", (e) => {
            // sort header
            const th = e.target.closest("th[data-sort]");
            if (th && _currentUrl) {
                const col = th.dataset.sort;
                if (col === "info") {
                    const idx = INFO_SORT_CYCLE.indexOf(_currentParams.sort);
                    if (idx === -1) {
                        _currentParams.sort = INFO_SORT_CYCLE[0];
                        _currentParams.dir  = "asc";
                    } else if (_currentParams.dir === "asc") {
                        _currentParams.dir = "desc";
                    } else if (idx < INFO_SORT_CYCLE.length - 1) {
                        _currentParams.sort = INFO_SORT_CYCLE[idx + 1];
                        _currentParams.dir  = "asc";
                    } else {
                        delete _currentParams.sort;
                        delete _currentParams.dir;
                    }
                } else {
                    if (_currentParams.sort === col && _currentParams.dir === "desc") {
                        delete _currentParams.sort;
                        delete _currentParams.dir;
                    } else {
                        _currentParams.dir  = _currentParams.sort === col ? "desc" : "asc";
                        _currentParams.sort = col;
                    }
                }
                _loadResults();
                return;
            }

            // action button
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
        _currentParams  = {};
        _activeFilters  = [];
        window.SeaglassDOM.tabToolbar.innerHTML = "";
        window.SeaglassDOM.tabResults.innerHTML = "";

        // Allow degraded services to show tabs (for login widget)
        if (app.status !== "online" && app.status !== "degraded") {
            window.SeaglassContent.showState();
            return;
        }

        // Always show pane for online/degraded so login widget is visible
        window.SeaglassContent.showPane();

        if (tab.toolbarUrl) _loadToolbar(tab.toolbarUrl);
        if (tab.url) {
            _currentUrl = tab.url;
            _loadResults();
            if (tab.poll) {
                _pollTimer = setInterval(_loadResults, tab.poll);
            }
        }
    }

    // ── Tab bar rendering ──────────────────────────────────────────────────────

    function renderTabs(app) {
        const { tabbar, tabsRight } = window.SeaglassDOM;
        const state = window.SeaglassState;

        _stopPolling();
        _currentUrl    = null;
        _currentParams = {};
        _activeFilters = [];
        tabbar.querySelectorAll(".tab-btn").forEach((n) => n.remove());

        const tabs = Array.isArray(app.tabs) ? app.tabs : [];
        tabs.forEach((tab, index) => {
            const btn = document.createElement("button");
            btn.className   = "tab-btn";
            btn.dataset.tab = tab.id;
            btn.innerHTML   = `${tab.label}${tab.badge ? ` <span class="badge">${tab.badge}</span>` : ""}`;

            if (index === 0) {
                btn.classList.add("active");
                state.activeTabId = tab.id;
                _activateTab(app, tab);
            }

            btn.addEventListener("click", () => {
                tabbar.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                state.activeTabId = tab.id;
                _activateTab(app, tab);
            });

            tabbar.insertBefore(btn, tabsRight);
        });

        tabsRight.textContent = `${app.label}: ${app.version || ""}`;
    }

    _initDelegation();

    function resetLoginWidget() {
        const existing = window.SeaglassDOM.tabToolbar.querySelector('#brinecrypt-login-widget');
        if (existing) existing.remove();
        _injectLoginWidget();
    }

    return {
        renderTabs,
        _injectLoginWidget,
        resetLoginWidget,
    };
})();
