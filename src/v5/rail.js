window.SeaglassRail = (function () {
    function activateApp(btn, app) {
        const state = window.SeaglassState;

        if (state.activeBtn) {
            state.activeBtn.classList.remove("active");
            state.activeBtn.style.background = "";
            state.activeBtn.style.color = "";
        }

        if (state.activeBtn === btn) {
            state.activeBtn = null;
            window.SeaglassContent.resetContent();
            return;
        }

        btn.classList.add("active");
        state.activeBtn = btn;
        state.activeApp = app;
        btn.style.background = "#1e293b";
        btn.style.color = app.color;

        window.SeaglassTint.setTint(app.color);
        window.SeaglassTabs.renderTabs(app);
        window.SeaglassContent.setServiceContent(app);

        // Trigger login widget injection for brinecrypt
        if (app.id === 'brinecrypt') {
            // The login widget will be injected by _loadToolbar -> _injectLoginWidget
            // But if the toolbar hasn't loaded yet, we need to ensure it happens
            setTimeout(() => {
                const toolbar = window.SeaglassDOM.tabToolbar;
                if (toolbar && !toolbar.querySelector('#brinecrypt-login-widget')) {
                    // Force injection if toolbar is empty or doesn't have the widget
                    window.SeaglassTabs._injectLoginWidget?.();
                }
            }, 100);
        }
    }

    async function refreshHealthForButton(btn, app) {
        const result = await window.SeaglassAPI.getHealth(app.id);
        const nextStatus = result && result.status ? result.status : app.status;

        if (nextStatus === "mock") return;

        app.status = nextStatus;
        btn.dataset.status = nextStatus;
        btn.dataset.tip = app.label + (nextStatus !== "online" ? ` · ${nextStatus}` : "");

        if (result.version && result.version !== app.version) {
            app.version = result.version;
            if (window.SeaglassState.activeApp === app) {
                window.SeaglassDOM.tabsRight.textContent = `${app.label}: ${app.version}`;
            }
        }
    }

    function renderRail(apps) {
        const { rail, spacer } = window.SeaglassDOM;

        apps.forEach((app) => {
            const btn = document.createElement("button");
            btn.dataset.tip = app.label + (app.status !== "online" ? ` · ${app.status}` : "");
            btn.dataset.status = app.status;
            btn.className = "rail-btn";
            btn.innerHTML = `<span class="status-bar"></span><span class="rail-icon" style="color:${app.color}">${app.icon}</span>`;

            if (app.status !== "disabled") {
                btn.addEventListener("click", () => activateApp(btn, app));
            }

            rail.insertBefore(btn, spacer);

            refreshHealthForButton(btn, app);
            setInterval(() => refreshHealthForButton(btn, app), 10000);
        });
    }

    return {
        renderRail
    };
})();
