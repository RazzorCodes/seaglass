window.SeaglassTabs = (function () {
    let _pollTimer = null;
    let _currentUrl = null;
    let _currentParams = {};
    let _activeFilters = [];

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

    function _renderFilterTags() {
        const el = window.SeaglassDOM.tabToolbar.querySelector("#filter-tags");
        if (!el) return;
        el.innerHTML = _activeFilters.map((f, i) =>
            `<span class="filter-tag">${f.label}<button class="filter-tag-x" data-fi="${i}" title="Remove">×</button></span>`
        ).join("");
    }

    // ── Filter builder ─────────────────────────────────────────────────────────

    function _initFilterBuilder() {
        const toolbar = window.SeaglassDOM.tabToolbar;
        if (!FILTER_FIELDS) return;

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

        Object.entries(FILTER_FIELDS).forEach(([key, cfg]) => {
            if (key === "ar" && !cfg.values) return;
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = cfg.label;
            fbField.appendChild(opt);
        });

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

        fbValIn.addEventListener("keydown", (e) => {
            if (e.key === "Enter") fbAdd.click();
        });

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

        filterTags.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-fi]");
            if (!btn) return;
            const idx = parseInt(btn.dataset.fi, 10);
            _activeFilters.splice(idx, 1);
            _renderFilterTags();
            _loadResults();
        });
    }

    // ── Brinecrypt tab activation ──────────────────────────────────────────────

    function _onBrinecryptTabActivate(tabId) {
        window.SeaglassSessions?.renderIntoToolbar();
        // Give the results HTML a moment to be injected before calling onLogin
        setTimeout(() => {
            if (tabId === 'resources') window.SeaglassBrinecrypt?.onLogin();
            else if (tabId === 'users') window.SeaglassUsers?.onLogin();
            else if (tabId === 'sa')    window.SeaglassSA?.onLogin();
        }, 60);
    }

    // ── Fetch & inject ─────────────────────────────────────────────────────────

    async function _loadToolbar(url, appId, tabId) {
        try {
            const r = await fetch(url);
            if (r.ok) {
                window.SeaglassDOM.tabToolbar.innerHTML = await r.text();
                _initFilterBuilder();
            }
        } catch (_) {}
        if (appId === 'brinecrypt') _onBrinecryptTabActivate(tabId);
        if (appId === 'coralforge') window.SeaglassCoralforge?.onLoad();
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
        const qs  = params.toString();
        const url = qs ? `${_currentUrl}?${qs}` : _currentUrl;
        _setSpinner(true);
        try {
            const r = await fetch(url);
            if (!r.ok) {
                window.SeaglassDOM.tabResults.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;">Service returned status ${r.status}.</div>`;
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
            case "bc-show-rs":
            case "bc-select-rs":
            case "bc-select-ver":
            case "bc-ns-refresh":
            case "bc-add-resource":
            case "bc-add-resource-cancel":
            case "bc-add-resource-review":
            case "bc-add-resource-back":
            case "bc-add-resource-confirm":
            case "bc-delete-resource":
            case "bc-add-new":
            case "bc-add-ns-cancel":
            case "bc-add-ns-confirm":
            case "bc-query":
            case "bc-query-submit":
                window.SeaglassBrinecrypt?.handleAction(data.action, btn);
                return;

            case "bcu-refresh":
            case "bcu-select":
            case "bcu-new-user":
            case "bcu-cancel-new":
            case "bcu-create-user":
            case "bcu-delete":
            case "bcu-edit-perms":
            case "bcu-edit-add":
            case "bcu-edit-remove":
            case "bcu-cancel-edit":
            case "bcu-review":
            case "bcu-back":
            case "bcu-commit":
                window.SeaglassUsers?.handleAction(data.action, btn);
                return;

            case "bcsa-refresh":
            case "bcsa-select":
            case "bcsa-query":
            case "bcsa-query-submit":
                window.SeaglassSA?.handleAction(data.action, btn);
                return;

            case "cf-refresh":
            case "cf-select-repo":
            case "cf-select-run":
            case "cf-select-run-type":
            case "cf-back-to-repo":
            case "cf-lifecycle-trigger":
            case "cf-show-logs":
                window.SeaglassCoralforge?.handleAction(data.action, btn);
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

        pane.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            if (e.target.id === "bc-ns-name") {
                e.preventDefault();
                const btn = pane.querySelector('[data-action="bc-add-ns-confirm"]');
                if (btn && !btn.disabled) btn.click();
            } else if (e.target.id === "bc-query-ns" || e.target.id === "bc-query-name") {
                e.preventDefault();
                const btn = pane.querySelector('[data-action="bc-query-submit"]');
                if (btn && !btn.disabled) btn.click();
            } else if (e.target.id === "bcsa-query-ns" || e.target.id === "bcsa-query-name") {
                e.preventDefault();
                const btn = pane.querySelector('[data-action="bcsa-query-submit"]');
                if (btn && !btn.disabled) btn.click();
            }
        });

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

        if (app.status !== "online" && app.status !== "degraded") {
            window.SeaglassContent.showState();
            return;
        }

        window.SeaglassContent.showPane();

        if (tab.toolbarUrl) _loadToolbar(tab.toolbarUrl, app.id, tab.id);
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

        const lbl = document.getElementById('tabs-service-label');
        if (lbl) lbl.textContent = `${app.label}: ${app.version || ""}`;

    }

    _initDelegation();

    return { renderTabs };
})();
