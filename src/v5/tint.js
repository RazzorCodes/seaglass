window.SeaglassTint = (function () {
    function setTint(color) {
        const { tabbar, contentArea, railHeader } = window.SeaglassDOM;
        const targets = [tabbar, contentArea, railHeader];

        if (color) {
            targets.forEach((el) => {
                el.style.setProperty("--app-color", color);
                el.classList.add("tinted");
            });
        } else {
            targets.forEach((el) => {
                el.style.removeProperty("--app-color");
                el.classList.remove("tinted");
            });
        }
    }

    return { setTint };
})();
