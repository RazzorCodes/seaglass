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

    return {
        loadApps,
        getHealth
    };
})();
