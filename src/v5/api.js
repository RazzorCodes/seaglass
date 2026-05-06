window.SeaglassAPI = (function () {
    // Will be populated from /api/config on first use
    let _brinecryptUrl = null;

    async function _loadConfig() {
        if (_brinecryptUrl) return;
        try {
            const r = await fetch('/api/config');
            if (r.ok) {
                const cfg = await r.json();
                _brinecryptUrl = cfg.brinecrypt_url || 'http://brinecrypt.lan';
            } else {
                _brinecryptUrl = 'http://brinecrypt.lan';
            }
        } catch (_e) {
            _brinecryptUrl = 'http://brinecrypt.lan';
        }
    }

    async function loadApps() {
        return window.APP_CONFIG || [];
    }

    async function getHealth(serviceId) {
        try {
            const r = await fetch(`/api/${encodeURIComponent(serviceId)}/health`, {
                method: "GET",
                headers: { Accept: "application/json" }
            });
            if (!r.ok) {
                return { service: serviceId, status: "offline" };
            }
            return await r.json();
        } catch (_e) {
            return { service: serviceId, status: "offline" };
        }
    }

    async function login(_serviceId, user, pass) {
        await _loadConfig();
        try {
            // Credentials go directly to brinecrypt — never touch the seaglass backend
            const r = await fetch(`${_brinecryptUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, pass })
            });
            const data = await r.json();
            if (!r.ok) return { success: false, error: data.error || data.message || 'Unauthorized' };

            // Hand the token (not the credentials) to the backend for proxying
            const sessionToken = data.session_token ?? data.token ?? data.access_token;
            const refreshToken = data.refresh_token;
            const store = await fetch('/api/brinecrypt/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_token: sessionToken, refresh_token: refreshToken, user })
            });
            if (!store.ok) return { success: false, error: 'Failed to store session' };
            return { success: true, user };
        } catch (_e) {
            return { success: false, error: 'Connection failed' };
        }
    }

    return {
        loadApps,
        getHealth,
        login
    };
})();
