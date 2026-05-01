document.addEventListener('DOMContentLoaded', () => {
    // State
    let libraryItems = [];
    let queueTasks = [];
    let queueRefreshInterval = null;
    let libraryRefreshInterval = null;
    let selectedHashes = new Set();
    let activeFilters = [];
    let libraryError = null;
    let activeSorts = [];

    const META_FIELDS = [
        { key: 'size',     label: 'Size' },
        { key: 'duration', label: 'Dur' },
        { key: 'bitrate',  label: 'Bitrate' },
        { key: 'quality',  label: 'Qual' },
        { key: 'codec',    label: 'Codec' },
    ];

    // Elements
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const btnScanLarge = document.getElementById('btn-scan-large');
    const btnRefreshLib = document.getElementById('btn-refresh-lib');
    const btnScanLib = document.getElementById('btn-scan-lib');
    const btnRefreshQueue = document.getElementById('btn-refresh-queue');
    const btnTranscodeSelected = document.getElementById('btn-transcode-selected');
    const checkAll = document.getElementById('check-all');
    const toggleAutoRefresh = document.getElementById('toggle-auto-refresh');
    const toggleAutoRefreshLib = document.getElementById('toggle-auto-refresh-lib');
    const appVersionSpan = document.getElementById('app-version');
    const qualityPresetSelect = document.getElementById('quality-preset');
    const qualityModal = document.getElementById('quality-modal');
    const btnSaveQuality = document.getElementById('btn-save-quality');
    const customQualityForm = document.getElementById('custom-quality-form');
    const modalCloseEls = document.querySelectorAll('.modal-close, .modal-close-btn');

    const filterType = document.getElementById('filter-type');
    const filterValueName = document.getElementById('filter-value-name');
    const filterValueStatus = document.getElementById('filter-value-status');
    const filterValueInfoContainer = document.getElementById('filter-value-info-container');
    const infoKind = document.getElementById('info-kind');
    const infoValCodec = document.getElementById('info-val-codec');
    const infoValQuality = document.getElementById('info-val-quality');
    const infoValAr = document.getElementById('info-val-ar');
    const compareOp = document.getElementById('compare-op');
    const compareVal = document.getElementById('compare-val');
    const btnAddFilter = document.getElementById('btn-add-filter');
    const activeFiltersContainer = document.getElementById('active-filters');

    // Toast Container
    const toastContainer = document.getElementById('toast-container');

    // Init
    initTabs();
    setupEventListeners();
    setupFilters();
    setupSortHeaders();
    fetchVersion();
    fetchLibrary();
    fetchQueue();
    fetchQuality();

    if (toggleAutoRefresh && toggleAutoRefresh.checked) {
        const icon = btnRefreshQueue.querySelector('i');
        if (icon) icon.classList.add('bx-spin-reverse');
    }
    if (toggleAutoRefreshLib && toggleAutoRefreshLib.checked) {
        const icon = btnRefreshLib.querySelector('i');
        if (icon) icon.classList.add('bx-spin-reverse');
    }

    startQueuePolling();
    startLibraryPolling();

    // --- Tabs Logic ---
    function initTabs() {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-tab');

                // Update buttons
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update panes
                tabPanes.forEach(pane => {
                    if (pane.id === targetId) {
                        pane.classList.add('active');
                    } else {
                        pane.classList.remove('active');
                    }
                });
            });
        });
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        document.getElementById('btn-retry').addEventListener('click', fetchLibrary);
        btnScanLib.addEventListener('click', triggerScan);
        btnRefreshLib.addEventListener('click', () => {
            fetchLibrary();
            showToast('Refreshing library...', 'info');
        });
        btnScanLarge.addEventListener('click', triggerScan);
        btnRefreshQueue.addEventListener('click', () => {
            // In queue tab, simply fetch queue
            fetchQueue();
        });

        toggleAutoRefresh.addEventListener('change', (e) => {
            const label = e.target.closest('.toggle-label');
            const icon = btnRefreshQueue.querySelector('i');
            if (e.target.checked) {
                startQueuePolling();
                icon.classList.add('bx-spin-reverse');
                if (label) label.classList.remove('text-muted');
            } else {
                if (queueRefreshInterval) clearInterval(queueRefreshInterval);
                icon.classList.remove('bx-spin-reverse');
                if (label) label.classList.add('text-muted');
            }
        });

        toggleAutoRefreshLib.addEventListener('change', (e) => {
            const label = e.target.closest('.toggle-label');
            const icon = btnRefreshLib.querySelector('i');
            if (e.target.checked) {
                startLibraryPolling();
                icon.classList.add('bx-spin-reverse');
                if (label) label.classList.remove('text-muted');
            } else {
                if (libraryRefreshInterval) clearInterval(libraryRefreshInterval);
                icon.classList.remove('bx-spin-reverse');
                if (label) label.classList.add('text-muted');
            }
        });

        checkAll.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                updateRowSelection(cb);
            });
            updateTranscodeButton();
        });

        btnTranscodeSelected.addEventListener('click', async () => {
            const checked = document.querySelectorAll('.row-checkbox:checked');
            if (checked.length === 0) return;

            btnTranscodeSelected.disabled = true;
            btnTranscodeSelected.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Queuing...";

            let successCount = 0;
            for (let cb of checked) {
                const hash = cb.value;
                try {
                    const res = await fetch(`/api/process/${hash}`, { method: 'PUT' });
                    if (res.ok) {
                        successCount++;
                    } else {
                        const data = await res.json();
                        showToast(`Failed to queue ${hash}: ${data.message || 'Error'}`, 'error');
                    }
                } catch (e) {
                    showToast(`Network error queuing ${hash}`, 'error');
                }
            }

            if (successCount > 0) {
                showToast(`Successfully queued ${successCount} items`, 'success');
                selectedHashes.clear();
                fetchLibrary();
                fetchQueue();
            }

            checkAll.checked = false;
            updateTranscodeButton();
        });

        qualityPresetSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                showQualityModal();
            } else {
                updateQuality(e.target.value);
            }
        });

        modalCloseEls.forEach(el => {
            el.addEventListener('click', hideQualityModal);
        });

        btnSaveQuality.addEventListener('click', () => {
            const formData = new FormData(customQualityForm);
            const custom = {
                crf: parseInt(formData.get('crf')),
                preset: formData.get('preset'),
                audio_bitrate: formData.get('audio_bitrate'),
                resolution_cap: formData.get('resolution_cap') ? parseInt(formData.get('resolution_cap')) : null
            };
            updateQuality(null, custom);
            hideQualityModal();
        });
    }

    function updateRowSelection(checkbox) {
        const tr = checkbox.closest('tr');
        if (checkbox.checked) {
            tr.classList.add('selected');
            selectedHashes.add(checkbox.value);
        } else {
            tr.classList.remove('selected');
            selectedHashes.delete(checkbox.value);
        }
    }

    function updateTranscodeButton() {
        const checked = document.querySelectorAll('.row-checkbox:checked').length;
        btnTranscodeSelected.disabled = checked === 0;
        btnTranscodeSelected.innerHTML = `<i class='bx bx-play-circle'></i> Transcode Selected (${checked})`;

        // update select all state
        const total = document.querySelectorAll('.row-checkbox').length;
        if (total > 0) {
            checkAll.checked = (checked === total);
            checkAll.indeterminate = (checked > 0 && checked < total);
        }
    }

    // --- API Calls ---
    async function fetchVersion() {
        try {
            const res = await fetch('/api/version');
            if (res.ok) {
                const data = await res.json();
                if (appVersionSpan) appVersionSpan.textContent = `v${data.version}`;
            }
        } catch (e) {
            console.error('Failed to fetch transcode version', e);
        }

        try {
            const res = await fetch('/api/seaglass-version');
            if (res.ok) {
                const data = await res.json();
                const spg = document.getElementById('seaglass-version');
                if (spg) spg.textContent = `${data.version}`;
            }
        } catch (e) {
            console.error('Failed to fetch seaglass version', e);
        }
    }

    async function fetchQuality() {
        try {
            const res = await fetch('/api/quality');
            if (res.ok) {
                const data = await res.json();
                if (data.active_preset) {
                    qualityPresetSelect.value = data.active_preset;
                } else {
                    qualityPresetSelect.value = 'custom';
                }
                // Sync modal fields
                if (data.settings) {
                    populateModalFields(data.settings);
                }
            }
        } catch (e) {
            console.error('Failed to fetch quality', e);
        }
    }

    async function updateQuality(preset, custom = null) {
        try {
            const body = preset ? { preset } : { custom };
            const res = await fetch('/api/quality', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                showToast('Quality updated', 'success');
                // verify change
                fetchQuality();
            } else {
                showToast('Failed to update quality', 'error');
            }
        } catch (e) {
            showToast('Network error updating quality', 'error');
        }
    }

    function showQualityModal() {
        qualityModal.classList.add('active');
    }

    function hideQualityModal() {
        qualityModal.classList.remove('active');
        // If they close without saving and were on custom, stay on custom.
        // If they click cancel, keep current state which is refreshed by fetchQuality.
        fetchQuality();
    }

    function populateModalFields(settings) {
        document.getElementById('q-crf').value = settings.crf;
        document.getElementById('q-preset').value = settings.preset;
        document.getElementById('q-audio').value = settings.audio_bitrate;
        document.getElementById('q-res').value = settings.resolution_cap || '';
    }

    async function fetchLibrary() {
        try {
            if (!toggleAutoRefreshLib.checked) {
                btnRefreshLib.querySelector('i').classList.add('bx-spin-reverse');
            }
            const res = await fetch('/api/list');
            if (res.ok) {
                libraryError = null;
                libraryItems = await res.json();
            } else {
                const data = await res.json().catch(() => ({}));
                libraryError = data.error || `Backend error (${res.status})`;
            }
        } catch (e) {
            libraryError = 'Could not reach the backend service.';
        } finally {
            renderLibrary();
            if (!toggleAutoRefreshLib.checked) {
                btnRefreshLib.querySelector('i').classList.remove('bx-spin-reverse');
            }
        }
    }

    async function fetchQueue() {
        try {
            if (!toggleAutoRefresh.checked) {
                btnRefreshQueue.querySelector('i').classList.add('bx-spin-reverse');
            }
            const res = await fetch('/api/status');
            if (res.ok) {
                const data = await res.json();
                queueTasks = Object.keys(data).map(uuid => {
                    return { uuid: uuid, ...data[uuid] };
                });
                renderQueue();
            }
        } catch (e) {
            console.error('Failed to fetch queue status', e);
        } finally {
            if (!toggleAutoRefresh.checked) {
                btnRefreshQueue.querySelector('i').classList.remove('bx-spin-reverse');
            }
        }
    }

    async function triggerScan() {
        try {
            btnRefreshLib.querySelector('i').classList.add('bx-spin-reverse');
            showToast('Initiating scan...', 'info');
            const res = await fetch('/api/scan', { method: 'PUT' });
            if (res.ok) {
                showToast('Scan queued successfully!', 'success');
                fetchQueue();
                // do not switch tabs as requested
                // refresh the library list after a delay so scan can populate it
                setTimeout(fetchLibrary, 1500);
            } else {
                const data = await res.json();
                showToast(`Scan failed: ${data.message || 'Error'}`, 'error');
            }
        } catch (e) {
            showToast('Network error triggering scan', 'error');
        } finally {
            btnRefreshLib.querySelector('i').classList.remove('bx-spin-reverse');
        }
    }

    async function cancelTask(uuid) {
        try {
            const res = await fetch(`/api/cancel/${uuid}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Task cancelled', 'info');
                fetchQueue();
            } else {
                showToast('Failed to cancel task', 'error');
            }
        } catch (e) {
            showToast('Network error cancelling task', 'error');
        }
    }

    // --- Filters ---
    function setupFilters() {
        if (!btnAddFilter) return;

        filterType.addEventListener('change', () => {
            filterValueName.classList.add('hidden');
            filterValueStatus.classList.add('hidden');
            filterValueInfoContainer.classList.add('hidden');

            const t = filterType.value;
            if (t === 'name') filterValueName.classList.remove('hidden');
            if (t === 'status') filterValueStatus.classList.remove('hidden');
            if (t === 'info') filterValueInfoContainer.classList.remove('hidden');
        });

        infoKind.addEventListener('change', () => {
            infoValCodec.classList.add('hidden');
            infoValQuality.classList.add('hidden');
            infoValAr.classList.add('hidden');
            compareOp.classList.add('hidden');
            compareVal.classList.add('hidden');

            const v = infoKind.value;
            if (v === 'codec') {
                infoValCodec.classList.remove('hidden');
            } else if (v === 'quality') {
                infoValQuality.classList.remove('hidden');
            } else if (v === 'ar') {
                infoValAr.classList.remove('hidden');
            } else if (v === 'duration' || v === 'mb_s') {
                compareOp.classList.remove('hidden');
                compareVal.classList.remove('hidden');
            }
        });

        btnAddFilter.addEventListener('click', () => {
            const type = filterType.value;
            let value = '';
            let labelStr = '';

            if (type === 'name') {
                value = filterValueName.value.trim();
                if (!value) return;
                labelStr = `Name: ${value}`;
                filterValueName.value = '';
                value = value.toLowerCase(); // keep logical matching lowercase
            } else if (type === 'status') {
                value = filterValueStatus.value;
                const text = filterValueStatus.options[filterValueStatus.selectedIndex].text;
                labelStr = `Status: ${text}`;
            } else if (type === 'info') {
                const ikind = infoKind.value;
                const kindText = infoKind.options[infoKind.selectedIndex].text;

                if (ikind === 'duration' || ikind === 'mb_s') {
                    const cOp = compareOp.value;
                    const cValText = compareVal.value;
                    if (!cValText) return;
                    const cVal = parseFloat(cValText);

                    value = `${ikind}|${cOp}|${cVal}`;
                    labelStr = `Metadata: ${kindText} ${cOp} ${cVal}`;
                } else if (ikind === 'codec') {
                    const v = infoValCodec.value;
                    const vText = infoValCodec.options[infoValCodec.selectedIndex].text;
                    value = `${ikind}|${v}`;
                    labelStr = `Metadata: Codec is ${vText}`;
                } else if (ikind === 'quality') {
                    const v = infoValQuality.value;
                    const vText = infoValQuality.options[infoValQuality.selectedIndex].text;
                    value = `${ikind}|${v}`;
                    labelStr = `Metadata: Quality is ${vText}`;
                } else if (ikind === 'ar') {
                    const v = infoValAr.value.trim();
                    if (!v) return;
                    value = `${ikind}|${v.toLowerCase()}`;
                    labelStr = `Metadata: AR is ${v}`;
                    infoValAr.value = ''; // clear input
                }
            }

            if (value) {
                addFilter(type, value, labelStr);
            }
        });
    }

    function addFilter(type, value, labelStr) {
        const exists = activeFilters.find(f => f.type === type && f.value === value);
        if (exists) return;

        activeFilters.push({ type, value, labelStr, id: Date.now() + Math.random() });
        renderFilters();
        renderLibrary();
    }

    function removeFilter(id) {
        activeFilters = activeFilters.filter(f => f.id !== id);
        renderFilters();
        renderLibrary();
    }

    function renderFilters() {
        activeFiltersContainer.innerHTML = '';
        activeFilters.forEach(f => {
            const el = document.createElement('div');
            el.className = 'filter-tag';
            el.innerHTML = `
                <span class="filter-label">${f.labelStr}</span>
                <button class="filter-remove" data-id="${f.id}"><i class='bx bx-x'></i></button>
            `;
            el.querySelector('.filter-remove').addEventListener('click', () => removeFilter(f.id));
            activeFiltersContainer.appendChild(el);
        });
    }

    // --- Sort ---
    function setupSortHeaders() {
        document.getElementById('th-file').addEventListener('click',   () => handleSortClick('file'));
        document.getElementById('th-status').addEventListener('click', () => handleSortClick('status'));
        document.getElementById('th-info').addEventListener('click',   () => handleSortClick('info'));
    }

    function handleSortClick(col) {
        const existing = activeSorts.find(s => s.col === col);

        if (!existing) {
            if (col === 'info') {
                activeSorts.push({ col, dir: 'asc', metaField: META_FIELDS[0].key });
            } else {
                activeSorts.push({ col, dir: 'asc', metaField: null });
            }
        } else if (col === 'info') {
            if (existing.dir === 'asc') {
                existing.dir = 'desc';
            } else {
                const nextIdx = META_FIELDS.findIndex(f => f.key === existing.metaField) + 1;
                if (nextIdx >= META_FIELDS.length) {
                    activeSorts = activeSorts.filter(s => s.col !== 'info');
                } else {
                    existing.metaField = META_FIELDS[nextIdx].key;
                    existing.dir = 'asc';
                }
            }
        } else {
            if (existing.dir === 'asc') {
                existing.dir = 'desc';
            } else {
                activeSorts = activeSorts.filter(s => s.col !== col);
            }
        }

        updateSortHeaders();
        renderLibrary();
    }

    function updateSortHeaders() {
        const thFile   = document.getElementById('th-file');
        const thStatus = document.getElementById('th-status');
        const thInfo   = document.getElementById('th-info');

        thFile.innerHTML   = 'Filename';
        thStatus.innerHTML = 'Status';
        thInfo.innerHTML   = 'Metadata';

        activeSorts.forEach((s, idx) => {
            const badge = `<span class="sort-badge">${idx + 1}</span>`;
            const arrow = s.dir === 'asc' ? '↑' : '↓';
            if (s.col === 'file') {
                thFile.innerHTML = `Filename <span class="sort-indicator">${arrow}</span>${badge}`;
            } else if (s.col === 'status') {
                thStatus.innerHTML = `Status <span class="sort-indicator">${arrow}</span>${badge}`;
            } else {
                const label = META_FIELDS.find(f => f.key === s.metaField)?.label || '';
                thInfo.innerHTML = `Metadata <span class="sort-indicator">${label} ${arrow}</span>${badge}`;
            }
        });

        thFile.classList.toggle('sort-active',   activeSorts.some(s => s.col === 'file'));
        thStatus.classList.toggle('sort-active', activeSorts.some(s => s.col === 'status'));
        thInfo.classList.toggle('sort-active',   activeSorts.some(s => s.col === 'info'));
    }

    function getItemSortValue(item, s) {
        if (s.col === 'file')   return (item.name || item.path || '').toLowerCase();
        if (s.col === 'status') return (item.status || '').toLowerCase();
        switch (s.metaField) {
            case 'size':     return item.size || 0;
            case 'duration': return item.duration || 0;
            case 'bitrate':  return item.duration > 0 ? (item.size * 8 / 1000000) / item.duration : 0;
            case 'quality':  return (item.resolution && item.resolution[1]) || 0;
            case 'codec':    return (item.codec || '').toLowerCase();
            default:         return 0;
        }
    }

    function applySorts(items) {
        if (activeSorts.length === 0) return items;
        return [...items].sort((a, b) => {
            for (const s of activeSorts) {
                const va = getItemSortValue(a, s), vb = getItemSortValue(b, s);
                const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
                if (cmp !== 0) return s.dir === 'asc' ? cmp : -cmp;
            }
            return 0;
        });
    }

    // --- Helpers ---
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatDuration(seconds) {
        if (!seconds) return '0m';
        const m = Math.floor(seconds / 60);
        const h = Math.floor(m / 60);
        const remM = m % 60;
        if (h > 0) return `${h}h ${remM}m`;
        return `${m}m`;
    }

    function getQualityLabel(resolution) {
        if (!resolution || !Array.isArray(resolution) || resolution.length < 2) return '';
        const h = resolution[1];
        if (h >= 2160) return '4K';
        if (h >= 1440) return '1440p';
        if (h >= 1080) return '1080p';
        if (h >= 720) return '720p';
        if (h >= 480) return '480p';
        return `${h}p`;
    }

    // --- Rendering ---
    function renderLibrary() {
        const table = document.getElementById('library-table');
        const emptyState = document.getElementById('empty-state');
        const errorState = document.getElementById('error-state');
        const tbody = document.getElementById('library-body');

        tbody.innerHTML = '';

        if (libraryError) {
            table.classList.add('hidden');
            emptyState.classList.add('hidden');
            errorState.classList.remove('hidden');
            document.getElementById('error-state-msg').textContent = libraryError;
            updateTranscodeButton();
            return;
        }

        errorState.classList.add('hidden');

        let filteredItems = libraryItems;

        if (activeFilters.length > 0) {
            filteredItems = libraryItems.filter(item => {
                const name = (item.name || '').toLowerCase();
                const path = (item.path || '').toLowerCase();
                const status = (item.status || '').toLowerCase();
                const codec = (item.codec || '').toLowerCase();
                const quality = getQualityLabel(item.resolution).toLowerCase();

                return activeFilters.every(f => {
                    if (f.type === 'name') {
                        return name.includes(f.value) || path.includes(f.value);
                    } else if (f.type === 'status') {
                        return status === f.value.toLowerCase();
                    } else if (f.type === 'info') {
                        const parts = f.value.split('|');
                        const field = parts[0];

                        if (field === 'duration' || field === 'mb_s') {
                            const op = parts[1];
                            const numVal = parseFloat(parts[2]);

                            let itemVal = 0;
                            if (field === 'mb_s') {
                                if (item.duration > 0) {
                                    itemVal = (item.size * 8 / 1000000) / item.duration;
                                } else {
                                    return false;
                                }
                            } else if (field === 'duration') {
                                itemVal = (item.duration || 0) / 60;
                            }

                            if (op === '>=') return itemVal >= numVal;
                            if (op === '<=') return itemVal <= numVal;
                        } else if (field === 'codec') {
                            const val = parts[1].toLowerCase();
                            return codec.includes(val);
                        } else if (field === 'quality') {
                            const val = parts[1].toLowerCase();
                            return quality.includes(val);
                        } else if (field === 'ar') {
                            const val = parts[1].toLowerCase();
                            const itemAR = (item.dar || item.sar || '').toLowerCase();
                            return itemAR.includes(val);
                        }
                    }
                    return true;
                });
            });
        }

        filteredItems = applySorts(filteredItems);

        if (!filteredItems || filteredItems.length === 0) {
            table.classList.add('hidden');
            emptyState.classList.remove('hidden');
        } else {
            table.classList.remove('hidden');
            emptyState.classList.add('hidden');

            filteredItems.forEach(item => {
                const tr = document.createElement('tr');

                const status = (item.status || '').toLowerCase();
                const canTranscode = status === 'pending' || status === 'error';

                let checkboxHtml = '';
                if (canTranscode && item.hash) {
                    const isChecked = selectedHashes.has(item.hash) ? 'checked' : '';
                    checkboxHtml = `<input type="checkbox" class="row-checkbox" value="${item.hash}" ${isChecked}>`;
                }

                const sizeStr = formatBytes(item.size);
                let durationStr = item.duration ? formatDuration(item.duration) : '0s';
                let mbsStr = '0 Mb/s';
                if (item.duration && item.duration > 0) {
                    const mbps = (item.size * 8 / 1000000) / item.duration;
                    mbsStr = mbps.toFixed(2) + ' Mb/s';
                }
                const qualityStr = getQualityLabel(item.resolution) || 'Unknown';
                const codecStr = item.codec || '???';
                let resStr = '-';
                if (item.resolution && Array.isArray(item.resolution) && item.resolution.length === 2) {
                    resStr = `${item.resolution[0]}x${item.resolution[1]}`;
                }
                const arStr = item.dar || item.sar || '-';
                const infoStr = `${sizeStr} | ${durationStr} | ${mbsStr} | ${qualityStr} | ${codecStr} | ${resStr} | AR: ${arStr}`;

                const statusUpper = status.toUpperCase();
                const displayName = item.name || (item.path ? item.path.split('/').pop() : 'Unknown');

                tr.innerHTML = `
                    <td class="col-check">${checkboxHtml}</td>
                    <td class="col-file" title="${item.path || ''}">
                        <div class="file-name-text">${displayName}</div>
                    </td>
                    <td class="col-status"><span class="status-badge ${status}">${statusUpper}</span></td>
                    <td class="col-info">${infoStr}</td>
                `;

                if (canTranscode && item.hash) {
                    const cb = tr.querySelector('.row-checkbox');
                    tr.addEventListener('click', (e) => {
                        if (e.target.tagName !== 'INPUT') {
                            cb.checked = !cb.checked;
                        }
                        updateRowSelection(cb);
                        updateTranscodeButton();
                    });

                    if (cb.checked) {
                        tr.classList.add('selected');
                    }
                }

                tbody.appendChild(tr);
            });
        }
        updateTranscodeButton();
    }

    function renderQueue() {
        const queueList = document.getElementById('queue-list');
        const emptyState = document.getElementById('queue-empty');
        const badge = document.getElementById('queue-badge');

        badge.textContent = queueTasks.length;
        queueList.innerHTML = '';

        if (queueTasks.length === 0) {
            queueList.classList.add('hidden');
            emptyState.classList.remove('hidden');
        } else {
            queueList.classList.remove('hidden');
            emptyState.classList.add('hidden');

            queueTasks.forEach(task => {
                const el = document.createElement('div');
                el.className = 'queue-item';

                let progressHtml = '';
                let detailsStr = task.type === 'tran' ? 'Transcode' : (task.type === 'scan' ? 'Library Scan' : task.type);
                const displayName = task.name || (task.uuid ? `Task: ${task.uuid.substring(0, 8)}` : 'Unknown Task');

                if (task.type === 'tran') {
                    const prog = task.progress ? parseFloat(task.progress.percent).toFixed(1) : 0;
                    const shortUuid = task.uuid ? task.uuid.substring(0, 8) : '...';
                    const preset = (task.quality_preset || 'high').toLowerCase();

                    detailsStr = `Transcode | ${shortUuid} | ${preset} | ${prog}%`;

                    progressHtml = `
                        <div class="queue-progress">
                            <div class="queue-progress-bar" style="width: ${prog}%"></div>
                        </div>
                    `;
                } else if (task.type === 'scan') {
                    detailsStr += ` | Scanning library...`;
                    progressHtml = `
                        <div class="queue-progress">
                            <div class="queue-progress-bar" style="width: 100%; animation: pulse 2s infinite;"></div>
                        </div>
                    `;
                }

                el.innerHTML = `
                    <div class="queue-item-info">
                        <div class="queue-item-title"></div>
                        <div class="queue-item-details"></div>
                        ${progressHtml}
                    </div>
                    <div class="queue-item-actions">
                        <button class="btn btn-icon btn-danger btn-cancel" data-uuid="${task.uuid}" title="Cancel Task">
                            <i class='bx bx-x'></i>
                        </button>
                    </div>
                `;

                el.querySelector('.queue-item-title').textContent = displayName;
                el.querySelector('.queue-item-details').textContent = detailsStr;

                const btnCancel = el.querySelector('.btn-cancel');
                btnCancel.addEventListener('click', () => {
                    let shouldConfirm = false;
                    if (task.type === 'tran' && task.progress && parseFloat(task.progress.percent) > 0.5) {
                        shouldConfirm = true;
                    }
                    if (!shouldConfirm || confirm('Are you sure you want to cancel this task? It is actively processing.')) {
                        cancelTask(task.uuid);
                    }
                });

                queueList.appendChild(el);
            });
        }
    }

    // --- Polling ---
    function startQueuePolling() {
        if (queueRefreshInterval) clearInterval(queueRefreshInterval);
        queueRefreshInterval = setInterval(() => {
            fetchQueue();
        }, 3000); // 3 seconds
    }

    function startLibraryPolling() {
        if (libraryRefreshInterval) clearInterval(libraryRefreshInterval);
        libraryRefreshInterval = setInterval(() => {
            fetchLibrary();
        }, 10000); // 10 seconds
    }

    // --- Toast Notifications ---
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'bx-info-circle';
        if (type === 'success') icon = 'bx-check-circle';
        if (type === 'error') icon = 'bx-error-circle';

        toast.innerHTML = `<i class='bx ${icon}'></i> <span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
});
