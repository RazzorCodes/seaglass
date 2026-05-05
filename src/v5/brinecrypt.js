window.SeaglassBrinecrypt = (function () {
  const _expandedNs = new Set();
  const _expandedRs = new Set();

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
      if (r.status === 401) {
        await fetch("/api/brinecrypt/logout", { method: "POST" }).catch(
          () => {},
        );
        window.SeaglassTabs?.resetLoginWidget();
      }
      throw new Error(data.error || `HTTP ${r.status}`);
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
      if (!list.length) {
        body.innerHTML =
          '<div class="pane-empty"><p>No namespaces available</p></div>';
        return;
      }
      const visible = list.filter(
        (ns) => !ns.verbs || _hasVerb(ns, "READ", "LIST"),
      );
      body.innerHTML = "";
      visible.forEach((ns) =>
        body.appendChild(_nsEl(ns.namespace ?? ns.name ?? ns)),
      );
    } catch (err) {
      body.innerHTML = `<div class="pane-empty"><p class="bc-err">${_e(err.message)}</p></div>`;
    }
  }

  function _nsEl(name) {
    const wrap = document.createElement("div");
    wrap.className = "bc-ns-wrap";

    const item = document.createElement("div");
    item.className = "bc-tree-item bc-ns";
    item.dataset.action = "bc-expand-ns";
    item.dataset.ns = name;
    item.innerHTML = `<span class="bc-chev">▶</span><span class="bc-iname">${_e(name)}</span>`;

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
        const canExpand = false;
        children.appendChild(_rsEl(name, rsName, rs.type, canExpand));
      });
    } catch (err) {
      children.innerHTML = `<div class="bc-err-indent">${_e(err.message)}</div>`;
    }
  }

  function _rsEl(ns, name, type, canExpand) {
    const wrap = document.createElement("div");
    wrap.className = "bc-rs-wrap";

    const item = document.createElement("div");
    item.className = "bc-tree-item bc-rs";
    item.dataset.action = canExpand ? "bc-expand-rs" : "bc-select-rs";
    item.dataset.ns = ns;
    item.dataset.rs = name;
    item.innerHTML = `<span class="bc-chev">${canExpand ? "▶" : "·"}</span><span class="bc-iname">${_e(name)}</span>`;
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
        itemEl.dataset.action = "bc-expand-rs";
        if (chev) chev.textContent = "▶";
      }
    } catch (err) {
      if (detail) detail.innerHTML = `<div class="pane-empty"><p class="bc-err">${_e(err.message)}</p></div>`;
    }
  }

  // ── Resource expand (shows latest detail + toggles version list) ─────────────

  async function expandRs(ns, name, itemEl) {
    // Always show the current resource detail
    _showDetail(`${ns}/${name}`, itemEl);

    const wrap = itemEl.closest(".bc-rs-wrap");
    const children = wrap?.querySelector(".bc-rs-children");
    if (!children) return;
    const key = `${ns}/${name}`;
    const chev = itemEl.querySelector(".bc-chev");

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

    return `
<div class="bc-card">
  <div class="bc-card-hdr">
    <span class="bc-rname">${_e(title)}</span>
    <span class="bc-rtype bc-rtype--${_e(type.toLowerCase())}">${_e(type)}</span>
  </div>
  ${headerMeta ? `<div class="bc-mgrid">${headerMeta}</div>` : ""}
  ${dataHtml}${encHtml}
</div>`;
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
      case "bc-select-rs":
        selectRs(ns, rs, el);
        return true;
      case "bc-select-ver":
        selectVer(el.dataset.uuid, el);
        return true;
      case "bc-ns-refresh":
        loadNamespaces();
        return true;
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
    _expandedNs.clear();
    _expandedRs.clear();
    const body = _tree();
    if (body) body.innerHTML = '<div class="pane-empty"><p>Log in to browse</p></div>';
    const detail = _detail();
    if (detail) detail.innerHTML = '<div class="pane-empty"><p>Select a resource</p></div>';
  }

  return { onLogin, handleAction, reset };
})();
