const lf = document.getElementById('library-form');

// Tab switching
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn, .tab-pane').forEach(e => e.classList.remove('active'));
    b.classList.add('active');
    document.getElementById(b.dataset.tab)?.classList.add('active');
}));

// Filter type + info-kind switching via data attributes (CSS handles show/hide)
document.getElementById('filter-type')?.addEventListener('change', e => lf.dataset.filterType = e.target.value);
document.getElementById('info-kind')?.addEventListener('change', e => lf.dataset.infoKind = e.target.value);

// Sort headers — update hidden form inputs and trigger library refresh
const sort = { col: '', dir: 'asc' };
document.addEventListener('click', e => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const col = th.dataset.sort;
    sort.dir = (sort.col === col && sort.dir === 'asc') ? 'desc' : 'asc';
    sort.col = col;
    lf.querySelector('[name=sort_col]').value = sort.col;
    lf.querySelector('[name=sort_dir]').value = sort.dir;
    htmx.trigger(document.body, 'filterChange');
});

// Add filter — appends hidden inputs to #library-form, renders visible tags
document.getElementById('btn-add-filter')?.addEventListener('click', () => {
    const type = document.getElementById('filter-type').value;
    let value = '', label = '';
    if (type === 'name') {
        const el = document.getElementById('filter-value-name');
        value = el.value.trim().toLowerCase(); label = `Name: ${el.value.trim()}`;
        if (!value) return; el.value = '';
    } else if (type === 'status') {
        const el = document.getElementById('filter-value-status');
        value = el.value; label = `Status: ${el.options[el.selectedIndex].text}`;
    } else if (type === 'info') {
        const ik = document.getElementById('info-kind'), v = ik.value, t = ik.options[ik.selectedIndex].text;
        if (v === 'codec')        { const s = document.getElementById('info-val-codec');   value = `codec|${s.value}`;   label = `Codec: ${s.options[s.selectedIndex].text}`; }
        else if (v === 'quality') { const s = document.getElementById('info-val-quality'); value = `quality|${s.value}`; label = `Quality: ${s.options[s.selectedIndex].text}`; }
        else if (v === 'ar')      { const e = document.getElementById('info-val-ar'); if (!e.value.trim()) return; value = `ar|${e.value.trim().toLowerCase()}`; label = `AR: ${e.value.trim()}`; e.value = ''; }
        else { const op = document.getElementById('compare-op').value, cv = document.getElementById('compare-val').value; if (!cv) return; value = `${v}|${op}|${cv}`; label = `${t} ${op} ${cv}`; }
    }
    if (!value) return;
    const id = Date.now();
    const inp = Object.assign(document.createElement('input'), { type: 'hidden', name: 'filter', value: `${type}|${value}|${label}` });
    inp.dataset.fid = id; lf.appendChild(inp);
    const tag = document.createElement('div'); tag.className = 'filter-tag';
    tag.innerHTML = `<span class="filter-label">${label}</span><button type="button" class="filter-remove"><i class='bx bx-x'></i></button>`;
    tag.querySelector('button').onclick = () => { lf.querySelector(`[data-fid="${id}"]`)?.remove(); tag.remove(); htmx.trigger(document.body, 'filterChange'); };
    document.getElementById('active-filters').appendChild(tag);
    htmx.trigger(document.body, 'filterChange');
});

// Quality preset — show modal for custom, POST via htmx.ajax for named presets
document.getElementById('quality-preset')?.addEventListener('change', e => {
    if (e.target.value === 'custom') document.getElementById('quality-modal')?.classList.add('active');
    else htmx.ajax('POST', '/api/quality', { values: { preset: e.target.value }, swap: 'none' });
});
document.querySelectorAll('.modal-close, .modal-close-btn').forEach(el =>
    el.addEventListener('click', () => document.getElementById('quality-modal')?.classList.remove('active')));
document.getElementById('btn-save-quality')?.addEventListener('click', () =>
    document.getElementById('quality-modal')?.classList.remove('active'));

// Transcode button count — kept in sync with checkbox changes and library swaps
document.addEventListener('change', e => {
    if (e.target.id === 'check-all') document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = e.target.checked);
    if (e.target.id === 'check-all' || e.target.classList.contains('row-checkbox')) syncTranscodeBtn();
});
document.body.addEventListener('htmx:afterSwap', syncTranscodeBtn);
function syncTranscodeBtn() {
    const n = document.querySelectorAll('.row-checkbox:checked').length;
    const b = document.getElementById('btn-transcode-selected');
    if (b) { b.disabled = !n; b.innerHTML = `<i class='bx bx-play-circle'></i> Transcode Selected (${n})`; }
}

// Toast — fired by HX-Trigger: {"showToast": {"message": "...", "type": "..."}}
// Login — browser-side fetch so brinecrypt CORS and session cookies work correctly
(function () {
    const BRINECRYPT = 'http://brinecrypt.lan';
    const btnLogin = document.getElementById('btn-login');
    const loginError = document.getElementById('login-error');
    if (!btnLogin) return;
    const attempt = async () => {
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value.trim();
        if (!user || !pass) { loginError.textContent = 'User and pass required'; loginError.classList.remove('hidden'); return; }
        btnLogin.disabled = true; loginError.classList.add('hidden');
        try {
            const r = await fetch(`${BRINECRYPT}/auth/login`, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass }) });
            if (r.ok) {
                document.getElementById('login-widget').innerHTML = `<span class="status-badge done" style="padding:.5rem 1rem"><i class='bx bx-user-check'></i> Logged in as <strong>${user}</strong></span>`;
            } else {
                loginError.textContent = (await r.text()) || 'Unauthorized'; loginError.classList.remove('hidden'); btnLogin.disabled = false;
            }
        } catch { loginError.textContent = 'Connection failed'; loginError.classList.remove('hidden'); btnLogin.disabled = false; }
    };
    btnLogin.addEventListener('click', attempt);
    ['login-user', 'login-pass'].forEach(id => document.getElementById(id)?.addEventListener('keypress', e => { if (e.key === 'Enter') attempt(); }));
})();

document.body.addEventListener('showToast', e => {
    const { message = '', type = 'info' } = e.detail || {};
    const icons = { success: 'bx-check-circle', error: 'bx-error-circle', info: 'bx-info-circle' };
    const t = document.createElement('div'); t.className = `toast ${type}`;
    t.innerHTML = `<i class='bx ${icons[type] || icons.info}'></i> <span>${message}</span>`;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 4000);
});
