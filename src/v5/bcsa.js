window.SeaglassSA = (function () {

  // ── State ──────────────────────────────────────────────────────────────────

  let _loggedIn  = false;
  let _canList   = false;
  let _selectedKey = null;            // "ns:name"
  const _saCache   = new Map();       // "ns:name" -> permissions[]
  let _queryDraft  = null;            // {ns, name}

  // ── DOM accessors ─────────────────────────────────────────────────────────

  const _list   = () => document.getElementById("bcsa-list-panel");
  const _tree   = () => document.getElementById("bcsa-tree-body");
  const _detail = () => document.getElementById("bcsa-detail");

  // ── Logging ───────────────────────────────────────────────────────────────

  function _ts() { return new Date().toISOString().slice(11, 23); }
  function _logOk(tag, d)   { console.log( `[ok]  [${_ts()}] bcsa ${tag}`, d); }
  function _logWarn(tag, d) { console.warn(`[warn][${_ts()}] bcsa ${tag}`, d); }

  // ── API helpers ───────────────────────────────────────────────────────────

  async function _listPrincipals() {
    const r = await fetch("/api/brinecrypt/admin/principals");
    let data = {};
    try { if (r.headers.get("content-type")?.includes("json")) data = await r.json(); } catch (_) {}
    if (!r.ok) { _logWarn("list", data); throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status }); }
    _logOk("list", data);
    return data;
  }

  async function _readPrincipals(principals) {
    const r = await fetch("/api/brinecrypt/admin/principals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principals }),
    });
    let data = {};
    try { if (r.headers.get("content-type")?.includes("json")) data = await r.json(); } catch (_) {}
    if (!r.ok) { _logWarn("read", data); throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status }); }
    _logOk("read", data);
    return data;
  }

  // Extract permissions from the "read" response for a given ns:name key.
  // Upstream may use "ns:name" or "ns/name" as the dict key.
  function _extractPerms(data, ns, name) {
    const p = data.principals ?? {};
    return (p[`${ns}:${name}`] ?? p[`${ns}/${name}`] ?? {}).permissions ?? [];
  }

  // ── Permissions table (read-only) ─────────────────────────────────────────

  function _renderPermsTable(perms) {
    if (!perms || !perms.length) {
      return `<tr><td colspan="2" style="text-align:center;color:#475569;padding:1rem;">No permissions</td></tr>`;
    }
    const byPattern = {};
    for (const p of perms) {
      if (!byPattern[p.resource_pattern]) byPattern[p.resource_pattern] = [];
      byPattern[p.resource_pattern].push(p.verb);
    }
    return Object.entries(byPattern).map(([pat, verbs]) =>
      `<tr>
        <td><code>${esc(pat)}</code></td>
        <td>${verbs.map(v => `<span class="bc-badge">${esc(v)}</span>`).join(" ")}</td>
      </tr>`
    ).join("");
  }

  // ── Detail card ───────────────────────────────────────────────────────────

  function _renderDetail(key, perms, { stale = false } = {}) {
    const staleBadge = stale ? `<span class="bc-query-cached-badge" title="Showing cached result" style="margin-left:0.5rem;">cached</span>` : "";
    return `
<div class="bc-card">
  <div class="bc-card-hdr">
    <span class="bc-rname">${esc(key)}</span>${staleBadge}
  </div>
  <div class="bc-section">
    <div class="bc-shdr">Permissions</div>
    <div class="bc-sbody" style="padding:0;">
      <table class="data-table" style="width:100%;">
        <thead><tr><th>Pattern</th><th>Verbs</th></tr></thead>
        <tbody>${_renderPermsTable(perms)}</tbody>
      </table>
    </div>
  </div>
</div>`;
  }

  // ── Query form ────────────────────────────────────────────────────────────

  function _renderQueryForm(ns = "", name = "", { result = null, error = null, loading = false, stale = false } = {}) {
    const errorHtml = error
      ? `<p class="bc-err" style="font-size:0.82rem;padding-bottom:0.5rem;">${esc(error)}</p>`
      : "";
    let resultHtml;
    if (loading) {
      resultHtml = `<div class="bc-query-result-area">${errorHtml}<div class="bc-loading">Looking up…</div></div>`;
    } else if (result) {
      resultHtml = `<div class="bc-query-result-area">${errorHtml}${_renderDetail(`${ns}:${name}`, result, { stale })}</div>`;
    } else if (error) {
      resultHtml = `<div class="bc-query-result-area">${errorHtml}</div>`;
    } else {
      resultHtml = `<div class="bc-query-result-area bc-query-result-empty">Enter namespace and SA name to look up a service account directly.</div>`;
    }
    const staleBadge = stale && !result ? `<span class="bc-query-cached-badge" title="Showing cached result">cached</span>` : "";
    return `
<div id="bcsa-query-form">
  <div class="bc-add-form-hdr">
    <span>Point Query</span>${staleBadge}
  </div>
  <div class="bc-query-fields">
    <input type="text" id="bcsa-query-ns"   placeholder="namespace" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;" value="${esc(ns)}">
    <input type="text" id="bcsa-query-name" placeholder="sa-name"   class="pane-search" style="flex:none;width:100%;font-size:0.84rem;" value="${esc(name)}">
    <button class="btn btn-primary btn-sm" data-action="bcsa-query-submit" style="align-self:flex-start;">Lookup</button>
  </div>
  ${resultHtml}
</div>`;
  }

  // ── List panel ────────────────────────────────────────────────────────────

  function _renderList(principals) {
    const tree = _tree();
    if (!tree) return;
    tree.innerHTML = "";

    if (!principals.length) {
      tree.innerHTML = '<div class="pane-empty"><p>No service accounts</p></div>';
    } else {
      principals.forEach(({ namespace, name }) => {
        const key = `${namespace}:${name}`;
        const el = document.createElement("div");
        el.className = "bc-tree-item";
        el.dataset.action  = "bcsa-select";
        el.dataset.key     = key;
        el.dataset.ns      = namespace;
        el.dataset.saname  = name;
        if (key === _selectedKey) el.classList.add("selected");
        el.innerHTML = `<span class="bc-iname">${esc(key)}</span>`;
        tree.appendChild(el);
      });
    }

    // Always append a query entry at the bottom of the list
    const queryEl = document.createElement("div");
    queryEl.className = "bc-tree-item bc-query-entry";
    queryEl.dataset.action = "bcsa-query";
    queryEl.innerHTML = `<span class="bc-chev" style="font-size:0.75rem;">?</span><span class="bc-iname">Query…</span>`;
    tree.appendChild(queryEl);
  }

  // ── Select SA ─────────────────────────────────────────────────────────────

  async function _selectSa(key, ns, saName) {
    _selectedKey = key;
    document.querySelectorAll("#bcsa-tree-body .bc-tree-item").forEach(el => {
      el.classList.toggle("selected", el.dataset.key === key);
    });

    const det = _detail();
    if (!det) return;

    const cached = _saCache.get(key) ?? null;
    if (cached) {
      det.innerHTML = _renderDetail(key, cached, { stale: true });
    } else {
      det.innerHTML = '<div class="bc-loading" style="padding:1.5rem;">Loading…</div>';
    }

    try {
      const data = await _readPrincipals([{ namespace: ns, name: saName }]);
      const perms = _extractPerms(data, ns, saName);
      _saCache.set(key, perms);
      det.innerHTML = _renderDetail(key, perms);
    } catch (err) {
      if (cached) {
        det.innerHTML = _renderDetail(key, cached, { stale: true });
      } else {
        det.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
      }
    }
  }

  // ── onLogin ────────────────────────────────────────────────────────────────

  async function onLogin() {
    _loggedIn = true;

    if (!_tree()) {
      setTimeout(onLogin, 80);
      return;
    }

    const tree = _tree();
    tree.innerHTML = '<div class="bc-loading">Loading…</div>';

    try {
      const data = await _listPrincipals();
      const list = data.principals ?? [];
      _canList = true;

      const lp = _list();
      if (lp) lp.hidden = false;

      _renderList(list);

      if (list.length) {
        const first = list[0];
        _selectSa(`${first.namespace}:${first.name}`, first.namespace, first.name);
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        _canList = false;
        tree.innerHTML = `
<div class="bc-sa-forbidden">
  <span class="bc-forbidden-icon">!</span>
  <p>You do not have rights to access this</p>
</div>`;
      } else {
        tree.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
      }
    }
  }

  // ── handleAction ──────────────────────────────────────────────────────────

  function handleAction(action, el) {
    switch (action) {

      case "bcsa-refresh":
        onLogin();
        return true;

      case "bcsa-select": {
        const { key, ns, saname } = el.dataset;
        _selectSa(key, ns, saname);
        return true;
      }

      case "bcsa-query": {
        const det = _detail();
        if (!det) return true;
        const qns   = _queryDraft?.ns   ?? "";
        const qname = _queryDraft?.name ?? "";
        const cached = qns && qname ? _saCache.get(`${qns}:${qname}`) ?? null : null;
        det.innerHTML = _renderQueryForm(qns, qname, { result: cached, stale: !!cached });
        return true;
      }

      case "bcsa-query-submit": {
        const qns   = document.getElementById("bcsa-query-ns")?.value.trim()   ?? "";
        const qname = document.getElementById("bcsa-query-name")?.value.trim() ?? "";
        if (!qns || !qname) return true;
        _queryDraft = { ns: qns, name: qname };
        const key    = `${qns}:${qname}`;
        const cached = _saCache.get(key) ?? null;
        const det    = _detail();
        if (det) det.innerHTML = _renderQueryForm(qns, qname, {
          result: cached, loading: !cached, stale: !!cached,
        });
        _readPrincipals([{ namespace: qns, name: qname }]).then(data => {
          const perms = _extractPerms(data, qns, qname);
          _saCache.set(key, perms);
          if (det) det.innerHTML = _renderQueryForm(qns, qname, { result: perms });
        }).catch(err => {
          if (det) det.innerHTML = _renderQueryForm(qns, qname, {
            result: cached, error: err.message, stale: !!cached,
          });
        });
        return true;
      }
    }
    return false;
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  function reset() {
    _loggedIn    = false;
    _canList     = false;
    _selectedKey = null;
    _saCache.clear();
    _queryDraft  = null;

    const tree = _tree();
    if (tree) tree.innerHTML = '<div class="pane-empty"><p>Log in to browse</p></div>';
    const det = _detail();
    if (det) { det.innerHTML = '<div class="pane-empty"><p>Select a service account</p></div>'; det.style.flex = ""; }
    const lp = _list();
    if (lp) { lp.hidden = false; }
  }

  return { onLogin, handleAction, reset };
})();
