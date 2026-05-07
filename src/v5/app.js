(function () {
    async function init() {
        const apps = await window.SeaglassAPI.loadApps();
        window.SeaglassRail.renderRail(apps);
        await window.SeaglassSessions.init();
    }

    init();
})();
