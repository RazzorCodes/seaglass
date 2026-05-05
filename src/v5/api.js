window.SeaglassAPI = (function () {
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
        try {
            const r = await fetch(`http://brinecrypt.lan/auth/login`, {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, pass })
            });
            if (r.ok) {
                return { success: true, user };
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
