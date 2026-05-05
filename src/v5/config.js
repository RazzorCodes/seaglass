window.APP_CONFIG = [
    {
        id: "transflux",
        label: "Transflux",
        status: "online",
        color: "#06b6d4",
        version: "v1.4.2",
        tabs: [
            { id: "library", label: "Library", toolbarUrl: "/partial/transflux/library/toolbar", url: "/partial/transflux/library/results", poll: 30000 },
            { id: "queue",   label: "Queue",   url: "/partial/transflux/queue",   poll: 5000  },
        ],
        icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
    },
    {
        id: "brinecrypt",
        label: "Brinecrypt",
        status: "degraded",
        color: "#4338ca",
        version: "v2.1.0",
        tabs: [
            { id: "resources", label: "Resources", toolbarUrl: "/partial/brinecrypt/resources/toolbar", url: "/partial/brinecrypt/resources/results" },
            { id: "users", label: "Users", toolbarUrl: "/partial/brinecrypt/users/toolbar", url: "/partial/brinecrypt/users/results" },
            { id: "sa", label: "SA", toolbarUrl: "/partial/brinecrypt/sa/toolbar", url: "/partial/brinecrypt/sa/results" }
        ],
        icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
    },
    {
        id: "oakleaf",
        label: "Oakleaf",
        status: "offline",
        color: "#22c55e",
        version: "v0.9.8",
        tabs: [
            { id: "overview", label: "Overview" },
            { id: "jobs", label: "Jobs" }
        ],
        icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8C8 10 5.9 16.17 3.82 21"/><path d="M9.5 8A5 5 0 0 1 20 7c0 6-5 8-11 11"/></svg>`
    },
    {
        id: "ember",
        label: "Ember",
        status: "disabled",
        color: "#ef4444",
        version: "v3.0.0",
        tabs: [],
        icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`
    },
    {
        id: "solaris",
        label: "Solaris",
        status: "never",
        color: "#f59e0b",
        version: "v0.1.0",
        tabs: [
            { id: "sun", label: "Sun" },
            { id: "metrics", label: "Metrics" }
        ],
        icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
    }
];
