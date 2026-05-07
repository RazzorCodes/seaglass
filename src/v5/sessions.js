window.SeaglassSessions = (function () {
    let _sessions = ['anon'];
    let _active   = 'anon';

    function _panel() {
        let el = document.getElementById('session-panel');
        if (!el) {
            el = document.createElement('div');
            el.id = 'session-panel';
            const toolbar = document.getElementById('tab-toolbar');
            if (toolbar) toolbar.insertBefore(el, toolbar.firstChild);
        }
        return el;
    }

    // ── API ───────────────────────────────────────────────────────────────────

    async function _fetchSessions() {
        try {
            const r = await fetch('/api/brinecrypt/sessions');
            if (!r.ok) return;
            const data = await r.json();
            _sessions = data.sessions || ['anon'];
            _active   = data.active   || 'anon';
            if (!_sessions.includes('anon')) _sessions.unshift('anon');
        } catch (_) {}
    }

    async function _ensureAnon() {
        try { await fetch('/api/brinecrypt/anon', { method: 'POST' }); } catch (_) {}
    }

    async function _switchActive(user) {
        try {
            await fetch('/api/brinecrypt/sessions/active', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user }),
            });
        } catch (_) {}
        _active = user;
        _render();
        _notify(user);
    }

    async function _logout(user) {
        try {
            await fetch('/api/brinecrypt/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user }),
            });
        } catch (_) {}
        const wasActive = (_active === user);
        _sessions = _sessions.filter(s => s !== user);
        if (wasActive) _active = 'anon';
        _render();
        if (wasActive) _notify('anon');
    }

    function _notify(_user) {
        window.SeaglassBrinecrypt?.onActiveSessionChanged?.();
        window.SeaglassUsers?.onActiveSessionChanged?.();
        window.SeaglassSA?.onActiveSessionChanged?.();
    }

    // ── Render ────────────────────────────────────────────────────────────────

    function _render() {
        const panel = _panel();
        if (!panel) return;
        panel.innerHTML = '';

        for (const user of _sessions) {
            const item = document.createElement('div');
            item.className = 'session-item'
                + (user === 'anon' ? ' session-anon' : '')
                + (user === _active ? ' active' : '');
            item.title = user === _active ? `Active: ${user}` : `Switch to ${user}`;

            const lbl = document.createElement('span');
            lbl.className = 'session-lbl';
            lbl.textContent = user;
            item.appendChild(lbl);

            if (user !== 'anon') {
                const x = document.createElement('button');
                x.className = 'session-x';
                x.textContent = '×';
                x.title = `Logout ${user}`;
                x.addEventListener('click', e => { e.stopPropagation(); _logout(user); });
                item.appendChild(x);
            }

            if (user !== _active) {
                item.style.cursor = 'pointer';
                item.addEventListener('click', () => _switchActive(user));
            }

            panel.appendChild(item);
        }

        const loginBtn = document.createElement('button');
        loginBtn.className = 'session-login-btn';
        loginBtn.textContent = '＋ Login';
        loginBtn.addEventListener('click', e => { e.stopPropagation(); _togglePopover(loginBtn); });
        panel.appendChild(loginBtn);
    }

    // ── Login popover ─────────────────────────────────────────────────────────

    function _togglePopover(anchor) {
        const existing = document.getElementById('session-login-popover');
        if (existing) { existing.remove(); return; }

        const pop = document.createElement('div');
        pop.id = 'session-login-popover';
        pop.innerHTML = `
            <input type="text"     id="slp-user" placeholder="Username" autocomplete="username">
            <input type="password" id="slp-pass" placeholder="Password" autocomplete="current-password">
            <div id="slp-err"></div>
            <div class="slp-row">
                <button id="slp-cancel">Cancel</button>
                <button id="slp-submit">Login</button>
            </div>`;
        document.body.appendChild(pop);

        const rect = anchor.getBoundingClientRect();
        pop.style.top   = `${rect.bottom + 6}px`;
        pop.style.right = `${document.documentElement.clientWidth - rect.right}px`;

        const userEl   = pop.querySelector('#slp-user');
        const passEl   = pop.querySelector('#slp-pass');
        const errEl    = pop.querySelector('#slp-err');
        const submitBtn = pop.querySelector('#slp-submit');
        const cancelBtn = pop.querySelector('#slp-cancel');

        userEl.focus();

        async function doLogin() {
            const user = userEl.value.trim();
            const pass = passEl.value;
            if (!user || !pass) { errEl.textContent = 'User and password required'; return; }
            submitBtn.disabled = true;
            errEl.textContent  = 'Logging in…';
            errEl.style.color  = '#94a3b8';

            const result = await window.SeaglassAPI.login('brinecrypt', user, pass);
            if (result.success) {
                if (!_sessions.includes(user)) _sessions.push(user);
                _active = user;
                pop.remove();
                _render();
                _notify(user);
            } else {
                errEl.textContent = result.error || 'Login failed';
                errEl.style.color = '#ef4444';
                submitBtn.disabled = false;
            }
        }

        cancelBtn.addEventListener('click', () => pop.remove());
        submitBtn.addEventListener('click', doLogin);
        passEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
        userEl.addEventListener('keydown', e => { if (e.key === 'Enter') passEl.focus(); });

        function onOutside(e) {
            if (!pop.contains(e.target) && e.target !== anchor) {
                pop.remove();
                document.removeEventListener('click', onOutside, true);
            }
        }
        setTimeout(() => document.addEventListener('click', onOutside, true), 0);
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    async function init() {
        await _ensureAnon();
        await _fetchSessions();
        _render();
        setInterval(() => {
            fetch('/api/brinecrypt/refresh', { method: 'POST' }).catch(() => {});
        }, 10 * 60 * 1000);
    }

    function renderIntoToolbar() {
        _render();
    }

    return {
        init,
        renderIntoToolbar,
        getActiveUser:     () => _active,
        getActiveSessions: () => _sessions.slice(),
    };
})();
