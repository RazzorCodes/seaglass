window.SeaglassTabs = (function () {
    function renderTabs(app) {
        const { tabbar, tabsRight, contentLbl, contentSub } = window.SeaglassDOM;
        const state = window.SeaglassState;

        tabbar.querySelectorAll(".tab-btn").forEach((n) => n.remove());

        const tabs = Array.isArray(app.tabs) ? app.tabs : [];
        tabs.forEach((tab, index) => {
            const btn = document.createElement("button");
            btn.className = "tab-btn";
            btn.dataset.tab = tab.id;
            btn.innerHTML = `${tab.label}${tab.badge ? ` <span class="badge">${tab.badge}</span>` : ""}`;

            if (index === 0) {
                btn.classList.add("active");
                state.activeTabId = tab.id;
            }

            btn.addEventListener("click", () => {
                tabbar.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                state.activeTabId = tab.id;
                contentLbl.textContent = `${app.label} — ${tab.label}`;
                contentSub.textContent = `Tab: ${tab.id}`;
            });

            tabbar.insertBefore(btn, tabsRight);
        });

        tabsRight.textContent = `${app.label}: ${app.version || ""}`;
    }

    return { renderTabs };
})();
