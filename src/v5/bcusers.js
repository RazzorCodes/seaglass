window.SeaglassUsers = (function () {

  // ── State ──────────────────────────────────────────────────────────────────

  let _isAdmin      = false;
  let _loggedIn     = false;
  let _ownUser      = null;
  let _selectedUser = null;
  let _currentPerms = [];   // [{verb, resource_pattern, created_at, expires_at}]
  let _draftPerms   = null; // null = view mode; array = edit mode

  // ── DOM accessors ─────────────────────────────────────────────────────────

  const _root   = () => document.getElementById("bcu-root");
  const _list   = () => document.getElementById("bcu-list-panel");
  const _tree   = () => document.getElementById("bcu-tree-body");
  const _detail = () => document.getElementById("bcu-detail");

  // ── Normalize user items (API may return strings or UserResponse objects) ──

  function _uname(u) { return typeof u === "string" ? u : (u.name ?? String(u)); }

  function _date(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    } catch (_) { return iso; }
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  function _ts() { return new Date().toISOString().slice(11, 23); }
  function _logOk(p, d)   { console.log( `[ok]  [${_ts()}] /api/brinecrypt/admin/${p}`, d); }
  function _logWarn(p, d) { console.warn(`[warn][${_ts()}] /api/brinecrypt/admin/${p}`, d); }

  // ── API helpers ───────────────────────────────────────────────────────────

  async function _adminGet(path) {
    const r = await fetch(`/api/brinecrypt/admin/${path}`);
    let data = {};
    try { if (r.headers.get("content-type")?.includes("json")) data = await r.json(); } catch (_) {}
    if (!r.ok) { _logWarn(path, data); throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status }); }
    _logOk(path, data);
    return data;
  }

  async function _adminPost(path, body) {
    const r = await fetch(`/api/brinecrypt/admin/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : {};
    if (!r.ok) { _logWarn(path, data); throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status }); }
    _logOk(path, data);
    return data;
  }

  async function _adminDel(path, body) {
    const r = await fetch(`/api/brinecrypt/admin/${path}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = r.headers.get("content-type")?.includes("json") ? await r.json() : {};
    if (!r.ok) { _logWarn(path, data); throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status }); }
    _logOk(path, data);
    return data;
  }

  // ── Diff ──────────────────────────────────────────────────────────────────

  function _diff(current, draft) {
    const cSet = new Set(current.map(p => `${p.verb}:${p.resource_pattern}`));
    const dSet = new Set(draft.map(p => `${p.verb}:${p.resource_pattern}`));
    return {
      toAdd:    draft.filter(p => !cSet.has(`${p.verb}:${p.resource_pattern}`)),
      toRemove: current.filter(p => !dSet.has(`${p.verb}:${p.resource_pattern}`)),
    };
  }

  // ── Perm view (read-only table) ───────────────────────────────────────────

  function _renderPermsView(perms, editable) {
    // Group by resource_pattern, collect verbs
    const byPattern = {};
    for (const p of perms) {
      if (!byPattern[p.resource_pattern]) byPattern[p.resource_pattern] = { verbs: [], created_at: p.created_at, expires_at: p.expires_at };
      byPattern[p.resource_pattern].verbs.push(p.verb);
    }

    const rows = Object.entries(byPattern).map(([pat, info]) =>
      `<tr>
        <td><code>${esc(pat)}</code></td>
        <td>${info.verbs.map(v => `<span class="bc-badge">${esc(v)}</span>`).join(" ")}</td>
        <td>${esc(_date(info.created_at))}</td>
        <td>${info.expires_at ? esc(_date(info.expires_at)) : "—"}</td>
      </tr>`
    ).join("");

    const empty = !rows ? `<tr><td colspan="4" style="text-align:center;color:#475569;padding:1rem;">No permissions</td></tr>` : "";

    const editBtn = editable
      ? `<button class="btn btn-ghost btn-sm" data-action="bcu-edit-perms" style="margin-left:auto;">Edit</button>`
      : "";

    return `
<div class="bc-section" id="bcu-perm-section">
  <div class="bc-shdr" style="display:flex;align-items:center;">
    <span>Permissions</span>${editBtn}
  </div>
  <div class="bc-sbody" style="padding:0;">
    <table class="data-table" style="width:100%;">
      <thead><tr>
        <th>Pattern</th><th>Verbs</th><th>Created</th><th>Expires</th>
      </tr></thead>
      <tbody>${rows}${empty}</tbody>
    </table>
  </div>
</div>`;
  }

  // ── Perm editor – EDIT stage ──────────────────────────────────────────────

  const VERBS = ["list", "read", "write", "delete"];

  function _draftToGroups(draft) {
    const groups = {};
    for (const p of draft) {
      if (!groups[p.resource_pattern]) groups[p.resource_pattern] = new Set();
      groups[p.resource_pattern].add(p.verb);
    }
    return groups;
  }

  function _renderEditStage() {
    const groups = _draftToGroups(_draftPerms);

    const verbHeaders = VERBS.map(v => `<th class="perm-verb-col">${v}</th>`).join("");

    const rows = Object.entries(groups).map(([pat, verbSet]) => {
      const checks = VERBS.map(v =>
        `<td class="perm-verb-col"><input type="checkbox" class="perm-verb-chk" data-pat="${esc(pat)}" data-verb="${v}" ${verbSet.has(v) ? "checked" : ""}></td>`
      ).join("");
      return `<tr>
        <td><code>${esc(pat)}</code></td>
        ${checks}
        <td><button class="btn btn-danger btn-sm" data-action="bcu-edit-remove" data-pat="${esc(pat)}" style="padding:2px 8px;">✕</button></td>
      </tr>`;
    }).join("");

    const verbNewChecks = VERBS.map(v =>
      `<td class="perm-verb-col"><input type="checkbox" class="perm-verb-chk" id="bcu-new-verb-${v}"></td>`
    ).join("");

    return `
<div class="perm-editor" id="bcu-perm-section">
  <div class="perm-editor-hdr">
    <span>Edit Permissions</span>
  </div>
  <div class="perm-editor-body">
    <table class="data-table" style="width:100%;">
      <thead><tr>
        <th>Pattern</th>${verbHeaders}<th></th>
      </tr></thead>
      <tbody id="bcu-edit-rows">${rows}</tbody>
    </table>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">
      <input type="text" id="bcu-new-pat" placeholder="namespace/pattern" class="pane-search" style="flex:1;font-size:0.82rem;">
      <table style="border-collapse:collapse;"><tbody><tr>${verbNewChecks}</tr></tbody></table>
      <button class="btn btn-ghost btn-sm" data-action="bcu-edit-add">＋ Add</button>
    </div>
  </div>
  <div style="display:flex;gap:0.5rem;padding:0.6rem 0.75rem;border-top:1px solid var(--border);">
    <button class="btn btn-ghost btn-sm" data-action="bcu-cancel-edit">Cancel</button>
    <button class="btn btn-primary btn-sm" data-action="bcu-review" style="margin-left:auto;">Review →</button>
  </div>
</div>`;
  }

  // ── Perm editor – REVIEW stage ────────────────────────────────────────────

  function _renderReviewStage(diff) {
    const addRows = diff.toAdd.map(p =>
      `<tr class="perm-diff-add"><td>＋</td><td><code>${esc(p.resource_pattern)}</code></td><td>${esc(p.verb)}</td></tr>`
    ).join("");
    const rmRows = diff.toRemove.map(p =>
      `<tr class="perm-diff-rm"><td>－</td><td><code>${esc(p.resource_pattern)}</code></td><td>${esc(p.verb)}</td></tr>`
    ).join("");

    const body = (addRows || rmRows)
      ? `<table class="data-table" style="width:100%;"><tbody>${addRows}${rmRows}</tbody></table>`
      : `<p style="color:#475569;text-align:center;padding:1rem;">No changes</p>`;

    const commitDisabled = (!addRows && !rmRows) ? "disabled" : "";

    return `
<div class="perm-editor" id="bcu-perm-section">
  <div class="perm-editor-hdr"><span>Review Changes</span></div>
  <div class="perm-editor-body">${body}</div>
  <div style="display:flex;gap:0.5rem;padding:0.6rem 0.75rem;border-top:1px solid var(--border);">
    <button class="btn btn-ghost btn-sm" data-action="bcu-back">← Back</button>
    <button class="btn btn-primary btn-sm" data-action="bcu-commit" ${commitDisabled} style="margin-left:auto;">Commit →</button>
  </div>
</div>`;
  }

  // ── Perm editor – COMMIT + VERIFY ────────────────────────────────────────

  async function _runCommit(username, diff) {
    const section = document.getElementById("bcu-perm-section");
    if (!section) return;

    // Render progress view
    section.querySelector(".perm-editor-body").innerHTML =
      `<div id="bcu-commit-log" style="font-size:0.82rem;font-family:monospace;padding:0.5rem 0;"></div>`;
    section.querySelector(".perm-editor-hdr").textContent = "Applying…";
    // Disable footer buttons
    section.querySelectorAll("button").forEach(b => b.disabled = true);

    const log = section.querySelector("#bcu-commit-log");

    function _logLine(cls, msg) {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = msg;
      log.appendChild(d);
    }

    let grantOk = true, revokeOk = true;

    if (diff.toAdd.length > 0) {
      try {
        await _adminPost("permissions", { principal: `user/${username}`, permissions: diff.toAdd.map(p => ({ verb: p.verb, resource_pattern: p.resource_pattern })) });
        _logLine("perm-op-ok", `✓ Granted ${diff.toAdd.length} permission(s)`);
      } catch (err) {
        _logLine("perm-op-err", `✗ Grant failed: ${err.message}`);
        grantOk = false;
      }
    }

    if (diff.toRemove.length > 0) {
      try {
        await _adminDel("permissions", { principal: `user/${username}`, permissions: diff.toRemove.map(p => ({ verb: p.verb, resource_pattern: p.resource_pattern })) });
        _logLine("perm-op-ok", `✓ Revoked ${diff.toRemove.length} permission(s)`);
      } catch (err) {
        _logLine("perm-op-err", `✗ Revoke failed: ${err.message}`);
        revokeOk = false;
      }
    }

    // Verify
    _logLine("", "Verifying…");
    section.querySelector(".perm-editor-hdr").textContent = "Verifying…";

    try {
      const fresh = await _adminGet(`users/${username}`);
      const freshPerms = fresh.permissions || [];
      const verify = _diff(freshPerms, _draftPerms);

      if (verify.toAdd.length === 0 && verify.toRemove.length === 0) {
        _logLine("perm-op-ok", "✓ Verified — permissions match desired state");
      } else {
        _logLine("perm-op-err", `✗ Mismatch: ${verify.toAdd.length} missing, ${verify.toRemove.length} unexpected`);
      }

      // Return to view mode with fresh data
      _draftPerms = null;
      _currentPerms = freshPerms;
      _selectedUser = username;
      const det = _detail();
      if (det) det.innerHTML = _renderDetail(fresh);
    } catch (err) {
      _logLine("perm-op-err", `✗ Verify fetch failed: ${err.message}`);
      // Show close button
      const footer = section.querySelector("[style*='border-top']");
      if (footer) {
        footer.innerHTML = `<button class="btn btn-ghost btn-sm" data-action="bcu-cancel-edit" style="margin-left:auto;">Close</button>`;
      }
    }
  }

  // ── User detail ───────────────────────────────────────────────────────────

  function _renderDetail(user) {
    const permsHtml = _renderPermsView(user.permissions || [], _isAdmin);
    const deleteBtn = _isAdmin
      ? `<button class="btn btn-danger btn-sm" data-action="bcu-delete" data-user="${esc(user.name)}" data-confirm="Delete user ${esc(user.name)}?">Delete user</button>`
      : "";

    return `
<div class="bc-card">
  <div class="bc-card-hdr">
    <span class="bc-rname">${esc(user.name)}</span>
    ${deleteBtn}
  </div>
  <div class="bc-mgrid">
    <span class="bc-mk">email</span><span class="bc-mv">${esc(user.email || "—")}</span>
    <span class="bc-mk">created</span><span class="bc-mv">${esc(_date(user.created_at))}</span>
  </div>
  ${permsHtml}
</div>`;
  }

  // ── User list ────────────────────────────────────────────────────────────

  function _renderUserList(users) {
    const tree = _tree();
    if (!tree) return;
    tree.innerHTML = "";
    if (!users.length) {
      tree.innerHTML = '<div class="pane-empty"><p>No users</p></div>';
      return;
    }
    users.forEach(u => {
      const name = _uname(u);
      const el = document.createElement("div");
      el.className = "bc-tree-item";
      el.dataset.action = "bcu-select";
      el.dataset.user = name;
      if (name === _selectedUser) el.classList.add("selected");
      el.innerHTML = `<span class="bc-iname">${esc(name)}</span>`;
      if (u.email) el.insertAdjacentHTML("beforeend", `<span class="bc-badge" style="font-size:0.68rem;opacity:0.6;">${esc(u.email)}</span>`);
      tree.appendChild(el);
    });
  }

  // ── New user form ────────────────────────────────────────────────────────

  function _renderNewUserForm() {
    return `
<div class="bc-card">
  <div class="bc-card-hdr"><span class="bc-rname">New User</span></div>
  <div style="display:flex;flex-direction:column;gap:0.6rem;padding:0.5rem 0;">
    <input type="text"     id="bcu-f-name"  placeholder="Username"  class="pane-search" style="font-size:0.84rem;">
    <input type="email"    id="bcu-f-email" placeholder="Email"     class="pane-search" style="font-size:0.84rem;">
    <input type="password" id="bcu-f-pass"  placeholder="Password"  class="pane-search" style="font-size:0.84rem;">
    <div id="bcu-form-err" style="color:#ef4444;font-size:0.8rem;min-height:1rem;"></div>
    <div style="display:flex;gap:0.5rem;">
      <button class="btn btn-ghost btn-sm" data-action="bcu-cancel-new">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="bcu-create-user" style="margin-left:auto;">Create</button>
    </div>
  </div>
</div>`;
  }

  // ── Select user ──────────────────────────────────────────────────────────

  async function _selectUser(name) {
    _selectedUser = name;
    _draftPerms = null;

    // Highlight in list
    document.querySelectorAll("#bcu-tree-body .bc-tree-item").forEach(el => {
      el.classList.toggle("selected", el.dataset.user === name);
    });

    const det = _detail();
    if (det) det.innerHTML = '<div class="bc-loading" style="padding:1.5rem;">Loading…</div>';

    try {
      const user = await _adminGet(`users/${name}`);
      _currentPerms = user.permissions || [];
      if (det) det.innerHTML = _renderDetail(user);
    } catch (err) {
      if (det) det.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
    }
  }

  // ── onLogin probe ─────────────────────────────────────────────────────────

  async function onLogin() {
    _loggedIn = true;
    const activeUser = window.SeaglassSessions?.getActiveUser();
    _ownUser = (activeUser && activeUser !== 'anon') ? activeUser : null;

    if (!_tree()) {
      setTimeout(onLogin, 80);
      return;
    }

    const tree = _tree();
    tree.innerHTML = '<div class="bc-loading">Loading…</div>';

    try {
      const users = await _adminGet("users");
      const list = Array.isArray(users) ? users : (users.users || []);
      _isAdmin = true;

      // Show list panel
      const lp = _list();
      if (lp) lp.hidden = false;

      _renderUserList(list);

      // Select own user by default
      const ownItem = list.find(u => _uname(u) === _ownUser);
      if (ownItem) _selectUser(_uname(ownItem));
      else if (list.length) _selectUser(_uname(list[0]));

    } catch (err) {
      if (err.status === 403 || err.status === 401) {
        // Non-admin: hide list panel, show own permissions only
        _isAdmin = false;
        const lp = _list();
        if (lp) lp.hidden = true;

        // Expand detail to fill width
        const det = _detail();
        if (det) det.style.flex = "1";

        if (_ownUser) {
          const det = _detail();
          if (det) det.innerHTML = '<div class="bc-loading" style="padding:1.5rem;">Loading…</div>';
          try {
            const user = await _adminGet('user');
            _currentPerms = user.permissions || [];
            if (det) det.innerHTML = _renderDetail(user);
          } catch (e) {
            if (det) det.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(e.message)}</p></div>`;
          }
        } else {
          tree.innerHTML = "";
        }
      } else {
        tree.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
      }
    }
  }

  // ── handleAction ──────────────────────────────────────────────────────────

  function handleAction(action, el) {
    switch (action) {

      case "bcu-refresh":
        onLogin();
        return true;

      case "bcu-select":
        _selectUser(el.dataset.user);
        return true;

      case "bcu-new-user": {
        const det = _detail();
        if (det) det.innerHTML = _renderNewUserForm();
        return true;
      }

      case "bcu-cancel-new": {
        // Re-render selected user or empty state
        if (_selectedUser) _selectUser(_selectedUser);
        else {
          const det = _detail();
          if (det) det.innerHTML = '<div class="pane-empty"><p>Select a user</p></div>';
        }
        return true;
      }

      case "bcu-create-user": {
        const name  = document.getElementById("bcu-f-name")?.value.trim();
        const email = document.getElementById("bcu-f-email")?.value.trim();
        const pass  = document.getElementById("bcu-f-pass")?.value;
        const errEl = document.getElementById("bcu-form-err");
        if (!name || !pass) {
          if (errEl) errEl.textContent = "Name and password are required";
          return true;
        }
        el.disabled = true;
        _adminPost("users", { name, email, pass }).then(() => {
          return _adminGet("users");
        }).then(users => {
          const list = Array.isArray(users) ? users : (users.users || []);
          _renderUserList(list);
          _selectUser(name); // we know the name since we just created it
        }).catch(err => {
          el.disabled = false;
          if (errEl) errEl.textContent = err.message;
        });
        return true;
      }

      case "bcu-delete": {
        const username = el.dataset.user;
        _adminDel(`users/${username}`).then(() => {
          _selectedUser = null;
          _currentPerms = [];
          const det = _detail();
          if (det) det.innerHTML = '<div class="pane-empty"><p>User deleted</p></div>';
          return _adminGet("users");
        }).then(users => {
          const list = Array.isArray(users) ? users : [];
          _renderUserList(list);
        }).catch(err => {
          const det = _detail();
          if (det) det.innerHTML = `<div class="pane-empty"><p class="bc-err">${esc(err.message)}</p></div>`;
        });
        return true;
      }

      case "bcu-edit-perms": {
        _draftPerms = _currentPerms.map(p => ({ verb: p.verb, resource_pattern: p.resource_pattern }));
        const section = document.getElementById("bcu-perm-section");
        if (section) section.outerHTML = _renderEditStage();
        return true;
      }

      case "bcu-edit-remove": {
        const pat = el.dataset.pat;
        _draftPerms = _draftPerms.filter(p => p.resource_pattern !== pat);
        const section = document.getElementById("bcu-perm-section");
        if (section) section.outerHTML = _renderEditStage();
        return true;
      }

      case "bcu-edit-add": {
        const patInput = document.getElementById("bcu-new-pat");
        const pat = patInput?.value.trim();
        if (!pat) return true;
        const checked = VERBS.filter(v => document.getElementById(`bcu-new-verb-${v}`)?.checked);
        if (!checked.length) return true;
        // Remove existing entries for this pattern, then add new
        _draftPerms = _draftPerms.filter(p => p.resource_pattern !== pat);
        for (const v of checked) _draftPerms.push({ verb: v, resource_pattern: pat });
        const section = document.getElementById("bcu-perm-section");
        if (section) section.outerHTML = _renderEditStage();
        return true;
      }

      case "bcu-cancel-edit": {
        _draftPerms = null;
        if (_selectedUser) _selectUser(_selectedUser);
        return true;
      }

      case "bcu-review": {
        // Sync checkboxes into _draftPerms
        _draftPerms = [];
        document.querySelectorAll("#bcu-edit-rows .perm-verb-chk:checked").forEach(chk => {
          _draftPerms.push({ verb: chk.dataset.verb, resource_pattern: chk.dataset.pat });
        });
        const section = document.getElementById("bcu-perm-section");
        if (section) section.outerHTML = _renderReviewStage(_diff(_currentPerms, _draftPerms));
        return true;
      }

      case "bcu-back": {
        const section = document.getElementById("bcu-perm-section");
        if (section) section.outerHTML = _renderEditStage();
        return true;
      }

      case "bcu-commit": {
        if (!_selectedUser || !_draftPerms) return true;
        const diff = _diff(_currentPerms, _draftPerms);
        _runCommit(_selectedUser, diff);
        return true;
      }
    }
    return false;
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  function reset() {
    _isAdmin      = false;
    _loggedIn     = false;
    _ownUser      = null;
    _selectedUser = null;
    _currentPerms = [];
    _draftPerms   = null;

    const tree = _tree();
    if (tree) tree.innerHTML = '<div class="pane-empty"><p>Log in to browse</p></div>';
    const det = _detail();
    if (det) det.innerHTML = '<div class="pane-empty"><p>Select a user</p></div>';
    const lp = _list();
    if (lp) { lp.hidden = false; lp.style.flex = ""; }
    const det2 = _detail();
    if (det2) det2.style.flex = "";
  }

  function onActiveSessionChanged() { onLogin(); }

  return { onLogin, onActiveSessionChanged, handleAction, reset };
})();
