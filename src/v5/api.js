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
        try {
            const r = await fetch('/api/brinecrypt/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, pass })
            });
            const data = await r.json();
            if (r.ok && data.success) {
                return { success: true, user: data.user };
            }
            return { success: false, error: data.error || 'Unauthorized' };
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
