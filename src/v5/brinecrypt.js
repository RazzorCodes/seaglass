window.SeaglassBrinecrypt = (function () {
  const _expandedNs = new Set();
  const _expandedRs = new Set();
  const _nsVerbs = {};
  const _queryCache = new Map();
  const _pinnedResources = new Map(); // nsName -> Map<resourceName, {type}>

  let _user = null;
  let _draftResource = null;
  let _queryDraft = null;

  // ── Session (display only — token lives server-side) ──────────────────────

  function setSession(user) { _user = user; }
  function clearSession()   { _user = null; }
  function hasSession()     { return !!_user; }
  function getUser()        { return _user; }

  // ── Logging ────────────────────────────────────────────────────────────────

  function _ts() {
    return new Date().toISOString().slice(11, 23);
  }

  function _logOk(path, data) {
    console.log(`[ok]  [${_ts()}] /api/v1/${path}`, data);
  }
  function _logWarn(path, data) {
    console.warn(`[warn][${_ts()}] /api/v1/${path}`, data);
  }

  // ── API ────────────────────────────────────────────────────────────────────

  async function _get(path, extra = {}) {
    const qs = new URLSearchParams({ path, ...extra }).toString();
    const r = await fetch(`/api/brinecrypt/v1?${qs}`);
    const data = await r.json();
    if (!r.ok) {
      _logWarn(path, data);
      throw new Error(data.error || data.message || `HTTP ${r.status}`);
    }
    _logOk(path, data);
    return data;
  }

  async function _post(path, body) {
    const qs = new URLSearchParams({ path }).toString();
    const r = await fetch(`/api/brinecrypt/v1?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      _logWarn(path, data);
      throw new Error(data.error || data.message || `HTTP ${r.status}`);
    }
    _logOk(path, data);
    return data;
  }

  async function _put(path, body) {
    const qs = new URLSearchParams({ path }).toString();
    const r = await fetch(`/api/brinecrypt/v1?${qs}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      _logWarn(path, data);
      throw new Error(data.error || data.message || `HTTP ${r.status}`);
    }
    _logOk(path, data);
    return data;
  }

  async function _del(path) {
    const qs = new URLSearchParams({ path }).toString();
    const r = await fetch(`/api/brinecrypt/v1?${qs}`, { method: "DELETE" });
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : {};
    if (!r.ok) {
      _logWarn(path, data);
      throw new Error(data.error || data.message || `HTTP ${r.status}`);
    }
    _logOk(path, data);
    return data;
  }

  function _arr(data, ...keys) {
    if (Array.isArray(data)) return data;
    for (const k of keys) if (Array.isArray(data[k])) return data[k];
    return [];
  }

  function _hasVerb(item, ...verbs) {
    const have = (item.verbs || item.permissions || []).map((v) =>
      v.toUpperCase(),
    );
    return verbs.some((v) => have.includes(v));
  }

  // ── DOM accessors ──────────────────────────────────────────────────────────

  const _tree = () => document.getElementById("bc-tree-body");
  const _detail = () => document.getElementById("bc-detail");

  // ── Escape ─────────────────────────────────────────────────────────────────

  function _e(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function _date(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch (_) {
      return iso;
    }
  }

  function _dateShort(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return "";
    }
  }

  // ── Namespace list ─────────────────────────────────────────────────────────

  async function loadNamespaces() {
    const body = _tree();
    if (!body) return;
    body.innerHTML = '<div class="bc-loading">Loading…</div>';
    try {
      const data = await _get("namespaces");
      const list = _arr(data, "namespaces", "items", "data");
      const visible = list.filter(
        (ns) => !ns.verbs || _hasVerb(ns, "READ", "LIST"),
      );
      body.innerHTML = "";
      const queryEl = document.createElement("div");
      queryEl.className = "bc-tree-item bc-query-entry";
      queryEl.dataset.action = "bc-query";
      queryEl.innerHTML = `<span class="bc-chev" style="font-size:0.75rem;">?</span><span class="bc-iname">Query…</span>`;
      body.appendChild(queryEl);
      visible.forEach((ns) => {
        const name = ns.namespace ?? ns.name ?? ns;
        if (typeof ns === "object" && ns.verbs) _nsVerbs[name] = ns.verbs;
        body.appendChild(_nsEl(name));
      });
      const newEl = document.createElement("div");
      newEl.className = "bc-tree-item bc-ns-new";
      newEl.dataset.action = "bc-add-new";
      newEl.innerHTML = `<span class="bc-chev">＋</span><span class="bc-iname">New…</span>`;
      body.appendChild(newEl);
      _injectPinned();
    } catch (err) {
      body.innerHTML = `<div class="pane-empty"><p class="bc-err">${_e(err.message)}</p></div>`;
    }
  }

  function _nsEl(name, { pinned = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "bc-ns-wrap";

    const item = document.createElement("div");
    item.className = "bc-tree-item bc-ns" + (pinned ? " bc-ns--pinned" : "");
    item.dataset.action = "bc-expand-ns";
    item.dataset.ns = name;
    const pinMark = pinned ? `<span class="bc-pin-mark" title="Pinned from query">·</span>` : "";
    item.innerHTML = `<span class="bc-chev">▶</span><span class="bc-iname">${_e(name)}</span>${pinMark}<button class="bc-icon-btn bc-ns-add" data-action="bc-add-resource" data-ns="${_e(name)}" title="Add resource to ${_e(name)}">＋</button>`;

    const children = document.createElement("div");
    children.className = "bc-ns-children";
    children.hidden = true;

    wrap.appendChild(item);
    wrap.appendChild(children);
    return wrap;
  }

  // ── Namespace expand ───────────────────────────────────────────────────────

  async function expandNs(name, itemEl) {
    const wrap = itemEl.closest(".bc-ns-wrap");
    const children = wrap?.querySelector(".bc-ns-children");
    if (!children) return;

    if (_expandedNs.has(name)) {
      _expandedNs.delete(name);
      itemEl.querySelector(".bc-chev").classList.remove("open");
      children.hidden = true;
      return;
    }
    _expandedNs.add(name);
    itemEl.querySelector(".bc-chev").classList.add("open");
    children.hidden = false;
    children.innerHTML =
      '<div class="bc-loading bc-loading--indent">Loading…</div>';

    try {
      const data = await _get(name);
      const list = _arr(data, "resources", "items", "data");
      if (!list.length) {
        children.innerHTML = '<div class="bc-empty-indent">No resources</div>';
        return;
      }
      children.innerHTML = "";
      list.forEach((rs) => {
        const rsName = rs.name ?? rs;
        children.appendChild(_rsEl(name, rsName, rs.type, false));
      });
    } catch (err) {
      const pinned = _pinnedResources.get(name);
      if (pinned && pinned.size > 0) {
        children.innerHTML = "";
        for (const [rsName, { type }] of pinned) {
          children.appendChild(_rsEl(name, rsName, type, false));
        }
      } else {
        children.innerHTML = `<div class="bc-err-indent">${_e(err.message)}</div>`;
      }
    }
  }

  function _rsEl(ns, name, type, canExpand) {
    const wrap = document.createElement("div");
    wrap.className = "bc-rs-wrap";

    const item = document.createElement("div");
    item.className = "bc-tree-item bc-rs";
    item.dataset.action = canExpand ? "bc-show-rs" : "bc-select-rs";
    item.dataset.ns = ns;
    item.dataset.rs = name;
    const chevHtml = canExpand
      ? `<span class="bc-chev" data-action="bc-expand-rs" data-ns="${_e(ns)}" data-rs="${_e(name)}">▶</span>`
      : `<span class="bc-chev">·</span>`;
    item.innerHTML = `${chevHtml}<span class="bc-iname">${_e(name)}</span>`;
    if (type)
      item.insertAdjacentHTML(
        "beforeend",
        `<span class="bc-badge">${_e(type)}</span>`,
      );

    const children = document.createElement("div");
    children.className = "bc-rs-children";
    children.hidden = true;

    wrap.appendChild(item);
    wrap.appendChild(children);
    return wrap;
  }

  // ── Resource select (first click) ─────────────────────────────────────────

  async function selectRs(ns, name, itemEl) {
    _setSelected(itemEl);
    const detail = _detail();
    if (detail) detail.innerHTML = '<div class="bc-loading" style="padding:1.5rem;">Loading…</div>';

    try {
      const data = await _get(`${ns}/${name}`);
      if (detail) detail.innerHTML = _renderDetail(data);

      // Upgrade to expandable if multiple versions exist, but keep closed
      if ((data.value?.version ?? 0) > 1) {
        const chev = itemEl.querySelector(".bc-chev");
        itemEl.dataset.action = "bc-show-rs";
        if (chev) {
          chev.textContent = "▶";
          chev.dataset.action = "bc-expand-rs";
          chev.dataset.ns = itemEl.dataset.ns;
          chev.dataset.rs = itemEl.dataset.rs;
        }
      }
    } catch (err) {
      if (detail) detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${_e(err.message)}</p></div>`;
    }
  }

  // ── Resource expand (shows latest detail + toggles version list) ─────────────

  async function expandRs(ns, name, itemEl) {
    const wrap = itemEl.closest(".bc-rs-wrap");
    const children = wrap?.querySelector(".bc-rs-children");
    if (!children) return;
    const key = `${ns}/${name}`;
    const chev = wrap?.querySelector(".bc-chev");

    if (_expandedRs.has(key)) {
      _expandedRs.delete(key);
      chev?.classList.remove("open");
      children.hidden = true;
      return;
    }
    _expandedRs.add(key);
    chev?.classList.add("open");
    children.hidden = false;

    if (children.childElementCount > 0) return; // already populated

    children.innerHTML = '<div class="bc-loading bc-loading--ver">Loading…</div>';
    try {
      const data = await _get(`${ns}/${name}/versions`);
      const list = _arr(data, "versions", "items", "data");
      if (!list.length) {
        children.innerHTML = '<div class="bc-empty-ver">No versions</div>';
        return;
      }
      children.innerHTML = "";
      _populateVersions(children, list, ns, name);
    } catch (err) {
      children.innerHTML = `<div class="bc-err-ver">${_e(err.message)}</div>`;
    }
  }

  function _populateVersions(container, list, ns, name) {
    list.forEach((v, i) => {
      const num  = v.version ?? v.id ?? (i + 1);
      const uuid = v.uuid ?? "";
      const el = document.createElement("div");
      el.className = "bc-tree-item bc-ver";
      el.dataset.action = "bc-select-ver";
      el.dataset.uuid = uuid;
      el.dataset.ns   = ns;
      el.dataset.rs   = name;
      el.innerHTML = `<span class="bc-chev">·</span><span class="bc-iname">v${_e(String(num))}</span><span class="bc-ver-meta">${_e(_dateShort(v.created_at))}</span>`;
      if (uuid) el.title = uuid;
      container.appendChild(el);
    });
  }

  // ── Version select ─────────────────────────────────────────────────────────

  async function _showDetail(path, itemEl) {
    _setSelected(itemEl);
    const detail = _detail();
    if (!detail) return;
    detail.innerHTML = '<div class="bc-loading" style="padding:1.5rem;">Loading…</div>';
    try {
      const data = await _get(path);
      detail.innerHTML = _renderDetail(data);
    } catch (err) {
      detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${_e(err.message)}</p></div>`;
    }
  }

  function _setSelected(itemEl) {
    document.querySelectorAll(".bc-tree-item.selected").forEach((el) => el.classList.remove("selected"));
    itemEl.classList.add("selected");
  }

  function selectVer(uuid, itemEl) {
    return _showDetail(`uuid/${uuid}`, itemEl);
  }

  // ── Detail renderer ────────────────────────────────────────────────────────
  // Handles two shapes:
  //   full resource:  { name, type, namespace, created_by, created_at, value: { uuid, version, data, … } }
  //   uuid fetch:     { uuid, version, data, encryption_algorithm, encryption_key, created_at }

  function _renderDetail(d) {
    const isFlat = d.uuid != null && d.value === undefined;
    const val = isFlat ? d : (d.value ?? {});
    const ekey = val.encryption_key ?? {};

    // Header
    const type = d.type ?? "encrypted";
    const title = d.name ?? `v${val.version ?? "?"}`;
    const ns = d.namespace?.name ?? d.namespace ?? null;

    const headerMeta = [
      ns ? ["namespace", _e(ns)] : null,
      d.created_at ? ["created", _e(_date(d.created_at))] : null,
      d.created_by ? ["created by", _e(d.created_by)] : null,
      isFlat && val.uuid ? ["uuid", _e(val.uuid)] : null,
    ]
      .filter(Boolean)
      .map(
        ([k, v]) =>
          `<span class="bc-mk">${k}</span><span class="bc-mv">${v}</span>`,
      )
      .join("");

    // Value section
    const dataHtml =
      val.data != null
        ? `
  <div class="bc-section">
    <div class="bc-shdr">Value</div>
    <div class="bc-sbody"><div class="bc-val-data">${_e(String(val.data))}</div></div>
  </div>`
        : "";

    // Encryption section
    const encPairs = [
      val.encryption_algorithm
        ? ["algorithm", _e(val.encryption_algorithm)]
        : null,
      val.encryption_key_id != null
        ? ["key id", String(val.encryption_key_id)]
        : null,
      ekey.kek_version != null
        ? ["kek version", String(ekey.kek_version)]
        : null,
      ekey.created_at ? ["key created", _e(_date(ekey.created_at))] : null,
      ekey.encrypted_dek
        ? [
            "encrypted dek",
            `<span title="${_e(ekey.encrypted_dek)}">${_e(ekey.encrypted_dek.slice(0, 36))}…</span>`,
          ]
        : null,
    ].filter(Boolean);

    const encHtml = encPairs.length
      ? `
  <div class="bc-section">
    <div class="bc-shdr">Encryption</div>
    <div class="bc-sbody">
      <div class="bc-mgrid">${encPairs.map(([k, v]) => `<span class="bc-mk">${k}</span><span class="bc-mv">${v}</span>`).join("")}</div>
    </div>
  </div>`
      : "";

    const canDelete = !isFlat && d.name && ns;
    const deleteBtn = canDelete
      ? `<button class="btn btn-danger btn-sm" data-action="bc-delete-resource" data-ns="${_e(ns)}" data-rs="${_e(d.name)}" style="margin-left:auto;">Delete</button>`
      : "";

    return `
<div class="bc-card">
  <div class="bc-card-hdr">
    <span class="bc-rname">${_e(title)}</span>
    <span class="bc-rtype bc-rtype--${_e(type.toLowerCase())}">${_e(type)}</span>
    ${deleteBtn}
  </div>
  ${headerMeta ? `<div class="bc-mgrid">${headerMeta}</div>` : ""}
  ${dataHtml}${encHtml}
</div>`;
  }

  // ── Add resource – form stage ──────────────────────────────────────────────

  function _renderAddForm(ns, editable = false) {
    const verbs = _nsVerbs[ns] || [];
    const canWrite = editable || !verbs.length || verbs.map((v) => v.toUpperCase()).includes("WRITE");
    const warnHtml = !canWrite
      ? `<span class="bc-warn-indicator" title="You may not have write permission on this namespace">!</span>`
      : "";
    const title = editable ? "New Namespace / Resource" : "Add Resource";

    const nsField = editable
      ? `<div class="bc-add-field">
      <span class="bc-add-label">Namespace</span>
      <input type="text" id="bc-add-ns" placeholder="namespace-name" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;">
    </div>`
      : `<div class="bc-add-field">
      <span class="bc-add-label">Namespace</span>
      <span class="bc-mv" style="font-size:0.88rem;">${_e(ns)}</span>
    </div>`;

    return `
<div class="bc-add-form" id="bc-add-form">
  <div class="bc-add-form-hdr">
    <span>${title}</span>${warnHtml}
  </div>
  <div class="bc-add-form-body">
    ${nsField}
    <div class="bc-add-field">
      <span class="bc-add-label">Resource Name</span>
      <input type="text" id="bc-add-name" placeholder="resource-name" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;">
    </div>
    <div class="bc-add-field">
      <span class="bc-add-label">Type</span>
      <div class="bc-type-row">
        <label class="bc-type-opt"><input type="radio" name="bc-add-type" value="cleartext" checked> cleartext</label>
        <label class="bc-type-opt"><input type="radio" name="bc-add-type" value="encrypted"> encrypted</label>
      </div>
    </div>
    <div class="bc-add-field">
      <span class="bc-add-label">Value</span>
      <textarea id="bc-add-value" class="pane-search" rows="2" style="flex:none;width:100%;resize:vertical;font-family:monospace;font-size:0.84rem;"></textarea>
    </div>
    <div id="bc-add-err" style="color:#ef4444;font-size:0.8rem;min-height:1rem;"></div>
  </div>
  <div style="display:flex;gap:0.5rem;padding:0.6rem 0.75rem;border-top:1px solid var(--border);">
    <button class="btn btn-ghost btn-sm" data-action="bc-add-resource-cancel">Cancel</button>
    <button class="btn btn-primary btn-sm" data-action="bc-add-resource-review" style="margin-left:auto;">Review →</button>
  </div>
</div>`;
  }

  // ── Add resource – review stage ────────────────────────────────────────────

  function _renderAddReview(draft) {
    return `
<div class="bc-add-form" id="bc-add-form">
  <div class="bc-add-form-hdr"><span>Review</span></div>
  <div class="bc-add-review-body">
    <p>Add resource <strong>${_e(draft.name)}</strong>
    <span class="bc-badge" style="vertical-align:middle;">${_e(draft.type)}</span>
    to namespace <strong>${_e(draft.ns)}</strong></p>
  </div>
  <div style="display:flex;gap:0.5rem;padding:0.6rem 0.75rem;border-top:1px solid var(--border);">
    <button class="btn btn-ghost btn-sm" data-action="bc-add-resource-back">← Back</button>
    <button class="btn btn-primary btn-sm" data-action="bc-add-resource-confirm" style="margin-left:auto;">Confirm →</button>
  </div>
</div>`;
  }

  // ── Point query – form renderer ────────────────────────────────────────────

  function _renderQueryForm(ns = "", name = "", { result = null, error = null, loading = false, stale = false } = {}) {
    const errorHtml = error ? `<p class="bc-err" style="font-size:0.82rem;padding-bottom:0.5rem;">${_e(error)}</p>` : "";
    let resultHtml;
    if (loading) {
      resultHtml = `<div class="bc-query-result-area">${errorHtml}<div class="bc-loading">Looking up…</div></div>`;
    } else if (result) {
      resultHtml = `<div class="bc-query-result-area">${errorHtml}${_renderDetail(result)}</div>`;
    } else if (error) {
      resultHtml = `<div class="bc-query-result-area">${errorHtml}</div>`;
    } else {
      resultHtml = `<div class="bc-query-result-area bc-query-result-empty">Enter namespace and resource name to look up a resource directly.</div>`;
    }
    const staleBadge = stale ? `<span class="bc-query-cached-badge" title="Showing cached result">cached</span>` : "";
    return `
<div id="bc-query-form">
  <div class="bc-add-form-hdr">
    <span>Point Query</span>${staleBadge}
  </div>
  <div class="bc-query-fields">
    <input type="text" id="bc-query-ns" placeholder="namespace" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;" value="${_e(ns)}">
    <input type="text" id="bc-query-name" placeholder="resource-name" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;" value="${_e(name)}">
    <button class="btn btn-primary btn-sm" data-action="bc-query-submit" style="align-self:flex-start;">Lookup</button>
  </div>
  ${resultHtml}
</div>`;
  }

  // ── Pinned resources (queried resources whose ns isn't in LIST) ───────────

  function _pinResource(nsName, resourceName, type) {
    if (!_pinnedResources.has(nsName)) _pinnedResources.set(nsName, new Map());
    _pinnedResources.get(nsName).set(resourceName, { type: type ?? "" });
    _injectPinned();
    _refreshNsIfOpen(nsName);
  }

  function _injectPinned() {
    const body = _tree();
    if (!body) return;
    const newEntry = body.querySelector(".bc-ns-new");
    for (const [nsName, resources] of _pinnedResources) {
      if (resources.size === 0) continue;
      // Skip if ns is already in tree (from LIST or previous inject)
      if (body.querySelector(`.bc-ns[data-ns="${CSS.escape(nsName)}"]`)) continue;
      const wrap = _nsEl(nsName, { pinned: true });
      body.insertBefore(wrap, newEntry ?? null);
    }
  }

  // ── Namespace refresh helper ───────────────────────────────────────────────

  function _refreshNsIfOpen(nsName) {
    const nsItem = _tree()?.querySelector(`.bc-ns[data-ns="${CSS.escape(nsName)}"]`);
    const nsWrap = nsItem?.closest(".bc-ns-wrap");
    if (!nsWrap || !_expandedNs.has(nsName)) return;
    _expandedNs.delete(nsName);
    nsItem.querySelector(".bc-chev")?.classList.remove("open");
    const children = nsWrap.querySelector(".bc-ns-children");
    if (children) children.hidden = true;
    expandNs(nsName, nsItem);
  }

  // ── Add resource – commit ──────────────────────────────────────────────────

  async function _commitAddResource(draft) {
    const form = document.getElementById("bc-add-form");
    if (!form) return;

    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const body = form.querySelector(".bc-add-review-body");
    if (body) body.innerHTML = `<p style="color:#94a3b8;">Creating…</p>`;

    try {
      await _put(`${draft.ns}/${draft.name}`, { type: draft.type, value: draft.value });

      _draftResource = null;
      const detail = _detail();
      if (detail) detail.innerHTML = `
<div class="bc-card">
  <div class="bc-card-hdr">
    <span class="bc-rname">${_e(draft.name)}</span>
    <span class="bc-rtype bc-rtype--${_e(draft.type.toLowerCase())}">${_e(draft.type)}</span>
  </div>
  <div class="bc-mgrid">
    <span class="bc-mk">namespace</span><span class="bc-mv">${_e(draft.ns)}</span>
    <span class="bc-mk">status</span><span class="bc-mv" style="color:#22c55e;">created</span>
  </div>
</div>`;

      _refreshNsIfOpen(draft.ns);
    } catch (err) {
      _draftResource = null;
      const detail = _detail();
      if (detail) detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${_e(err.message)}</p></div>`;
    }
  }

  // ── handleAction (called by tabs.js dispatcher) ────────────────────────────

  function handleAction(action, el) {
    const { ns, rs, ver } = el.dataset;
    switch (action) {
      case "bc-expand-ns":
        expandNs(ns, el);
        return true;
      case "bc-expand-rs":
        expandRs(ns, rs, el);
        return true;
      case "bc-show-rs": {
        const item = el.closest(".bc-tree-item") ?? el;
        _showDetail(`${ns}/${rs}`, item);
        return true;
      }
      case "bc-select-rs":
        selectRs(ns, rs, el);
        return true;
      case "bc-select-ver":
        selectVer(el.dataset.uuid, el);
        return true;
      case "bc-ns-refresh":
        loadNamespaces();
        return true;

      case "bc-add-resource": {
        _draftResource = { ns: el.dataset.ns, name: "", type: "cleartext", value: "" };
        const detail = _detail();
        if (detail) detail.innerHTML = _renderAddForm(el.dataset.ns);
        return true;
      }

      case "bc-add-resource-cancel": {
        _draftResource = null;
        const detail = _detail();
        if (detail) detail.innerHTML = '<div class="pane-empty"><p>Select a resource</p></div>';
        return true;
      }

      case "bc-add-resource-review": {
        const nsInput = document.getElementById("bc-add-ns");
        const ns      = nsInput ? nsInput.value.trim() : (_draftResource?.ns ?? "");
        const name    = document.getElementById("bc-add-name")?.value.trim();
        const type    = document.querySelector("input[name='bc-add-type']:checked")?.value || "cleartext";
        const value   = document.getElementById("bc-add-value")?.value ?? "";
        const errEl   = document.getElementById("bc-add-err");
        if (!ns || !name) {
          if (errEl) errEl.textContent = "Namespace and name are required";
          return true;
        }
        _draftResource = { ns, name, type, value };
        const form = document.getElementById("bc-add-form");
        if (form) form.outerHTML = _renderAddReview(_draftResource);
        return true;
      }

      case "bc-add-resource-back": {
        if (!_draftResource) return true;
        const { ns, editable } = _draftResource;
        const form = document.getElementById("bc-add-form");
        if (form) form.outerHTML = _renderAddForm(ns, editable);
        // restore field values from draft
        const nsEl   = document.getElementById("bc-add-ns");
        const nameEl = document.getElementById("bc-add-name");
        const valEl  = document.getElementById("bc-add-value");
        const typeEl = document.querySelector(`input[name='bc-add-type'][value='${_draftResource.type}']`);
        if (nsEl)   nsEl.value   = _draftResource.ns;
        if (nameEl) nameEl.value = _draftResource.name;
        if (valEl)  valEl.value  = _draftResource.value;
        if (typeEl) typeEl.checked = true;
        return true;
      }

      case "bc-add-resource-confirm": {
        if (!_draftResource) return true;
        _commitAddResource(_draftResource);
        return true;
      }

      case "bc-delete-resource": {
        const { ns, rs } = el.dataset;
        const detail = _detail();
        if (detail) detail.innerHTML = `<div class="bc-loading" style="padding:1.5rem;">Deleting…</div>`;
        _del(`${ns}/${rs}`).then(() => {
          _queryCache.delete(`${ns}/${rs}`);
          const pins = _pinnedResources.get(ns);
          if (pins) {
            pins.delete(rs);
            if (pins.size === 0) {
              _pinnedResources.delete(ns);
              _tree()?.querySelector(`.bc-ns--pinned[data-ns="${CSS.escape(ns)}"]`)?.closest(".bc-ns-wrap")?.remove();
            }
          }
          if (detail) detail.innerHTML = '<div class="pane-empty"><p>Resource deleted</p></div>';
          _refreshNsIfOpen(ns);
        }).catch((err) => {
          if (detail) detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${_e(err.message)}</p></div>`;
        });
        return true;
      }

      case "bc-query": {
        const detail = _detail();
        if (!detail) return true;
        const qns = _queryDraft?.ns ?? "";
        const qname = _queryDraft?.name ?? "";
        const cached = qns && qname ? _queryCache.get(`${qns}/${qname}`) ?? null : null;
        detail.innerHTML = _renderQueryForm(qns, qname, { result: cached, stale: !!cached });
        return true;
      }

      case "bc-query-submit": {
        const qns   = document.getElementById("bc-query-ns")?.value.trim() ?? "";
        const qname = document.getElementById("bc-query-name")?.value.trim() ?? "";
        if (!qns || !qname) return true;
        _queryDraft = { ns: qns, name: qname };
        const key = `${qns}/${qname}`;
        const cached = _queryCache.get(key) ?? null;
        const detail = _detail();
        if (detail) detail.innerHTML = _renderQueryForm(qns, qname, {
          result: cached,
          loading: !cached,
          stale: !!cached,
        });
        _get(`${qns}/${qname}`).then(data => {
          _queryCache.set(key, data);
          const nsName = data.namespace?.name ?? data.namespace ?? qns;
          _pinResource(nsName, qname, data.type ?? "");
          if (detail) detail.innerHTML = _renderQueryForm(qns, qname, { result: data });
        }).catch(err => {
          if (detail) detail.innerHTML = _renderQueryForm(qns, qname, {
            result: cached,
            error: err.message,
            stale: !!cached,
          });
        });
        return true;
      }

      case "bc-add-new": {
        _draftResource = { ns: "", name: "", type: "cleartext", value: "", editable: true };
        const detail = _detail();
        if (detail) detail.innerHTML = _renderAddForm("", true);
        return true;
      }
    }
    return false;
  }

  // ── onLogin (called by tabs.js after login/session confirmed) ──────────────

  function onLogin() {
    if (!_tree()) {
      setTimeout(onLogin, 80);
      return;
    }
    _expandedNs.clear();
    _expandedRs.clear();
    loadNamespaces();
  }

  function reset() {
    clearSession();
    _expandedNs.clear();
    _expandedRs.clear();
    _draftResource = null;
    _queryDraft = null;
    _queryCache.clear();
    _pinnedResources.clear();
    for (const k of Object.keys(_nsVerbs)) delete _nsVerbs[k];
    const body = _tree();
    if (body) body.innerHTML = '<div class="pane-empty"><p>Log in to browse</p></div>';
    const detail = _detail();
    if (detail) detail.innerHTML = '<div class="pane-empty"><p>Select a resource</p></div>';
  }

  return { setSession, clearSession, hasSession, getUser, onLogin, handleAction, reset };
})();
