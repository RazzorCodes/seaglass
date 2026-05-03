window.SeaglassAPI = (function () {
    async function loadApps() {
        return window.APP_CONFIG || [];
    }

    return {
        loadApps
    };
})();
