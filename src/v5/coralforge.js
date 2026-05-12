window.SeaglassCoralforge = (function () {
  "use strict";

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function _ts() {
    return new Date().toISOString().slice(11, 23);
  }
  function _log(tag, d) {
    console.log(`[ok]  [${_ts()}] cf ${tag}`, d);
  }
  function _warn(tag, d) {
    console.warn(`[warn][${_ts()}] cf ${tag}`, d);
  }
  function esc(s) {
    if (s == null) return "";
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }
  function _timeAgo(isoStr) {
    if (!isoStr) return "-";
    const diff = Date.now() - new Date(isoStr).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function _duration(start, end) {
    if (!start) return "";
    const ms = (end ? new Date(end) : new Date()) - new Date(start);
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  function _statusColor(st) {
    const m = {
      queued:    "#6b7280",
      running:   "#3b82f6",
      blocked:   "#f59e0b",
      passed:    "#22c55e",
      failed:    "#ef4444",
      cancelled: "#6b7280",
      released:  "#06b6d4",
      done:      "#16a34a",
      unknown:   "#6b7280",
    };
    return m[st] ?? "#6b7280";
  }
  function _statusDot(st) {
    return `<span class="bc-status-dot" style="background:${_statusColor(st)};"></span>`;
  }
  function _loading(html) {
    return `<div class="bc-loading" style="padding:1.5rem;">${html}</div>`;
  }
  function _empty(html) {
    return `<div class="pane-empty"><p>${html}</p></div>`;
  }

  // Lifecycle order — determines display/unlock order
  const LIFECYCLE = ["ci", "release", "stable"];
  // Statuses that mean "this stage succeeded and the next is unlocked"
  const PASSED_STATUSES = new Set(["passed", "released", "done"]);
  const ACTIVE_STATUSES = new Set(["queued", "running", "blocked"]);

  // ── State ────────────────────────────────────────────────────────────────────
  let _repos = [];
  let _runsByRepo = {};     // repo name → run list (all run_types)
  let _stableByRepo = {};   // repo name → stable version string or null
  let _selectedRepo = null;
  let _selectedRunId = null;
  const _expanded = new Set();
  let _pollTimer = null;

  // ── DOM shortcuts ─────────────────────────────────────────────────────────────
  function _treeBody() { return document.getElementById("cf-tree-body"); }
  function _detail()   { return document.getElementById("cf-detail"); }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  function onLoad() {
    if (_pollTimer) clearInterval(_pollTimer);
    _loadRepos();
    _pollTimer = setInterval(_softRefresh, 15000);
  }

  async function _softRefresh() {
    if (!_selectedRepo) return;
    await _loadRunsForRepo(_selectedRepo);
    if (_selectedRunId) {
      _showRunDetail(_selectedRunId);
    } else {
      _showRepoOverview(_selectedRepo);
    }
  }

  async function _loadRepos() {
    const tb = _treeBody();
    if (!tb) return;
    tb.innerHTML = _loading("Loading&hellip;");
    try {
      const r = await fetch("/api/coralforge/repos");
      if (!r.ok) { tb.innerHTML = _empty("Failed to load repositories"); return; }
      const data = await r.json();
      _repos = data.repos ?? [];
      _renderTree(tb);
      if (_selectedRepo) {
        await _loadRunsForRepo(_selectedRepo);
        if (_selectedRunId) _showRunDetail(_selectedRunId);
        else _showRepoOverview(_selectedRepo);
      } else {
        const detail = _detail();
        if (detail) detail.innerHTML = _empty("Select a repository");
      }
    } catch (err) {
      _warn("load-repos", err);
      tb.innerHTML = _empty(err.message);
    }
  }

  async function _loadRunsForRepo(repoName) {
    try {
      const r = await fetch(`/api/coralforge/runs?target=${encodeURIComponent(repoName)}&limit=30`);
      if (!r.ok) return;
      const data = await r.json();
      _runsByRepo[repoName] = data.runs ?? [];
    } catch (err) {
      _warn("load-runs", err);
    }
    // load stable in parallel (best-effort)
    try {
      const rs = await fetch(`/api/coralforge/repos/${encodeURIComponent(repoName)}/stable`);
      if (rs.ok) {
        const sd = await rs.json();
        _stableByRepo[repoName] = (sd.stables ?? [])[0]?.stable ?? null;
      }
    } catch (_) {}
  }

  // ── Tree ──────────────────────────────────────────────────────────────────────
  function _renderTree(container) {
    container.innerHTML = "";
    if (!_repos.length) {
      container.innerHTML = '<div class="bc-empty-indent">No repositories</div>';
      return;
    }
    _repos.forEach((repo) => container.appendChild(_repoEl(repo)));
    _repos.forEach((repo) => {
      if (_expanded.has(repo.name)) {
        const wrap = container.querySelector(`[data-repo="${CSS.escape(repo.name)}"]`)?.closest(".bc-ns-wrap");
        if (wrap) _applyExpand(repo.name, wrap, true);
      }
    });
  }

  function _repoEl(repo) {
    const wrap = document.createElement("div");
    wrap.className = "bc-ns-wrap";

    const item = document.createElement("div");
    item.className = "bc-tree-item bc-ns";
    if (_selectedRepo === repo.name && !_selectedRunId) item.classList.add("selected");
    item.dataset.action = "cf-select-repo";
    item.dataset.repo = repo.name;

    const runTypes = (repo.run_types ?? []).join(" → ") || "?";
    const errCount = (repo.validation_errors ?? []).length;
    const errBadge = errCount
      ? `<span class="bc-badge" style="background:rgba(239,68,68,0.2);color:#f87171;">${errCount} err</span>`
      : "";
    const runs = _runsByRepo[repo.name] ?? [];
    const latestCi = _latestOfType(runs, "ci");
    const ciDot = latestCi ? _statusDot(latestCi.status) : _statusDot("unknown");

    item.innerHTML = `<span class="bc-chev">▶</span>${ciDot}<span class="bc-iname">${esc(repo.name)}</span><span class="bc-ver-meta">${esc(runTypes)}</span>${errBadge}`;

    const children = document.createElement("div");
    children.className = "bc-ns-children";
    children.hidden = !_expanded.has(repo.name);

    if (_expanded.has(repo.name)) {
      _renderRunList(children, runs);
    }

    wrap.appendChild(item);
    wrap.appendChild(children);
    return wrap;
  }

  function _latestOfType(runs, runType) {
    return runs.find((r) => r.run_type === runType) ?? null;
  }

  // ── Expand/collapse ───────────────────────────────────────────────────────────
  function _applyExpand(name, wrap, force) {
    const item = wrap.querySelector(`[data-repo="${CSS.escape(name)}"]`);
    const children = wrap.querySelector(".bc-ns-children");
    if (!item || !children) return;

    if (!force && _expanded.has(name)) {
      _expanded.delete(name);
      item.querySelector(".bc-chev")?.classList.remove("open");
      children.hidden = true;
      return;
    }
    _expanded.add(name);
    item.querySelector(".bc-chev")?.classList.add("open");
    children.hidden = false;
    _renderRunList(children, _runsByRepo[name] ?? []);
  }

  function _renderRunList(container, runs) {
    container.innerHTML = "";
    if (!runs.length) {
      container.innerHTML = '<div class="bc-empty-indent">No runs yet</div>';
      return;
    }
    runs.forEach((run) => container.appendChild(_runEl(run)));
  }

  function _runEl(run) {
    const item = document.createElement("div");
    item.className = "bc-tree-item bc-rs";
    if (_selectedRunId === run.run_id) item.classList.add("selected");
    item.dataset.action = "cf-select-run";
    item.dataset.runId = run.run_id ?? "";
    item.dataset.repo = run.repo ?? "";

    const st = run.status ?? "unknown";
    const ref = run.ref ? esc(run.ref.slice(0, 24)) : "";
    item.innerHTML = `<span class="bc-chev">·</span>${_statusDot(st)}<span class="bc-iname">${esc(run.run_type ?? "run")}</span><span class="bc-ver-meta">${ref ? ref + " · " : ""}${_timeAgo(run.created_at)}</span>`;
    return item;
  }

  // ── Repo overview (lifecycle dashboard) ───────────────────────────────────────
  function _showRepoOverview(repoName) {
    const detail = _detail();
    if (!detail) return;
    const repo = _repos.find((r) => r.name === repoName);
    if (!repo) return;
    const runs = _runsByRepo[repoName] ?? [];
    const stable = _stableByRepo[repoName] ?? null;
    detail.innerHTML = _renderRepoOverview(repo, runs, stable);
  }

  function _stageVersionLabel(repoName, runType, run, stable) {
    if (runType === "ci")
      return run && PASSED_STATUSES.has(run.status) ? `${repoName}-latest` : null;
    if (runType === "release") {
      const ver = run?.provider_metadata?.version;
      return ver ? `${repoName}-release-${ver}` : null;
    }
    if (runType === "stable")
      return stable ? `${repoName}-stable` : null;
    return null;
  }

  function _renderRepoOverview(repo, runs, stable) {
    const runTypes = repo.run_types ?? [];
    const errCount = (repo.validation_errors ?? []).length;
    const errSection = errCount
      ? `<div class="bc-section">
           <div class="bc-shdr" style="color:#f87171;">Validation errors (${errCount})</div>
           <div class="bc-sbody">
             ${(repo.validation_errors ?? []).map((e) => `<div class="cf-err-row">${esc(e)}</div>`).join("")}
           </div>
         </div>`
      : "";

    // Order lifecycle stages; unrecognised run_types appended after
    const ordered = LIFECYCLE.filter((rt) => runTypes.includes(rt));
    const extra = runTypes.filter((rt) => !LIFECYCLE.includes(rt));
    const allStages = [...ordered, ...extra];

    // Build latest-run-per-type map
    const latestByType = {};
    allStages.forEach((rt) => { latestByType[rt] = _latestOfType(runs, rt); });

    // Unlock logic: each stage unlocked if previous stage's latest run passed
    const unlocked = {};
    allStages.forEach((rt, i) => {
      if (i === 0) { unlocked[rt] = true; return; }
      const prev = allStages[i - 1];
      const prevLatest = latestByType[prev];
      unlocked[rt] = prevLatest != null && PASSED_STATUSES.has(prevLatest.status);
    });

    const stageRows = allStages.map((rt) => {
      const latest = latestByType[rt];
      const st = latest?.status ?? "unknown";
      const isActive = latest && ACTIVE_STATUSES.has(st);
      const canTrigger = unlocked[rt] && !isActive;

      const refText = latest?.ref ? `${esc(latest.ref.slice(0, 24))} · ` : "";
      const meta = latest ? `${refText}${_timeAgo(latest.created_at)}` : "no runs";

      const label = _stageVersionLabel(repo.name, rt, latest, stable);
      const labelHtml = label ? `<span class="cf-ver-chip">${esc(label)}</span>` : "";

      const triggerBtn = canTrigger
        ? `<button class="btn btn-ghost btn-sm" data-action="cf-lifecycle-trigger" data-repo="${esc(repo.name)}" data-run-type="${esc(rt)}" title="Trigger ${rt}">Run</button>`
        : "";

      return `
        <div class="cf-lifecycle-row" data-action="cf-select-run-type" data-repo="${esc(repo.name)}" data-run-type="${esc(rt)}">
          ${_statusDot(st)}
          <span class="cf-lc-name">${esc(rt)}</span>
          <span class="bc-ver-meta">${meta}</span>
          ${labelHtml}${triggerBtn}
        </div>`;
    }).join("");

    return `
      <div class="bc-card">
        <div class="bc-card-hdr">
          <span class="bc-rname">${esc(repo.name)}</span>
          <span class="bc-ver-meta" style="margin-left:auto;">${esc(repo.slug ?? "")}</span>
        </div>
        <div class="bc-section">
          <div class="bc-shdr">Lifecycle</div>
          <div class="bc-sbody cf-lifecycle-body">
            ${stageRows}
          </div>
        </div>
        ${errSection}
        <div class="cf-detail-actions">
          <button class="btn btn-ghost btn-sm" data-action="cf-refresh">Refresh</button>
        </div>
      </div>`;
  }

  // ── Run detail ────────────────────────────────────────────────────────────────
  async function _showRunDetail(runId) {
    _selectedRunId = runId;
    const detail = _detail();
    if (!detail) return;
    detail.innerHTML = _loading("Loading run&hellip;");
    try {
      const r = await fetch(`/api/coralforge/runs/${encodeURIComponent(runId)}?refresh=1`);
      if (!r.ok) { detail.innerHTML = _empty("Failed to load run"); return; }
      const run = await r.json();
      detail.innerHTML = _renderRunDetail(run);
    } catch (err) {
      _warn("select-run", err);
      detail.innerHTML = _empty(err.message);
    }
  }

  function _renderRunDetail(run) {
    const st = run.status ?? "unknown";
    const color = _statusColor(st);
    const dur = _duration(run.started_at ?? run.created_at, run.finished_at);

    const infoRows = [
      ["Repo",     esc(run.repo ?? "-")],
      ["Run type", esc(run.run_type ?? "-")],
      ["Provider", esc(run.provider ?? "-")],
      ["Ref",      esc(run.ref ?? "-")],
      ["SHA",      run.sha ? `<span style="font-family:monospace;">${esc(run.sha.slice(0, 12))}</span>` : "-"],
      ["Actor",    esc(run.actor ?? "-")],
      ["Created",  esc(run.created_at ? new Date(run.created_at).toLocaleString() : "-")],
      ["Duration", esc(dur || "-")],
    ];

    const stages = run.stages ?? [];
    const stageHtml = stages.length
      ? stages.map((s) => _renderStage(s)).join("")
      : '<div class="bc-empty-indent">No stage data</div>';

    return `
      <div class="bc-card">
        <div class="bc-card-hdr">
          <span class="bc-rname">${esc(run.repo ?? "-")} / ${esc(run.run_type ?? "run")}</span>
          <span style="margin-left:auto;display:flex;align-items:center;gap:.5rem;">
            <span class="bc-status-dot" style="background:${color};"></span>
            <span style="color:${color};font-weight:600;">${esc(st)}</span>
          </span>
        </div>
        <div class="cf-detail-actions">
          <button class="btn btn-ghost btn-sm" data-action="cf-show-logs" data-run-id="${esc(run.run_id)}">Logs</button>
          <button class="btn btn-ghost btn-sm" data-action="cf-back-to-repo" data-repo="${esc(run.repo)}">← Repo</button>
        </div>
        <div class="bc-section">
          <div class="bc-shdr">Details</div>
          <div class="bc-sbody">
            <div class="cf-mgrid">
              ${infoRows.map(([k, v]) => `<span class="cf-mk">${k}</span><span class="cf-mv">${v}</span>`).join("")}
            </div>
          </div>
        </div>
        <div class="bc-section">
          <div class="bc-shdr">Stages</div>
          <div class="bc-sbody">${stageHtml}</div>
        </div>
      </div>`;
  }

  function _renderStage(stage) {
    const st = stage.status ?? "unknown";
    const color = _statusColor(st);
    const dur = _duration(stage.started_at, stage.finished_at);
    const steps = stage.steps ?? [];

    const stepsHtml = steps.length
      ? `<div class="cf-steps">${steps.map((step) => {
          const sc = _statusColor(step.status ?? "unknown");
          return `<div class="cf-step"><span class="bc-status-dot" style="background:${sc};width:.5rem;height:.5rem;"></span><span>${esc(step.name)}</span><span class="bc-ver-meta">${esc(step.status ?? "")}</span></div>`;
        }).join("")}</div>`
      : "";

    return `
      <div class="cf-stage">
        <div class="cf-stage-hdr">
          <span class="bc-status-dot" style="background:${color};"></span>
          <span class="cf-stage-name">${esc(stage.name ?? "-")}</span>
          <span class="bc-ver-meta">${esc(st)}${dur ? " · " + dur : ""}</span>
        </div>
        ${stepsHtml}
      </div>`;
  }

  // ── Logs ──────────────────────────────────────────────────────────────────────
  async function _showLogs(runId) {
    const detail = _detail();
    if (!detail) return;
    const logSection = detail.querySelector(".cf-log-section");
    if (logSection) { logSection.remove(); return; }

    const placeholder = document.createElement("div");
    placeholder.className = "cf-log-section bc-section";
    placeholder.innerHTML = `<div class="bc-shdr">Logs</div><div class="bc-sbody">${_loading("Fetching logs&hellip;")}</div>`;
    detail.querySelector(".bc-card")?.appendChild(placeholder);

    try {
      const r = await fetch(`/api/coralforge/runs/${encodeURIComponent(runId)}/logs`);
      if (!r.ok) { placeholder.querySelector(".bc-sbody").innerHTML = _empty("Failed to fetch logs"); return; }
      const data = await r.json();
      const logs = data.logs ?? {};
      const logHtml = Object.entries(logs).map(([name, text]) =>
        `<div class="cf-log-block"><div class="cf-log-label">${esc(name)}</div><pre class="cf-log-pre">${esc(text)}</pre></div>`
      ).join("") || _empty("No logs available");
      placeholder.querySelector(".bc-sbody").innerHTML = logHtml;
    } catch (err) {
      _warn("logs", err);
      placeholder.querySelector(".bc-sbody").innerHTML = _empty(err.message);
    }
  }

  // ── Lifecycle trigger ─────────────────────────────────────────────────────────
  async function _lifecycleTrigger(repoName, runType) {
    try {
      const r = await fetch("/api/coralforge/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: repoName, run_type: runType, actor: "seaglass" }),
      });
      if (!r.ok) {
        const txt = await r.text();
        _warn("lifecycle-trigger", txt);
        alert(`Failed to trigger ${runType}: ${txt}`);
        return;
      }
      const data = await r.json();
      _log("lifecycle-trigger", data);
      _runsByRepo[repoName] = [];
      await _loadRunsForRepo(repoName);
      _renderTree(_treeBody());
      _showRepoOverview(repoName);
    } catch (err) {
      _warn("lifecycle-trigger", err);
      alert(`Error: ${err.message}`);
    }
  }

  // ── handleAction ──────────────────────────────────────────────────────────────
  function handleAction(action, el) {
    const repo = el.dataset.repo ?? "";
    switch (action) {
      case "cf-refresh":
        _runsByRepo = {};
        _stableByRepo = {};
        _selectedRunId = null;
        _loadRepos();
        return;

      case "cf-select-repo": {
        _setSelected(el);
        _selectedRepo = repo;
        _selectedRunId = null;
        _applyExpand(repo, el.closest(".bc-ns-wrap"), /* toggle */ false);
        const runs = _runsByRepo[repo];
        if (runs) {
          _showRepoOverview(repo);
        } else {
          const detail = _detail();
          if (detail) detail.innerHTML = _loading("Loading&hellip;");
          _loadRunsForRepo(repo).then(() => {
            _renderTree(_treeBody());
            _showRepoOverview(repo);
          });
        }
        return;
      }

      case "cf-select-run": {
        _setSelected(el);
        _selectedRepo = repo || _selectedRepo;
        _showRunDetail(el.dataset.runId);
        return;
      }

      case "cf-select-run-type": {
        // Click on lifecycle row → show latest run of that type
        const runType = el.dataset.runType ?? "";
        const runs = _runsByRepo[repo] ?? [];
        const latest = _latestOfType(runs, runType);
        if (latest) {
          _setSelected(el);
          _showRunDetail(latest.run_id);
        }
        return;
      }

      case "cf-back-to-repo":
        _selectedRunId = null;
        if (repo) {
          _selectedRepo = repo;
          _showRepoOverview(repo);
        }
        return;

      case "cf-lifecycle-trigger":
        _lifecycleTrigger(repo, el.dataset.runType ?? "");
        return;

      case "cf-show-logs":
        _showLogs(el.dataset.runId ?? _selectedRunId);
        return;
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────────
  function _setSelected(itemEl) {
    document.querySelectorAll(".bc-tree-item.selected, .cf-lifecycle-row.selected")
      .forEach((e) => e.classList.remove("selected"));
    itemEl.classList.add("selected");
  }

  return { onLoad, handleAction };
})();
