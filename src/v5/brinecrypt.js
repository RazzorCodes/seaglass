window.SeaglassBrinecrypt = (function () {
  const _expandedNs = new Set();
  const _expandedRs = new Set();
  const _nsVerbs = {};
  const _queryCache = new Map();
  const _pinnedResources = new Map(); // nsName -> Map<resourceName, {type}>

  let _draftResource = null;
  let _queryDraft = null;

  // ── Logging ────────────────────────────────────────────────────────────────

  function _ts() {
    return new Date().toISOString().slice(11, 23);
  }
  function _logOk(tag, d) {
    console.log(`[ok]  [${_ts()}] bc ${tag}`, d);
  }
  function _logWarn(tag, d) {
    console.warn(`[warn][${_ts()}] bc ${tag}`, d);
  }

  // ── API (new brinecrypt endpoint shapes) ───────────────────────────────────

  async function _post(seaglassPath, body, extra = {}) {
    const qs = Object.keys(extra).length
      ? "?" + new URLSearchParams(extra).toString()
      : "";
    const r = await fetch(`/api/brinecrypt/v1/${seaglassPath}${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { error: text.trim() || `HTTP ${r.status}` };
    }
    if (!r.ok) {
      _logWarn(seaglassPath, data);
      throw new Error(data.error || data.message || `HTTP ${r.status}`);
    }
    _logOk(seaglassPath, data);
    return data;
  }

  async function _listNamespaces() {
    const r = await fetch("/api/brinecrypt/v1/namespace");
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { error: text.trim() || `HTTP ${r.status}` };
    }
    if (!r.ok) {
      _logWarn("namespace/list", data);
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    _logOk("namespace/list", data);
    return data;
  }

  async function _queryNamespace(ns) {
    return _post("namespace", { namespace: ns });
  }

  async function _queryResource(ns, name) {
    return _post("resource", { namespace: ns, name }, { op: "query" });
  }

  async function _queryResourceByUuid(uuid) {
    return _post("resource", { uuid }, { op: "query" });
  }

  async function _queryVersions(ns, name) {
    return _post("resource", { namespace: ns, name }, { op: "versions" });
  }

  async function _writeResource(ns, name, type, value) {
    const r = await fetch("/api/brinecrypt/v1/resource", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: ns, name, type, value }),
    });
    const data = await r.json();
    if (!r.ok) {
      _logWarn("resource/put", data);
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    _logOk("resource/put", data);
    return data;
  }

  async function _deleteResource(ns, name) {
    const r = await fetch("/api/brinecrypt/v1/resource", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: ns, name }),
    });
    const data = r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : {};
    if (!r.ok) {
      _logWarn("resource/delete", data);
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    _logOk("resource/delete", data);
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
      const data = await _listNamespaces();
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
      body.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
    }
  }

  function _nsEl(name, { pinned = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "bc-ns-wrap";

    const item = document.createElement("div");
    item.className = "bc-tree-item bc-ns" + (pinned ? " bc-ns--pinned" : "");
    item.dataset.action = "bc-expand-ns";
    item.dataset.ns = name;
    const pinMark = pinned
      ? `<span class="bc-pin-mark" title="Pinned from query">·</span>`
      : "";
    item.innerHTML = `<span class="bc-chev">▶</span><span class="bc-iname">${esc(name)}</span>${pinMark}<button class="bc-icon-btn bc-ns-add" data-action="bc-add-resource" data-ns="${esc(name)}" title="Add resource to ${esc(name)}">＋</button>`;

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
      const data = await _queryNamespace(name);
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
        children.innerHTML = `<div class="bc-err-indent">${esc(err.message)}</div>`;
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
      ? `<span class="bc-chev" data-action="bc-expand-rs" data-ns="${esc(ns)}" data-rs="${esc(name)}">▶</span>`
      : `<span class="bc-chev">·</span>`;
    item.innerHTML = `${chevHtml}<span class="bc-iname">${esc(name)}</span>`;
    if (type)
      item.insertAdjacentHTML(
        "beforeend",
        `<span class="bc-badge">${esc(type)}</span>`,
      );

    const children = document.createElement("div");
    children.className = "bc-rs-children";
    children.hidden = true;

    wrap.appendChild(item);
    wrap.appendChild(children);
    return wrap;
  }

  // ── Resource select ────────────────────────────────────────────────────────

  async function selectRs(ns, name, itemEl) {
    _setSelected(itemEl);
    const detail = _detail();
    if (detail)
      detail.innerHTML =
        '<div class="bc-loading" style="padding:1.5rem;">Loading…</div>';

    try {
      const data = await _queryResource(ns, name);
      if (detail) detail.innerHTML = _renderDetail(data);

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
      if (detail)
        detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
    }
  }

  // ── Resource expand ────────────────────────────────────────────────────────

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

    if (children.childElementCount > 0) return;

    children.innerHTML =
      '<div class="bc-loading bc-loading--ver">Loading…</div>';
    try {
      const data = await _queryVersions(ns, name);
      const list = _arr(data, "versions", "items", "data");
      if (!list.length) {
        children.innerHTML = '<div class="bc-empty-ver">No versions</div>';
        return;
      }
      children.innerHTML = "";
      _populateVersions(children, list, ns, name);
    } catch (err) {
      children.innerHTML = `<div class="bc-err-ver">${esc(err.message)}</div>`;
    }
  }

  function _populateVersions(container, list, ns, name) {
    list.forEach((v, i) => {
      const num = v.version ?? v.id ?? i + 1;
      const uuid = v.uuid ?? "";
      const el = document.createElement("div");
      el.className = "bc-tree-item bc-ver";
      el.dataset.action = "bc-select-ver";
      el.dataset.uuid = uuid;
      el.dataset.ns = ns;
      el.dataset.rs = name;
      el.innerHTML = `<span class="bc-chev">·</span><span class="bc-iname">v${esc(String(num))}</span><span class="bc-ver-meta">${esc(_dateShort(v.created_at))}</span>`;
      if (uuid) el.title = uuid;
      container.appendChild(el);
    });
  }

  // ── Version select ─────────────────────────────────────────────────────────

  async function _showDetail(ns, name, uuid, itemEl) {
    _setSelected(itemEl);
    const detail = _detail();
    if (!detail) return;
    detail.innerHTML =
      '<div class="bc-loading" style="padding:1.5rem;">Loading…</div>';
    try {
      const data = uuid
        ? await _queryResourceByUuid(uuid)
        : await _queryResource(ns, name);
      detail.innerHTML = _renderDetail(data);
    } catch (err) {
      detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
    }
  }

  function _setSelected(itemEl) {
    document
      .querySelectorAll(".bc-tree-item.selected")
      .forEach((el) => el.classList.remove("selected"));
    itemEl.classList.add("selected");
  }

  // ── Detail renderer ────────────────────────────────────────────────────────

  function _renderDetail(d) {
    const isFlat = d.uuid != null && d.value === undefined;
    const val = isFlat ? d : (d.value ?? {});
    const ekey = val.encryption_key ?? {};

    const type = d.type ?? "encrypted";
    const title = d.name ?? `v${val.version ?? "?"}`;
    const ns = d.namespace?.name ?? d.namespace ?? null;

    const headerMeta = [
      ns ? ["namespace", esc(ns)] : null,
      d.created_at ? ["created", esc(_date(d.created_at))] : null,
      d.created_by ? ["created by", esc(d.created_by)] : null,
      isFlat && val.uuid ? ["uuid", esc(val.uuid)] : null,
    ]
      .filter(Boolean)
      .map(
        ([k, v]) =>
          `<span class="bc-mk">${k}</span><span class="bc-mv">${v}</span>`,
      )
      .join("");

    const dataHtml =
      val.data != null
        ? `<div class="bc-section"><div class="bc-shdr">Value</div><div class="bc-sbody"><div class="bc-val-data">${esc(String(val.data))}</div></div></div>`
        : "";

    const encPairs = [
      val.encryption_algorithm
        ? ["algorithm", esc(val.encryption_algorithm)]
        : null,
      val.encryption_key_id != null
        ? ["key id", String(val.encryption_key_id)]
        : null,
      ekey.kek_version != null
        ? ["kek version", String(ekey.kek_version)]
        : null,
      ekey.created_at ? ["key created", esc(_date(ekey.created_at))] : null,
      ekey.encrypted_dek
        ? [
            "encrypted dek",
            `<span title="${esc(ekey.encrypted_dek)}">${esc(ekey.encrypted_dek.slice(0, 36))}…</span>`,
          ]
        : null,
    ].filter(Boolean);

    const encHtml = encPairs.length
      ? `<div class="bc-section"><div class="bc-shdr">Encryption</div><div class="bc-sbody"><div class="bc-mgrid">${encPairs.map(([k, v]) => `<span class="bc-mk">${k}</span><span class="bc-mv">${v}</span>`).join("")}</div></div></div>`
      : "";

    const canDelete = !isFlat && d.name && ns;
    const deleteBtn = canDelete
      ? `<button class="btn btn-danger btn-sm" data-action="bc-delete-resource" data-ns="${esc(ns)}" data-rs="${esc(d.name)}" style="margin-left:auto;">Delete</button>`
      : "";

    return `
<div class="bc-card">
  <div class="bc-card-hdr">
    <span class="bc-rname">${esc(title)}</span>
    <span class="bc-rtype bc-rtype--${esc(type.toLowerCase())}">${esc(type)}</span>
    ${deleteBtn}
  </div>
  ${headerMeta ? `<div class="bc-mgrid">${headerMeta}</div>` : ""}
  ${dataHtml}${encHtml}
</div>`;
  }

  // ── Add resource form ──────────────────────────────────────────────────────

  function _renderAddForm(ns, editable = false) {
    const verbs = _nsVerbs[ns] || [];
    const canWrite =
      editable ||
      !verbs.length ||
      verbs.map((v) => v.toUpperCase()).includes("WRITE");
    const warnHtml = !canWrite
      ? `<span class="bc-warn-indicator" title="You may not have write permission on this namespace">!</span>`
      : "";
    const title = editable ? "New Namespace / Resource" : "Add Resource";

    const nsField = editable
      ? `<div class="bc-add-field"><span class="bc-add-label">Namespace</span><input type="text" id="bc-add-ns" placeholder="namespace-name" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;"></div>`
      : `<div class="bc-add-field"><span class="bc-add-label">Namespace</span><span class="bc-mv" style="font-size:0.88rem;">${esc(ns)}</span></div>`;

    return `
<div class="bc-add-form" id="bc-add-form">
  <div class="bc-add-form-hdr"><span>${title}</span>${warnHtml}</div>
  <div class="bc-add-form-body">
    ${nsField}
    <div class="bc-add-field"><span class="bc-add-label">Resource Name</span><input type="text" id="bc-add-name" placeholder="resource-name" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;"></div>
    <div class="bc-add-field"><span class="bc-add-label">Type</span>
      <div class="bc-type-row">
        <label class="bc-type-opt"><input type="radio" name="bc-add-type" value="cleartext" checked> cleartext</label>
        <label class="bc-type-opt"><input type="radio" name="bc-add-type" value="encrypted"> encrypted</label>
      </div>
    </div>
    <div class="bc-add-field"><span class="bc-add-label">Value</span><textarea id="bc-add-value" class="pane-search" rows="2" style="flex:none;width:100%;resize:vertical;font-family:monospace;font-size:0.84rem;"></textarea></div>
    <div id="bc-add-err" style="color:#ef4444;font-size:0.8rem;min-height:1rem;"></div>
  </div>
  <div style="display:flex;gap:0.5rem;padding:0.6rem 0.75rem;border-top:1px solid var(--border);">
    <button class="btn btn-ghost btn-sm" data-action="bc-add-resource-cancel">Cancel</button>
    <button class="btn btn-primary btn-sm" data-action="bc-add-resource-review" style="margin-left:auto;">Review →</button>
  </div>
</div>`;
  }

  function _renderAddReview(draft) {
    return `
<div class="bc-add-form" id="bc-add-form">
  <div class="bc-add-form-hdr"><span>Review</span></div>
  <div class="bc-add-review-body">
    <p>Add resource <strong>${esc(draft.name)}</strong> <span class="bc-badge" style="vertical-align:middle;">${esc(draft.type)}</span> to namespace <strong>${esc(draft.ns)}</strong></p>
  </div>
  <div style="display:flex;gap:0.5rem;padding:0.6rem 0.75rem;border-top:1px solid var(--border);">
    <button class="btn btn-ghost btn-sm" data-action="bc-add-resource-back">← Back</button>
    <button class="btn btn-primary btn-sm" data-action="bc-add-resource-confirm" style="margin-left:auto;">Confirm →</button>
  </div>
</div>`;
  }

  // ── Point query form ───────────────────────────────────────────────────────

  function _renderQueryForm(
    ns = "",
    name = "",
    { result = null, error = null, loading = false, stale = false } = {},
  ) {
    const errorHtml = error
      ? `<p class="bc-err" style="font-size:0.82rem;padding-bottom:0.5rem;">${esc(error)}</p>`
      : "";
    let resultHtml;
    if (loading)
      resultHtml = `<div class="bc-query-result-area">${errorHtml}<div class="bc-loading">Looking up…</div></div>`;
    else if (result)
      resultHtml = `<div class="bc-query-result-area">${errorHtml}${_renderDetail(result)}</div>`;
    else if (error)
      resultHtml = `<div class="bc-query-result-area">${errorHtml}</div>`;
    else
      resultHtml = `<div class="bc-query-result-area bc-query-result-empty">Enter namespace and resource name to look up a resource directly.</div>`;

    const staleBadge = stale
      ? `<span class="bc-query-cached-badge" title="Showing cached result">cached</span>`
      : "";
    return `
<div id="bc-query-form">
  <div class="bc-add-form-hdr"><span>Point Query</span>${staleBadge}</div>
  <div class="bc-query-fields">
    <input type="text" id="bc-query-ns"   placeholder="namespace"     class="pane-search" style="flex:none;width:100%;font-size:0.84rem;" value="${esc(ns)}">
    <input type="text" id="bc-query-name" placeholder="resource-name" class="pane-search" style="flex:none;width:100%;font-size:0.84rem;" value="${esc(name)}">
    <button class="btn btn-primary btn-sm" data-action="bc-query-submit" style="align-self:flex-start;">Lookup</button>
  </div>
  ${resultHtml}
</div>`;
  }

  // ── Pinned resources ───────────────────────────────────────────────────────

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
      if (body.querySelector(`.bc-ns[data-ns="${CSS.escape(nsName)}"]`))
        continue;
      const wrap = _nsEl(nsName, { pinned: true });
      body.insertBefore(wrap, newEntry ?? null);
    }
  }

  function _refreshNsIfOpen(nsName) {
    const nsItem = _tree()?.querySelector(
      `.bc-ns[data-ns="${CSS.escape(nsName)}"]`,
    );
    const nsWrap = nsItem?.closest(".bc-ns-wrap");
    if (!nsWrap || !_expandedNs.has(nsName)) return;
    _expandedNs.delete(nsName);
    nsItem.querySelector(".bc-chev")?.classList.remove("open");
    const children = nsWrap.querySelector(".bc-ns-children");
    if (children) children.hidden = true;
    expandNs(nsName, nsItem);
  }

  // ── Add resource commit ────────────────────────────────────────────────────

  async function _commitAddResource(draft) {
    const form = document.getElementById("bc-add-form");
    if (!form) return;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const body = form.querySelector(".bc-add-review-body");
    if (body) body.innerHTML = `<p style="color:#94a3b8;">Creating…</p>`;

    try {
      await _writeResource(draft.ns, draft.name, draft.type, draft.value);
      _draftResource = null;
      const detail = _detail();
      if (detail)
        detail.innerHTML = `
<div class="bc-card">
  <div class="bc-card-hdr">
    <span class="bc-rname">${esc(draft.name)}</span>
    <span class="bc-rtype bc-rtype--${esc(draft.type.toLowerCase())}">${esc(draft.type)}</span>
  </div>
  <div class="bc-mgrid">
    <span class="bc-mk">namespace</span><span class="bc-mv">${esc(draft.ns)}</span>
    <span class="bc-mk">status</span><span class="bc-mv" style="color:#22c55e;">created</span>
  </div>
</div>`;
      const pinnedNsEl = _tree()?.querySelector(
        `.bc-ns--pinned[data-ns="${CSS.escape(draft.ns)}"]`,
      );
      if (pinnedNsEl) {
        pinnedNsEl.closest(".bc-ns-wrap")?.remove();
        _pinnedResources.delete(draft.ns);
        _expandedNs.delete(draft.ns);
      } else {
        _refreshNsIfOpen(draft.ns);
      }
    } catch (err) {
      _draftResource = null;
      const detail = _detail();
      if (detail)
        detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
    }
  }

  // ── handleAction ───────────────────────────────────────────────────────────

  function handleAction(action, el) {
    const { ns, rs } = el.dataset;
    switch (action) {
      case "bc-expand-ns":
        expandNs(ns, el);
        return true;
      case "bc-expand-rs":
        expandRs(ns, rs, el);
        return true;
      case "bc-show-rs": {
        const item = el.closest(".bc-tree-item") ?? el;
        _showDetail(ns, rs, null, item);
        return true;
      }
      case "bc-select-rs":
        selectRs(ns, rs, el);
        return true;
      case "bc-select-ver":
        _showDetail(el.dataset.ns, el.dataset.rs, el.dataset.uuid, el);
        return true;
      case "bc-ns-refresh":
        loadNamespaces();
        return true;

      case "bc-add-resource": {
        _draftResource = {
          ns: el.dataset.ns,
          name: "",
          type: "cleartext",
          value: "",
        };
        const detail = _detail();
        if (detail) detail.innerHTML = _renderAddForm(el.dataset.ns);
        return true;
      }
      case "bc-add-resource-cancel": {
        _draftResource = null;
        const detail = _detail();
        if (detail)
          detail.innerHTML =
            '<div class="pane-empty"><p>Select a resource</p></div>';
        return true;
      }
      case "bc-add-resource-review": {
        const nsInput = document.getElementById("bc-add-ns");
        const resolvedNs = nsInput
          ? nsInput.value.trim()
          : (_draftResource?.ns ?? "");
        const name = document.getElementById("bc-add-name")?.value.trim();
        const type =
          document.querySelector("input[name='bc-add-type']:checked")?.value ||
          "cleartext";
        const value = document.getElementById("bc-add-value")?.value ?? "";
        const errEl = document.getElementById("bc-add-err");
        if (!resolvedNs || !name) {
          if (errEl) errEl.textContent = "Namespace and name are required";
          return true;
        }
        _draftResource = { ns: resolvedNs, name, type, value };
        const form = document.getElementById("bc-add-form");
        if (form) form.outerHTML = _renderAddReview(_draftResource);
        return true;
      }
      case "bc-add-resource-back": {
        if (!_draftResource) return true;
        const { ns: draftNs, editable } = _draftResource;
        const form = document.getElementById("bc-add-form");
        if (form) form.outerHTML = _renderAddForm(draftNs, editable);
        const nsEl = document.getElementById("bc-add-ns");
        const nameEl = document.getElementById("bc-add-name");
        const valEl = document.getElementById("bc-add-value");
        const typeEl = document.querySelector(
          `input[name='bc-add-type'][value='${_draftResource.type}']`,
        );
        if (nsEl) nsEl.value = _draftResource.ns;
        if (nameEl) nameEl.value = _draftResource.name;
        if (valEl) valEl.value = _draftResource.value;
        if (typeEl) typeEl.checked = true;
        return true;
      }
      case "bc-add-resource-confirm":
        if (_draftResource) _commitAddResource(_draftResource);
        return true;

      case "bc-delete-resource": {
        const { ns: dNs, rs: dRs } = el.dataset;
        const detail = _detail();
        if (detail)
          detail.innerHTML =
            '<div class="bc-loading" style="padding:1.5rem;">Deleting…</div>';
        _deleteResource(dNs, dRs)
          .then(() => {
            _queryCache.delete(`${dNs}/${dRs}`);
            const pins = _pinnedResources.get(dNs);
            if (pins) {
              pins.delete(dRs);
              if (pins.size === 0) {
                _pinnedResources.delete(dNs);
                _tree()
                  ?.querySelector(
                    `.bc-ns--pinned[data-ns="${CSS.escape(dNs)}"]`,
                  )
                  ?.closest(".bc-ns-wrap")
                  ?.remove();
              }
            }
            if (detail)
              detail.innerHTML =
                '<div class="pane-empty"><p>Resource deleted</p></div>';
            _refreshNsIfOpen(dNs);
          })
          .catch((err) => {
            if (detail)
              detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
          });
        return true;
      }

      case "bc-query": {
        const detail = _detail();
        if (!detail) return true;
        const qns = _queryDraft?.ns ?? "";
        const qname = _queryDraft?.name ?? "";
        const cached =
          qns && qname ? (_queryCache.get(`${qns}/${qname}`) ?? null) : null;
        detail.innerHTML = _renderQueryForm(qns, qname, {
          result: cached,
          stale: !!cached,
        });
        return true;
      }
      case "bc-query-submit": {
        const qns = document.getElementById("bc-query-ns")?.value.trim() ?? "";
        const qname =
          document.getElementById("bc-query-name")?.value.trim() ?? "";
        if (!qns || !qname) return true;
        _queryDraft = { ns: qns, name: qname };
        const key = `${qns}/${qname}`;
        const cached = _queryCache.get(key) ?? null;
        const detail = _detail();
        if (detail)
          detail.innerHTML = _renderQueryForm(qns, qname, {
            result: cached,
            loading: !cached,
            stale: !!cached,
          });
        _queryResource(qns, qname)
          .then((data) => {
            _queryCache.set(key, data);
            const nsName = data.namespace?.name ?? data.namespace ?? qns;
            _pinResource(nsName, qname, data.type ?? "");
            if (detail)
              detail.innerHTML = _renderQueryForm(qns, qname, { result: data });
          })
          .catch((err) => {
            if (detail)
              detail.innerHTML = _renderQueryForm(qns, qname, {
                result: cached,
                error: err.message,
                stale: !!cached,
              });
          });
        return true;
      }

      case "bc-add-new": {
        _draftResource = {
          ns: "",
          name: "",
          type: "cleartext",
          value: "",
          editable: true,
        };
        const detail = _detail();
        if (detail) detail.innerHTML = _renderAddForm("", true);
        return true;
      }
    }
    return false;
  }

  // ── onLogin / onActiveSessionChanged ───────────────────────────────────────

  function onLogin() {
    if (!_tree()) {
      setTimeout(onLogin, 80);
      return;
    }
    _expandedNs.clear();
    _expandedRs.clear();
    loadNamespaces();
  }

  function onActiveSessionChanged() {
    _expandedNs.clear();
    _expandedRs.clear();
    _draftResource = null;
    _queryDraft = null;
    _queryCache.clear();
    _pinnedResources.clear();
    for (const k of Object.keys(_nsVerbs)) delete _nsVerbs[k];
    onLogin();
  }

  function reset() {
    onActiveSessionChanged();
    const body = _tree();
    if (body)
      body.innerHTML = '<div class="pane-empty"><p>Select a resource</p></div>';
    const detail = _detail();
    if (detail)
      detail.innerHTML =
        '<div class="pane-empty"><p>Select a resource</p></div>';
  }

  return { onLogin, onActiveSessionChanged, handleAction, reset };
})();
