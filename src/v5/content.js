window.SeaglassContent = (function () {
    function resetContent() {
        const { tabbar, tabsRight, contentIcon, contentLbl, contentSub } = window.SeaglassDOM;
        const state = window.SeaglassState;

        window.SeaglassTint.setTint(null);
        tabbar.querySelectorAll(".tab-btn").forEach((n) => n.remove());
        tabsRight.textContent = "No service selected";
        contentLbl.textContent = "Seaglass — Select a service";
        contentSub.textContent = "";
        contentIcon.className = "content-icon";
        contentIcon.style.cssText = "";
        contentIcon.innerHTML = "";

        state.activeApp = null;
        state.activeTabId = null;
    }

    function setServiceContent(app) {
        const { contentIcon, contentLbl, contentSub } = window.SeaglassDOM;

        if (app.status === "offline") {
            contentLbl.textContent = `${app.label} — disconnected`;
            contentSub.textContent = "The endpoint is not responding. Check service health.";
            contentIcon.style.background = "#ef44441a";
            contentIcon.style.border = "1px solid #ef444440";
            contentIcon.style.color = "#ef4444";
            contentIcon.innerHTML =
                `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
            contentIcon.className = "content-icon visible";
            return;
        }

        if (app.status === "degraded") {
            contentLbl.textContent = `${app.label} — degraded`;
            contentSub.textContent = "Service is reachable but performance/errors are outside normal range.";
            contentIcon.style.background = "#eab3081a";
            contentIcon.style.border = "1px solid #eab30844";
            contentIcon.style.color = "#eab308";
            contentIcon.innerHTML =
                `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
            contentIcon.className = "content-icon visible";
            return;
        }

        if (app.status === "never") {
            contentLbl.textContent = `${app.label} — never connected`;
            contentSub.textContent = "Service is activated but has not established its first connection yet.";
            contentIcon.style.background = "#6b72801a";
            contentIcon.style.border = "1px solid #6b728044";
            contentIcon.style.color = "#6b7280";
            contentIcon.innerHTML =
                `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`;
            contentIcon.className = "content-icon visible";
            return;
        }

        const firstTab = (app.tabs && app.tabs[0]) || null;
        contentLbl.textContent = `${app.label} — ${firstTab ? firstTab.label : "Overview"}`;
        contentSub.textContent = firstTab ? `Tab: ${firstTab.id}` : "";
        contentIcon.style.background = app.color + "1a";
        contentIcon.style.border = `1px solid ${app.color}44`;
        contentIcon.style.color = app.color;
        contentIcon.innerHTML = app.icon;
        contentIcon.className = "content-icon visible";
    }

    return {
        resetContent,
        setServiceContent
    };
})();
