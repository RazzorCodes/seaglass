(function () {
    async function init() {
        const apps = await window.SeaglassAPI.loadApps();
        window.SeaglassRail.renderRail(apps);
    }

    init();
})();
