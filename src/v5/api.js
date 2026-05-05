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

    async function login(serviceId, user, pass) {
        // Ensure config is loaded (brinecrypt URL)
        await _loadConfig();

        try {
            const r = await fetch(`${_brinecryptUrl}/auth/login`, {
                method: 'POST',
                mode: 'cors',
                // Remove credentials: 'include' — brinecrypt doesn't support credentialed CORS
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, pass })
            });
            if (r.ok) {
                // Try to extract a token from the response if present
                let token = null;
                try {
                    const data = await r.json();
                    token = data.token || data.access_token || null;
                } catch (_) {
                    // Response might be empty or not JSON
                }
                return { success: true, user, token };
            }
            const text = await r.text();
            return { success: false, error: text || 'Unauthorized' };
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
