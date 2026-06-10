// ============================================================
// app.js — جواهر | منطق التطبيق الرئيسي
// ============================================================

import {
    db, ordersRef, logsRef, warehouseRef, returnsRef,
    purchasesRef, defPagesRef, defUsersRef, sysUsersRef, customColorsRef,
    ref, push, onValue, update, remove, get
} from "./firebase-config.js";

import {
    USERS, STATUS_AR, STATUS_COLORS,
    COLORS_AR, DEFAULT_SIZES, STOCK_ALERT_THRESHOLD
} from "./constants.js";

// ── Expose app globally so inline onclick handlers work ────
window.app = {

    // ── State ────────────────────────────────────────────────
    user: null, role: null, userName: null,
    orders: {}, warehouse: {}, returns: {}, purchases: {},
    pages: [], entryUsers: [],
    charts: {},
    selectedR: new Set(), selectedKb: new Set(),
    modalOrderId: null,
    lastOrderId: null,
    isDark: localStorage.getItem('shmDark') === 'true',
   pSizeData: [],   // each element: { size, qty, color, colorHex }
    retSelectedOrderId: null,
    itemRows: [],
    logsData: {},
    nimSizeRows: [],
    sysUsers: {},
    _fbReady: { orders: false, warehouse: false, returns: false, purchases: false },
    _listenersStarted: false,
    auditData: {},
    customColors: [],   // ألوان مخصصة من Firebase تُضاف لـ COLORS_AR

    // ── Simple hash (SHA-256 via SubtleCrypto) ───────────────
    async _hash(str) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    },

    // ── Check if a plaintext pass matches stored hash or plain ─
    async _passMatch(input, stored) {
        if (!stored) return false;
        if (stored === input) return true; // legacy plain-text (constants.js users)
        const hashed = await this._hash(input);
        return hashed === stored;
    },

    // ============ LOGIN ============
    async login() {

        const u = document.getElementById('loginUser').value.trim().toLowerCase();
        const p = document.getElementById('loginPass').value;

        // 1. Check constants.js first (built-in accounts — always available, no Firebase delay)
        let ud = null;
        const cu = USERS[u];
        if (cu) {
            if (cu.pass !== p) { this.toast('بيانات الدخول غير صحيحة', 'error'); return; }
            ud = { role: cu.role, name: cu.name, perms: {} };
        } else {
            // 2. Try Firebase dynamic users
            const fbUser = this.sysUsers[u];
            if (!fbUser) { this.toast('بيانات الدخول غير صحيحة', 'error'); return; }
            if (fbUser.disabled) { this.toast('هذا الحساب معطّل. تواصل مع المدير', 'error'); return; }
            const ok = await this._passMatch(p, fbUser.passHash);
            if (!ok) { this.toast('بيانات الدخول غير صحيحة', 'error'); return; }
            ud = { role: fbUser.role, name: fbUser.name, perms: fbUser.perms || {} };
        }

        this.user = u; this.role = ud.role; this.userName = ud.name;
        this.userPerms = ud.perms;

        // حفظ الحساب إذا Remember Me مفعّل
        if (document.getElementById('rememberMe')?.checked) {
            this._saveAccount(u, p);
        }

localStorage.setItem('shmSession', JSON.stringify({ user: u, role: ud.role, name: ud.name }));        document.getElementById('authScreen').classList.remove('visible');
        document.getElementById('appContainer').style.display = 'block';
        document.getElementById('userName').textContent = ud.name;
        document.getElementById('userRole').textContent = ud.role;
        document.getElementById('userAvatar').textContent = ud.name[0];
        document.getElementById('eDate').value = new Date().toLocaleDateString('en-GB');
        document.getElementById('dashDate').textContent = new Date().toLocaleDateString('ar-JO', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        this.applyDark();
        this.applyPermissions();
        this.startListeners();
        this.updateCountry();
        // Record last login timestamp for Firebase users
        if (this.sysUsers[u]) {
            update(ref(db, 'jawaher_system_users/' + u), { lastLogin: Date.now() });
        }
        this.log('login', u, `دخول: ${ud.name} (${ud.role})`);
        this.toast('مرحباً ' + ud.name, 'success');
    },

    logout() {
        this.user = null; this.role = null; this.userName = null; this.userPerms = {};
        localStorage.removeItem('shmSession');
        document.getElementById('appContainer').style.display = 'none';
        document.getElementById('authScreen').classList.add('visible');
        document.getElementById('loginUser').value = '';
        document.getElementById('loginPass').value = '';
        app.renderSavedAccounts();
    },

  applyPermissions() {
        const isAdmin = this.role === 'Admin';
        const perms = this.userPerms || {};

        // ── Map the 8 named permissions → which pages they unlock ─
        const permPageMap = {
            canManageStock:   ['warehouse'],
            canManageReturns: ['returns'],
            canViewReports:   ['reports'],
            canExport:        [],   // action-only, no dedicated page
            canDelete:        [],
            canEditOrders:    [],
            canMoveStatus:    [],
            canSeePrices:     [],
        };

        // Build set of pages this user can access
        const allowedPages = new Set();
        if (!isAdmin) {
            Object.entries(permPageMap).forEach(([perm, pages]) => {
                if (perms[perm] === true) pages.forEach(p => allowedPages.add(p));
            });
        }

        // ── Page-level visibility for .admin-only elements ──────
        document.querySelectorAll('.admin-only').forEach(el => {
            const page = el.dataset?.page;
            let show = isAdmin;
            if (!isAdmin && page && allowedPages.has(page)) show = true;

            if (show) {
                if (el.classList.contains('nav-btn')) el.style.display = 'flex';
                else if (el.classList.contains('dropdown-j')) el.style.display = 'inline-block';
                else el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        });

        // ── Action-level restrictions ──────────────────────────
        const canDelete = isAdmin || perms.canDelete === true;
        const delBtn = document.getElementById('modalDeleteBtn');
        if (delBtn) delBtn.style.display = canDelete ? '' : 'none';

        const canExport = isAdmin || perms.canExport === true;
        document.querySelectorAll('.export-btn').forEach(el => {
            el.style.display = canExport ? '' : 'none';
        });

        const canSeePrices = isAdmin || perms.canSeePrices === true;
        if (!canSeePrices) {
            document.querySelectorAll('.price-cell,.kpi-emerald').forEach(el => {
                el.style.filter = 'blur(5px)'; el.style.userSelect = 'none';
            });
        }

        // ── Role-based default navigation ─────────────────────
        if (this.role === 'Delivery') { document.getElementById('rStatus').value = 'done'; this.gotoPage('reports'); }
        else if (this.role === 'User') {
            // If user has warehouse permission, go to dashboard; else entry
            if (allowedPages.has('warehouse')) this.gotoPage('dashboard');
            else this.gotoPage('entry');
        }
        else { this.gotoPage('dashboard'); }
    },

    // ── Guard: check permission before action ────────────────
    _can(perm) {
        if (this.role === 'Admin') return true;
        if (!this.userPerms) return false;
        return this.userPerms[perm] === true;
    },

    // ── Live session revocation check ────────────────────────
    _checkSessionValid() {
        if (!this.user) return;
        const fbUser = this.sysUsers[this.user];
        if (fbUser && fbUser.disabled) {
            this.toast('تم تعطيل حسابك. سيتم تسجيل الخروج.', 'error');
            setTimeout(() => this.logout(), 2000);
        }
    },

    // ============ REMEMBER ME / SAVED ACCOUNTS ============
    _getSavedAccounts() {
        try { return JSON.parse(localStorage.getItem('shmSavedAccounts') || '[]'); }
        catch { return []; }
    },
    _saveAccount(username, password) {
        const accounts = this._getSavedAccounts().filter(a => a.u !== username);
        accounts.unshift({ u: username, p: password, ts: Date.now() });
        localStorage.setItem('shmSavedAccounts', JSON.stringify(accounts.slice(0, 5)));
    },
    _removeAccount(username) {
        const accounts = this._getSavedAccounts().filter(a => a.u !== username);
        localStorage.setItem('shmSavedAccounts', JSON.stringify(accounts));
        this.renderSavedAccounts();
    },
 toggleRememberMe() {
    const cb   = document.getElementById('rememberMe');
    const box  = document.getElementById('rememberMeBox');
    const icon = box.querySelector('i');
    
    if (cb.checked) {
        box.style.background = 'rgba(201,168,76,.2)';
        box.style.borderColor = '#C9A84C';
        box.style.color = '#000000'; // تلوين النص بالأسود عند التفعيل
        icon.style.display = 'block';
    } else {
        box.style.background = 'rgba(255,255,255,.05)';
        box.style.borderColor = 'rgba(201,168,76,.4)';
        box.style.color = '#000000'; // تلوين النص بالأسود أيضاً عند إلغاء التفعيل
        icon.style.display = 'none';
    }
},
    renderSavedAccounts() {
        const accounts = this._getSavedAccounts();
        const container = document.getElementById('savedAccountsList');
        if (!container) return;
        if (!accounts.length) { container.style.display = 'none'; return; }
        container.style.display = 'block';
        container.innerHTML = `
            <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:.5rem;text-align:right;">الحسابات المحفوظة</div>
            <div style="display:flex;flex-direction:column;gap:.4rem;">
                ${accounts.map(a => `
                    <div style="
                        display:flex;align-items:center;gap:.6rem;
                        background:rgba(255,255,255,.05);
                        border:1px solid rgba(201,168,76,.15);
                        border-radius:12px;padding:.55rem .9rem;
                        cursor:pointer;transition:background .2s;
                    " onmouseenter="this.style.background='rgba(201,168,76,.08)'"
                       onmouseleave="this.style.background='rgba(255,255,255,.05)'"
                       onclick="app.quickLogin('${a.u}','${a.p}')">
                        <div style="
                            width:32px;height:32px;border-radius:50%;flex-shrink:0;
                            background:linear-gradient(135deg,#C9A84C,#9A7A2E);
                            display:flex;align-items:center;justify-content:center;
                            font-weight:800;font-size:.85rem;color:#1A1A2E;
                        ">${a.u[0].toUpperCase()}</div>
                        <span style="flex:1;color:rgba(255,255,255,.8);font-size:.88rem;">${a.u}</span>
                        <button onclick="event.stopPropagation();app._removeAccount('${a.u}')" style="
                            background:none;border:none;color:rgba(255,255,255,.3);
                            cursor:pointer;font-size:.8rem;padding:.2rem .4rem;
                            border-radius:6px;transition:color .2s;
                        " onmouseenter="this.style.color='#e74c3c'"
                           onmouseleave="this.style.color='rgba(255,255,255,.3)'">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
            <div style="text-align:center;margin-top:.6rem;">
                <span style="font-size:.75rem;color:rgba(255,255,255,.25);cursor:pointer;"
                    onclick="app.loginWithOther()">
                    <i class="fas fa-plus" style="font-size:.65rem;"></i> تسجيل دخول بحساب آخر
                </span>
            </div>
        `;
    },
    async quickLogin(username, password) {
        document.getElementById('loginUser').value = username;
        document.getElementById('loginPass').value = password;
        await this.login();
    },
    loginWithOther() {
        document.getElementById('loginUser').value = '';
        document.getElementById('loginPass').value = '';
        document.getElementById('loginUser').focus();
    },

    // ============ DARK MODE ============
    toggleDark() {
        this.isDark = !this.isDark;
        localStorage.setItem('shmDark', this.isDark);
        this.applyDark();
        if (document.getElementById('page-dashboard').classList.contains('active')) this.renderDashboard();
    },
    applyDark() {
        document.documentElement.setAttribute('data-theme', this.isDark ? 'dark' : 'light');
        const icon = document.querySelector('#darkBtn i');
        if (icon) icon.className = this.isDark ? 'fas fa-sun' : 'fas fa-moon';
    },

    // ============ NAVIGATION ============
    gotoPage(id) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + id)?.classList.add('active');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === id));

        if (id === 'dashboard') this.renderDashboard();
        if (id === 'entry') this.startWizard();
        if (id === 'orders') this.renderBoard();
        if (id === 'reports') { this.renderTable(); this.renderStageCards(); }
        if (id === 'warehouse') this.renderWarehouse();
        if (id === 'purchase') this.renderPurchasePage();
        if (id === 'returns') this.renderReturnsList();
        if (id === 'definitions') this.renderDefinitions();
        if (id === 'logs') this.renderLogs();
        if (id === 'movement')    this.renderMovementTable();
        if (id === 'customers')   { if (this.role === 'Admin') this.renderCustomers(); }
        if (id === 'users')       { if (this.role === 'Admin') this.renderUsersPage(); }
        if (id === 'audit')       { if (this.role === 'Admin') this.renderAuditPage(); }
        this.closeAllDropdowns();
    },

    // ============ FIREBASE LISTENERS ============
    // ── IndexedDB Cache helpers ───────────────────────────────
    async _cacheInit() {
        return new Promise((res, rej) => {
            const req = indexedDB.open('ShmCache', 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
                if (!db.objectStoreNames.contains('offlineQueue')) db.createObjectStore('offlineQueue', { autoIncrement: true });
            };
            req.onsuccess = e => { this._idb = e.target.result; res(); };
            req.onerror = () => rej();
        });
    },

    async _cacheSet(key, val) {
        if (!this._idb) return;
        return new Promise(res => {
            const tx = this._idb.transaction('data', 'readwrite');
            tx.objectStore('data').put(val, key);
            tx.oncomplete = res;
        });
    },

    async _cacheGet(key) {
        if (!this._idb) return null;
        return new Promise(res => {
            const tx = this._idb.transaction('data', 'readonly');
            const req = tx.objectStore('data').get(key);
            req.onsuccess = () => res(req.result ?? null);
            req.onerror = () => res(null);
        });
    },

    async _offlineQueueAdd(path, data) {
        if (!this._idb) return;
        return new Promise(res => {
            const tx = this._idb.transaction('offlineQueue', 'readwrite');
            tx.objectStore('offlineQueue').add({ path, data, ts: Date.now() });
            tx.oncomplete = res;
        });
    },

    async _offlineQueueFlush() {
        if (!this._idb) return;
        const tx = this._idb.transaction('offlineQueue', 'readwrite');
        const store = tx.objectStore('offlineQueue');
        const all = await new Promise(res => { const r = store.getAll(); r.onsuccess = () => res(r.result); });
        const keys = await new Promise(res => { const r = store.getAllKeys(); r.onsuccess = () => res(r.result); });
        if (all.length === 0) return;
        const updates = {};
        all.forEach(item => { updates[item.path] = item.data; });
        try {
            await update(ref(db), updates);
            // Clear queue on success
            const tx2 = this._idb.transaction('offlineQueue', 'readwrite');
            keys.forEach(k => tx2.objectStore('offlineQueue').delete(k));
            if (all.length) this.toast(`تم مزامنة ${all.length} عملية محفوظة أثناء الانقطاع ✓`, 'success');
        } catch(e) { /* keep in queue */ }
    },

    _hideSyncOverlay() {
        if (Object.values(this._fbReady).every(Boolean)) {
            const overlay = document.getElementById('syncOverlay');
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 400);
            }
        }
    },

    startListeners() {
        if (this._listenersStarted) return;
        this._listenersStarted = true;
        // ── Load cached data immediately for instant UI ────────
        this._cacheInit().then(async () => {
            const cached = {
                orders: await this._cacheGet('orders'),
                warehouse: await this._cacheGet('warehouse'),
                returns: await this._cacheGet('returns'),
                purchases: await this._cacheGet('purchases'),
                pages: await this._cacheGet('pages'),
            };
            if (cached.orders)    { this.orders    = cached.orders;    this.updateCurrentPage(); this.updateRItemFilter(); }
            if (cached.warehouse) { this.warehouse  = cached.warehouse; this.updateItemSelects(); this.updateCurrentPage(); }
            if (cached.returns)   { this.returns    = cached.returns;   this.updateCurrentPage(); }
            if (cached.purchases) { this.purchases  = cached.purchases; this.updateCurrentPage(); }
            if (cached.pages) {
                this.pages = cached.pages;
                this.updatePageSelect();
            }
        });

        onValue(ordersRef, snap => {
            this.orders = snap.val() || {};
            this._cacheSet('orders', this.orders);
            this._fbReady.orders = true; this._hideSyncOverlay();
            this.updateCurrentPage(); this.updateRItemFilter();
        });
        onValue(warehouseRef, snap => {
            this.warehouse = snap.val() || {};
            this._cacheSet('warehouse', this.warehouse);
            this._fbReady.warehouse = true; this._hideSyncOverlay();
            this.updateItemSelects(); this.updateCurrentPage();
        });
        onValue(returnsRef, snap => {
            this.returns = snap.val() || {};
            this._cacheSet('returns', this.returns);
            this._fbReady.returns = true; this._hideSyncOverlay();
            this.updateCurrentPage();
        });
        onValue(purchasesRef, snap => {
            this.purchases = snap.val() || {};
            this._cacheSet('purchases', this.purchases);
            this._fbReady.purchases = true; this._hideSyncOverlay();
            this.updateCurrentPage();
        });
        onValue(defPagesRef, snap => {
            this.pages = snap.val() ? Object.entries(snap.val()).map(([id, v]) => ({ id, name: v.name })) : [];
            this._cacheSet('pages', this.pages);
            this.updatePageSelect(); this.renderDefinitions();
        });
        onValue(defUsersRef, snap => {
            this.entryUsers = snap.val() ? Object.entries(snap.val()).map(([id, v]) => ({ id, name: v.name })) : [];
            this.updateEntryUserSelect(); this.renderDefinitions();
        });
        // ── System Users listener (real-time RBAC + revocation) ──
        onValue(sysUsersRef, snap => {
            this.sysUsers = snap.val() || {};
            this._checkSessionValid();
            this.updateEntryUserSelect(); // refresh entry user dropdown
            const active = document.querySelector('.page.active');
            if (active?.id === 'page-users' && this.role === 'Admin') this.renderUsersPage();
        });
       if (this.role === 'Admin') {
    onValue(logsRef, snap => { this.logsData = snap.val() || {}; this.updateCurrentPage(); });
        }

        // ── Online/offline detection + queue flush ─────────────
        window.addEventListener('online', () => {
            this.toast('عاد الاتصال بالإنترنت — جارٍ المزامنة...', 'success');
            this._offlineQueueFlush();
        });
        window.addEventListener('offline', () => {
            this.toast('انقطع الاتصال — سيتم حفظ العمليات ومزامنتها لاحقاً', 'warning');
        });
        // ── Audit trail listener (Admin only) ────────────────
        if (this.role === 'Admin') {
            onValue(ref(db, 'jawaher_audit'), snap => {
                this.auditData = snap.val() || {};
                const active = document.querySelector('.page.active');
                if (active?.id === 'page-audit') this.renderAuditPage();
            });
        }

        // ── Custom Colors listener ───────────────────────
        onValue(customColorsRef, snap => {
            const data = snap.val() || {};
            this.customColors = Object.entries(data).map(([key, c]) => ({
                name: c.name, hex: c.hex, border: c.border || c.hex, custom: true, _key: key
            }));
            this.renderCustomColorsDef();
        });

        // Flush any pending queue on startup
        setTimeout(() => this._offlineQueueFlush(), 3000);
    },

    updateCurrentPage() {
        const active = document.querySelector('.page.active');
        if (!active) return;
        const id = active.id.replace('page-', '');
        if (id === 'dashboard') this.renderDashboard();
        if (id === 'orders') this.renderBoard();
        if (id === 'reports') { this.renderTable(); this.renderStageCards(); }
        if (id === 'warehouse') this.renderWarehouse();
        if (id === 'purchase') this.renderPurchasePage();
    if (id === 'returns') this.renderReturnsList();
    if (id === 'definitions') this.renderDefinitions();
    if (id === 'logs') this.renderLogs();
    if (id === 'movement') this.renderMovementTable();
    if (id === 'customers' && this.role === 'Admin') this.renderCustomers();
    },

    // ============ DEFINITIONS ============
    updatePageSelect() {
        const opts = '<option value="">اختر الصفحة</option>' +
            this.pages.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        ['ePageName', 'pPageName', 'nimPage'].forEach(id => {
            const sel = document.getElementById(id);
            if (sel) sel.innerHTML = opts;
        });
        const rPage = document.getElementById('rPage');
        if (rPage) rPage.innerHTML = '<option value="">كل الصفحات</option>' +
            this.pages.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    },

    updateEntryUserSelect() {
        const sel = document.getElementById('eEntryUser');
        if (!sel) return;

        const isAdmin = this.role === 'Admin';

        if (isAdmin) {
            // Admin sees all system users (Firebase + constants built-ins)
            const builtInNames = ['المدير العام', 'باسل', 'موظف إدخال', 'عامل التوصيل'];
            const fbNames = Object.values(this.sysUsers || {})
                .filter(u => !u.disabled)
                .map(u => u.name);
            // Merge & deduplicate
            const allNames = [...new Set([...builtInNames, ...fbNames])].sort();
            sel.innerHTML = allNames.map(n => `<option value="${n}" ${n === this.userName ? 'selected' : ''}>${n}</option>`).join('');
            // Pre-select current user
            sel.value = this.userName;
            sel.disabled = false;
        } else {
            // Non-admin: locked to their own name, non-editable
            sel.innerHTML = `<option value="${this.userName}" selected>${this.userName}</option>`;
            sel.value = this.userName;
            sel.disabled = true;
            sel.style.opacity = '.7';
        }
    },

    updateItemSelects() {
        const items = Object.entries(this.warehouse);
        const opts = '<option value="">اختر المنتج...</option>' +
            items.map(([id, w]) => `<option value="${id}">${w.name}${w.color ? ' — ' + w.color : ''}</option>`).join('');
        const datalist = document.getElementById('productsList');
        if (datalist) datalist.innerHTML = [...new Set(items.map(([, w]) => w.name))]
            .map(name => `<option value="${name}"></option>`).join('');
        const pSel = document.getElementById('pItem');
        if (pSel) { const cur = pSel.value; pSel.innerHTML = '<option value="">اختر منتجاً موجوداً</option>' + items.map(([id, w]) => `<option value="${id}">${w.name}</option>`).join(''); pSel.value = cur; }
        //document.querySelectorAll('.ir-item').forEach(sel => { const cur = sel.value; sel.innerHTML = opts; if (cur) sel.value = cur; });
    },

    updateRItemFilter() {
        const sel = document.getElementById('rItem');
        if (!sel) return;
        const items = [...new Set(Object.values(this.orders).map(o => o.itemName).filter(Boolean))];
        sel.innerHTML = '<option value="">كل المنتجات</option>' + items.map(n => `<option value="${n}">${n}</option>`).join('');
    },

    async addDef(type, inputId) {
        const name = document.getElementById(inputId).value.trim();
        if (!name) return this.toast('يرجى إدخال الاسم', 'error');
        await push(type === 'pages' ? defPagesRef : defUsersRef, { name });
        document.getElementById(inputId).value = '';
        this.toast('تم الإضافة', 'success');
    },

    async delDef(type, id) {
        if (!confirm('حذف هذا العنصر؟')) return;
        const pathMap = { pages: 'jawaher_defPages', entryUsers: 'jawaher_defUsers' };
        await remove(ref(db, `${pathMap[type] || 'jawaher_def/' + type}/${id}`));
    },

    async addCustomColorDef() {
        const name = document.getElementById('defColorName')?.value.trim();
        const hex  = document.getElementById('defColorHex')?.value || '#000000';
        if (!name) { this.toast('يرجى إدخال اسم اللون', 'error'); return; }
        if (this._allColors().find(c => c.name === name)) { this.toast('هذا الاسم موجود مسبقاً', 'error'); return; }
        await push(customColorsRef, { name, hex, border: hex, custom: true });
        document.getElementById('defColorName').value = '';
        this.toast(`تم إضافة اللون "${name}" ✓`, 'success');
    },

    async renameCustomColor(firebaseKey, oldName) {
        const newName = prompt(`الاسم الجديد للون "${oldName}":`, oldName);
        if (!newName || newName.trim() === oldName) return;
        if (this._allColors().find(c => c.name === newName.trim())) { this.toast('هذا الاسم موجود مسبقاً', 'error'); return; }
        await update(ref(db, `jawaher_custom_colors/${firebaseKey}`), { name: newName.trim() });
        this.toast(`تم تغيير الاسم إلى "${newName.trim()}" ✓`, 'success');
    },

    async deleteCustomColor(firebaseKey, colorName) {
        const usedIn = [];
        Object.values(this.warehouse).forEach(w => {
            const hasStock = Object.entries(w.sizes || {}).some(([k, q]) => {
                if (q <= 0) return false;
                const kColor = k.includes(' - ') ? k.split(' - ').slice(1).join(' - ') : (w.color || '');
                return kColor === colorName;
            });
            if (hasStock) usedIn.push(w.name);
        });
        if (usedIn.length > 0) {
            this.toast(`⚠ لا يمكن حذف "${colorName}" — مستخدم في: ${usedIn.slice(0,3).join('، ')}${usedIn.length>3?'...':''}`, 'error');
            return;
        }
        if (!confirm(`حذف اللون "${colorName}" نهائياً؟`)) return;
        await remove(ref(db, `jawaher_custom_colors/${firebaseKey}`));
        this.toast(`تم حذف اللون "${colorName}"`, 'success');
    },

    renderCustomColorsDef() {
        const container = document.getElementById('customColorsList');
        if (!container) return;
        if (!this.customColors || this.customColors.length === 0) {
            container.innerHTML = '<div style="color:var(--ink-mid);font-size:.85rem;text-align:center;padding:1rem">لا توجد ألوان مخصصة مضافة</div>';
            return;
        }
        container.innerHTML = this.customColors.map(c => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:.55rem 0;border-bottom:1px solid var(--border-2)">
                <div style="display:flex;align-items:center;gap:.6rem">
                    <span style="width:22px;height:22px;border-radius:6px;background:${c.hex};border:1.5px solid var(--border);display:inline-block;flex-shrink:0"></span>
                    <span style="font-weight:700;font-size:.9rem">${c.name}</span>
                    <span style="font-size:.72rem;color:var(--ink-mid);font-family:monospace">${c.hex}</span>
                </div>
                <div style="display:flex;gap:.4rem">
                    <button class="btn-j btn-ghost btn-xs-j" onclick="app.renameCustomColor('${c._key}','${c.name}')" title="تغيير الاسم">
                        <i class="fas fa-pencil-alt" style="color:var(--gold)"></i>
                    </button>
                    <button class="btn-j btn-ruby btn-xs-j" onclick="app.deleteCustomColor('${c._key}','${c.name}')" title="حذف">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`).join('');
    },

    renderDefinitions() {
        if (this.role !== 'Admin') return;
        const mkItem = (name, type, id) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--border)">
                <span style="font-weight:700;font-size:.9rem">${name}</span>
                <button class="btn-j btn-ruby btn-xs-j" onclick="app.delDef('${type}','${id}')"><i class="fas fa-trash"></i></button>
            </div>`;
        const pg = document.getElementById('pagesList');
        const us = document.getElementById('usersList');
        if (pg) pg.innerHTML = this.pages.length ? this.pages.map(p => mkItem(p.name, 'pages', p.id)).join('') : '<div style="color:var(--ink-mid); font-size:0.85rem;">لا توجد صفحات معرفة</div>';
        if (us) us.innerHTML = this.entryUsers.length ? this.entryUsers.map(u => mkItem(u.name, 'entryUsers', u.id)).join('') : '<div style="color:var(--ink-mid); font-size:0.85rem;">لا يوجد مدخلين معرفين</div>';
        this.renderCustomColorsDef();
    },

    // ============ COUNTRY ============
    updateCountry() { this.checkDuplicate(); },

    checkDuplicate() {
const mob = document.getElementById('eCustMob')?.value.replace(/\D/g, '') || '';
        const full = '07' + mob;
        const dups = Object.values(this.orders).filter(o => o.custMob === full);
        const warn = document.getElementById('eDupWarn');
        const msg = document.getElementById('eDupMsg');
        if (warn && msg) {
            if (mob.length >= 7 && dups.length > 0) {
                warn.style.display = 'block';
                msg.textContent = `هذا الرقم لديه ${dups.length} طلبات سابقة`;
            } else { warn.style.display = 'none'; }
        }
    },

    // ============ COLOR PICKER ============
    _colorPickerOpen: null,

    openColorPicker(idx, inputId) {
        document.querySelectorAll('.color-picker-popup').forEach(p => p.remove());
        this._colorPickerOpen = null;

        const isMain = idx === 'main';
        let targetId, btnId;
        if (isMain) {
            const idMap = { 'p_color': 'pColor', 'nim_color': 'nimColor', 'asColor': 'asColor' };
            targetId = idMap[inputId] || inputId;
            btnId = `${inputId}_btn_main`;
        } else {
            targetId = `${inputId}_${idx}`;
            btnId = `${inputId}_btn_${idx}`;
        }
        const btn = document.getElementById(btnId) || document.getElementById(targetId);
        if (!btn) return;
        this._colorPickerOpen = targetId;

        const popup = document.createElement('div');
        popup.className = 'color-picker-popup';

        const targetEl = document.getElementById(targetId);
        const availableColors = targetEl?.dataset?.availableColors ? JSON.parse(targetEl.dataset.availableColors) : null;

        const applyColor = (c) => {
            const target = document.getElementById(targetId);
            if (target) {
                target.value = c.name;
                target.dataset.hex = c.hex;
                if (targetId.startsWith('ir_color_')) {
                    const rowIdx = target.dataset.idx;
                    const preview = document.getElementById(`ir_color_preview_${rowIdx}`);
                    if (preview) {
                        const bg = c.rainbow ? 'linear-gradient(135deg,#ff0000,#ff7700,#ffff00,#00ff00,#0000ff,#8b00ff)' : c.hex;
                        preview.innerHTML = `<span style="width:18px;height:18px;border-radius:5px;background:${bg};border:1.5px solid rgba(0,0,0,.12);flex-shrink:0;display:inline-block"></span>
                            <span style="font-size:.82rem;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</span>`;
                        preview.style.borderColor = c.rainbow ? 'transparent' : c.hex;
                        preview.style.boxShadow = `0 0 0 2px ${c.hex}22`;
                    }
                    app.loadRowSizes(parseInt(rowIdx), null, c.name);
                } else {
                    if (c.rainbow) {
                        target.style.borderRight = '4px solid transparent';
                        target.style.borderImage = 'linear-gradient(#ff0000,#ff7700,#ffff00,#00ff00,#0000ff,#8b00ff) 1';
                    } else {
                        target.style.borderRight = `4px solid ${c.hex}`;
                        target.style.borderImage = '';
                    }
                }
                if (targetId.startsWith('psc_')) {
                    const i = parseInt(targetId.split('_')[1]);
                    if (app.pSizeData && app.pSizeData[i]) { app.pSizeData[i].color = c.name; app.pSizeData[i].colorHex = c.hex; }
                }
                if (targetId === 'asColor') {
                    const itemId = document.querySelector('[onclick*="confirmAddStock"]')?.getAttribute('onclick').match(/'([^']+)'/)?.[1];
                    if (itemId) app.updateLiveBalance(itemId);
                }
            }
            popup?.parentNode && popup.remove();
            this._colorPickerOpen = null;
        };

        this._allColors().forEach(c => {
            if (availableColors && !availableColors.includes(c.name)) return;
            const el = document.createElement('div');
            el.title = c.name;
            el.style.cssText = `width:28px;height:28px;border-radius:8px;background:${c.rainbow ? 'linear-gradient(135deg,#ff0000,#ff7700,#ffff00,#00ff00,#0000ff,#8b00ff)' : c.hex};border:2px solid ${c.border || '#ccc'};cursor:pointer;transition:transform .15s`;
            el.onclick = () => applyColor(c);
            popup.appendChild(el);
        });

        // زر "أخرى" للون مخصص
        const otherBtn = document.createElement('div');
        otherBtn.title = 'لون مخصص';
        otherBtn.style.cssText = `width:28px;height:28px;border-radius:8px;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);border:2px solid #aaa;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px`;
        otherBtn.innerHTML = '✏️';
        otherBtn.onclick = () => { popup.remove(); this._colorPickerOpen = null; this._openCustomColorModal(targetId, applyColor); };
        popup.appendChild(otherBtn);

        document.body.appendChild(popup);
        const r = btn.getBoundingClientRect();
        const allCount = this._allColors().length + 1;
        const popupH = Math.ceil(allCount / 6) * 36 + 16;
        const spaceBelow = window.innerHeight - r.bottom;
        popup.style.top = (spaceBelow < popupH && r.top > popupH) ? 'auto' : (r.bottom + 6) + 'px';
        if (spaceBelow < popupH && r.top > popupH) popup.style.bottom = (window.innerHeight - r.top + 4) + 'px';
        popup.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 230)) + 'px';

        const closeHandler = (e) => {
            if (!popup.contains(e.target) && e.target !== btn) {
                popup.remove(); this._colorPickerOpen = null;
                document.removeEventListener('mousedown', closeHandler, true);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 50);
    },

    _openCustomColorModal(targetId, applyColorFn) {
        document.getElementById('customColorModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'customColorModal'; modal.className = 'modal-j open';
        modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('customColorModal').remove()"></div>
        <div class="modal-sheet" style="max-width:360px">
            <div class="modal-handle"></div>
            <div class="modal-title"><i class="fas fa-palette" style="color:var(--gold)"></i> إضافة لون مخصص</div>
            <div class="row g-3">
                <div class="col-12">
                    <label class="form-label-j">اسم اللون <span style="color:var(--ruby-light)">*</span></label>
                    <input type="text" id="ccName" class="form-control-j" placeholder="مثال: أزرق سماوي فاتح" dir="rtl" autocomplete="off">
                </div>
                <div class="col-12">
                    <label class="form-label-j">اختر اللون</label>
                    <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
                        <input type="color" id="ccHex" value="#C9A84C" style="width:60px;height:48px;border:2px solid var(--border);border-radius:10px;cursor:pointer;padding:2px;background:transparent;flex-shrink:0">
                        <div id="ccPreview" style="flex:1;min-width:120px;height:48px;border-radius:10px;background:#C9A84C;border:1px solid var(--border);display:flex;align-items:center;justify-content:center">
                            <span id="ccPreviewLabel" style="color:#fff;font-weight:700;font-size:.85rem;text-shadow:0 1px 3px rgba(0,0,0,.5)">معاينة</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="d-flex gap-3 mt-4">
                <button class="btn-j btn-gold flex-fill" id="ccSaveBtn"><i class="fas fa-save"></i> حفظ وتطبيق</button>
                <button class="btn-j btn-ghost" onclick="document.getElementById('customColorModal').remove()">إلغاء</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        const hexInput = document.getElementById('ccHex');
        const preview = document.getElementById('ccPreview');
        const previewLabel = document.getElementById('ccPreviewLabel');
        hexInput.addEventListener('input', () => {
            preview.style.background = hexInput.value;
            const r = parseInt(hexInput.value.slice(1,3),16), g = parseInt(hexInput.value.slice(3,5),16), b = parseInt(hexInput.value.slice(5,7),16);
            previewLabel.style.color = (r*299+g*587+b*114)/1000 > 128 ? '#1A1A2E' : '#fff';
        });
        document.getElementById('ccSaveBtn').onclick = async () => {
            const name = document.getElementById('ccName').value.trim();
            const hex = document.getElementById('ccHex').value;
            if (!name) { this.toast('يرجى كتابة اسم اللون', 'error'); return; }
            if (this._allColors().find(c => c.name === name)) { this.toast('هذا الاسم موجود مسبقاً', 'error'); return; }
            const newColor = { name, hex, border: hex, custom: true };
            await push(customColorsRef, newColor);
            applyColorFn(newColor);
            document.getElementById('customColorModal').remove();
            this.toast(`تم إضافة اللون "${name}" ✓`, 'success');
        };
    },

    _colorHex(name) {
        if (!name) return null;
        if (name.startsWith('#')) return name;
        const found = this._allColors().find(c => c.name === name);
        return found?.hex || null;
    },

    // Returns an inline style string for background (handles gradients)
    _colorStyle(name) {
        const hex = this._colorHex(name);
        if (!hex) return 'background:#ccc';
        if (hex.startsWith('linear-gradient')) return `background:${hex}`;
        return `background:${hex}`;
    },

    // ── القائمة الكاملة للألوان (الرسمية + المخصصة) ──────────
    _allColors() {
        return [...COLORS_AR, ...this.customColors];
    },

    filterSizesByColor(idx, colorName) {
        const sel = document.querySelector(`.ir-item[data-idx="${idx}"]`);
        const sizeSel = document.querySelector(`.ir-size[data-idx="${idx}"]`);
        const stockInfo = document.querySelector(`.ir-stock[data-idx="${idx}"]`);
        if (!sel || !sizeSel) return;
        const itemId = sel.value;
        const item = this.warehouse[itemId];
        if (!item) return;

        let colorHasStock = false;
        let availableSizesHtml = '<option value="">المقاس</option>';

        Object.entries(item.sizes || {}).forEach(([s, q]) => {
            let vColor = '';
            if (item.variations && item.variations[s]) vColor = item.variations[s].color;
            else if (s.includes(' - ')) vColor = s.split(' - ')[1];
            else vColor = item.color || '';

            if (vColor === colorName) {
                availableSizesHtml += `<option value="${s}" data-qty="${q}">${s} (${q})</option>`;
                if (q > 0) colorHasStock = true;
            }
        });

        if (!colorHasStock) {
            this.toast(`اللون "${colorName}" غير متوفر (ليس له رصيد)`, 'error');
            const cInp = document.getElementById(`ir_color_${idx}`);
            if (cInp) { cInp.value = ''; cInp.style.borderRight = '4px solid var(--border)'; cInp.dataset.hex = ''; }
            this.loadRowSizes(idx);
            return;
        }
        sizeSel.innerHTML = availableSizesHtml;
        if (stockInfo) stockInfo.textContent = '';
        if (sizeSel.options.length === 2) { sizeSel.selectedIndex = 1; sizeSel.onchange(); }
    },

    // ============ ITEM ROWS (multi-product entry) ============
    initItemRows() {
        if (!document.getElementById('eItemsList')) return;
        this.itemRows = [{ id: Date.now() }];
        this.renderItemRows();
    },
addItemRow() {
        this._saveItemRowsState();
        
        const lastRow = this.itemRows[this.itemRows.length - 1];
        if (!lastRow.savedItem || !lastRow.savedColor || !lastRow.savedSize) {
            this.toast('يرجى اختيار (المنتج + اللون + المقاس) للمنتج الحالي قبل إضافة منتج آخر', 'error');
            return;
        }

        this.itemRows.push({ id: Date.now() });
        this.renderItemRows();
    },

    removeItemRow(idx) {
        if (this.itemRows.length <= 1) return;
        this._saveItemRowsState();
        this.itemRows.splice(idx, 1);
        this.renderItemRows();
    },

    _saveItemRowsState() {
        this.itemRows.forEach((row, idx) => {
            const itemSel = document.querySelector(`.ir-item[data-idx="${idx}"]`);
            const sizeSel = document.querySelector(`.ir-size[data-idx="${idx}"]`);
            const colorInp = document.getElementById(`ir_color_${idx}`);
            const qtyInp = document.querySelector(`.ir-qty[data-idx="${idx}"]`);
            if (itemSel) row.savedItem = itemSel.value;
            if (sizeSel) row.savedSize = sizeSel.value;
            if (colorInp) { row.savedColor = colorInp.value; row.savedColorHex = colorInp.dataset.hex || ''; }
            if (qtyInp) row.savedQty = qtyInp.value;
        });
    },

    renderItemRows() {
        const container = document.getElementById('eItemsList');
        if (!container) return;
        container.innerHTML = this.itemRows.map((row, idx) => `
            <div class="item-row-card" id="itemrow_${idx}">
                <!-- Row header: number + delete -->
                <div class="item-row-header">
                    <span class="item-row-num">${idx + 1}</span>
                    ${idx > 0 ? `<button class="btn-j btn-ruby btn-xs-j item-row-del" onclick="app.removeItemRow(${idx})">
                        <i class="fas fa-times"></i> حذف
                    </button>` : '<span></span>'}
                </div>
                <!-- Fields grid -->
                <div class="item-row-fields">
                    <!-- Product search -->
                    <div class="item-row-field item-row-product">
                        <label class="form-label-j">المنتج <span style="color:var(--ruby-light)">*</span></label>
                        <input type="text"
                               class="form-control-j ir-item"
                               data-idx="${idx}"
                               id="ir_item_inp_${idx}"
                               placeholder="ابحث عن منتج..."
                               autocomplete="off"
                               value="${row.savedItem || ''}"
                               oninput="app.onItemSearch(${idx}, this.value)"
                               onfocus="app.onItemSearch(${idx}, this.value)"
                               onblur="setTimeout(()=>app.closeItemDropdown(${idx}),200)">
                    </div>
                    <!-- Color -->
                    <div class="item-row-field item-row-color">
                        <label class="form-label-j">اللون</label>
                        <div style="display:flex;gap:4px;align-items:stretch">
                            <div id="ir_color_preview_${idx}"
                                onclick="app.openColorPicker(${idx},'ir_color')"
                                style="display:flex;align-items:center;gap:7px;flex:1;min-width:0;
                                       padding:.42rem .65rem;border-radius:10px;cursor:pointer;
                                       border:1.5px solid var(--border);background:var(--paper);
                                       transition:border-color .18s,box-shadow .18s;user-select:none"
                                onmouseenter="this.style.borderColor='var(--gold)'"
                                onmouseleave="this.style.borderColor='var(--border)'">
                                ${row.savedColorHex
                                    ? `<span style="width:18px;height:18px;border-radius:5px;background:${row.savedColorHex};border:1.5px solid rgba(0,0,0,.12);flex-shrink:0;display:inline-block"></span>
                                       <span style="font-size:.82rem;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${row.savedColor}</span>`
                                    : `<i class="fas fa-palette" style="color:var(--gold);font-size:.85rem"></i>
                                       <span style="font-size:.82rem;color:var(--ink-mid)">اختر اللون...</span>`
                                }
                            </div>
                            <input type="hidden" id="ir_color_${idx}" class="ir-color" data-idx="${idx}"
                                value="${row.savedColor || ''}" data-hex="${row.savedColorHex || ''}">
                            <button id="ir_color_btn_${idx}" class="btn-j btn-ghost btn-xs-j"
                                onclick="app.openColorPicker(${idx},'ir_color')" style="padding:.3rem .5rem;flex-shrink:0">
                                <i class="fas fa-palette" style="color:var(--gold)"></i>
                            </button>
                        </div>
                    </div>
                    <!-- Size -->
                    <div class="item-row-field item-row-size">
                        <label class="form-label-j">المقاس <span style="color:var(--ruby-light)">*</span></label>
                        <div class="select-wrapper">
                            <select class="form-control-j select-j ir-size" data-idx="${idx}">
                                <option value="">المقاس</option>
                            </select>
                        </div>
                        <!-- Stock below size - fixed height so it doesn't shift layout -->
                        <div class="ir-stock" data-idx="${idx}"></div>
                    </div>
                    <!-- Qty -->
                    <div class="item-row-field item-row-qty">
                        <label class="form-label-j">الكمية</label>
                        <div class="qty-control">
                            <button class="qty-btn" onclick="app.adjustRowQty(${idx},-1)">−</button>
                            <input type="number" class="form-control-j qty-input ir-qty" data-idx="${idx}" value="${row.savedQty || 1}" min="1">
                            <button class="qty-btn" onclick="app.adjustRowQty(${idx},1)">+</button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
        this.itemRows.forEach((row, idx) => { 
            if (row.savedItem) {
                this.loadRowColors(idx);
                // إعادة تعيين اللون المحفوظ
                const colorInp = document.getElementById(`ir_color_${idx}`);
                if (colorInp && row.savedColor) {
                    colorInp.value = row.savedColor;
                    colorInp.dataset.hex = row.savedColorHex || '';
                    colorInp.style.borderRight = `4px solid ${row.savedColorHex || 'var(--border)'}`;
                }
                // إعادة تعيين المقاس المحفوظ
                this.loadRowSizes(idx, row.savedSize, row.savedColor);
            } 
        });
    },
    onItemSearch(idx, val) {
        const inp = document.getElementById(`ir_item_inp_${idx}`);
        if (!inp) return;
        const existing = document.getElementById(`item_dd_${idx}`);
        if (existing) existing.remove();

        const q = val.trim().toLowerCase();
        const items = Object.entries(this.warehouse);
        const matches = q === '' ? items : items.filter(([, w]) => w.name.toLowerCase().includes(q));
        if (matches.length === 0) return;

        const rect = inp.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const ddHeight = Math.min(matches.length * 50, 220);
        const showAbove = spaceBelow < ddHeight + 20 && rect.top > ddHeight;

        const dd = document.createElement('div');
        dd.id = `item_dd_${idx}`;
        // detect dark mode
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const bg = isDark ? '#1a1a2e' : '#ffffff';
        const border = '1.5px solid #C9A84C';
        dd.style.cssText = `position:fixed;z-index:99999;background:${bg};border:${border};border-radius:10px;max-height:220px;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.55);width:${rect.width}px;left:${rect.left}px;${showAbove ? `bottom:${window.innerHeight - rect.top + 4}px` : `top:${rect.bottom + 4}px`}`;
        dd.innerHTML = matches.map(([id, w]) => {
            const colorDot = w.color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${this._colorHex(w.color)||'#ccc'};border:1px solid rgba(0,0,0,.2);vertical-align:middle;margin-left:5px;flex-shrink:0"></span>` : '';
            const total = Object.values(w.sizes || {}).reduce((a, b) => a + b, 0);
            const stockClr = total === 0 ? 'var(--ruby-light)' : total <= 3 ? '#f0a500' : 'var(--emerald)';
            return `<div onclick="app.selectItem(${idx},'${w.name.replace(/'/g,"\'")}','${id}')" style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);font-size:.88rem" onmouseenter="this.style.background='rgba(201,168,76,.12)'" onmouseleave="this.style.background=''">
                ${colorDot}<span style="flex:1;font-weight:700">${w.name}</span>
                <span style="font-size:.72rem;color:${stockClr};font-weight:700;background:${stockClr}18;padding:2px 7px;border-radius:10px">${total} قطعة</span>
            </div>`;
        }).join('');
        document.body.appendChild(dd);
    },

    selectItem(idx, name, id) {
        const inp = document.querySelector(`.ir-item[data-idx="${idx}"]`);
        const dd = document.getElementById(`item_dd_${idx}`);
        if (inp) inp.value = name;
        if (dd) dd.remove();
        this.loadRowColors(idx);
        // Auto-fill pageName in wizard state if item has a linked page
        const wItem = this.warehouse[id];
        if (wItem && wItem.pageName) {
            // Update wizard state
            if (this._wiz) this._wiz.pageName = wItem.pageName;
            // Also update hidden/select field if exists
            const pageSel = document.getElementById('ePageName') || document.getElementById('wiz_page');
            if (pageSel && wItem.pageName) pageSel.value = wItem.pageName;
        }
    },

    closeItemDropdown(idx) {
        const dd = document.getElementById(`item_dd_${idx}`);
        if (dd) dd.remove();
    },

        loadRowColors(idx) {
        const sel = document.querySelector(`.ir-item[data-idx="${idx}"]`);
        const colorInp = document.getElementById(`ir_color_${idx}`);
        const sizeSel = document.querySelector(`.ir-size[data-idx="${idx}"]`);
        const stockInfo = document.querySelector(`.ir-stock[data-idx="${idx}"]`);
        if (!sel || !colorInp) return;
        const itemName = sel.value.trim();
        const foundEntry = Object.entries(this.warehouse).find(([, w]) => w.name === itemName);
        const item = foundEntry ? foundEntry[1] : null;
        const pageSel = document.getElementById('ePageName');
        if (item && item.pageName && pageSel) pageSel.value = item.pageName;
        // reset
        colorInp.value = ''; colorInp.style.borderRight = '4px solid var(--border)'; colorInp.dataset.hex = '';
        if (sizeSel) { sizeSel.innerHTML = '<option value="">المقاس</option>'; }
        if (stockInfo) stockInfo.textContent = '';
      if (!item) return;
        // check if item has any colors with stock
        const colorSet = new Set();
        Object.entries(item.sizes || {}).forEach(([s, q]) => {
            if (q <= 0) return;
            let c = '';
            // المفتاح المركب "S - وردي" يحتوي اللون مباشرة
            if (s.includes(' - ')) c = s.split(' - ').slice(1).join(' - ');
            else if (item.variations?.[s]) c = item.variations[s].color;
            else if (item.sizeColors?.[s]) c = item.sizeColors[s];
            else c = item.color || '';
            if (c) colorSet.add(c);
        });
        if (colorSet.size === 0) {
            this.toast(`المنتج "${item.name}" لا يوجد له ألوان متوفرة في المستودع`, 'error');
            sel.value = '';
            return;
        }
        // collect unique colors that have stock
      
        // store on element for picker filtering
        colorInp.dataset.availableColors = JSON.stringify([...colorSet]);
        colorInp.dataset.itemIdx = idx;
    },
    loadRowSizes(idx, preselectSize, filterColor = null) {
        const sel = document.querySelector(`.ir-item[data-idx="${idx}"]`);
        const sizeSel = document.querySelector(`.ir-size[data-idx="${idx}"]`);
        const stockInfo = document.querySelector(`.ir-stock[data-idx="${idx}"]`);
        if (!sel || !sizeSel) return;
        const itemName = sel.value.trim();
        const foundEntry = Object.entries(this.warehouse).find(([id, w]) => w.name === itemName);
        const itemId = foundEntry ? foundEntry[0] : null;
        const item = foundEntry ? foundEntry[1] : null;
        const pageSel = document.getElementById('ePageName');
        if (item && item.pageName && pageSel) pageSel.value = item.pageName;
        sizeSel.innerHTML = '<option value="">المقاس</option>';
        if (!item) return;
        const colorToFilter = filterColor || document.getElementById(`ir_color_${idx}`)?.value || null;
        Object.entries(item.sizes || {}).forEach(([key, q]) => {
            // فصل المقاس واللون من المفتاح المركب
            let dispSize = key, keyColor = '';
            if (key.includes(' - ')) {
                dispSize = key.split(' - ')[0];
                keyColor = key.split(' - ').slice(1).join(' - ');
            } else if (item.variations?.[key]) keyColor = item.variations[key].color;
            else if (item.sizeColors?.[key]) keyColor = item.sizeColors[key];
            else keyColor = item.color || '';

            if (colorToFilter && keyColor !== colorToFilter) return;
            if (q > 0 || preselectSize === key)
                sizeSel.innerHTML += `<option value="${key}" data-qty="${q}" data-color="${keyColor}" ${preselectSize === key ? 'selected' : ''}>${dispSize} (${q})</option>`;
        });
        const showStock = () => {
            const opt = sizeSel.selectedOptions[0];
            const qty = opt?.dataset?.qty || 0;
            if (stockInfo) { stockInfo.textContent = qty > 0 ? `✓ متوفر: ${qty}` : '✗ نفد'; stockInfo.style.color = qty > 0 ? 'var(--emerald)' : 'var(--ruby-light)'; }
            const val = sizeSel.value;
            if (val && item) {
                let vColor = '', vHex = '';
                // أولوية: data-color من الـ option (مخزن مسبقاً) → variations → sizeColors → اللون العام
                const selOpt = sizeSel.selectedOptions[0];
                if (selOpt?.dataset?.color) { vColor = selOpt.dataset.color; vHex = this._colorHex(vColor) || ''; }
                else if (item.variations && item.variations[val]) { vColor = item.variations[val].color; vHex = item.variations[val].hex || this._colorHex(vColor); }
                else if (item.sizeColors?.[val]) { vColor = item.sizeColors[val]; vHex = this._colorHex(vColor) || ''; }
                else if (val.includes(' - ')) { vColor = val.split(' - ').slice(1).join(' - '); vHex = this._colorHex(vColor); }
                else if (item.color) { vColor = item.color; vHex = this._colorHex(vColor) || ''; }
                const cInp = document.getElementById(`ir_color_${idx}`);
                if (cInp && vColor) { cInp.value = vColor; cInp.dataset.hex = vHex || ''; cInp.style.borderRight = `4px solid ${vHex || 'var(--border)'}`; }
            }
        };
        sizeSel.onchange = showStock;
        if (preselectSize) showStock();
    },

    adjustRowQty(idx, delta) {
        const el = document.querySelector(`.ir-qty[data-idx="${idx}"]`);
        if (el) el.value = Math.max(1, (parseInt(el.value) || 1) + delta);
    },

    // ============ SAVE ORDER ============
    async saveOrder() {
        const custName = document.getElementById('eCustName').value.trim();
       const mob = document.getElementById('eCustMob').value.replace(/\D/g, '');
        const gov = document.getElementById('eGovernorate').value;
        const addr = document.getElementById('eAddr').value.trim();
        const price = parseFloat(document.getElementById('ePrice').value);
        const pageName = document.getElementById('ePageName').value;
        const entryUser = document.getElementById('eEntryUser').value;
        const tags = document.getElementById('eTags').value.trim();


        if (!custName) { this.toast('يرجى إدخال اسم الزبون', 'error'); return; }
       if (mob.length !== 8) { this.toast('رقم الموبايل يجب أن يكون 8 أرقام', 'error'); return; }
        if (!addr) { this.toast('يرجى إدخال العنوان', 'error'); return; }
        if (!pageName) { this.toast('اسم الصفحة إجباري', 'error'); return; }
      if (this.role === 'User') document.getElementById('eEntryUser').value = this.userName;
        const entryUserFinal = document.getElementById('eEntryUser').value;
        if (!entryUserFinal) { this.toast('اسم المدخل إجباري', 'error'); return; }
        if (!price || price <= 0) { this.toast('يرجى إدخال السعر', 'error'); return; }

        const items = [];
        const itemSelectors = document.querySelectorAll('.ir-item');
        for (let i = 0; i < itemSelectors.length; i++) {
            const itemNameInput = itemSelectors[i].value;
            const foundEntry = Object.entries(this.warehouse).find(([id, w]) => w.name === itemNameInput);
            const itemId = foundEntry ? foundEntry[0] : null;
            const item = foundEntry ? foundEntry[1] : null;

            // تعريف المتغيرات مرة واحدة فقط
            const sizeCombo = document.querySelector(`.ir-size[data-idx="${i}"]`)?.value;
            const color = document.getElementById(`ir_color_${i}`)?.value || '';
            const qty = parseInt(document.querySelector(`.ir-qty[data-idx="${i}"]`)?.value) || 1;

            // التحقق الصارم من وجود الثلاثي المرح
            if (!itemId || !sizeCombo || !color) {
                this.toast(`يرجى اختيار (المنتج + اللون + المقاس) للصف ${i + 1}`, 'error');
                return;
            }

            // التحقق من الكمية المتوفرة
            const avail = item.sizes?.[sizeCombo] || 0;
            if (qty > avail) {
                this.toast(`الكمية المطلوبة (${qty}) غير متوفرة لـ ${item.name}! المتوفر (${avail})`, 'error');
                return;
            }

            // بناء بيانات الصنف
            let finalSize = sizeCombo;
            let finalColor = color;
            if (sizeCombo.includes(' - ')) {
                finalSize = sizeCombo.split(' - ')[0];
                finalColor = sizeCombo.split(' - ')[1];
            }

            items.push({ itemId, itemName: item.name, itemColor: finalColor, size: finalSize, exactKey: sizeCombo, qty });
        }

        const payload = {
            timestamp: Date.now(), date: document.getElementById('eDate').value,
            custName, custMob: '07' + mob, country: 'الأردن', governorate: gov, custAddr: addr,
            itemId: items[0].itemId, itemName: items[0].itemName, itemColor: items[0].itemColor,
            size: items[0].size, exactKey: items[0].exactKey, qty: items[0].qty,
       items, price, currency: 'JOD', pageName, entryUser: entryUserFinal, tags, status: 'new'
        };

        const newRef = await push(ordersRef, payload);
        this.lastOrderId = newRef.key;
        this.log('create', newRef.key, `إنشاء طلب للزبون: ${custName} | صفحة: ${pageName}`);
        this.toast('تم حفظ الطلب بنجاح ✓', 'success');
        this.resetOrderForm();
        document.getElementById('lastOrderPrintBtn').style.display = 'block';
    },

    resetOrderForm() {
        ['eCustName', 'eCustMob', 'eAddr', 'eTags', 'ePrice', 'ePageNameCustom'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        const pageSel = document.getElementById('ePageName'); if (pageSel) pageSel.value = '';
        document.getElementById('eDupWarn').style.display = 'none';
        this.initItemRows();
    },

    printLastOrder() {
        if (this.lastOrderId && this.orders[this.lastOrderId])
            this.printOrder(this.orders[this.lastOrderId], this.lastOrderId);
    },

    // ============ DASHBOARD ============
    renderDashboard() {
        const orders = Object.values(this.orders);
        const counts = { new: 0, process: 0, done: 0, delivered: 0, postponed: 0, canceled: 0 };
        let totalRev = 0, totalCost = 0;
        const itemSales = {};
        orders.forEach(o => {
            counts[o.status]++;
            if (o.status === 'delivered') {
                totalRev += parseFloat(o.price || 0);
                // حساب التكلفة من كل أصناف الطلب وليس الصنف الأول فقط
                const itemsList = o.items || [{ itemId: o.itemId, qty: o.qty }];
                itemsList.forEach(it => {
                    const wItem = this.warehouse[it.itemId];
                    if (wItem) totalCost += parseFloat(wItem.buyPrice || 0) * (parseInt(it.qty) || 1);
                });
            }
            if (o.status !== 'canceled') itemSales[o.itemName] = (itemSales[o.itemName] || 0) + (o.qty || 1);
        });
        const totalStock = Object.values(this.warehouse).reduce((s, w) => s + Object.values(w.sizes || {}).reduce((a, b) => a + b, 0), 0);

        const kpis = [
            { label: 'إجمالي الطلبات', value: orders.length, icon: 'fa-boxes', cls: 'kpi-gold' },
            { label: 'جديدة', value: counts.new, icon: 'fa-star', cls: 'kpi-sapphire' },
            { label: 'جاهزة للتسليم', value: counts.done, icon: 'fa-box', cls: 'kpi-emerald' },
            { label: 'تم التسليم', value: counts.delivered, icon: 'fa-check-double', cls: 'kpi-amethyst' },
            { label: 'إجمالي الإيرادات', value: totalRev.toFixed(2) + ' JOD', icon: 'fa-money-bill-wave', cls: 'kpi-emerald', small: true },
            { label: 'إجمالي المستودع', value: totalStock + ' قطعة', icon: 'fa-warehouse', cls: 'kpi-onyx' },
        ];
        document.getElementById('kpiGrid').innerHTML = kpis.map(k => `
            <div class="kpi-card ${k.cls}">
                <i class="fas ${k.icon} kpi-icon"></i>
                <div class="kpi-label">${k.label}</div>
                <div class="kpi-value" style="${k.small ? 'font-size:1.3rem' : ''}">${k.value}</div>
            </div>`).join('');

        if (this.charts.status) this.charts.status.destroy();
        const isDark = this.isDark;
        Chart.defaults.color = isDark ? '#aaa' : '#666';
        this.charts.status = new Chart(document.getElementById('statusChart'), {
            type: 'doughnut',
            data: { labels: Object.values(STATUS_AR), datasets: [{ data: Object.values(counts), backgroundColor: Object.values(STATUS_COLORS), borderWidth: 0 }] },
            options: { cutout: '72%', plugins: { legend: { position: 'bottom', labels: { font: { family: 'Almarai' } } } } }
        });

        if (this.charts.items) this.charts.items.destroy();
        const topItems = Object.entries(itemSales).sort((a, b) => b[1] - a[1]).slice(0, 6);
        this.charts.items = new Chart(document.getElementById('itemChart'), {
            type: 'bar',
            data: { labels: topItems.map(i => i[0]), datasets: [{ label: 'المبيعات', data: topItems.map(i => i[1]), backgroundColor: '#C9A84C', borderRadius: 8 }] },
            options: { scales: { x: { grid: { display: false } }, y: { grid: { color: isDark ? '#333' : '#eee' } } }, plugins: { legend: { display: false } } }
        });

        const alerts = [];
        Object.values(this.warehouse).forEach(w => {
            const total = Object.values(w.sizes || {}).reduce((a, b) => a + b, 0);
            if (total < STOCK_ALERT_THRESHOLD) alerts.push({ name: w.name, qty: total, color: w.color });
        });
        const alertsEl = document.getElementById('stockAlerts');
        if (alertsEl) {
            alertsEl.innerHTML = alerts.length === 0
                ? `<div style="color:var(--emerald);font-weight:700;text-align:center;padding:2rem;"><i class="fas fa-check-circle fa-2x mb-2 d-block"></i>المستودع بحالة جيدة</div>`
                : alerts.map(a => `
                    <div class="stock-alert">
                        <i class="fas fa-exclamation-triangle" style="color:var(--ruby-light);font-size:1.3rem;flex-shrink:0"></i>
                        <div><div style="font-weight:800;font-size:.9rem">${a.name}</div>
                        <div style="font-size:.78rem;color:var(--ruby-light)">المتبقي: ${a.qty} قطعة</div></div>
                    </div>`).join('');
        }

        const userRanking = document.getElementById('entryUserRanking');
        if (userRanking) {
            const userCounts = {};
            orders.forEach(o => { if (o.entryUser) userCounts[o.entryUser] = (userCounts[o.entryUser] || 0) + 1; });
            const sorted = Object.entries(userCounts).sort((a, b) => b[1] - a[1]);
            const max = sorted[0]?.[1] || 1;
            const medals = ['🥇', '🥈', '🥉'];
            userRanking.innerHTML = sorted.length === 0
                ? `<div style="color:var(--ink-mid);text-align:center;padding:1rem">لا توجد بيانات بعد</div>`
                : sorted.map(([name, count], i) => `
                    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
                        <span style="font-size:1.3rem;flex-shrink:0;width:28px">${medals[i] || ''}</span>
                        <div style="flex:1">
                            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                                <span style="font-weight:700;font-size:.9rem">${name}</span>
                                <span style="font-weight:800;color:var(--gold)">${count} طلب</span>
                            </div>
                            <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
                                <div style="height:100%;width:${Math.round(count / max * 100)}%;background:linear-gradient(90deg,var(--gold),var(--gold-dark));border-radius:4px"></div>
                            </div>
                        </div>
                    </div>`).join('');
        }
    },

    // ============ ORDERS BOARD ============
    renderBoard() {
        const q = (document.getElementById('ordersSearch')?.value || '').toLowerCase();
        const cols = { new: [], process: [], done: [], delivered: [], postponed: [], canceled: [] };
        const sums = {}; Object.keys(cols).forEach(s => sums[s] = 0);
        Object.entries(this.orders).forEach(([id, o]) => {
            if (q && !JSON.stringify(o).toLowerCase().includes(q)) return;
            if (cols[o.status] !== undefined) { cols[o.status].push({ id, ...o }); sums[o.status] += parseFloat(o.price || 0); }
        });
        document.getElementById('boardContainer').innerHTML = Object.entries(cols).map(([status, orders]) => {
            const allSelected = orders.length > 0 && orders.every(o => this.selectedKb.has(o.id));
            return `
            <div class="kanban-section${status === 'new' ? ' open' : ''}" id="kb-${status}">
                <div class="kanban-header" onclick="app.toggleKb('${status}')">
                    <input type="checkbox" class="check-j me-2" 
                        onclick="event.stopPropagation(); app.toggleKbGroup('${status}', this.checked)" 
                        ${allSelected ? 'checked' : ''} title="تحديد الكل في هذه الحالة">
                    <div class="kanban-dot" style="background:${STATUS_COLORS[status]}"></div>
                    <div class="kanban-title">${STATUS_AR[status]}</div>
                    <div class="kanban-count" style="background:${STATUS_COLORS[status]}15;color:${STATUS_COLORS[status]}">${orders.length}</div>
                    <div class="kanban-sum">${sums[status].toFixed(2)} JOD</div>
                    <i class="fas fa-chevron-left kanban-chevron"></i>
                </div>
                <div class="kanban-body${status === 'new' ? ' open' : ''}">
                    ${orders.length === 0
                    ? `<div style="color:var(--ink-mid);font-size:.85rem;padding:1rem;text-align:center;grid-column:1/-1"><i class="fas fa-inbox" style="font-size:2rem;opacity:.3;display:block;margin-bottom:.5rem"></i>لا توجد طلبات</div>`
                    : orders.map(o => this.mkOrderCard(o)).join('')}
                </div>
            </div>`;
        }).join('');
    },

    toggleKb(status) {
        const sec = document.getElementById('kb-' + status);
        sec.classList.toggle('open');
        sec.querySelector('.kanban-body').classList.toggle('open');
    },
    toggleKbGroup(status, isChecked) {
        Object.entries(this.orders).forEach(([id, o]) => {
            if (o.status === status) {
                if (isChecked) this.selectedKb.add(id);
                else this.selectedKb.delete(id);
            }
        });
        this.renderBoard();
        this.updateKbBulkPanel();
    },
    mkOrderCard(o) {
        const isChecked = this.selectedKb.has(o.id) ? 'checked' : '';
        // إنشاء قائمة الأصناف الصغيرة داخل الكرت
        // جلب الأصناف سواء كانت قائمة جديدة أو صنف واحد قديم لضمان العرض دائماً
        const displayItems = o.items || [{ itemName: o.itemName, size: o.size, itemColor: o.itemColor, qty: o.qty }];
        const itemsSummary = displayItems.map(it => `
        <div style="font-size:.7rem; color:var(--ink-mid); border-bottom:1px dashed var(--border); padding:2px 0;">
            • ${it.itemName || 'صنف'} <span style="color:var(--gold-dark)">(${it.size || '-'})</span> ${it.qty > 1 ? `x${it.qty}` : ''}
        </div>
    `).join('');

        return `<div class="order-card-j status-${o.status}" onclick="app.openOrderModal('${o.id}')">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.6rem">
            <input type="checkbox" class="check-j" onclick="event.stopPropagation();app.toggleKbSelect('${o.id}')" ${isChecked}>
            <span style="font-size:.72rem;color:var(--ink-mid)">${o.pageName || ''}</span>
        </div>
        <div class="order-card-customer">${o.custName}</div>
        <div class="order-card-meta"><i class="fas fa-phone-alt" style="color:var(--gold);margin-left:4px"></i>${o.custMob}</div>
        
        <!-- عرض قائمة الأصناف الموحد -->
        <div style="margin: 8px 0; max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.02); padding: 6px; border-radius: 8px; border: 1px solid var(--border);">
            ${itemsSummary}
        </div>

<div style="display:flex;justify-content:space-between;align-items:center;margin-top:.7rem;padding-top:.7rem;border-top:1px solid var(--border)">
            <span style="font-weight:800;color:var(--emerald)">${o.price || 0} JOD</span>
            <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:.72rem;color:var(--ink-mid)">${o.date || ''}</span>
                <button class="btn-j btn-emerald btn-xs-j" onclick="event.stopPropagation();app.openWhatsApp('${o.id}')" title="واتساب" style="padding:.2rem .45rem"><i class="fab fa-whatsapp"></i></button>
            </div>
        </div>
    </div>`;
    },

    toggleKbSelect(id) {
        if (this.selectedKb.has(id)) this.selectedKb.delete(id); else this.selectedKb.add(id);
        this.updateKbBulkPanel();
    },
    updateKbBulkPanel() {
        document.getElementById('kbBulkPanel').classList.toggle('show', this.selectedKb.size > 0);
        document.getElementById('kbBulkCount').textContent = this.selectedKb.size;
    },
    async kbBulkStatus(s) {
        const upd = {};
        this.selectedKb.forEach(id => { upd[`jawaher_orders/${id}/status`] = s; });
        await update(ref(db), upd);
        // خصم أو إرجاع المخزون بعد التحديث
        for (const id of this.selectedKb) {
            if (s === 'delivered') await this.deductStock(id);
            if (s === 'canceled' || s === 'postponed') await this._returnStock(id);
        }
        this.selectedKb.clear(); this.updateKbBulkPanel();
        this.toast('تم تحديث الحالة', 'success');
    },
    kbBulkPrint() { this.executePrint([...this.selectedKb]); this.selectedKb.clear(); this.updateKbBulkPanel(); },

    // ============ ORDER MODAL ============
    openOrderModal(id) {
        this.modalOrderId = id;
        const o = this.orders[id];
        if (!o) return;
        const isRO = this.role !== 'Admin';
        const dis = isRO ? 'disabled' : '';
        const wLink = `https://wa.me/${o.custMob.replace('+', '')}`;

        document.getElementById('orderModalTitle').textContent = `طلب #${id.slice(-6)}`;
        document.getElementById('orderModalContent').innerHTML = `
            <div class="row g-3">
                <div class="col-6"><label class="form-label-j">الزبون</label><input id="mo_name" class="form-control-j" value="${o.custName}" ${dis}></div>
                <div class="col-6"><label class="form-label-j">الموبايل</label>
                    <div style="display:flex;gap:4px">
                        <input id="mo_mob" class="form-control-j" value="${o.custMob}" dir="ltr" style="text-align:left" ${dis}>
                        <a href="${wLink}" target="_blank" class="btn-j btn-emerald btn-sm-j"><i class="fab fa-whatsapp"></i></a>
                    </div>
                </div>
                <div class="col-12"><label class="form-label-j">العنوان</label><input id="mo_addr" class="form-control-j" value="${o.custAddr || ''}" ${dis}></div>
              <!-- قسم عرض الأصناف المتعددة -->
<div class="col-12">
    <label class="form-label-j"><i class="fas fa-shopping-basket"></i> الأصناف المطلوبة</label>
  <div class="items-display-list" style="background: var(--paper-warm); border-radius: 10px; padding: 10px; border: 1px solid var(--border);">
     ${(o.items || [{ itemName: o.itemName, size: o.size, itemColor: o.itemColor, qty: o.qty }]).map((item, idx) => `
            <div class=\"item-row-view\" id=\"mo_item_${idx}\" style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);\">
                <div style=\"display:flex;flex-direction:column;\">
                    <span style=\"font-weight:800;font-size:.9rem;\">${item.itemName || 'صنف غير معروف'}</span>
                    <span style=\"font-size:.75rem;color:var(--gold-dark);\">مقاس: ${item.size || '-'}</span>
                </div>
                <div style=\"display:flex;align-items:center;gap:8px;\">
                    <span style=\"font-size:.8rem;border-right:4px solid ${this._colorHex(item.itemColor)};padding-right:6px;\">${item.itemColor || 'بدون لون'}</span>
                    ${isRO ? `<span style=\"font-weight:700;color:var(--emerald);background:rgba(26,107,74,.1);padding:2px 8px;border-radius:5px;\">x${item.qty||1}</span>` : `
                    <div class=\"qty-control\" style=\"transform:scale(.82);transform-origin:right\">
                        <button class=\"qty-btn\" onclick=\"app._moAdjQty(${idx},-1)\">−</button>
                        <input type=\"number\" id=\"mo_qty_${idx}\" class=\"form-control-j qty-input\" value=\"${item.qty||1}\" min=\"1\" style=\"width:40px\">
                        <button class=\"qty-btn\" onclick=\"app._moAdjQty(${idx},1)\">+</button>
                    </div>
                    <button class=\"btn-j btn-ruby btn-xs-j\" onclick=\"app._moRemoveItem('${id}',${idx})\" title=\"حذف الصنف\"><i class=\"fas fa-times\"></i></button>`}
                </div>
            </div>
        `).join('')}
    </div>
<!-- السعر الإجمالي يبقى كما هو -->
<div class="col-12 mt-2">
    <label class="form-label-j">إجمالي السعر</label>
    <input type="number" id="mo_price" class="form-control-j" value="${o.price || ''}" ${dis}>
</div>
                <div class="col-6"><label class="form-label-j">الكمية</label><input type="number" id="mo_qty" class="form-control-j" value="${o.qty || 1}" ${dis}></div>
                <div class="col-6"><label class="form-label-j">الملاحظات</label><input id="mo_tags" class="form-control-j" value="${o.tags || ''}" ${dis}></div>
                <div class="col-12">
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:.5rem">
                        <div style="text-align:center;background:var(--paper-warm);border-radius:10px;padding:.6rem"><div style="font-size:.7rem;color:var(--ink-mid)">الحالة</div><div style="font-weight:800;font-size:.9rem">${STATUS_AR[o.status] || ''}</div></div>
                        <div style="text-align:center;background:var(--paper-warm);border-radius:10px;padding:.6rem"><div style="font-size:.7rem;color:var(--ink-mid)">المدخل</div><div style="font-weight:800;font-size:.9rem">${o.entryUser || ''}</div></div>
                        <div style="text-align:center;background:var(--paper-warm);border-radius:10px;padding:.6rem"><div style="font-size:.7rem;color:var(--ink-mid)">التاريخ</div><div style="font-weight:800;font-size:.9rem">${o.date || ''}</div></div>
                    </div>
                </div>
                ${this.role === 'Admin' ? `
                <div class="col-12">
                    <label class="form-label-j">نقل إلى مرحلة</label>
                    <div style="display:flex;flex-wrap:wrap;gap:.5rem">
                        ${Object.entries(STATUS_AR).map(([k, v]) => `<button class="btn-j btn-ghost btn-xs-j" onclick="app.moveOrder('${id}','${k}')">${v}</button>`).join('')}
                    </div>
                </div>` : ''}
            </div>`;

        document.getElementById('modalUpdateBtn').style.display = isRO ? 'none' : '';
        document.getElementById('modalDeleteBtn').onclick = () => this.deleteOrder(id);
        document.getElementById('modalPrintBtn').onclick = () => { this.printOrder(o, id); this.closeModal('orderModal'); };
        this.openModal('orderModal');
    },

async updateOrder() {
        const id = this.modalOrderId; if (!id) return;
        const o = this.orders[id];
        try {
            const payload = {
                custName: document.getElementById('mo_name').value.trim(),
                custMob: document.getElementById('mo_mob').value.trim(),
                custAddr: document.getElementById('mo_addr').value.trim(),
                price: parseFloat(document.getElementById('mo_price').value) || 0,
                tags: document.getElementById('mo_tags').value.trim(),
            };
            if (o.items) {
                payload.items = o.items.map((it, idx) => {
                    const el = document.getElementById(`mo_qty_${idx}`);
                    return el ? { ...it, qty: parseInt(el.value)||it.qty } : it;
                });
                payload.qty = payload.items.reduce((s, it) => s + (it.qty||1), 0);
            }
            await update(ref(db, `jawaher_orders/${id}`), payload);
            this.log('edit', id, 'تعديل بيانات الطلب');
            this._auditLog('order_edit', id, o, payload, `تعديل طلب ${o.custName}`);
            this.toast('تم حفظ التعديلات بنجاح ✓', 'success');
            this.closeModal('orderModal');
        } catch (err) {
            console.error(err);
            this.toast('حدث خطأ أثناء التحديث', 'error');
        }
    },

    _moAdjQty(idx, delta) {
        const el = document.getElementById(`mo_qty_${idx}`);
        if (el) el.value = Math.max(1, (parseInt(el.value)||1) + delta);
    },

  async _moRemoveItem(orderId, idx) {
        const o = this.orders[orderId];
        if (!o?.items || o.items.length <= 1) { this.toast('لا يمكن حذف الصنف الوحيد', 'error'); return; }
        if (!confirm('حذف هذا الصنف من الطلب؟')) return;

        const itemToRemove = o.items[idx];
        const newItems = o.items.filter((_, i) => i !== idx);
        const updates = {};

        // 1. تحديث بيانات الطلب (الأصناف والكمية الإجمالية)
        updates[`jawaher_orders/${orderId}/items`] = newItems;
        updates[`jawaher_orders/${orderId}/qty`] = newItems.reduce((s, it) => s + (it.qty || 1), 0);

        // 2. إرجاع المخزون إذا كان الطلب مسلماً أو مخصوماً مسبقاً
        if (o.stockDeducted || o.status === 'done' || o.status === 'delivered') {
            const wItem = this.warehouse[itemToRemove.itemId];
            if (wItem) {
                let keyToReturn = itemToRemove.exactKey || itemToRemove.size;
                
                // البحث عن المفتاح الصحيح إذا كان مسجلاً بصيغة (المقاس - اللون)
                if (wItem.sizes && wItem.sizes[keyToReturn] === undefined && itemToRemove.itemColor) {
                    if (wItem.sizes[`${itemToRemove.size} - ${itemToRemove.itemColor}`] !== undefined) {
                        keyToReturn = `${itemToRemove.size} - ${itemToRemove.itemColor}`;
                    }
                }
                
                const currentStock = wItem.sizes?.[keyToReturn] || 0;
                const qtyToReturn = parseInt(itemToRemove.qty) || 1;
                
                updates[`jawaher_warehouse/${itemToRemove.itemId}/sizes/${keyToReturn}`] = currentStock + qtyToReturn;
                this.log('stock_return', orderId, `إرجاع ${qtyToReturn} قطعة من ${wItem.name} بسبب حذف صنف من طلب مخصوم`);
            }
        }

        // تنفيذ جميع التحديثات دفعة واحدة
        await update(ref(db), updates);
        
        this.log('edit', orderId, `حذف صنف idx:${idx} من الطلب`);
        this.toast('تم حذف الصنف (وإرجاع الكمية للمستودع إن لزم الأمر) ✓', 'success');
        this.openOrderModal(orderId);
    },
        async moveOrder(id, status) {
        const before = { status: this.orders[id]?.status };
        await update(ref(db, `jawaher_orders/${id}`), { status });
        if (status === 'delivered') await this.deductStock(id);
        if (status === 'canceled' || status === 'postponed') await this._returnStock(id);
        this.log('status', id, `تغيير الحالة إلى ${STATUS_AR[status]}`);
        this._auditLog('order_edit', id, before, { status }, `تغيير حالة الطلب: ${STATUS_AR[before.status]} ← ${STATUS_AR[status]}`);
        this.toast('تم تغيير المرحلة', 'success'); this.closeModal('orderModal');
    },

    async deleteOrder(id) {
        if (!confirm('حذف الطلب نهائياً؟')) return;
        const o = this.orders[id];
        const updates = {};
        // إرجاع المخزون إذا كان الطلب مخصوماً مسبقاً
        if (o && o.stockDeducted) {
            const itemsToReturn = o.items || [{ itemId: o.itemId, size: o.exactKey || o.size, exactKey: o.exactKey, itemColor: o.itemColor, qty: o.qty }];
            for (const it of itemsToReturn) {
                if (!it.itemId) continue;
                const wItem = this.warehouse[it.itemId]; if (!wItem) continue;
                let key = it.exactKey || it.size;
                if (wItem.sizes && wItem.sizes[key] === undefined && it.itemColor) {
                    if (wItem.sizes[`${it.size} - ${it.itemColor}`] !== undefined) key = `${it.size} - ${it.itemColor}`;
                }
                const current = wItem.sizes?.[key] || 0;
                updates[`jawaher_warehouse/${it.itemId}/sizes/${key}`] = current + (parseInt(it.qty) || 1);
            }
        }
        await remove(ref(db, `jawaher_orders/${id}`));
        if (Object.keys(updates).length > 0) await update(ref(db), updates);
        this.log('delete', id, `حذف الطلب${o?.stockDeducted ? ' (تم إرجاع المخزون)' : ''}`);
        this._auditLog('order_delete', id, o, null, `حذف طلب ${o?.custName || ''} | السعر: ${o?.price || 0} JOD`);
        this.toast('تم الحذف' + (o?.stockDeducted ? ' وإرجاع الكمية للمستودع' : ''), 'success');
        this.closeModal('orderModal');
    },

    // ============ STOCK DEDUCTION ============
async deductStock(orderId) {
        const o = this.orders[orderId]; if (!o) return;
        
        // الحماية: إذا تم خصم مخزون هذا الطلب مسبقاً، لا تقم بالخصم مرة أخرى
        if (o.stockDeducted) return; 

        const itemsToDeduct = o.items || [{ itemId: o.itemId, size: o.exactKey || o.size, exactKey: o.exactKey, itemColor: o.itemColor, qty: o.qty }];
        const updates = {};
        
        for (const it of itemsToDeduct) {
            if (!it.itemId) continue;
            const item = this.warehouse[it.itemId]; if (!item) continue;
            let keyToDeduct = it.exactKey || it.size;
            if (item.sizes && item.sizes[keyToDeduct] === undefined && it.itemColor) {
                if (item.sizes[`${it.size} - ${it.itemColor}`] !== undefined) keyToDeduct = `${it.size} - ${it.itemColor}`;
            }
            const current = item.sizes?.[keyToDeduct] || 0;
            const qty = parseInt(it.qty) || 1;
            updates[`jawaher_warehouse/${it.itemId}/sizes/${keyToDeduct}`] = Math.max(0, current - qty);
            this.log('stock', orderId, `خصم ${qty} قطعة من ${item.name} مقاس/لون ${keyToDeduct}`);
        }
        
        if (Object.keys(updates).length > 0) {
            // وضع علامة أنه تم الخصم لتجنب الخصم المزدوج
            updates[`jawaher_orders/${orderId}/stockDeducted`] = true; 
            await update(ref(db), updates);
        }
    },


    // ── إرجاع المخزون عند الإلغاء أو التأجيل ──────────────
    async _returnStock(orderId) {
        const o = this.orders[orderId]; if (!o) return;
        if (!o.stockDeducted) return;
        const itemsToReturn = o.items || [{ itemId: o.itemId, size: o.exactKey || o.size, exactKey: o.exactKey, itemColor: o.itemColor, qty: o.qty }];
        const updates = {};
        for (const it of itemsToReturn) {
            if (!it.itemId) continue;
            const item = this.warehouse[it.itemId]; if (!item) continue;
            let key = it.exactKey || it.size;
            if (item.sizes && item.sizes[key] === undefined && it.itemColor) {
                if (item.sizes[`${it.size} - ${it.itemColor}`] !== undefined) key = `${it.size} - ${it.itemColor}`;
            }
            const current = item.sizes?.[key] || 0;
            const qty = parseInt(it.qty) || 1;
            updates[`jawaher_warehouse/${it.itemId}/sizes/${key}`] = current + qty;
            this.log('stock', orderId, `إرجاع ${qty} قطعة لـ ${item.name} مقاس/لون ${key}`);
        }
        if (Object.keys(updates).length > 0) {
            updates[`jawaher_orders/${orderId}/stockDeducted`] = false;
            await update(ref(db), updates);
        }
    },

    // ============ PRINT ============
      printOrder(o, id) {
        const win = window.open('', '_blank');
        win.document.write(this._buildLabelHTML([{ id, o }]));
        win.document.close();
        update(ref(db, `jawaher_orders/${id}`), { status: 'done' });
        this.deductStock(id);
    },

    executePrint(ids) {
        const win    = window.open('', '_blank');
        const labels = ids.map(id => ({ id, o: this.orders[id] })).filter(x => x.o);
        win.document.write(this._buildLabelHTML(labels, true));
        win.document.close();
        const updates = {};
        setTimeout(() => {
            labels.forEach(({ id }) => { updates[`jawaher_orders/${id}/status`] = 'done'; });
            update(ref(db), updates).then(() => { labels.forEach(({ id }) => this.deductStock(id)); });
        }, 1500);
        this.toast('تمت الطباعة وتحويل الحالة إلى جاهزة', 'success');
    },

    _buildLabelHTML(labels, multi = false) {
        // ─────────────────────────────────────────────────────────
        // كل ملصق = صفحة مستقلة 10×10 سم.
        // المشكلة السابقة: window.print() يُطبع قبل رسم الباركودات
        // الحل: نجمع كل JS في مصفوفة، ننفذها بالتسلسل، ثم نطبع.
        // ─────────────────────────────────────────────────────────
        const labelsData = labels.map(({ id, o }, idx) => {
            if (!o) return null;
            const pageNamesSet = new Set();
            if (o.pageName) pageNamesSet.add(o.pageName);
            (o.items || []).forEach(it => {
                const w = this.warehouse[it.itemId];
                if (w?.pageName) pageNamesSet.add(w.pageName);
            });
            const pageHeader = pageNamesSet.size > 0
                ? Array.from(pageNamesSet).join(' & ')
                : 'شادي ملكاوي';
            const items = o.items || [{
                itemName: o.itemName, itemColor: o.itemColor,
                size: o.size, qty: o.qty
            }];
            const bcId  = `bc${idx}`;
            const bcVal = id.slice(-12).toUpperCase();

            let sellPrice = '';
            for (const it of items) {
                const w = this.warehouse[it.itemId];
                if (w?.sellPrice) { sellPrice = w.sellPrice; break; }
            }

            const ICONS = {
                'واتس اب' : `<svg width="10" height="10" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.557 4.126 1.526 5.858L.057 23.888a.5.5 0 0 0 .617.6l6.162-1.615A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.694-.528-5.217-1.446l-.374-.224-3.878 1.016 1.033-3.772-.244-.389A9.952 9.952 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>واتس`,
                'انستا'   : `<svg width="10" height="10" viewBox="0 0 24 24"><path fill="#d6249f" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069z"/></svg>انستا`,
                'فيس بوك': `<svg width="10" height="10" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>فيسبوك`,
            };
            const contactHtml = ICONS[o.contactChannel]
                ? `<span style="display:inline-flex;align-items:center;gap:1px;font-size:5.5pt;font-weight:700">${ICONS[o.contactChannel]}</span>`
                : '';

            const weightHtml = (o.weightKg || o.lengthCm)
                ? `<div style="font-size:4.5pt;color:#555;margin-top:1px">${o.weightKg?`⚖${o.weightKg}kg `:``}${o.lengthCm?`📏${o.lengthCm}cm`:``}</div>`
                : '';

            const itemNames  = items.map(it => it.itemName  || '').filter(Boolean).join(' ، ');
            const itemColors = items.map(it => it.itemColor || '').filter(Boolean).join('، ') || '—';
            const itemSizes  = items.map(it => it.size      || '').filter(Boolean).join('، ') || '—';

            const html = `<div class="lp">
  <div class="li">
    <div class="lh">
      <div class="lpn">◆ ${pageHeader} ◆</div>
      <div class="lsh"><span>📞 077 65 01 333</span><span>👤 ${o.entryUser || ''}</span></div>
    </div>
    <div class="lb">
      <div class="lc lcr">
        <div class="lf"><div class="lfl">اسم الزبون</div><div class="lfv lname">${o.custName || ''}</div></div>
        <div class="lf lfsm"><div class="lfl">التواصل</div><div class="lfv">${contactHtml || '—'}</div></div>
        <div class="lf"><div class="lfl">الصنف</div><div class="lfv litem">${itemNames}</div></div>
        <div class="lf lfsm"><div class="lfl">اللون</div><div class="lfv">${itemColors}</div></div>
        <div class="lf lfsm"><div class="lfl">المقاس</div><div class="lfv">${itemSizes}</div></div>
        ${sellPrice ? `<div class="lf lfsm"><div class="lfl">سعر القطعة</div><div class="lfv" style="color:#1A6B4A;font-weight:800">${sellPrice} JOD</div></div>` : ''}
        ${weightHtml}
      </div>
      <div class="lc lcl">
        <div class="lf"><div class="lfl">عنوان الزبون</div><div class="lfv laddr">${o.governorate ? o.governorate + ' - ' : ''}${o.custAddr || '—'}</div></div>
        <div class="lf"><div class="lfl">رقم الهاتف</div><div class="lfv lphone" dir="ltr">${o.custMob || ''}</div></div>
        <div class="lf lprice-box"><div class="lfl" style="color:#1A6B4A">القيمة شامل</div><div class="lfv lprice">${o.price || 0} JOD</div></div>
        <div class="lf" style="flex:1;overflow:hidden"><div class="lfl">ملاحظات</div><div class="lfv lnotes">${o.tags || ''}</div></div>
        <div class="lwarn">⚠ يُمنع فتح الطرد</div>
      </div>
    </div>
    <div class="lbc"><svg id="${bcId}"></svg>${sellPrice ? `<div class="lbc-price">${sellPrice} JOD</div>` : ''}</div>
  </div>
</div>`;
            return { html, bcId, bcVal };
        }).filter(Boolean);

        const labelsHtml = labelsData.map(d => d.html).join('\n');

        // كل باركود يُرسم بشكل متسلسل لضمان اكتمالهم جميعاً قبل الطباعة
        const bcArray = JSON.stringify(labelsData.map(d => ({ id: d.bcId, val: d.bcVal })));

        const css = `
@page { size: 10cm 10cm; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: 10cm; background: #fff; font-family: 'Almarai', Arial, sans-serif }
body { margin: 0 }
@media print {
  html, body { width: 10cm }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .lp { page-break-after: always; page-break-inside: avoid }
  .lp:last-child { page-break-after: auto }
}
.lp  { width:10cm; height:10cm; display:flex; align-items:stretch; padding:2.5mm; overflow:hidden }
.li  { width:100%; display:flex; flex-direction:column; border:2px solid #1A3A8F; border-radius:5px; overflow:hidden }
.lh  { background:#0F2260; color:#fff; padding:3px 6px; border-bottom:1.5px solid #1A3A8F; flex-shrink:0 }
.lpn { font-size:10pt; font-weight:800; color:#7AA0F0; text-align:center; letter-spacing:.4px }
.lsh { display:flex; justify-content:center; gap:8px; font-size:6pt; color:#aabde0; margin-top:1px }
.lb  { flex:1; display:grid; grid-template-columns:1fr 1fr; overflow:hidden; min-height:0 }
.lc  { display:flex; flex-direction:column; gap:1.5px; padding:3px; overflow:hidden; min-width:0 }
.lcr { border-left:1px solid #ccd }
.lf  { background:#f4f6ff; border:1px solid #dde; border-radius:3px; padding:2px 4px; overflow:hidden; flex-shrink:1 }
.lfsm { flex-shrink:0 }
.lfl  { font-size:5.5pt; color:#555; font-weight:700; line-height:1.2 }
.lfv  { font-size:7pt; font-weight:700; color:#111; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.lname  { font-size:9pt;   font-weight:800; white-space:normal; line-height:1.15 }
.litem  { font-size:7.5pt; font-weight:800; white-space:normal; line-height:1.15 }
.laddr  { font-size:6.5pt; white-space:normal; line-height:1.2 }
.lphone { font-size:9.5pt; font-weight:800; text-align:right }
.lprice-box { background:#e6f4ed !important; border-color:#1A6B4A !important; flex-shrink:0 }
.lprice { font-size:11pt; font-weight:800; color:#1A6B4A }
.lnotes { font-size:6pt; white-space:normal; line-height:1.2 }
.lwarn  { background:#FFF0F0; border:1.5px solid #C02525; border-radius:3px; padding:2px 4px; font-size:6.5pt; font-weight:800; color:#C02525; text-align:center; flex-shrink:0; margin-top:auto }
.lbc    { text-align:center; padding:1px 4px 2px; border-top:1px solid #dde; flex-shrink:0; background:#fff; display:flex; align-items:center; justify-content:center; gap:6px }
.lbc svg { max-width:100%; height:auto !important }
.lbc-price { font-size:9pt; font-weight:800; color:#1A6B4A; white-space:nowrap; border:1.5px solid #1A6B4A; border-radius:4px; padding:1px 6px; background:#e6f4ed }`;

        // الطباعة: نرسم كل الباركودات أولاً ثم نطبع بعد تأخير كافٍ
        return `<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="UTF-8">
<title>ملصقات الطباعة</title>
<link href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"><\/script>
<style>${css}</style>
</head><body>
${labelsHtml}
<script>
(function () {
  var barcodes = ${bcArray};
  function drawAll() {
    for (var i = 0; i < barcodes.length; i++) {
      try {
        JsBarcode('#' + barcodes[i].id, barcodes[i].val, {
          format: 'CODE128', width: 1.3, height: 26,
          displayValue: true, fontSize: 9, margin: 2, background: 'transparent'
        });
      } catch(e) { console.warn('barcode error', barcodes[i].id, e); }
    }
    // تأخير 800ms بعد الرسم لضمان اكتمال التخطيط قبل الطباعة
    setTimeout(function () { window.print(); }, 800);
  }
  if (document.readyState === 'complete') {
    drawAll();
  } else {
    window.addEventListener('load', drawAll);
  }
})();
<\/script>
</body></html>`;
    },

    // ============ REPORTS ============
  getFiltered() {
        const q = document.getElementById('rSearch')?.value.toLowerCase() || '';
        const st = document.getElementById('rStatus')?.value || '';
        const it = document.getElementById('rItem')?.value || '';
        const pg = document.getElementById('rPage')?.value || '';
        const fr = document.getElementById('rFrom')?.value || '';
        const to = document.getElementById('rTo')?.value || '';

        // User role: only sees their own orders (matched by userName)
        const isUserOnly = this.role === 'User';

        return Object.entries(this.orders).filter(([id, o]) => {
            // ── Data-level restriction: User sees only their orders ──
            if (isUserOnly && o.entryUser !== this.userName) return false;
            if (q && !((o.custName || '').toLowerCase().includes(q) || (o.custMob || '').includes(q) || id.includes(q))) return false;
            if (st && o.status !== st) return false;
            if (it && o.itemName !== it) return false;
            if (pg && o.pageName !== pg) return false;
            if ((fr || to) && o.date) {
                const [d, m, y] = o.date.split('/');
                const od = new Date(`${y}-${m}-${d}`);
                if (fr && od < new Date(fr)) return false;
                if (to && od > new Date(to)) return false;
            }
            return true;
        }).sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
    },

    renderStageCards() {
        const filtered = this.getFiltered();
        const counts = { new: 0, process: 0, done: 0, delivered: 0, postponed: 0, canceled: 0 };
        const sums = { new: 0, process: 0, done: 0, delivered: 0, postponed: 0, canceled: 0 };
        filtered.forEach(([, o]) => { counts[o.status]++; sums[o.status] += parseFloat(o.price || 0); });
        document.getElementById('stageCards').innerHTML = Object.entries(STATUS_AR).map(([k, v]) => `
            <div class="col-4 col-md-2">
                <div style="background:var(--glass);border:1px solid ${STATUS_COLORS[k]}25;border-radius:var(--radius-sm);padding:.75rem;text-align:center;border-top:3px solid ${STATUS_COLORS[k]}">
                    <div style="font-size:.75rem;font-weight:700;color:var(--ink-mid)">${v}</div>
                    <div style="font-size:1.5rem;font-weight:800;color:${STATUS_COLORS[k]}">${counts[k]}</div>
                    <div style="font-size:.7rem;color:var(--ink-mid)">${sums[k].toFixed(0)} JOD</div>
                </div>
            </div>`).join('');
    },

    renderTable() {
        this.renderStageCards();
        const filtered = this.getFiltered();
        const isAdmin = this.role === 'Admin';
        const sBadge = k => `<span class="badge-j badge-${k}">${STATUS_AR[k] || k}</span>`;
        const tbody = document.getElementById('reportsTableBody');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:3rem;color:var(--ink-mid)"><i class="fas fa-inbox" style="font-size:2rem;opacity:.3;display:block;margin-bottom:.5rem"></i>لا توجد بيانات</td></tr>`;
            return;
        }
        tbody.innerHTML = filtered.map(([id, o]) => {
            const colorHex = this._colorHex(o.itemColor);
            const colorDot = colorHex ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${colorHex};border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-left:4px"></span>` : '';
            const colorText = o.itemColor ? `<span style="font-size:.78rem;color:var(--ink-mid)">${o.itemColor}</span>` : '-';
            return `<tr>
                <td><input type="checkbox" class="check-j r-check" value="${id}" onchange="app.updateRSel()" ${this.selectedR.has(id) ? 'checked' : ''}></td>
                <td style="font-size:.8rem;font-weight:700;color:var(--gold)">${id.slice(-6)}</td>
                <td style="font-weight:700">${o.custName}</td>
                <td dir="ltr" style="text-align:right;font-size:.85rem">${o.custMob}</td>
               <!-- عمود المنتجات -->
<td style="font-size:.75rem; line-height:1.4; min-width:120px">
    ${(o.items || [{ itemName: o.itemName }]).map(it => `<div>• ${it.itemName || '-'}</div>`).join('')}
</td>

<!-- عمود الألوان مع النقطة الملونة لكل صنف -->
<td style="font-size:.75rem; line-height:1.4">
    ${(o.items || [{ itemColor: o.itemColor }]).map(it => {
                const hex = this._colorHex(it.itemColor);
                return `<div>${hex ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${hex};border:1px solid rgba(0,0,0,0.1);vertical-align:middle;margin-left:4px"></span>` : ''}${it.itemColor || '-'}</div>`;
            }).join('')}
</td>

<!-- عمود المقاسات -->
<td style="font-size:.75rem; line-height:1.4">
    ${(o.items || [{ size: o.size }]).map(it => `<div>${it.size || '-'}</div>`).join('')}
</td>

<!-- عمود إجمالي الكمية -->
<td style="text-align:center; font-weight:700">
    ${(o.items || [{ qty: o.qty }]).reduce((sum, it) => sum + (parseInt(it.qty) || 1), 0)}
</td>
                <td style="font-weight:700;color:var(--emerald)">${o.price || 0} ${o.currency || 'JOD'}</td>
                <td style="font-size:.8rem;color:var(--ink-mid)">${o.pageName || '-'}</td>
                <td>${sBadge(o.status)}</td>
                <td style="font-size:.8rem" dir="ltr">${o.date || ''}</td>
                <td>
                    <div style="display:flex;gap:4px">
<button class="btn-j btn-gold btn-xs-j" onclick="app.openOrderModal('${id}')"><i class="fas fa-eye"></i></button>
                        <button class="btn-j btn-emerald btn-xs-j" onclick="app.openWhatsApp('${id}')" title="واتساب"><i class="fab fa-whatsapp"></i></button>
                        ${isAdmin ? `<button class="btn-j btn-ruby btn-xs-j" onclick="app.deleteOrder('${id}')"><i class="fas fa-trash"></i></button>` : ''}                    </div>
                </td>
            </tr>`;
        }).join('');
        document.getElementById('selectAllR').checked = filtered.length > 0 && this.selectedR.size === filtered.length;
    },

    toggleSelectAll() {
        const checked = document.getElementById('selectAllR').checked;
        this.getFiltered().forEach(([id]) => { checked ? this.selectedR.add(id) : this.selectedR.delete(id); });
        document.querySelectorAll('.r-check').forEach(cb => cb.checked = checked);
        this.updateRBulkPanel();
    },
    updateRSel() {
        document.querySelectorAll('.r-check').forEach(cb => { cb.checked ? this.selectedR.add(cb.value) : this.selectedR.delete(cb.value); });
        this.updateRBulkPanel();
    },
    updateRBulkPanel() {
        document.getElementById('rBulkPanel').classList.toggle('show', this.selectedR.size > 0);
        document.getElementById('rBulkCount').textContent = this.selectedR.size;
    },
    async rBulkStatus(s) {
        const upd = {};
        this.selectedR.forEach(id => { upd[`jawaher_orders/${id}/status`] = s; });
        await update(ref(db), upd);
        // خصم أو إرجاع المخزون بعد التحديث
        for (const id of this.selectedR) {
            if (s === 'delivered') await this.deductStock(id);
            if (s === 'canceled' || s === 'postponed') await this._returnStock(id);
        }
        this.selectedR.clear(); this.updateRBulkPanel(); this.renderTable();
        this.toast('تم التحديث', 'success');
    },
    rBulkPrint() { this.executePrint([...this.selectedR]); this.selectedR.clear(); this.updateRBulkPanel(); },
    async rBulkDelete() {
        if (!confirm(`حذف ${this.selectedR.size} طلبات؟`)) return;
        for (const id of this.selectedR) { await this._returnStock(id); }
        const upd = {};
        this.selectedR.forEach(id => { upd[`jawaher_orders/${id}`] = null; this.log('delete', id, 'حذف جماعي'); });
        await update(ref(db), upd);
        this.selectedR.clear(); this.updateRBulkPanel(); this.renderTable();
        this.toast('تم الحذف', 'success');
    },
    resetReportFilters() {
        ['rSearch', 'rStatus', 'rItem', 'rPage', 'rFrom', 'rTo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.renderTable();
    },
    exportExcel() {
        const rows = this.getFiltered().map(([id, o]) => ({
            'رقم الطلب': id, 'الزبون': o.custName, 'الموبايل': o.custMob,
            'الدولة': o.country || '', 'المحافظة': o.governorate || '', 'العنوان': o.custAddr || '',
            'المنتج': o.itemName || '', 'المقاس': o.size || '', 'الكمية': o.qty || 1,
            'السعر': o.price, 'العملة': o.currency || 'JOD', 'الحالة': STATUS_AR[o.status] || o.status,
            'الصفحة': o.pageName || '', 'ملاحظات': o.tags || '', 'المدخل': o.entryUser || '', 'التاريخ': o.date || ''
        }));
        if (!rows.length) { this.toast('لا يوجد بيانات', 'warning'); return; }
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Orders');
        XLSX.writeFile(wb, `Jawaher_${Date.now()}.xlsx`);
        this.toast('تم التصدير', 'success');
    },

    // ============ WAREHOUSE ============
    scanWarehouseBarcode() {
        const code = document.getElementById('wBarcodeScanner').value.trim().toUpperCase();
        if (!code) { this.renderWarehouse(); return; }
        const items = Object.entries(this.warehouse).filter(([, w]) => {
            if (w.name.toLowerCase().includes(code.toLowerCase())) return true;
            if (w.barcode && w.barcode.toUpperCase().includes(code)) return true;
            if (w.variations) return Object.values(w.variations).some(v => v.barcode && v.barcode.toUpperCase().includes(code));
            return false;
        });
        if (items.length === 0) {
            document.getElementById('warehouseGrid').innerHTML = `<div class="col-12" style="text-align:center;padding:2rem;color:var(--ink-mid)">
                <i class="fas fa-search fa-2x" style="opacity:.2;display:block;margin-bottom:1rem"></i>لم يتم العثور على منتج
                <br><button class="btn-j btn-gold btn-sm-j mt-3" onclick="app.openNewItemModal()"><i class="fas fa-plus"></i> إضافة كمنتج جديد</button></div>`;
            return;
        }
        this._renderItemCards(items);
    },

    openNewItemModal() {
        this.nimSizeRows = DEFAULT_SIZES.map(s => ({ size: s }));
        this.renderNimSizesGrid();
        ['nimName', 'nimPage', 'nimBuyPrice', 'nimSellPrice'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.openModal('newItemModal');
    },

    _saveNimSizeRows() {
        if (!this.nimSizeRows) return;
        this.nimSizeRows.forEach((row, i) => {
            const sInp = document.querySelector(`#nimsr_${i} .nim-s-val`);
            const cInp = document.getElementById(`nim_color_${i}`);
            const bInp = document.querySelector(`#nimsr_${i} .nim-b-val`);
            if (sInp) row.size = sInp.value;
            if (cInp) { row.color = cInp.value; row.hex = cInp.dataset.hex; }
            if (bInp) row.barcode = bInp.value;
        });
    },

    renderNimSizesGrid() {
        const grid = document.getElementById('nimSizesGrid'); if (!grid) return;
        const mainBarcode = document.getElementById('nimBarcode')?.value?.trim().toUpperCase() || '';
        grid.innerHTML = (this.nimSizeRows || []).map((row, i) => {
            const s = row.size || ''; const c = row.color || ''; const hex = row.hex || '';
            const b = row.barcode !== undefined ? row.barcode : mainBarcode;
            return `<div class="col-12 nim-size-row" id="nimsr_${i}">
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;background:var(--paper);padding:8px;border-radius:8px;border:1px solid var(--border);margin-bottom:4px">
                    <input type="text"   class="form-control-j nim-s-val" style="width:60px;text-align:center;font-weight:700" placeholder="مقاس" value="${s}">
                    <input type="text"   id="nim_color_${i}" class="form-control-j nim-c-val" placeholder="اللون" readonly
                        style="width:80px;cursor:pointer;font-size:.8rem;border-right:4px solid ${hex || 'var(--border)'}"
                        value="${c}" data-hex="${hex}" onclick="app.openColorPicker(${i},'nim_color')">
                    <input type="text"   class="form-control-j nim-b-val" placeholder="${mainBarcode || 'باركود (اختياري)'}" value="${b}" style="flex:1;min-width:100px;font-size:.85rem;font-family:monospace;background:${b && b === mainBarcode ? 'rgba(201,168,76,.06)' : 'inherit'}" dir="ltr" title="يرث باركود المنتج تلقائياً — قابل للتعديل">
                    <input type="number" class="form-control-j nim-q-val" placeholder="كمية" min="0" value="0" style="width:65px">
                    <button class="btn-j btn-ruby btn-xs-j" onclick="app.removeNimSizeRow(${i})" style="flex-shrink:0;padding:.3rem .5rem"><i class="fas fa-times"></i></button>
                </div>
            </div>`;
        }).join('');
    },

    addNimSizeRow() {
        if (!this.nimSizeRows) this.nimSizeRows = [];
        this._saveNimSizeRows();
        const mainBarcode2 = document.getElementById('nimBarcode')?.value?.trim().toUpperCase() || '';
        this.nimSizeRows.push({ size: '', barcode: mainBarcode2 });
        this.renderNimSizesGrid();
    },
    removeNimSizeRow(i) {
        this._saveNimSizeRows(); this.nimSizeRows.splice(i, 1); this.renderNimSizesGrid();
    },

    async saveNewItem() {
        const name = document.getElementById('nimName').value.trim();
        if (!name) { this.toast('يرجى إدخال اسم المنتج', 'error'); return; }
        const buyPrice = parseFloat(document.getElementById('nimBuyPrice').value) || 0;
        const sellPrice = parseFloat(document.getElementById('nimSellPrice').value) || 0;
        const pageName = document.getElementById('nimPage').value.trim();
        const sizes = {}; const variations = {};

        for (const row of document.querySelectorAll('.nim-size-row')) {
            const sz = row.querySelector('.nim-s-val')?.value.trim() || '';
            const c = row.querySelector('.nim-c-val')?.value.trim() || '';
            const hex = row.querySelector('.nim-c-val')?.dataset?.hex || '';
            let b = row.querySelector('.nim-b-val')?.value.trim().toUpperCase() || '';
            const qty = parseInt(row.querySelector('.nim-q-val')?.value) || 0;
            if (sz && !c) {
                this.toast(`المقاس ${sz} يحتاج لتحديد لون!`, 'error');
                return;
            }
            if (!sz) continue;
            if (!b) b = 'JW' + Math.random().toString(36).substr(2, 6).toUpperCase();
            const existing = Object.values(this.warehouse).find(w => w.barcode === b || (w.variations && Object.values(w.variations).some(v => v.barcode === b)));
            if (existing) { this.toast(`الباركود ${b} مستخدم مسبقاً`, 'error'); return; }
            const key = c ? `${sz} - ${c}` : sz;
            sizes[key] = (sizes[key] || 0) + qty;
            variations[key] = { size: sz, color: c, hex, barcode: b };
        }
        if (Object.keys(sizes).length === 0) { this.toast('يرجى إدخال مقاس واحد على الأقل', 'error'); return; }

        const newRef = await push(warehouseRef, { name, buyPrice, sellPrice, pageName, sizes, variations, createdAt: Date.now() });
        const totalQty = Object.values(sizes).reduce((a, b) => a + b, 0);
        if (totalQty > 0) await push(purchasesRef, { timestamp: Date.now(), date: new Date().toLocaleDateString('en-GB'), itemId: newRef.key, itemName: name, sizes, buyPrice, pageName, notes: 'إدخال أولي', user: this.userName });
        this.log('create_item', newRef.key, `إضافة منتج: ${name}`);
        this.toast(`تم إضافة "${name}" للمستودع ✓`, 'success');
        this.closeModal('newItemModal');
    },

    resetWarehouseFilters() {
        ['wSearch', 'wColorFilter', 'wPageFilter', 'wStockFilter'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.renderWarehouse();
    },

    renderWarehouse() {
        const q = document.getElementById('wSearch')?.value.toLowerCase() || '';
        const colorF = document.getElementById('wColorFilter')?.value || '';
        const pageF = document.getElementById('wPageFilter')?.value || '';
        const stockF = document.getElementById('wStockFilter')?.value || '';
        let items = Object.entries(this.warehouse);

        const wColorSel = document.getElementById('wColorFilter');
        if (wColorSel) {
            const cur = wColorSel.value;
            // جمع كل الألوان الموجودة فعلياً في المستودع (من المقاسات)
            const usedColors = new Set();
            items.forEach(([, w]) => {
                // اللون العام للمنتج
                if (w.color) usedColors.add(w.color);
                // ألوان من مفاتيح المقاسات المركبة "S - وردي"
                Object.keys(w.sizes || {}).forEach(key => {
                    if (key.includes(' - ')) usedColors.add(key.split(' - ').slice(1).join(' - '));
                });
                // ألوان من variations
                Object.values(w.variations || {}).forEach(v => { if (v.color) usedColors.add(v.color); });
            });
            const sortedColors = [...usedColors].sort();
            wColorSel.innerHTML = '<option value="">كل الألوان</option>' + sortedColors.map(c => {
                return `<option value="${c}" ${cur === c ? 'selected' : ''}>${c}</option>`;
            }).join('');
            wColorSel.value = cur;
        }
        const wPageSel = document.getElementById('wPageFilter');
        if (wPageSel) { const cur = wPageSel.value; const pages = [...new Set(items.map(([, w]) => w.pageName).filter(Boolean))].sort(); wPageSel.innerHTML = '<option value="">كل الصفحات</option>' + pages.map(p => `<option value="${p}" ${cur === p ? 'selected' : ''}>${p}</option>`).join(''); }

       items = items.filter(([, w]) => {
            // إضافة حماية لاسم المنتج والباركود
            if (q && !(w.name || '').toLowerCase().includes(q) && !(w.barcode || '').toLowerCase().includes(q)) return false;
            if (colorF) {
                // فلترة شاملة: اللون العام + ألوان من مفاتيح المقاسات
                const itemColors = new Set();
                if (w.color) itemColors.add(w.color);
                Object.keys(w.sizes || {}).forEach(key => {
                    if (key.includes(' - ')) itemColors.add(key.split(' - ').slice(1).join(' - '));
                });
                Object.values(w.variations || {}).forEach(v => { if (v.color) itemColors.add(v.color); });
                if (!itemColors.has(colorF)) return false;
            }
            if (pageF && w.pageName !== pageF) return false;
            const total = Object.values(w.sizes || {}).reduce((a, b) => a + b, 0);
            if (stockF === 'low' && total >= 5) return false;
            if (stockF === 'zero' && total > 0) return false;
            if (stockF === 'ok' && total < 5) return false;
            return true;
        });
        this._renderItemCards(items);
    },

  _renderItemCards(items) {
        const grid = document.getElementById('warehouseGrid'); if (!grid) return;
        
        // 1. حالة المستودع فارغ (تم تصحيحها وحذف الزر غير المنطقي هنا)
        if (items.length === 0) {
            grid.innerHTML = `<div class="col-12" style="text-align:center;padding:3rem;color:var(--ink-mid)">
                <i class="fas fa-warehouse fa-3x" style="opacity:.2;display:block;margin-bottom:1rem"></i>المستودع فارغ
                <br><button class="btn-j btn-gold btn-sm-j mt-3" onclick="app.openNewItemModal()"><i class="fas fa-plus"></i> إضافة منتج جديد</button>
            </div>`;
            return;
        }

        // 2. رسم البطاقات
        grid.innerHTML = items.map(([id, w]) => {
            const sizes = Object.entries(w.sizes || {});
            const total = sizes.reduce((s, [, q]) => s + q, 0);
            const fillCls = total > 10 ? 'qty-high' : total > 3 ? 'qty-med' : 'qty-low';
            const mainColorHex = this._colorHex(w.color);
            const colorBorder = mainColorHex || 'var(--gold)';
            
            return `<div class="col-12 col-sm-6 col-lg-4 col-xl-3">
                <div class="item-card" style="border-top:4px solid ${colorBorder}">
                    <div class="item-card-header">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start">
                            <div>
                                <div class="item-card-name">${w.name}</div>
                                <div class="item-card-code" style="opacity:.7;font-size:.7rem">المعرف: ${id.slice(-8).toUpperCase()}</div>
                            </div>
                            ${total <= 3 ? `<span style="background:rgba(192,37,86,.25);color:#ffaaaa;font-size:.7rem;font-weight:800;padding:2px 8px;border-radius:20px">⚠ منخفض</span>` : ''}
                        </div>
                        ${w.pageName ? `<div style="font-size:.72rem;color:rgba(255,255,255,.5);margin-top:4px"><i class="fas fa-file-alt me-1"></i>${w.pageName}</div>` : ''}
                    </div>
                    <div class="item-card-body">
                        <div class="item-qty-row">
                            <span class="item-qty-label">إجمالي المخزون</span>
                            <span class="item-qty-value">${total} <small style="font-size:.8rem;font-weight:400;color:var(--ink-mid)">قطعة</small></span>
                        </div>
                        <div class="item-qty-bar"><div class="item-qty-fill ${fillCls}" style="width:${Math.min(total > 0 ? Math.round(total / Math.max(total, 20) * 100) : 0, 100)}%"></div></div>
                        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem">
                            <div style="background:rgba(26,107,74,.08);border:1px solid rgba(26,107,74,.25);border-radius:8px;padding:4px 10px;font-size:.74rem;display:flex;align-items:center;gap:5px">
                                <span style="color:var(--emerald)">سعر البيع</span>
                                <strong style="color:var(--emerald)">${w.sellPrice ? w.sellPrice + ' JOD' : '—'}</strong>
                                <span style="cursor:pointer;color:var(--gold);font-size:.72rem;margin-right:2px" onclick="app.inlineEditSellPrice('${id}')" title="تعديل سعر البيع"><i class="fas fa-pencil-alt"></i></span>
                            </div>
                        </div>
                        <div style="background:rgba(201,168,76,.06);border-right:3px solid var(--gold);border-radius:0 8px 8px 0;padding:5px 10px;font-size:.76rem;color:var(--ink-mid);margin-bottom:.5rem;display:flex;align-items:center;gap:6px">
                            <i class="fas fa-sticky-note" style="color:var(--gold)"></i>
                            <span style="flex:1">${w.notes || '<span style="opacity:.45">لا توجد ملاحظة</span>'}</span>
                            <span style="cursor:pointer;color:var(--gold);font-size:.72rem" onclick="app.inlineEditNotes('${id}')" title="تعديل الملاحظة"><i class="fas fa-pencil-alt"></i></span>
                        </div>
                        <div class="item-sizes mb-3">
                            ${sizes.length === 0 ? `<span style="color:var(--ink-mid);font-size:.8rem">لا توجد مقاسات</span>` : sizes.map(([key, q]) => {
                                // فصل المقاس واللون من المفتاح "S - وردي" أو "S"
                                let dispSize = key, dispColor = '';
                                if (key.includes(' - ')) {
                                    dispSize = key.split(' - ')[0];
                                    dispColor = key.split(' - ').slice(1).join(' - ');
                                }
                                const v = w.variations ? w.variations[key] : null;
                                const vCode = v && v.barcode ? v.barcode : (w.barcode || id.slice(-8)).toUpperCase();
                                // أولوية اللون: من المفتاح المركب → variation → sizeColors → اللون العام
                                const vColor = dispColor || (v && v.color) || (w.sizeColors && w.sizeColors[key]) || w.color || '';
                                const colorHex = this._colorHex(vColor) || '#ccc';
                                return `<div style="background:rgba(0,0,0,.02);border:1px solid var(--border);padding:6px;border-radius:8px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;width:100%">
                                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                        <span style="font-weight:700;font-size:.85rem">${dispSize}</span>
                                        ${vColor ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${colorHex};border:1px solid rgba(0,0,0,.15);flex-shrink:0"></span><span style="font-size:.78rem;color:var(--ink-mid)">${vColor}</span>` : ''}
                                        <span style="${q === 0 ? 'color:var(--ruby)' : 'color:var(--ink)'}">: <strong>${q}</strong> قطعة</span>
                                    </div>
                                    <div style="font-size:.7rem;font-family:monospace;background:var(--paper);padding:4px 6px;border-radius:4px;border:1px solid var(--border);display:flex;align-items:center;gap:5px">
                                        <span style="cursor:pointer" onclick="app.showBarcode('${vCode}','${w.name}','${dispSize}','${vColor}','${w.pageName||''}','${id}')" title="طباعة الباركود">
                                            <i class="fas fa-barcode" style="color:var(--gold)"></i> ${vCode}
                                        </span>
                                        <span style="cursor:pointer;color:var(--gold);opacity:.7;font-size:.65rem" onclick="app.inlineEditBarcode('${id}','${key}')" title="تعديل الباركود"><i class="fas fa-pencil-alt"></i></span>
                                    </div>
                                </div>`;
                            }).join('')}
                        </div>
                        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                            <button class="btn-j btn-gold btn-xs-j" style="flex:1" onclick="app.openAddStockModal('${id}')"><i class="fas fa-plus"></i> إضافة كمية</button>
                            <button class="btn-j btn-emerald btn-xs-j" style="flex:1" onclick="app.openInventoryCorrection('${id}')" title="تصحيح جرد"><i class="fas fa-clipboard-check"></i> جرد</button>
                            <button class="btn-j btn-sapphire btn-xs-j" onclick="app.viewMovement('${id}')" title="حركة الصنف"><i class="fas fa-history"></i></button>
                            <button class="btn-j btn-ruby btn-xs-j" onclick="app.deleteItem('${id}')" title="حذف"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    openAddStockModal(itemId) {
        const item = this.warehouse[itemId]; if (!item) return;
        const sizes = Object.keys(item.sizes || {});
        const modal = document.createElement('div');
        modal.className = 'modal-j open'; modal.id = 'addStockModal';
        modal.innerHTML = `<div class="modal-overlay" onclick="this.parentElement.remove()"></div>
            <div class="modal-sheet" style="max-width:400px">
                <div class="modal-handle"></div>
                <div class="modal-title"><i class="fas fa-plus-circle" style="color:var(--gold)"></i> تعديل كمية — ${item.name}</div>
                <div class="row g-3">
                    <div class="col-12">
                        <label class="form-label-j">اللون <span style="color:var(--ruby-light)">*</span></label>
                        <div style="display:flex;gap:4px;align-items:center">
                            <input type="text" id="asColor" class="form-control-j" placeholder="اختر اللون..." readonly
                                style="cursor:pointer;font-size:.82rem;border-right:4px solid var(--border)"
                                onclick="app.openColorPicker('main','asColor')">
                            <button class="btn-j btn-ghost btn-xs-j" onclick="app.openColorPicker('main','asColor')">
                                <i class="fas fa-palette" style="color:var(--gold)"></i>
                            </button>
                        </div>
                    </div>
                    <div class="col-12">
                        <label class="form-label-j">المقاس <span style="color:var(--ruby-light)">*</span></label>
                        <div style="display:flex;gap:6px">
                            <div class="select-wrapper" style="flex:1">
                                <select id="asSize" class="form-control-j select-j" onchange="app.updateLiveBalance('${itemId}')">
                                    <option value="">اختر المقاس...</option>
                                    ${sizes.map(s => `<option value="${s}">${s}</option>`).join('')}
                                </select>
                            </div>
                            <input type="text" id="asNewSize" class="form-control-j" placeholder="أو جديد" style="width:80px">
                        </div>
                    </div>
                    <div id="asLiveBalance" style="font-size: .8rem; font-weight: 700; color: var(--gold); text-align: center; padding: 8px; background: var(--paper-warm); border-radius: 8px; display: none; border: 1px dashed var(--gold)"></div>
                    <div class="col-12">
                        <label class="form-label-j">الكمية (موجب للاضافة / سالب للخصم)</label>
                        <div class="qty-control">
                            <button class="qty-btn" onclick="app.adjustQty('asQty',-1)">−</button>
                            <input type="number" id="asQty" class="form-control-j qty-input" value="1">
                            <button class="qty-btn" onclick="app.adjustQty('asQty',1)">+</button>
                        </div>
                    </div>
                    <div class="col-12">
                        <label class="form-label-j">سبب التعديل</label>
                        <select id="asReason" class="form-control-j select-j">
                            <option value="مشتريات جديدة">مشتريات جديدة</option>
                            <option value="تصحيح جرد">تصحيح جرد</option>
                            <option value="مرتجع من زبون">مرتجع من زبون</option>
                        </select>
                    </div>
                </div>
                <div class="d-flex gap-3 mt-4">
                    <button class="btn-j btn-gold flex-fill" onclick="app.confirmAddStock('${itemId}')"><i class="fas fa-save"></i> حفظ التعديل</button>
                    <button class="btn-j btn-ghost" onclick="document.getElementById('addStockModal').remove()">إلغاء</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    },
    updateLiveBalance(itemId) {
        const item = this.warehouse[itemId];
        const color = document.getElementById('asColor').value;
        const size = document.getElementById('asSize').value;
        const liveEl = document.getElementById('asLiveBalance');

        if (item && color && size) {
            const key = `${size} - ${color}`;
            const current = item.sizes?.[key] || item.sizes?.[size] || 0;
            liveEl.textContent = `الرصيد الحالي لهذا اللون والمقاس: ${current}`;
            liveEl.style.display = 'block';
        } else {
            liveEl.style.display = 'none';
        }
    },
    async confirmAddStock(itemId) {
        const item = this.warehouse[itemId]; if (!item) return;
        const color = document.getElementById('asColor').value.trim();
        const newSize = document.getElementById('asNewSize').value.trim();
        const exSize = document.getElementById('asSize').value;
        const size = newSize || exSize;
        const qty = parseInt(document.getElementById('asQty').value) || 0;
        const reason = document.getElementById('asReason')?.value || 'تصحيح جرد';

        // التحقق من الحقول الإجبارية
        if (!color) { this.toast('يرجى تحديد اللون أولاً', 'error'); return; }
        if (!size) { this.toast('يرجى تحديد المقاس', 'error'); return; }
        if (qty === 0) { this.toast('يرجى إدخال كمية صحيحة', 'error'); return; }

        // بناء المفتاح الموحد (المقاس - اللون)
       // تحديد المفتاح الصحيح للمقاس لمنع تكرار المفاتيح أو تجاهل الرصيد القديم
        let key = `${size} - ${color}`;
        if (item.sizes && item.sizes[size] !== undefined && item.variations?.[size]?.color === color) {
            key = size; // استخدم المفتاح القديم إذا كان موجوداً ويحمل نفس اللون
        }
        const current = item.sizes?.[key] || 0;
        const finalQty = current + qty;

        if (finalQty < 0) {
            if (!confirm('الكمية الناتجة ستكون بالسالب، هل أنت متأكد من صحة الجرد؟')) return;
        }

        const updates = {};
        updates[`jawaher_warehouse/${itemId}/sizes/${key}`] = finalQty;

        // تحديث معلومات الـ variations لضمان ظهور اللون والباركود مستقبلاً لهذا الصنف الجديد
        if (!item.sizes?.[key]) {
            const vHex = document.getElementById('asColor').dataset.hex || '';
            const vBarcode = 'JW' + Math.random().toString(36).substr(2, 6).toUpperCase();
            updates[`jawaher_warehouse/${itemId}/variations/${key}`] = { size, color, hex: vHex, barcode: vBarcode };
        }

        await update(ref(db), updates);

        this.log('stock_adjust', itemId, `تعديل مخزون: ${qty} قطعة (اللون: ${color} | المقاس: ${size}) - السبب: ${reason}`);
        this.toast(`تم تحديث المخزون بنجاح ✓`, 'success');
        document.getElementById('addStockModal')?.remove();
    },

    async deleteItem(itemId) {
        const item = this.warehouse[itemId];
        if (!confirm(`حذف المنتج "${item?.name}" نهائياً؟`)) return;
        await remove(ref(db, `jawaher_warehouse/${itemId}`));
        this.log('delete_item', itemId, `حذف المنتج: ${item?.name}`);
        this.toast('تم حذف المنتج', 'success');
    },

    // ══════════════════════════════════════════
    // INLINE EDIT — warehouse fields (no reload)
    // ══════════════════════════════════════════

    // تعديل باركود الـ variation أو الباركود الرئيسي للصنف
    inlineEditBarcode(itemId, varKey) {
        const item = this.warehouse[itemId]; if (!item) return;
        const current = varKey
            ? (item.variations?.[varKey]?.barcode || item.barcode || '')
            : (item.barcode || '');
        const val = prompt('تعديل الباركود:', current);
        if (val === null) return;
        const clean = val.trim().toUpperCase();
        if (!clean) { this.toast('الباركود لا يمكن أن يكون فارغاً', 'error'); return; }
        // فحص التكرار (تجاهل نفس الصنف)
        const dup = Object.entries(this.warehouse).find(([id, w]) => {
            if (id === itemId) return false;
            if (w.barcode === clean) return true;
            return Object.values(w.variations || {}).some(v => v.barcode === clean);
        });
        if (dup) { this.toast(`الباركود ${clean} مستخدم في صنف آخر`, 'error'); return; }
        const path = varKey
            ? `jawaher_warehouse/${itemId}/variations/${varKey}/barcode`
            : `jawaher_warehouse/${itemId}/barcode`;
        update(ref(db), { [path]: clean }).then(() => this.toast('تم تحديث الباركود ✓', 'success'));
    },

    // تعديل سعر البيع
    inlineEditSellPrice(itemId) {
        const item = this.warehouse[itemId]; if (!item) return;
        const val = prompt('تعديل سعر البيع (JOD):', item.sellPrice || '');
        if (val === null) return;
        const price = parseFloat(val);
        if (isNaN(price) || price < 0) { this.toast('سعر غير صالح', 'error'); return; }
        update(ref(db, `jawaher_warehouse/${itemId}`), { sellPrice: price })
            .then(() => this.toast('تم تحديث سعر البيع ✓', 'success'));
    },

    // تعديل الملاحظة
    inlineEditNotes(itemId) {
        const item = this.warehouse[itemId]; if (!item) return;
        const val = prompt('ملاحظات الصنف:', item.notes || '');
        if (val === null) return;
        update(ref(db, `jawaher_warehouse/${itemId}`), { notes: val.trim() })
            .then(() => this.toast('تم حفظ الملاحظة ✓', 'success'));
    },

    showBarcode(code, itemName, size, color, pageName, itemId) {
        // دعم الاستدعاء القديم (code, name)
        if (size === undefined) {
            const parts = (itemName || '').split(' - ');
            size     = parts.slice(1).join(' - ') || '';
            itemName = parts[0] || '';
        }
        const colorHex  = this._colorHex(color) || '';
        const colorDot  = colorHex
            ? `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${colorHex};border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-left:4px"></span>`
            : '';
        const sellPrice = itemId && this.warehouse[itemId]?.sellPrice
            ? this.warehouse[itemId].sellPrice : '';
        const modal = document.createElement('div');
        modal.className = 'modal-j open';
        modal.innerHTML = `
        <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
        <div class="modal-sheet" style="max-width:370px;text-align:center">
            <div class="modal-handle"></div>
            <div class="modal-title" style="font-size:1rem;margin-bottom:.5rem">${itemName}</div>
            ${size     ? `<div style="font-size:.82rem;color:var(--ink-mid);margin-bottom:2px">المقاس: <strong>${size}</strong></div>` : ''}
            ${color    ? `<div style="font-size:.82rem;color:var(--ink-mid);margin-bottom:2px">${colorDot}اللون: <strong>${color}</strong></div>` : ''}
            ${sellPrice ? `<div style="font-size:.82rem;color:var(--emerald);margin-bottom:4px;font-weight:800"><i class="fas fa-tag"></i> سعر البيع: ${sellPrice} JOD</div>` : ''}
            ${pageName ? `<div style="font-size:.78rem;color:var(--gold);margin-bottom:.75rem"><i class="fas fa-file-alt" style="font-size:.7rem;margin-left:3px"></i>${pageName}</div>` : '<div style="margin-bottom:.75rem"></div>'}
            <div style="background:#fff;border-radius:8px;padding:.5rem;border:1px solid var(--border);margin-bottom:.75rem">
                <svg id="barcodeModal"></svg>
                <div style="font-size:.75rem;color:#777;font-family:monospace;margin-top:2px">${code}</div>
                ${sellPrice ? `<div style="font-size:.85rem;font-weight:800;color:#1A6B4A;margin-top:4px">${sellPrice} JOD</div>` : ''}
            </div>
            <button class="btn-j btn-gold w-100" onclick="app._printBarcode('${code}','${(itemName||'').replace(/'/g,"\\'")}','${(size||'').replace(/'/g,"\\'")}','${(color||'').replace(/'/g,"\\'")}','${(pageName||'').replace(/'/g,"\\'")}','${sellPrice}')">
                <i class="fas fa-print"></i> طباعة الباركود
            </button>
        </div>`;
        document.body.appendChild(modal);
        JsBarcode('#barcodeModal', code, { format:'CODE128', width:2, height:60, displayValue:true, font:'Almarai' });
    },

    _printBarcode(code, itemName, size, color, pageName, sellPrice) {
        const win = window.open('', '_blank', 'width=460,height=340');
        if (!win) { this.toast('فعّل النوافذ المنبثقة في المتصفح', 'error'); return; }

        const colorHex   = this._colorHex(color) || '';
        const colorSwatch = colorHex
            ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorHex};border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-left:3px"></span>`
            : '';

        const rows = [
            itemName ? `<tr><td class="lbl">الصنف</td><td class="val">${itemName}</td></tr>`      : '',
            size     ? `<tr><td class="lbl">المقاس</td><td class="val"><strong>${size}</strong></td></tr>` : '',
            color    ? `<tr><td class="lbl">اللون</td><td class="val">${colorSwatch}${color}</td></tr>`    : '',
            pageName ? `<tr><td class="lbl">الصفحة</td><td class="val" style="color:#9A5500">${pageName}</td></tr>` : '',
            sellPrice ? `<tr><td class="lbl">السعر</td><td class="val" style="color:#1A6B4A;font-weight:800">${sellPrice} JOD</td></tr>` : '',
        ].filter(Boolean).join('');

        win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="UTF-8"><title>باركود — ${itemName} ${size}</title>
<link href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"><\/script>
<style>
  @page { size:9cm 5.5cm; margin:0 }
  *,*::before,*::after { box-sizing:border-box; margin:0; padding:0 }
  html,body { width:9cm; height:5.5cm; background:#fff; font-family:'Almarai',Arial,sans-serif }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact } }
  body { display:flex; align-items:center; justify-content:center }
  .card { width:9cm; height:5.5cm; border:1.5px solid #1A3A8F; border-radius:4px; display:flex; flex-direction:column; padding:2.5mm; overflow:hidden }
  .hdr  { background:#0F2260; color:#7AA0F0; font-size:8pt; font-weight:800; text-align:center; padding:3px 4px; border-radius:3px; margin-bottom:2mm; flex-shrink:0; letter-spacing:.3px }
  .body { display:flex; gap:2.5mm; flex:1; min-height:0; align-items:center }
  .info { flex:1; min-width:0 }
  .info table { width:100%; border-collapse:collapse }
  .lbl  { font-size:7pt; color:#555; width:30%; white-space:nowrap; padding-bottom:2px; font-weight:700 }
  .val  { font-size:7.5pt; color:#111; font-weight:700; padding-right:3px; padding-bottom:2px }
  .bc   { flex-shrink:0; text-align:center }
  .bc svg { width:105px !important; height:auto !important }
  .code { font-size:6pt; color:#444; text-align:center; font-family:monospace; margin-top:1.5mm; flex-shrink:0; letter-spacing:.5px; font-weight:700 }
  ${sellPrice ? `.price-badge { background:#e6f4ed; border:1.5px solid #1A6B4A; border-radius:4px; padding:2px 8px; font-size:9pt; font-weight:800; color:#1A6B4A; text-align:center; margin-top:2mm; flex-shrink:0 }` : ''}
</style>
</head><body>
<div class="card">
  <div class="hdr">◆ شادي ملكاوي — ملصق الصنف ◆</div>
  <div class="body">
    <div class="info"><table>${rows}</table></div>
    <div class="bc"><svg id="bc"></svg></div>
  </div>
  <div class="code">${code}</div>
  ${sellPrice ? `<div class="price-badge">💰 ${sellPrice} JOD</div>` : ''}
</div>
<script>
(function(){
  function run(){
    try{
      JsBarcode('#bc','${code}',{format:'CODE128',width:1.6,height:46,displayValue:false,margin:2,background:'transparent'});
    }catch(e){}
    setTimeout(function(){ window.print(); window.close(); }, 700);
  }
  if(document.readyState==='complete'){ run(); }
  else { window.addEventListener('load', run); }
})();
<\/script>
</body></html>`);
        win.document.close();
    },

    // ============ PURCHASE BARCODE ============
    scanPurchaseBarcode() {
        const code = document.getElementById('pBarcodeScanner').value.trim().toUpperCase();
        if (!code) return;
        const found = Object.entries(this.warehouse).find(([, w]) => {
            if (w.barcode && w.barcode.toUpperCase() === code) return true;
            if (w.variations && Object.values(w.variations).some(v => v.barcode && v.barcode.toUpperCase() === code)) return true;
            return false;
        });
        const resultEl = document.getElementById('pBarcodeResult');
        if (found) {
            const [id, w] = found;
            resultEl.style.display = 'block';
            resultEl.innerHTML = `<div style="background:rgba(26,107,74,.08);border:1px solid rgba(26,107,74,.2);border-radius:10px;padding:.75rem;display:flex;align-items:center;gap:.75rem">
                <i class="fas fa-check-circle" style="color:var(--emerald);font-size:1.3rem"></i>
                <div><div style="font-weight:800">${w.name}</div><div style="font-size:.78rem;color:var(--ink-mid)">مخزون: ${Object.values(w.sizes || {}).reduce((a, b) => a + b, 0)} قطعة</div></div>
                <button class="btn-j btn-gold btn-sm-j" style="margin-right:auto" onclick="app.selectPurchaseItem('${id}')">اختيار</button>
            </div>`;
        } else {
            resultEl.style.display = 'block';
            resultEl.innerHTML = `<div style="background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.2);border-radius:10px;padding:.75rem;font-size:.85rem;color:var(--gold-dark)">
                <i class="fas fa-info-circle me-2"></i>الباركود غير موجود — سيتم إنشاء منتج جديد</div>`;
            document.getElementById('pBarcode').value = code;
        }
    },
    clearPurchaseBarcode() {
        document.getElementById('pBarcodeScanner').value = '';
        document.getElementById('pBarcodeResult').style.display = 'none';
    },
    selectPurchaseItem(id) {
        document.getElementById('pItem').value = id; this.loadPurchaseItem();
        document.getElementById('pBarcodeResult').style.display = 'none';
        document.getElementById('pBarcodeScanner').value = '';
        this.toast('تم تحديد المنتج', 'success');
    },

    // ============ PURCHASE ============
renderPurchasePage() { 
    this.renderPurchaseHistory(); 
    if (this.pSizeData.length === 0) {
        this.pSizeData = DEFAULT_SIZES.map(s => ({ size: s, qty: 0, color: '', colorHex: '' }));
    }
    this.renderSizesGrid(); 
},
updateSizeData(idx, field, value) {
    if (!this.pSizeData[idx]) return;
    this.pSizeData[idx][field] = value;
},
 renderSizesGrid() {
    const grid = document.getElementById('pSizesGrid'); if (!grid) return;
    grid.innerHTML = this.pSizeData.map((row, i) => `
        <div class="col-12 size-row-item" id="psr_${i}">
            <div style="display:flex;gap:6px;align-items:center;background:rgba(201,168,76,.03);border:1px solid var(--border);border-radius:10px;padding:.5rem .65rem">
                <input type="text" class="form-control-j" style="width:58px;text-align:center;font-weight:700;flex-shrink:0" placeholder="مقاس"
                       value="${row.size}" onchange="app.updateSizeData(${i}, 'size', this.value)">
                <input type="number" class="form-control-j" placeholder="كمية" min="0" style="width:65px;flex-shrink:0"
                       value="${row.qty}" onchange="app.updateSizeData(${i}, 'qty', parseInt(this.value)||0)">
                <input type="text" id="psc_${i}" class="form-control-j" placeholder="اللون *" readonly
                       style="flex:1;cursor:pointer;font-size:.82rem;border-right:4px solid ${row.colorHex || 'var(--ruby-light)'}"
                       value="${row.color}" data-hex="${row.colorHex}"
                       onclick="app.openColorPicker(${i},'psc')">
                <button class="btn-j btn-ghost btn-xs-j" onclick="app.openColorPicker(${i},'psc')" style="flex-shrink:0;padding:.3rem .5rem">
                    <i class="fas fa-palette" style="color:var(--gold)"></i>
                </button>
                <button class="btn-j btn-ruby btn-xs-j" onclick="app.removeSizeRow(${i})" style="flex-shrink:0"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `).join('');
},

  addSizeRow() { 
    this.pSizeData.push({ size: '', qty: 0, color: '', colorHex: '' });
    this.renderSizesGrid(); 
},
removeSizeRow(i) { 
    this.pSizeData.splice(i, 1); 
    this.renderSizesGrid(); 
},


loadPurchaseItem() {
    const id = document.getElementById('pItem').value; 
    if (!id || !this.warehouse[id]) return;
    const item = this.warehouse[id];
    document.getElementById('pBuyPrice').value = item.buyPrice || '';
    document.getElementById('pSellPrice').value = item.sellPrice || '';
    document.getElementById('pColor').value = item.color || '';
    document.getElementById('pPageName').value = item.pageName || '';
    
    // بناء pSizeData من المقاسات الموجودة
    this.pSizeData = Object.entries(item.sizes || {}).map(([key, qty]) => {
        // المفتاح قد يكون "S - وردي" أو "S" فقط
        let size = key, color = '', colorHex = '';
        if (key.includes(' - ')) {
            size = key.split(' - ')[0];
            color = key.split(' - ').slice(1).join(' - ');
        } else if (item.variations && item.variations[key]) {
            color = item.variations[key].color || '';
            colorHex = item.variations[key].hex || '';
        } else if (item.sizeColors && item.sizeColors[key]) {
            color = item.sizeColors[key];
        } else if (item.color) {
            color = item.color;
        }
        colorHex = this._colorHex(color) || '';
        return { size, qty, color, colorHex };
    });
    if (this.pSizeData.length === 0) {
        this.pSizeData = DEFAULT_SIZES.map(s => ({ size: s, qty: 0, color: '', colorHex: '' }));
    }
    this.renderSizesGrid();
},

    async savePurchase() {
        const existingId = document.getElementById('pItem').value;
        const newName = document.getElementById('pNewItem').value.trim();
        const manualBarcode = document.getElementById('pBarcode').value.trim().toUpperCase();
        const buyPrice = parseFloat(document.getElementById('pBuyPrice').value) || 0;
        const sellPrice = parseFloat(document.getElementById('pSellPrice').value) || 0;
        
        const pageName = document.getElementById('pPageName').value.trim();
        const invoiceDate = document.getElementById('pInvoiceDate').value || new Date().toLocaleDateString('en-GB');
        const notes = document.getElementById('pNotes').value.trim();
        const color = document.getElementById('pColor')?.value.trim() || '';
        if (!pageName) { this.toast('اسم الصفحة إجباري', 'error'); return; }
        if (!existingId && !newName) { this.toast('يرجى اختيار أو إدخال اسم المنتج', 'error'); return; }

      const sizes = {};
const sizeColors = {};
let colorMissing = false;
for (const row of this.pSizeData) {
    const sz = row.size.trim();
    const qty = row.qty || 0;
    const col = row.color.trim();
    if (sz && qty > 0) {
        if (!col) { colorMissing = true; break; }
        // المفتاح: "مقاس - لون" للسماح بنفس المقاس بألوان مختلفة
        const key = col ? `${sz} - ${col}` : sz;
        sizes[key] = (sizes[key] || 0) + qty;
        sizeColors[key] = col;
    }
}
        if (colorMissing) { this.toast('اللون إجباري لكل مقاس', 'error'); return; }
        if (Object.keys(sizes).length === 0) { this.toast('يرجى إدخال مقاس وكمية', 'error'); return; }

        let targetId = existingId;
        let isNewItem = false;
        if (!targetId) {
            isNewItem = true;
            const barcode = manualBarcode || ('JW' + Date.now().toString().slice(-8));
            const newRef = await push(warehouseRef, { name: newName, buyPrice, sellPrice, pageName, color, barcode, sizes: {}, sizeColors: {}, createdAt: Date.now() });
            targetId = newRef.key;
        }
        // للمنتج الجديد: الكاش المحلي لم يُحدَّث بعد، نبني البيانات من الجلسة الحالية
        const item = this.warehouse[targetId];
        const existingSizes = isNewItem ? {} : (item?.sizes || {});
        const existingSizeColors = isNewItem ? {} : (item?.sizeColors || {});
        const mergedSizes = { ...existingSizes };
        Object.entries(sizes).forEach(([s, q]) => { mergedSizes[s] = (mergedSizes[s] || 0) + q; });
        const mergedSizeColors = { ...existingSizeColors, ...sizeColors };
        const updateData = { buyPrice, sellPrice, pageName, sizes: mergedSizes, sizeColors: mergedSizeColors };

        if (manualBarcode && !existingId) updateData.barcode = manualBarcode;
        await update(ref(db, `jawaher_warehouse/${targetId}`), updateData);
        await push(purchasesRef, { timestamp: Date.now(), date: invoiceDate, itemId: targetId, itemName: item?.name || newName, sizes, sizeColors, buyPrice, sellPrice, pageName, color, notes, user: this.userName });
        this.log('purchase', targetId, `شراء: ${JSON.stringify(sizes)} - صفحة: ${pageName} - سعر: ${buyPrice} JOD`);
        this.toast('تم تسجيل الشراء وتحديث المستودع ✓', 'success');
        this.resetPurchase(); this.renderPurchaseHistory();
    },

  resetPurchase() {
    ['pItem', 'pBuyPrice', 'pSellPrice', 'pNotes', 'pBarcode', 'pInvoiceDate'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const pColorEl = document.getElementById('pColor');
    if (pColorEl) { pColorEl.value = ''; pColorEl.style.borderRight = '4px solid var(--border)'; }
    document.getElementById('pNewItem').value = '';
    const scanner = document.getElementById('pBarcodeScanner');
    const result = document.getElementById('pBarcodeResult');
    if (scanner) scanner.value = '';
    if (result) result.style.display = 'none';
    
    // إعادة تعيين pSizeData وليس المصفوفات القديمة
    this.pSizeData = DEFAULT_SIZES.map(s => ({ size: s, qty: 0, color: '', colorHex: '' }));
    this.renderSizesGrid();
},

    renderPurchaseHistory() {
        const hist = document.getElementById('purchaseHistory'); if (!hist) return;
        const entries = Object.values(this.purchases).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        if (!entries.length) { hist.innerHTML = `<div style="text-align:center;color:var(--ink-mid);padding:2rem">لا توجد عمليات شراء</div>`; return; }
        hist.innerHTML = entries.map(p => `
            <div style="background:rgba(201,168,76,.05);border:1px solid rgba(201,168,76,.15);border-radius:10px;padding:.85rem;margin-bottom:.6rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
                    <span style="font-weight:800;font-size:.9rem">${p.itemName || 'غير محدد'}</span>
                    <span style="font-size:.75rem;color:var(--ink-mid)" dir="ltr">${p.date || ''}</span>
                </div>
                <div style="font-size:.8rem;color:var(--ink-mid)">
                    ${Object.entries(p.sizes || {}).map(([s, q]) => `<span class="size-tag">مقاس ${s}: ${q}</span>`).join(' ')}
                    ${p.buyPrice ? `<span style="color:var(--emerald);font-weight:700;margin-right:6px">${p.buyPrice} JOD</span>` : ''}
                </div>
            </div>`).join('');
    },

    // ============ RETURNS ============
    scanReturnBarcode() {
        const code = document.getElementById('retBarcodeScanner').value.trim().toUpperCase();
        if (!code) return;
        const found = Object.entries(this.orders).find(([id]) => id.slice(-12).toUpperCase().includes(code) || id.slice(-8).toUpperCase() === code);
        if (found) { this.selectReturnOrder(found[0], found[1]); document.getElementById('retBarcodeScanner').value = ''; this.toast('تم العثور على الطلب', 'success'); return; }
        const itemFound = Object.entries(this.warehouse).find(([, w]) => w.barcode?.toUpperCase() === code || (w.variations && Object.values(w.variations).some(v => v.barcode?.toUpperCase() === code)));
        if (itemFound) {
            const ordersByItem = Object.entries(this.orders).filter(([, o]) => o.itemId === itemFound[0] && o.status !== 'canceled');
            if (ordersByItem.length === 1) this.selectReturnOrder(ordersByItem[0][0], ordersByItem[0][1]);
            else if (ordersByItem.length > 1) this.showReturnResults(ordersByItem);
            else this.toast('لا توجد طلبات لهذا المنتج', 'error');
        } else { this.toast('لم يتم العثور على طلب', 'error'); }
    },

    searchForReturn() {
        const q = document.getElementById('retSearch').value.trim().toLowerCase();
        const resultsEl = document.getElementById('retSearchResults');
        const preview = document.getElementById('retOrderPreview');
        const form = document.getElementById('retForm');
        this.retSelectedOrderId = null; form.style.display = 'none'; preview.style.display = 'none'; resultsEl.style.display = 'none';
        if (q.length < 2) return;
        const matches = Object.entries(this.orders).filter(([id, o]) =>
            id.slice(-8).toLowerCase().includes(q) || (o.custName || '').toLowerCase().includes(q) || (o.custMob || '').includes(q) || (o.itemName || '').toLowerCase().includes(q)
        ).slice(0, 8);
        if (matches.length === 0) { resultsEl.style.display = 'block'; resultsEl.innerHTML = `<div style="padding:.75rem;font-size:.85rem;color:var(--ink-mid);text-align:center"><i class="fas fa-search-minus"></i> لم يتم العثور على نتائج</div>`; return; }
        if (matches.length === 1) { this.selectReturnOrder(matches[0][0], matches[0][1]); return; }
        this.showReturnResults(matches);
    },

    showReturnResults(matches) {
        const resultsEl = document.getElementById('retSearchResults');
        resultsEl.style.display = 'block';
        resultsEl.innerHTML = matches.map(([id, o]) => `
            <div onclick="app.selectReturnOrder('${id}', null)" style="padding:.7rem .85rem;cursor:pointer;border-bottom:1px solid var(--border);transition:background .2s;display:flex;align-items:center;gap:.75rem"
                onmouseover="this.style.background='rgba(201,168,76,.06)'" onmouseout="this.style.background=''">
                <i class="fas fa-box" style="color:var(--gold);flex-shrink:0"></i>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:800;font-size:.88rem">${o.custName}</div>
                    <div style="font-size:.75rem;color:var(--ink-mid)">${o.itemName || ''} | ${o.size || ''} | ${o.custMob || ''}</div>
                </div>
                <span class="badge-j badge-${o.status}" style="flex-shrink:0;font-size:.7rem">${STATUS_AR[o.status] || ''}</span>
            </div>`).join('');
    },

 selectReturnOrder(id, order) {
        const o = order || this.orders[id]; if (!o) return;
        this.retSelectedOrderId = id;
        document.getElementById('retSearchResults').style.display = 'none';
        document.getElementById('retSearch').value = o.custName;
        const preview = document.getElementById('retOrderPreview');
        preview.style.display = 'block';

        // تجهيز الأصناف (يدعم الطلبات القديمة بصنف واحد، والجديدة بعدة أصناف)
        const itemsList = o.items || [{ itemId: o.itemId, itemName: o.itemName, size: o.size, exactKey: o.exactKey, itemColor: o.itemColor, qty: o.qty }];
        
        // بناء قائمة منسدلة لاختيار الصنف المرتجع
        let itemsDropdownHtml = `<select id="retItemSelect" class="form-control-j mb-2" onchange="app.updateRetSizes(this.value)">`;
        itemsList.forEach((it, idx) => {
            itemsDropdownHtml += `<option value="${idx}">${it.itemName || 'بدون اسم'} | لون: ${it.itemColor || '-'} | مقاس: ${it.size || '-'} (الكمية: ${it.qty || 1})</option>`;
        });
        itemsDropdownHtml += `</select>`;

        preview.innerHTML = `<div class="return-item-preview">
            <div class="return-item-icon"><i class="fas fa-box"></i></div>
            <div style="flex:1">
                <div style="font-weight:800;font-size:1rem;margin-bottom:6px">${o.custName}</div>
                <label style="font-size:.75rem;color:var(--ink-mid)">اختر الصنف المراد إرجاعه:</label>
                ${itemsDropdownHtml}
                <div style="font-size:.82rem;color:var(--gold)">الإجمالي: ${o.price || 0} ${o.currency || 'JOD'}</div>
                <div style="font-size:.75rem;color:var(--ink-mid)">${o.custMob || ''} | حالة الطلب: ${STATUS_AR[o.status] || ''}</div>
            </div>
            <button class="btn-j btn-ghost btn-xs-j" onclick="app.clearReturnSelection()" style="align-self:flex-start"><i class="fas fa-times"></i></button>
        </div>`;
        
        document.getElementById('retForm').style.display = 'block';
        
        // تحديث المقاسات والكمية الافتراضية للصنف الأول
        this.updateRetSizes(0);
    },
updateRetSizes(itemIdx) {
        const orderId = this.retSelectedOrderId;
        if (!orderId) return;
        const o = this.orders[orderId];
        const itemsList = o.items || [{ itemId: o.itemId, itemName: o.itemName, size: o.size, exactKey: o.exactKey, itemColor: o.itemColor, qty: o.qty }];
        const selectedItem = itemsList[itemIdx];
        
        const sizeSel = document.getElementById('retSize');
        if (!sizeSel) return;

        // نعرض فقط المقاس المسجل في الطلب (exactKey أو size) لمنع إرجاع مقاس خاطئ للمستودع
        const orderKey = selectedItem.exactKey || selectedItem.size || '';
        const displaySize = orderKey.includes(' - ') ? orderKey.split(' - ')[0] : orderKey;
        sizeSel.innerHTML = orderKey ? `<option value="${orderKey}">${displaySize}${selectedItem.itemColor ? ' - ' + selectedItem.itemColor : ''}</option>` : '';
        sizeSel.value = orderKey;

        // تحديد أقصى كمية مسموح إرجاعها بناءً على المتاح في الطلب
        const qtyInput = document.getElementById('retQty');
        if (qtyInput) {
            qtyInput.max = selectedItem.qty || 1;
            qtyInput.value = 1;
        }
    },

    clearReturnSelection() {
        this.retSelectedOrderId = null;
        ['retOrderPreview', 'retForm', 'retSearchResults'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        document.getElementById('retSearch').value = '';
    },

 async saveReturn() {
        const orderId = this.retSelectedOrderId; if (!orderId) { this.toast('يرجى تحديد طلب', 'error'); return; }
        const o = this.orders[orderId]; if (!o) return;

        // سحب الصنف المحدد من القائمة المنسدلة
        const itemIdx = document.getElementById('retItemSelect')?.value || 0;
        const itemsList = o.items || [{ itemId: o.itemId, itemName: o.itemName, size: o.size, exactKey: o.exactKey, itemColor: o.itemColor, qty: o.qty }];
        const returnedItem = itemsList[itemIdx];

        const size = document.getElementById('retSize').value;
        const qty = parseInt(document.getElementById('retQty').value) || 1;
        const reason = document.getElementById('retReason').value;
        const notes = document.getElementById('retNotes').value;

        if (qty > (returnedItem.qty || 1)) {
            this.toast(`لا يمكنك إرجاع كمية أكبر من الموجودة في الطلب (${returnedItem.qty || 1})`, 'error');
            return;
        }

        const updates = {};

        // 1. إرجاع الكمية للمستودع
        if (returnedItem.itemId && this.warehouse[returnedItem.itemId]) {
            const wItem = this.warehouse[returnedItem.itemId];
            let keyToReturn = size;
            
            // الحماية لضمان توافق المفاتيح إذا كان المقاس مسجلاً (المقاس - اللون)
            if (wItem.sizes && wItem.sizes[size] === undefined && returnedItem.itemColor) {
                if (wItem.sizes[`${size} - ${returnedItem.itemColor}`] !== undefined) {
                    keyToReturn = `${size} - ${returnedItem.itemColor}`;
                }
            }
            const currentStock = wItem.sizes?.[keyToReturn] || 0;
            updates[`jawaher_warehouse/${returnedItem.itemId}/sizes/${keyToReturn}`] = currentStock + qty;
        }

        // 2. تسجيل المرتجع الجديد
        const newReturnRef = push(returnsRef); // ننشئ ريفرنس جديد ونضيفه لحزمة التحديثات
        updates[`jawaher_returns/${newReturnRef.key}`] = { 
            timestamp: Date.now(), 
            date: new Date().toLocaleDateString('en-GB'), 
            orderId, 
            custName: o.custName, 
            custMob: o.custMob, 
            itemName: returnedItem.itemName || '', 
            itemColor: returnedItem.itemColor || '',
            itemId: returnedItem.itemId || '', 
            size, 
            qty, 
            reason, 
            notes, 
            user: this.userName 
        };

        // 3. تحديث مصفوفة الطلب الأصلي لمنع إرجاع نفس القطعة مرتين
        const updatedItems = [...itemsList];
        updatedItems[itemIdx].qty = (updatedItems[itemIdx].qty || 1) - qty;
        
        // تصفية الأصناف: الاحتفاظ فقط بالأصناف التي كميتها أكبر من صفر
        const finalItems = updatedItems.filter(it => it.qty > 0);
        
        updates[`jawaher_orders/${orderId}/items`] = finalItems.length > 0 ? finalItems : null;
        updates[`jawaher_orders/${orderId}/qty`] = finalItems.reduce((sum, it) => sum + (it.qty || 1), 0);
        
        // إذا تم إرجاع كل الأصناف، نغير الحالة لملغي (canceled)، وإلا نتركه مؤجل
        if (finalItems.length === 0) {
            updates[`jawaher_orders/${orderId}/status`] = 'canceled';
        } else {
            updates[`jawaher_orders/${orderId}/status`] = 'postponed'; 
        }

        // إرسال التحديثات دفعة واحدة للفايربيس
        await update(ref(db), updates);

        this.log('return', orderId, `مرتجع ${qty} قطعة من ${returnedItem.itemName} (اللون: ${returnedItem.itemColor || '-'} | المقاس: ${size}) - السبب: ${reason}`);
        this.toast('تم تسجيل المرتجع بنجاح. ⚠ يرجى تعديل السعر الإجمالي للطلب يدوياً إذا لزم الأمر', 'warning');

        // تصفير الواجهة
        ['retSearch', 'retNotes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('retQty').value = '1';
        const scanEl = document.getElementById('retBarcodeScanner'); if (scanEl) scanEl.value = '';
        ['retOrderPreview', 'retForm', 'retSearchResults'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        this.retSelectedOrderId = null;
        this.renderReturnsList();
    },
    renderReturnsList() {
        const el = document.getElementById('returnsList'); if (!el) return;
        const entries = Object.values(this.returns).sort((a, b) => b.timestamp - a.timestamp);
        if (!entries.length) { el.innerHTML = `<div style="text-align:center;color:var(--ink-mid);padding:2rem"><i class="fas fa-box-open fa-2x" style="opacity:.2;display:block;margin-bottom:1rem"></i>لا توجد مرتجعات</div>`; return; }
        el.innerHTML = entries.map(r => `
            <div class="return-history-item">
                <div style="width:40px;height:40px;background:rgba(139,26,58,.1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-undo-alt" style="color:var(--ruby-light)"></i></div>
                <div style="flex:1">
                    <div style="font-weight:800;font-size:.9rem">${r.custName || ''}</div>
                    <div style="font-size:.78rem;color:var(--ink-mid)">${r.itemName || ''} مقاس ${r.size || ''} × ${r.qty || 1} | ${r.reason || ''}</div>
                    <div style="font-size:.72rem;color:var(--ink-mid)" dir="ltr">${r.date || ''} - ${r.user || ''}</div>
                </div>
            </div>`).join('');
    },

    // ============ LOGS ============
    log(action, id, details) {
        if (this.role !== 'Admin') return;
        push(logsRef, { timestamp: Date.now(), date: new Date().toLocaleString('en-GB'), user: this.userName, action, id, details });
    },
    renderLogs() {
        const el = document.getElementById('logsBody'); if (!el) return;
        const entries = Object.values(this.logsData || {}).sort((a, b) => b.timestamp - a.timestamp);
        el.innerHTML = entries.map(l => `<tr>
            <td dir="ltr" style="font-size:.8rem">${new Date(l.timestamp).toLocaleString('en-GB')}</td>
            <td style="font-weight:700">${l.user || ''}</td>
            <td><span class="badge-j badge-new">${l.action || ''}</span></td>
            <td style="font-size:.78rem;color:var(--gold)">${(l.id || '').slice(-8)}</td>
            <td style="font-size:.85rem">${l.details || ''}</td>
        </tr>`).join('');
    },

    // ============ HELPERS ============
   adjustQty(id, delta) {
        const el = document.getElementById(id); if (!el) return;
        // شلنا Math.max عشان نسمح بالنزول تحت الصفر (للسالب)
        el.value = (parseInt(el.value) || 0) + delta;
    },
    openModal(id) { document.getElementById(id)?.classList.add('open'); },
    closeModal(id) { document.getElementById(id)?.classList.remove('open'); },
    toggleDrop(id) { document.getElementById(id)?.classList.toggle('open'); },
    closeAllDropdowns() { document.querySelectorAll('.dropdown-j.open').forEach(d => d.classList.remove('open')); },

    toast(msg, type = 'info') {
        const container = document.getElementById('toastContainer');
        const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
        const t = document.createElement('div');
        t.className = `toast-j ${type}`;
        t.innerHTML = `<i class="fas ${icons[type] || 'fa-info-circle'}"></i> ${msg}`;
        container.appendChild(t);
        if (type === 'success' && navigator.vibrate) navigator.vibrate(30);
        setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-20px)'; setTimeout(() => t.remove(), 300); }, 3000);
    },

    // ============================================================
    // ██████╗ ██████╗ ███╗   ███╗    ███╗   ███╗ ██████╗ ██████╗ ██╗   ██╗██╗     ███████╗
    // ██╔══██╗██╔══██╗████╗ ████║    ████╗ ████║██╔═══██╗██╔══██╗██║   ██║██║     ██╔════╝
    // ██║  ██║██████╔╝██╔████╔██║    ██╔████╔██║██║   ██║██║  ██║██║   ██║██║     █████╗  
    // ██║  ██║██╔══██╗██║╚██╔╝██║    ██║╚██╔╝██║██║   ██║██║  ██║██║   ██║██║     ██╔══╝  
    // ██████╔╝██║  ██║██║ ╚═╝ ██║    ██║ ╚═╝ ██║╚██████╔╝██████╔╝╚██████╔╝███████╗███████╗
    // ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝    ╚═╝     ╚═╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
    // ============ CRM MODULE — CUSTOMERS ============

    // ── Build customer data structure from orders ────────────────
    _buildCrmData() {
        const customers = {};
        Object.values(this.orders).forEach(o => {
            const phone = o.custMob || '';
            if (!phone) return;
            if (!customers[phone]) {
                customers[phone] = {
                    name: o.custName || '',
                    phone,
                    governorate: o.governorate || '',
                    address: o.custAddr || '',
                    orders: 0,
                    completed: 0,
                    revenue: 0,
                    lastOrderTs: 0,
                    lastOrderDate: ''
                };
            }
            const c = customers[phone];
            // update name/address if newer
            if (o.timestamp > c.lastOrderTs) {
                c.name = o.custName || c.name;
                c.governorate = o.governorate || c.governorate;
                c.address = o.custAddr || c.address;
                c.lastOrderTs = o.timestamp || 0;
                c.lastOrderDate = o.date || '';
            }
            c.orders++;
            if (o.status === 'delivered' || o.status === 'done') {
                c.completed++;
                c.revenue += parseFloat(o.price || 0);
            }
        });
        return Object.values(customers);
    },

    // ── Render KPI cards for CRM ────────────────────────────────
    _renderCrmKpis(data) {
        const totalCustomers = data.length;
        const totalRevenue = data.reduce((s, c) => s + c.revenue, 0);
        const avgOrder = data.reduce((s, c) => s + (c.completed > 0 ? c.revenue / c.completed : 0), 0) / (totalCustomers || 1);
        const vipCount = data.filter(c => c.orders >= 5).length;

        const kpis = [
            { label: 'إجمالي العملاء', value: totalCustomers, icon: 'fa-users', cls: 'kpi-gold' },
            { label: 'إجمالي الإيرادات', value: totalRevenue.toFixed(2) + ' JOD', icon: 'fa-money-bill-wave', cls: 'kpi-emerald', small: true },
            { label: 'متوسط قيمة الطلب', value: avgOrder.toFixed(2) + ' JOD', icon: 'fa-chart-line', cls: 'kpi-sapphire', small: true },
            { label: 'عملاء VIP', value: vipCount, icon: 'fa-crown', cls: 'kpi-amethyst' },
        ];
        const grid = document.getElementById('crmKpiGrid');
        if (grid) grid.innerHTML = kpis.map(k => `
            <div class="kpi-card ${k.cls}">
                <i class="fas ${k.icon} kpi-icon"></i>
                <div class="kpi-label">${k.label}</div>
                <div class="kpi-value" style="${k.small ? 'font-size:1.2rem' : ''}">${k.value}</div>
            </div>`).join('');
    },

    // ── Populate governorate filter ──────────────────────────────
    _populateCrmGovFilter(data) {
        const sel = document.getElementById('crmFilterGov');
        if (!sel) return;
        const cur = sel.value;
        const govs = [...new Set(data.map(c => c.governorate).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">كل المحافظات</option>' + govs.map(g => `<option value="${g}" ${cur === g ? 'selected' : ''}>${g}</option>`).join('');
    },

    // ── Main render function ─────────────────────────────────────
    renderCustomers() {
        const rawData = this._buildCrmData();
        this._renderCrmKpis(rawData);
        this._populateCrmGovFilter(rawData);

        const q = (document.getElementById('crmSearch')?.value || '').toLowerCase().trim();
        const sortBy = document.getElementById('crmSortBy')?.value || 'revenue';
        const filterGov = document.getElementById('crmFilterGov')?.value || '';
        const filterStatus = document.getElementById('crmFilterStatus')?.value || '';

        let data = rawData.filter(c => {
            if (q && !c.name.toLowerCase().includes(q) && !c.phone.includes(q)) return false;
            if (filterGov && c.governorate !== filterGov) return false;
            if (filterStatus === 'vip' && c.orders < 5) return false;
            if (filterStatus === 'regular' && (c.orders < 2 || c.orders > 4)) return false;
            if (filterStatus === 'new' && c.orders !== 1) return false;
            return true;
        });

        // Sort
        data.sort((a, b) => {
            if (sortBy === 'revenue') return b.revenue - a.revenue;
            if (sortBy === 'orders') return b.orders - a.orders;
            if (sortBy === 'name') return a.name.localeCompare(b.name, 'ar');
            if (sortBy === 'lastOrder') return b.lastOrderTs - a.lastOrderTs;
            return 0;
        });

        document.getElementById('crmResultCount').textContent = `${data.length} عميل`;

        const tbody = document.getElementById('crmTableBody');
        if (!tbody) return;

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:2.5rem;color:var(--ink-mid)">
                <i class="fas fa-users-slash" style="font-size:2rem;display:block;margin-bottom:.5rem;opacity:.3"></i>
                لا يوجد عملاء مطابقون
            </td></tr>`;
            return;
        }

        tbody.innerHTML = data.map((c, i) => {
            const avgOrder = c.completed > 0 ? (c.revenue / c.completed).toFixed(2) : '—';
            const tier = c.orders >= 5 ? { label: 'VIP', cls: 'badge-delivered', icon: 'fa-crown' }
                       : c.orders >= 2 ? { label: 'منتظم', cls: 'badge-process', icon: 'fa-star-half-alt' }
                       : { label: 'جديد', cls: 'badge-new', icon: 'fa-seedling' };
            const completionRate = c.orders > 0 ? Math.round(c.completed / c.orders * 100) : 0;
            const waLink = this._buildWhatsAppLink(c.phone);
            return `<tr style="transition:background .15s" onmouseenter="this.style.background='rgba(201,168,76,.04)'" onmouseleave="this.style.background=''">
                <td style="color:var(--ink-mid);font-size:.78rem;font-weight:700">${i + 1}</td>
                <td>
                    <div style="font-weight:800;font-size:.9rem">${c.name}</div>
                    <div style="font-size:.72rem;color:var(--ink-mid)">${completionRate}% مكتملة</div>
                </td>
                <td style="font-family:monospace;direction:ltr;text-align:right;font-size:.85rem;font-weight:700">${c.phone}</td>
                <td style="font-size:.82rem">${c.governorate || '—'}</td>
                <td style="font-size:.78rem;color:var(--ink-mid);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${c.address}">${c.address || '—'}</td>
                <td style="text-align:center">
                    <span style="font-weight:800;font-size:.95rem;color:var(--gold)">${c.orders}</span>
                </td>
                <td style="text-align:center">
                    <span style="font-weight:700;color:var(--emerald)">${c.completed}</span>
                </td>
                <td style="text-align:center">
                    <span style="font-weight:800;color:var(--emerald);font-size:.92rem">${c.revenue > 0 ? c.revenue.toFixed(2) + ' JOD' : '—'}</span>
                </td>
                <td style="text-align:center;font-size:.82rem;color:var(--ink-mid)">${avgOrder !== '—' ? avgOrder + ' JOD' : '—'}</td>
                <td style="text-align:center;font-size:.75rem;color:var(--ink-mid)">${c.lastOrderDate || '—'}</td>
                <td style="text-align:center">
                    <span class="badge-j ${tier.cls}" style="font-size:.7rem;gap:3px">
                        <i class="fas ${tier.icon}" style="font-size:.65rem"></i> ${tier.label}
                    </span>
                </td>
                <td style="text-align:center">
                    <a href="${waLink}" target="_blank" rel="noopener"
                        style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#25D366;color:#fff;border-radius:20px;font-size:.75rem;font-weight:700;text-decoration:none;transition:opacity .2s"
                        onmouseenter="this.style.opacity='.8'" onmouseleave="this.style.opacity='1'"
                        title="فتح واتساب">
                        <i class="fab fa-whatsapp" style="font-size:.9rem"></i> واتساب
                    </a>
                </td>
            </tr>`;
        }).join('');
    },

    // ── WhatsApp link builder ────────────────────────────────────
    _buildWhatsAppLink(phone) {
        // Normalize: remove leading 0, add Jordan code 962
        let p = phone.replace(/\D/g, '');
        if (p.startsWith('0')) p = p.slice(1);
        if (!p.startsWith('962')) p = '962' + p;
        const msg = encodeURIComponent('مرحباً، لدينا بضاعة جديدة وصلت حديثاً في المستودع، يسعدنا خدمتك في أي وقت. هل ترغب بالطلب أو الاستفسار؟');
        return `https://wa.me/${p}?text=${msg}`;
    },

    // ── Excel export ─────────────────────────────────────────────
    exportCustomersExcel() {
        if (this.role !== 'Admin') { this.toast('غير مسموح', 'error'); return; }
        const data = this._buildCrmData();
        data.sort((a, b) => b.revenue - a.revenue);

        const rows = [['#', 'اسم العميل', 'رقم الموبايل', 'المحافظة', 'العنوان', 'إجمالي الطلبات', 'الطلبات المكتملة', 'إجمالي الإيرادات (JOD)', 'متوسط الطلب (JOD)', 'آخر طلب', 'التصنيف']];
        data.forEach((c, i) => {
            const tier = c.orders >= 5 ? 'VIP' : c.orders >= 2 ? 'منتظم' : 'جديد';
            const avg = c.completed > 0 ? (c.revenue / c.completed).toFixed(2) : 0;
            rows.push([i + 1, c.name, c.phone, c.governorate, c.address, c.orders, c.completed, c.revenue.toFixed(2), avg, c.lastOrderDate, tier]);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [5,25,15,15,25,12,12,18,15,12,10].map(w => ({ wch: w }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'العملاء');
        XLSX.writeFile(wb, `Jawaher_Customers_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.xlsx`);
        this.toast('تم تصدير بيانات العملاء بنجاح ✓', 'success');
    },

    // ============================================================
    // ██╗███╗   ██╗██╗   ██╗███████╗███╗   ██╗████████╗ ██████╗ ██████╗ ██╗   ██╗
    // ██║████╗  ██║██║   ██║██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗██╔══██╗╚██╗ ██╔╝
    // ██║██╔██╗ ██║██║   ██║█████╗  ██╔██╗ ██║   ██║   ██║   ██║██████╔╝ ╚████╔╝ 
    // ██║██║╚██╗██║╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██╔══██╗  ╚██╔╝  
    // ██║██║ ╚████║ ╚████╔╝ ███████╗██║ ╚████║   ██║   ╚██████╔╝██║  ██║   ██║   
    // ╚═╝╚═╝  ╚═══╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   
    // ============ ENHANCED INVENTORY CORRECTION ============

    openInventoryCorrection(itemId) {
        const item = this.warehouse[itemId]; if (!item) return;

        // Build existing sizes with display labels
        const sizeEntries = Object.entries(item.sizes || {});

        const modal = document.createElement('div');
        modal.className = 'modal-j open'; modal.id = 'invCorrModal';
        modal.innerHTML = `
        <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
        <div class="modal-sheet" style="max-width:560px">
            <div class="modal-handle"></div>
            <div class="modal-title">
                <i class="fas fa-clipboard-check" style="color:var(--emerald)"></i>
                تصحيح جرد — <span style="color:var(--gold)">${item.name}</span>
            </div>

            <!-- Current Stock Overview -->
            <div style="background:var(--paper-warm);border-radius:12px;padding:1rem;margin-bottom:1.25rem;border:1px solid var(--border)">
                <div style="font-size:.78rem;color:var(--ink-mid);font-weight:700;margin-bottom:.6rem">
                    <i class="fas fa-boxes" style="color:var(--gold)"></i> الرصيد الحالي في المستودع
                </div>
                ${sizeEntries.length === 0
                    ? `<div style="color:var(--ink-mid);font-size:.82rem">لا توجد مقاسات مسجلة</div>`
                    : `<div style="display:flex;flex-wrap:wrap;gap:.4rem">
                        ${sizeEntries.map(([k, q]) => {
                            const dispSize = k.includes(' - ') ? k.split(' - ')[0] : k;
                            const dispColor = k.includes(' - ') ? k.split(' - ').slice(1).join(' - ') : (item.color || '');
                            const colorHex = this._colorHex(dispColor) || '#ccc';
                            return `<div style="background:var(--paper);border:1px solid var(--border);border-radius:8px;padding:5px 10px;font-size:.78rem;display:flex;align-items:center;gap:5px;justify-content:space-between">
                                <div style="display:flex;align-items:center;gap:5px">
                                    <span style="font-weight:700">${dispSize}</span>
                                    ${dispColor ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorHex}"></span><span style="color:var(--ink-mid)">${dispColor}</span>` : ''}
                                    <span style="font-weight:800;color:${q === 0 ? 'var(--ruby-light)' : 'var(--emerald)'}">${q}</span>
                                </div>
                                <button onclick="app.deleteItemSize('${itemId}','${k}')" title="حذف المقاس نهائياً"
                                    style="background:none;border:none;cursor:pointer;color:var(--ruby-light);font-size:.75rem;padding:2px 5px;border-radius:4px;line-height:1"
                                    onmouseenter="this.style.background='rgba(192,37,86,.1)'"
                                    onmouseleave="this.style.background='none'"><i class="fas fa-trash-alt"></i></button>
                            </div>`;
                        }).join('')}
                    </div>`
                }
            </div>

            <!-- Step: Select target size + color -->
            <div class="row g-3">
                <div class="col-12">
                    <label class="form-label-j">اختر المقاس واللون المراد تصحيحه <span style="color:var(--ruby-light)">*</span></label>
                    ${sizeEntries.length > 0 ? `
                    <div class="select-wrapper mb-2">
                        <select id="icSizeSelect" class="form-control-j select-j" onchange="app._icOnSizeSelect('${itemId}')">
                            <option value="">— اختر من الموجود —</option>
                            ${sizeEntries.map(([k, q]) => {
                                const dispSize = k.includes(' - ') ? k.split(' - ')[0] : k;
                                const dispColor = k.includes(' - ') ? k.split(' - ').slice(1).join(' - ') : (item.color || '');
                                return `<option value="${k}" data-qty="${q}" data-size="${dispSize}" data-color="${dispColor}">${dispSize}${dispColor ? ' — ' + dispColor : ''} (رصيد: ${q})</option>`;
                            }).join('')}
                        </select>
                    </div>
                    <div style="text-align:center;font-size:.78rem;color:var(--ink-mid);margin-bottom:.5rem">— أو أدخل مقاساً جديداً —</div>` : ''}
                    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
                        <input type="text" id="icNewSize" class="form-control-j" placeholder="المقاس (S, M, L, XL...)" style="flex:1;min-width:80px" oninput="app._icClearSelect()">
                        <div style="display:flex;gap:4px;align-items:center;flex:1;min-width:120px">
                            <input type="text" id="icColor" class="form-control-j" placeholder="اللون..." readonly
                                style="cursor:pointer;border-right:4px solid var(--border);flex:1"
                                onclick="app.openColorPicker('main','icColor')">
                            <button class="btn-j btn-ghost btn-xs-j" onclick="app.openColorPicker('main','icColor')">
                                <i class="fas fa-palette" style="color:var(--gold)"></i>
                            </button>
                        </div>
                    </div>
                    <!-- حقل الباركود مع وراثة تلقائية من الصنف -->
                    <div style="margin-top:.5rem">
                        <label class="form-label-j" style="font-size:.78rem">
                            <i class="fas fa-barcode" style="color:var(--gold)"></i>
                            باركود المقاس
                            <span style="color:var(--ink-mid);font-weight:400;font-size:.72rem"> — يرث باركود الصنف تلقائياً، قابل للتعديل</span>
                        </label>
                        <input type="text" id="icBarcode" class="form-control-j"
                            placeholder="باركود المقاس..."
                            value="${item.barcode || ''}"
                            style="font-family:monospace;font-size:.88rem;background:rgba(201,168,76,.05);border-right:3px solid var(--gold)"
                            dir="ltr">
                    </div>
                </div>

                <!-- Live current balance display -->
                <div id="icCurrentQty" class="col-12" style="display:none">
                    <div style="background:var(--paper-warm);border:1.5px dashed var(--gold);border-radius:10px;padding:.75rem;text-align:center">
                        <div style="font-size:.75rem;color:var(--ink-mid)">الكمية الحالية في المستودع</div>
                        <div id="icCurrentQtyVal" style="font-size:1.8rem;font-weight:800;color:var(--gold);line-height:1.2">0</div>
                        <div style="font-size:.72rem;color:var(--ink-mid)">قطعة</div>
                    </div>
                </div>

                <!-- Actual physical count input -->
                <div class="col-12">
                    <label class="form-label-j">
                        <i class="fas fa-hand-paper" style="color:var(--emerald)"></i>
                        الكمية الفعلية المعدودة يدوياً <span style="color:var(--ruby-light)">*</span>
                    </label>
                    <div class="qty-control">
                        <button class="qty-btn" onclick="app.adjustQty('icRealQty',-1);app._icCalcDelta()">−</button>
                        <input type="number" id="icRealQty" class="form-control-j qty-input" value="0" min="0"
                            oninput="app._icCalcDelta()">
                        <button class="qty-btn" onclick="app.adjustQty('icRealQty',1);app._icCalcDelta()">+</button>
                    </div>
                </div>

                <!-- Auto-calculated delta -->
                <div class="col-12" id="icDeltaBox" style="display:none">
                    <div id="icDeltaContent" style="border-radius:12px;padding:.85rem;text-align:center;border:2px solid">
                    </div>
                </div>

                <!-- Reason + Notes -->
                <div class="col-md-6">
                    <label class="form-label-j">سبب التصحيح <span style="color:var(--ruby-light)">*</span></label>
                    <div class="select-wrapper">
                        <select id="icReason" class="form-control-j select-j">
                            <option value="تصحيح جرد دوري">تصحيح جرد دوري</option>
                            <option value="خسارة أو تلف">خسارة أو تلف</option>
                            <option value="خطأ في الإدخال السابق">خطأ في الإدخال السابق</option>
                            <option value="مرتجع غير مسجل">مرتجع غير مسجل</option>
                            <option value="سرقة">سرقة</option>
                            <option value="أخرى">أخرى</option>
                        </select>
                    </div>
                </div>
                <div class="col-md-6">
                    <label class="form-label-j">ملاحظات إضافية</label>
                    <input type="text" id="icNotes" class="form-control-j" placeholder="اختياري...">
                </div>
            </div>

            <div class="d-flex gap-3 mt-4">
                <button class="btn-j btn-emerald flex-fill" onclick="app.confirmInventoryCorrection('${itemId}')">
                    <i class="fas fa-check-circle"></i> تأكيد التصحيح وحفظ السجل
                </button>
                <button class="btn-j btn-ghost" onclick="document.getElementById('invCorrModal').remove()">إلغاء</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    },

    async deleteItemSize(itemId, sizeKey) {
        const item = this.warehouse[itemId]; if (!item) return;
        const dispKey = sizeKey;
        if (!confirm(`هل أنت متأكد من حذف المقاس "${dispKey}" نهائياً من المستودع؟`)) return;
        const updates = {};
        updates[`jawaher_warehouse/${itemId}/sizes/${sizeKey}`] = null;
        if (item.variations?.[sizeKey] !== undefined) updates[`jawaher_warehouse/${itemId}/variations/${sizeKey}`] = null;
        if (item.sizeColors?.[sizeKey] !== undefined) updates[`jawaher_warehouse/${itemId}/sizeColors/${sizeKey}`] = null;
        await update(ref(db), updates);
        this.log('stock', itemId, `حذف مقاس/لون: ${sizeKey}`);
        this.toast(`تم حذف المقاس "${dispKey}" ✓`, 'success');
        document.getElementById('invCorrModal')?.remove();
        setTimeout(() => this.openInventoryCorrection(itemId), 300);
    },

    _icOnSizeSelect(itemId) {
        const sel = document.getElementById('icSizeSelect');
        const opt = sel.selectedOptions[0];
        if (!opt || !opt.value) return;
        const color = opt.dataset.color || '';
        const size  = opt.dataset.size  || opt.value;
        const qty   = parseInt(opt.dataset.qty) || 0;
        document.getElementById('icNewSize').value = size;
        // Set color field
        const colorInp = document.getElementById('icColor');
        if (colorInp) {
            colorInp.value = color;
            const hex = this._colorHex(color);
            colorInp.style.borderRight = `4px solid ${hex || 'var(--border)'}`;
            if (hex) colorInp.dataset.hex = hex;
        }
        // Fill barcode from existing variation or item barcode
        const item = this.warehouse[itemId];
        const bcInp = document.getElementById('icBarcode');
        if (bcInp && item) {
            const varKey = opt.value; // the full key e.g. "S - أحمر"
            const existingBarcode = item.variations?.[varKey]?.barcode || item.barcode || '';
            bcInp.value = existingBarcode;
        }
        // Show current balance
        document.getElementById('icCurrentQty').style.display = 'block';
        document.getElementById('icCurrentQtyVal').textContent = qty;
        document.getElementById('icRealQty').value = qty;
        this._icCalcDelta();
    },

    _icClearSelect() {
        const sel = document.getElementById('icSizeSelect');
        if (sel) sel.value = '';
        document.getElementById('icCurrentQty').style.display = 'none';
        document.getElementById('icDeltaBox').style.display = 'none';
    },

    _icCalcDelta() {
        const itemId = document.querySelector('[id="invCorrModal"]')
            ?.querySelector('[onclick*="confirmInventoryCorrection"]')
            ?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (!itemId) return;

        const item = this.warehouse[itemId];
        const newSize = document.getElementById('icNewSize')?.value.trim();
        const color = document.getElementById('icColor')?.value.trim();
        if (!newSize || !color) { document.getElementById('icDeltaBox').style.display = 'none'; return; }

        const key = color ? `${newSize} - ${color}` : newSize;
        const currentQty = item?.sizes?.[key] ?? item?.sizes?.[newSize] ?? 0;

        // Show current qty
        document.getElementById('icCurrentQty').style.display = 'block';
        document.getElementById('icCurrentQtyVal').textContent = currentQty;

        const realQty = parseInt(document.getElementById('icRealQty')?.value) || 0;
        const delta = realQty - currentQty;

        const box = document.getElementById('icDeltaBox');
        const content = document.getElementById('icDeltaContent');
        box.style.display = 'block';

        if (delta === 0) {
            content.style.borderColor = 'var(--gold)';
            content.style.background = 'rgba(201,168,76,.05)';
            content.innerHTML = `<i class="fas fa-equals" style="color:var(--gold);font-size:1.2rem"></i>
                <div style="font-weight:800;color:var(--gold);margin-top:.3rem">لا يوجد فرق — الكمية مطابقة</div>`;
        } else if (delta > 0) {
            content.style.borderColor = 'var(--emerald)';
            content.style.background = 'rgba(26,107,74,.05)';
            content.innerHTML = `<div style="font-size:.8rem;color:var(--ink-mid)">الفرق المكتشف</div>
                <div style="font-size:2rem;font-weight:900;color:var(--emerald);line-height:1.1">+${delta}</div>
                <div style="font-size:.78rem;color:var(--emerald)">سيتم إضافة ${delta} قطعة للمستودع</div>`;
        } else {
            content.style.borderColor = 'var(--ruby-light)';
            content.style.background = 'rgba(192,37,86,.05)';
            content.innerHTML = `<div style="font-size:.8rem;color:var(--ink-mid)">الفرق المكتشف</div>
                <div style="font-size:2rem;font-weight:900;color:var(--ruby-light);line-height:1.1">${delta}</div>
                <div style="font-size:.78rem;color:var(--ruby-light)">سيتم خصم ${Math.abs(delta)} قطعة من المستودع</div>`;
        }
    },

    async confirmInventoryCorrection(itemId) {
        const item = this.warehouse[itemId]; if (!item) return;

        const newSize = document.getElementById('icNewSize')?.value.trim();
        const color   = document.getElementById('icColor')?.value.trim();
        const realQty = parseInt(document.getElementById('icRealQty')?.value);
        const barcode = document.getElementById('icBarcode')?.value.trim().toUpperCase()
                        || item.barcode
                        || ('JW' + Math.random().toString(36).substr(2,6).toUpperCase());
        const reason  = document.getElementById('icReason')?.value || 'تصحيح جرد دوري';
        const notes   = document.getElementById('icNotes')?.value.trim() || '';

        if (!newSize) { this.toast('يرجى تحديد المقاس', 'error'); return; }
        if (!color)   { this.toast('يرجى تحديد اللون', 'error'); return; }
        if (isNaN(realQty) || realQty < 0) { this.toast('يرجى إدخال الكمية الفعلية', 'error'); return; }

        const key = `${newSize} - ${color}`;
        const currentQty = item.sizes?.[key] ?? item.sizes?.[newSize] ?? 0;
        const delta = realQty - currentQty;

        if (delta === 0) {
            this.toast('الكمية الفعلية مطابقة للمخزون — لا حاجة لتصحيح', 'info');
            document.getElementById('invCorrModal')?.remove();
            return;
        }

        if (realQty < 0) { this.toast('الكمية لا يمكن أن تكون سالبة', 'error'); return; }

        const confirmMsg = delta > 0
            ? `سيتم إضافة ${delta} قطعة. هل أنت متأكد؟`
            : `تحذير: سيتم خصم ${Math.abs(delta)} قطعة. الكمية الجديدة ستكون ${realQty}. متأكد؟`;
        if (!confirm(confirmMsg)) return;

        const updates = {};
        updates[`jawaher_warehouse/${itemId}/sizes/${key}`] = realQty;

        // حفظ variation مع الباركود — سواء جديد أو موجود
        const vHex = document.getElementById('icColor')?.dataset?.hex || this._colorHex(color) || '';
        updates[`jawaher_warehouse/${itemId}/variations/${key}`] = {
            size: newSize, color, hex: vHex, barcode
        };
        updates[`jawaher_warehouse/${itemId}/sizeColors/${key}`] = color;

        await update(ref(db), updates);

        const logDetail = `تصحيح جرد: من ${currentQty} → ${realQty} (فرق: ${delta > 0 ? '+' : ''}${delta}) | اللون: ${color} | المقاس: ${newSize} | الباركود: ${barcode} | السبب: ${reason}${notes ? ' | ملاحظات: ' + notes : ''}`;
        this.log('stock_correction', itemId, logDetail);
        this.toast(`تم تصحيح الجرد بنجاح ✓ (${delta > 0 ? '+' : ''}${delta} قطعة)`, delta >= 0 ? 'success' : 'warning');
        document.getElementById('invCorrModal')?.remove();
    },

    
    // ════════════════════════════════════════════════════════════
    // ██╗   ██╗███████╗███████╗██████╗ ███████╗
    // ██║   ██║██╔════╝██╔════╝██╔══██╗██╔════╝
    // ██║   ██║███████╗█████╗  ██████╔╝███████╗
    // ██║   ██║╚════██║██╔══╝  ██╔══██╗╚════██║
    // ╚██████╔╝███████║███████╗██║  ██║███████║
    //  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
    // ════ USERS & PERMISSIONS MANAGEMENT MODULE ════

    // ── Render the full users page ───────────────────────────
    renderUsersPage() {
        if (this.role !== 'Admin') return;

        // Merge Firebase users with constants.js built-in users
        const builtIn = Object.entries({
            admin:    { pass:'***', role:'Admin',    name:'المدير العام', builtin:true },
            basel:    { pass:'***', role:'Admin',    name:'باسل',          builtin:true },
            user:     { pass:'***', role:'User',     name:'موظف إدخال',   builtin:true },
            delivery: { pass:'***', role:'Delivery', name:'عامل التوصيل', builtin:true }
        });

        const fbUsers = Object.entries(this.sysUsers || {});
        const q = (document.getElementById('usrSearch')?.value || '').toLowerCase();
        const roleF = document.getElementById('usrRoleFilter')?.value || '';

        const allUsers = [
            ...builtIn.map(([id, u]) => ({ id, ...u, source: 'builtin' })),
            ...fbUsers.map(([id, u]) => ({ id, ...u, source: 'firebase' }))
        ].filter(u => {
            if (q && !u.name.toLowerCase().includes(q) && !u.id.includes(q)) return false;
            if (roleF && u.role !== roleF) return false;
            return true;
        });

        // KPIs
        const total = builtIn.length + fbUsers.length;
        const active = fbUsers.filter(([,u]) => !u.disabled).length + builtIn.length;
        const disabled = fbUsers.filter(([,u]) => u.disabled).length;
        const admins = [...builtIn.filter(([,u]) => u.role==='Admin'), ...fbUsers.filter(([,u]) => u[1]?.role==='Admin')].length;

        const kpiHtml = `
        <div class="kpi-grid" style="margin-bottom:1.5rem">
            <div class="kpi-card kpi-gold"><i class="fas fa-users kpi-icon"></i><div class="kpi-label">إجمالي المستخدمين</div><div class="kpi-value">${total}</div></div>
            <div class="kpi-card kpi-emerald"><i class="fas fa-user-check kpi-icon"></i><div class="kpi-label">نشطون</div><div class="kpi-value">${active}</div></div>
            <div class="kpi-card kpi-ruby"><i class="fas fa-user-slash kpi-icon"></i><div class="kpi-label">معطّلون</div><div class="kpi-value">${disabled}</div></div>
            <div class="kpi-card kpi-sapphire"><i class="fas fa-user-shield kpi-icon"></i><div class="kpi-label">مديرون</div><div class="kpi-value">${admins + builtIn.filter(([,u])=>u.role==='Admin').length}</div></div>
        </div>`;

        const roleColors = { Admin:'badge-delivered', User:'badge-process', Delivery:'badge-done' };
        const roleAr = { Admin:'مدير', User:'مستخدم', Delivery:'توصيل' };

        const tableRows = allUsers.map(u => {
            const isDisabled = u.disabled;
            const isBuiltin = u.source === 'builtin';
            const permsCount = u.perms ? Object.keys(u.perms).length : 0;
            const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('ar-JO') : '—';
            const createdAt = u.createdAt ? new Date(u.createdAt).toLocaleDateString('ar-JO') : 'مدمج';
            return `
            <tr style="opacity:${isDisabled?'.5':'1'};transition:all .2s" onmouseenter="this.style.background='rgba(201,168,76,.04)'" onmouseleave="this.style.background=''">
                <td>
                    <div style="display:flex;align-items:center;gap:.6rem">
                        <div style="width:36px;height:36px;border-radius:50%;background:${isDisabled?'var(--border)':'linear-gradient(135deg,var(--gold),var(--gold-dark))'};display:flex;align-items:center;justify-content:center;color:${isDisabled?'var(--ink-mid)':'#fff'};font-weight:800;font-size:.9rem;flex-shrink:0">${u.name?.[0]||'?'}</div>
                        <div>
                            <div style="font-weight:800;font-size:.88rem">${u.name}</div>
                            <div style="font-size:.72rem;color:var(--ink-mid);font-family:monospace">${u.id}</div>
                        </div>
                    </div>
                </td>
                <td><span class="badge-j ${roleColors[u.role]||'badge-new'}">${roleAr[u.role]||u.role}</span></td>
                <td style="text-align:center">
                    ${isDisabled
                        ? '<span class="badge-j badge-canceled"><i class="fas fa-times-circle"></i> معطّل</span>'
                        : '<span class="badge-j badge-done"><i class="fas fa-check-circle"></i> نشط</span>'}
                </td>
                <td style="text-align:center;font-size:.8rem;color:var(--ink-mid)">${permsCount > 0 ? permsCount + ' قاعدة' : isBuiltin ? 'افتراضي' : 'كاملة'}</td>
                <td style="text-align:center;font-size:.78rem;color:var(--ink-mid)">${lastLogin}</td>
                <td style="text-align:center;font-size:.78rem;color:var(--ink-mid)">${createdAt}</td>
                <td style="text-align:center">
                    ${isBuiltin
                        ? '<span style="font-size:.72rem;color:var(--ink-mid);font-style:italic">مدمج في النظام</span>'
                        : `<div style="display:flex;gap:.35rem;justify-content:center;flex-wrap:wrap">
                            <button class="btn-j btn-gold btn-xs-j" onclick="app.openEditUserModal('${u.id}')" title="تعديل"><i class="fas fa-edit"></i></button>
                            <button class="btn-j btn-xs-j" style="background:${isDisabled?'rgba(26,107,74,.15)':'rgba(139,26,58,.1)'};color:${isDisabled?'var(--emerald)':'var(--ruby-light)'}"
                                onclick="app.toggleUserDisabled('${u.id}',${!isDisabled})" title="${isDisabled?'تفعيل':'تعطيل'}">
                                <i class="fas fa-${isDisabled?'user-check':'user-slash'}"></i>
                            </button>
                            <button class="btn-j btn-ruby btn-xs-j" onclick="app.deleteSystemUser('${u.id}')" title="حذف"><i class="fas fa-trash"></i></button>
                        </div>`}
                </td>
            </tr>`;
        }).join('');

        const container = document.getElementById('usrPageContent');
        if (!container) return;
        container.innerHTML = kpiHtml + `
        <div class="card-j" style="overflow:hidden">
            <div class="table-wrap" style="max-height:560px;overflow-y:auto">
                <table class="table-j">
                    <thead><tr>
                        <th>المستخدم</th>
                        <th style="text-align:center">الدور</th>
                        <th style="text-align:center">الحالة</th>
                        <th style="text-align:center">الصلاحيات</th>
                        <th style="text-align:center">آخر دخول</th>
                        <th style="text-align:center">تاريخ الإنشاء</th>
                        <th style="text-align:center">إجراءات</th>
                    </tr></thead>
                    <tbody>${tableRows || '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--ink-mid)">لا يوجد مستخدمون</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
    },

    // ── Open create-user modal ───────────────────────────────
    openCreateUserModal() {
        if (this.role !== 'Admin') return;
        const modal = document.createElement('div');
        modal.className = 'modal-j open'; modal.id = 'createUserModal';
        modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('createUserModal').remove()"></div>
        <div class="modal-sheet" style="max-width:520px">
            <div class="modal-handle"></div>
            <div class="modal-title"><i class="fas fa-user-plus" style="color:var(--gold)"></i> إنشاء مستخدم جديد</div>
            <div class="row g-3">
                <div class="col-md-6">
                    <label class="form-label-j">الاسم الكامل <span style="color:var(--ruby-light)">*</span></label>
                    <input type="text" id="cuName" class="form-control-j" placeholder="مثال: أحمد محمد">
                </div>
                <div class="col-md-6">
                    <label class="form-label-j">اسم المستخدم (Login ID) <span style="color:var(--ruby-light)">*</span></label>
                    <input type="text" id="cuUsername" class="form-control-j" placeholder="مثال: ahmed123" dir="ltr">
                </div>
                <div class="col-md-6">
                    <label class="form-label-j">كلمة المرور <span style="color:var(--ruby-light)">*</span></label>
                    <input type="password" id="cuPass" class="form-control-j" placeholder="8 أحرف على الأقل" dir="ltr">
                </div>
                <div class="col-md-6">
                    <label class="form-label-j">تأكيد كلمة المرور <span style="color:var(--ruby-light)">*</span></label>
                    <input type="password" id="cuPass2" class="form-control-j" placeholder="أعد كتابة المرور" dir="ltr">
                </div>
                <div class="col-md-6">
                    <label class="form-label-j">الدور / Role <span style="color:var(--ruby-light)">*</span></label>
                    <div class="select-wrapper">
                        <select id="cuRole" class="form-control-j select-j" onchange="app._cuRoleChanged()">
                            <option value="User">مستخدم — User</option>
                            <option value="Admin">مدير — Admin</option>
                            <option value="Delivery">توصيل — Delivery</option>
                        </select>
                    </div>
                </div>
                <div class="col-md-6" style="display:flex;align-items:flex-end">
                    <div style="background:rgba(201,168,76,.06);border:1px solid var(--border);border-radius:10px;padding:.6rem .85rem;font-size:.78rem;color:var(--ink-mid);width:100%">
                        <i class="fas fa-info-circle" style="color:var(--gold)"></i>
                        <span id="cuRoleDesc">وصول للطلبات وإدخال البيانات فقط</span>
                    </div>
                </div>

                <!-- Permissions Panel -->
                <div class="col-12" id="cuPermsPanel">
                    <div style="font-weight:800;font-size:.85rem;margin-bottom:.75rem;color:var(--ink-mid)">
                        <i class="fas fa-shield-alt" style="color:var(--gold)"></i> الصلاحيات المخصصة
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
                        ${this._buildPermCheckboxes()}
                    </div>
                </div>
            </div>
            <div class="d-flex gap-3 mt-4">
                <button class="btn-j btn-gold flex-fill" onclick="app.saveNewSystemUser()">
                    <i class="fas fa-save"></i> إنشاء الحساب
                </button>
                <button class="btn-j btn-ghost" onclick="document.getElementById('createUserModal').remove()">إلغاء</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    },

    _buildPermCheckboxes(existingPerms = {}) {
        const perms = [
            { key:'canDelete',       label:'حذف البيانات',        icon:'fa-trash' },
            { key:'canExport',       label:'تصدير Excel',          icon:'fa-file-excel' },
            { key:'canSeePrices',    label:'رؤية الأسعار والإيرادات', icon:'fa-eye' },
            { key:'canEditOrders',   label:'تعديل الطلبات',        icon:'fa-edit' },
            { key:'canMoveStatus',   label:'تغيير حالة الطلبات',   icon:'fa-exchange-alt' },
            { key:'canManageStock',  label:'إدارة المستودع',       icon:'fa-warehouse' },
            { key:'canViewReports',  label:'التقارير والإحصاءات',  icon:'fa-chart-bar' },
            { key:'canManageReturns',label:'إدارة المرتجعات',      icon:'fa-undo-alt' },
        ];
        return perms.map(p => `
            <label style="display:flex;align-items:center;gap:.5rem;padding:.45rem .6rem;background:var(--paper-warm);border-radius:8px;cursor:pointer;border:1px solid var(--border);font-size:.8rem">
                <input type="checkbox" id="perm_${p.key}" ${existingPerms[p.key]?'checked':''} style="width:15px;height:15px;accent-color:var(--gold)">
                <i class="fas ${p.icon}" style="color:var(--gold);width:14px"></i>
                ${p.label}
            </label>`).join('');
    },

    _cuRoleChanged() {
        const role = document.getElementById('cuRole')?.value;
        const desc = { Admin:'وصول كامل لجميع الصفحات والإعدادات', User:'وصول للطلبات وإدخال البيانات فقط', Delivery:'وصول لتقارير التوصيل فقط' };
        const el = document.getElementById('cuRoleDesc');
        if (el) el.textContent = desc[role] || '';
        const panel = document.getElementById('cuPermsPanel');
        if (panel) panel.style.display = role === 'Admin' ? 'none' : '';
    },

    async saveNewSystemUser() {
        const name = document.getElementById('cuName').value.trim();
        const username = document.getElementById('cuUsername').value.trim().toLowerCase();
        const pass = document.getElementById('cuPass').value;
        const pass2 = document.getElementById('cuPass2').value;
        const role = document.getElementById('cuRole').value;

        if (!name || !username || !pass) { this.toast('يرجى ملء جميع الحقول المطلوبة', 'error'); return; }
        if (pass !== pass2) { this.toast('كلمتا المرور غير متطابقتين', 'error'); return; }
        if (pass.length < 6) { this.toast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error'); return; }
        if (!/^[a-z0-9_]+$/.test(username)) { this.toast('اسم المستخدم: أحرف إنجليزية وأرقام وشرطة سفلية فقط', 'error'); return; }

        // Check uniqueness
        if (this.sysUsers[username] || ['admin','basel','user','delivery'].includes(username)) {
            this.toast('اسم المستخدم مستخدم بالفعل', 'error'); return;
        }

        const permKeys = ['canDelete','canExport','canSeePrices','canEditOrders','canMoveStatus','canManageStock','canViewReports','canManageReturns'];
        const perms = {};
        permKeys.forEach(k => {
            const el = document.getElementById('perm_' + k);
            if (el) perms[k] = el.checked;
        });

        const passHash = await this._hash(pass);
        const userData = { name, role, passHash, perms, disabled: false, createdAt: Date.now(), createdBy: this.userName };

        await update(ref(db, 'jawaher_system_users/' + username), userData);
        this.log('user_create', username, 'إنشاء مستخدم جديد: ' + name + ' | الدور: ' + role);
        this.toast('تم إنشاء الحساب بنجاح ✓', 'success');
        document.getElementById('createUserModal')?.remove();
        this.renderUsersPage();
    },

    // ── Open edit-user modal ─────────────────────────────────
    openEditUserModal(userId) {
        if (this.role !== 'Admin') return;
        const u = this.sysUsers[userId]; if (!u) return;
        const modal = document.createElement('div');
        modal.className = 'modal-j open'; modal.id = 'editUserModal';
        modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('editUserModal').remove()"></div>
        <div class="modal-sheet" style="max-width:520px">
            <div class="modal-handle"></div>
            <div class="modal-title"><i class="fas fa-user-edit" style="color:var(--gold)"></i> تعديل: <span style="color:var(--gold)">${u.name}</span></div>
            <div class="row g-3">
                <div class="col-md-6">
                    <label class="form-label-j">الاسم الكامل</label>
                    <input type="text" id="euName" class="form-control-j" value="${u.name}">
                </div>
                <div class="col-md-6">
                    <label class="form-label-j">Login ID</label>
                    <input type="text" class="form-control-j" value="${userId}" disabled style="opacity:.6;font-family:monospace" dir="ltr">
                </div>
                <div class="col-12">
                    <label class="form-label-j">كلمة مرور جديدة <span style="color:var(--ink-mid);font-size:.75rem">(اتركها فارغة لعدم التغيير)</span></label>
                    <input type="password" id="euPass" class="form-control-j" placeholder="أدخل لتغيير المرور" dir="ltr">
                </div>
                <div class="col-md-6">
                    <label class="form-label-j">الدور</label>
                    <div class="select-wrapper">
                        <select id="euRole" class="form-control-j select-j">
                            <option value="User" ${u.role==='User'?'selected':''}>مستخدم</option>
                            <option value="Admin" ${u.role==='Admin'?'selected':''}>مدير</option>
                            <option value="Delivery" ${u.role==='Delivery'?'selected':''}>توصيل</option>
                        </select>
                    </div>
                </div>
                <div class="col-md-6" style="display:flex;align-items:flex-end">
                    <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;padding:.6rem;background:var(--paper-warm);border-radius:10px;width:100%;border:1px solid var(--border)">
                        <input type="checkbox" id="euDisabled" ${u.disabled?'checked':''} style="width:16px;height:16px;accent-color:var(--ruby-light)">
                        <span style="font-size:.82rem"><i class="fas fa-user-slash" style="color:var(--ruby-light)"></i> تعطيل الحساب</span>
                    </label>
                </div>
                <div class="col-12">
                    <div style="font-weight:800;font-size:.85rem;margin-bottom:.75rem;color:var(--ink-mid)">
                        <i class="fas fa-shield-alt" style="color:var(--gold)"></i> الصلاحيات
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
                        ${this._buildPermCheckboxes(u.perms || {})}
                    </div>
                </div>
            </div>
            <div class="d-flex gap-3 mt-4">
                <button class="btn-j btn-gold flex-fill" onclick="app.saveEditedUser('${userId}')">
                    <i class="fas fa-save"></i> حفظ التغييرات
                </button>
                <button class="btn-j btn-ghost" onclick="document.getElementById('editUserModal').remove()">إلغاء</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    },

    async saveEditedUser(userId) {
        const name = document.getElementById('euName').value.trim();
        const role = document.getElementById('euRole').value;
        const disabled = document.getElementById('euDisabled').checked;
        const newPass = document.getElementById('euPass').value;

        if (!name) { this.toast('الاسم مطلوب', 'error'); return; }

        const permKeys = ['canDelete','canExport','canSeePrices','canEditOrders','canMoveStatus','canManageStock','canViewReports','canManageReturns'];
        const perms = {};
        permKeys.forEach(k => {
            const el = document.getElementById('perm_' + k);
            if (el) perms[k] = el.checked;
        });

        const updates = { name, role, disabled, perms, updatedAt: Date.now(), updatedBy: this.userName };
        if (newPass) {
            if (newPass.length < 6) { this.toast('كلمة المرور 6 أحرف على الأقل', 'error'); return; }
            updates.passHash = await this._hash(newPass);
        }

        await update(ref(db, 'jawaher_system_users/' + userId), updates);
        this.log('user_edit', userId, 'تعديل بيانات المستخدم: ' + name + ' | الدور: ' + role + (disabled?' [معطّل]':''));
        this.toast('تم حفظ التغييرات ✓', 'success');
        document.getElementById('editUserModal')?.remove();
        this.renderUsersPage();
    },

    // ── Toggle disable/enable ────────────────────────────────
    async toggleUserDisabled(userId, disable) {
        if (userId === this.user) { this.toast('لا يمكنك تعطيل حسابك الحالي', 'error'); return; }
        const u = this.sysUsers[userId]; if (!u) return;
        const label = disable ? 'تعطيل' : 'تفعيل';
        if (!confirm(`${label} حساب "${u.name}"؟`)) return;
        await update(ref(db, 'jawaher_system_users/' + userId), { disabled: disable });
        this.log('user_toggle', userId, (disable?'تعطيل':'تفعيل') + ' حساب: ' + u.name);
        this.toast(`تم ${label} الحساب`, disable ? 'warning' : 'success');
        this.renderUsersPage();
    },

    // ── Delete user permanently ──────────────────────────────
    async deleteSystemUser(userId) {
        if (userId === this.user) { this.toast('لا يمكنك حذف حسابك الحالي', 'error'); return; }
        const u = this.sysUsers[userId];
        if (!confirm(`حذف مستخدم "${u?.name}" نهائياً؟ لا يمكن التراجع.`)) return;
        await remove(ref(db, 'jawaher_system_users/' + userId));
        this.log('user_delete', userId, 'حذف نهائي للمستخدم: ' + (u?.name || userId));
        this.toast('تم حذف المستخدم نهائياً', 'warning');
        this.renderUsersPage();
    },


    // ══════════════════════════════════════════════════════════
    // ██╗    ██╗██╗███████╗ █████╗ ██████╗ ██████╗
    // ██║    ██║██║╚══███╔╝██╔══██╗██╔══██╗██╔══██╗
    // ██║ █╗ ██║██║  ███╔╝ ███████║██████╔╝██║  ██║
    // ██║███╗██║██║ ███╔╝  ██╔══██║██╔══██╗██║  ██║
    // ╚███╔███╔╝██║███████╗██║  ██║██║  ██║██████╔╝
    //  ╚══╝╚══╝ ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝
    // ════ TYPEFORM-STYLE ORDER WIZARD ════

    // Wizard state
    _wiz: { step: 0, items: [] },

    // Steps definition
    _wizSteps() {
        return [
            { key: 'custName',     label: 'اسم الزبون',         icon: 'fa-user' },
            { key: 'mobile',       label: 'رقم الموبايل',       icon: 'fa-phone' },
            { key: 'location',     label: 'الموقع والعنوان',    icon: 'fa-map-marker-alt' },
            { key: 'contact',      label: 'مكان التواصل',       icon: 'fa-comments' },
            { key: 'products',     label: 'المنتجات',           icon: 'fa-boxes' },
            { key: 'pricing',      label: 'السعر والمصدر',      icon: 'fa-tag' },
            { key: 'confirm',      label: 'مراجعة وتأكيد',      icon: 'fa-check-circle' },
        ];
    },

    startWizard() {
        this._wiz = { step: 0, custName: '', mobile: '', governorate: 'العاصمة (عمّان)', addr: '', price: '', tags: '', pageName: '', entryUser: this.userName, items: [], contactChannel: '', weightKg: '', lengthCm: '' };
        this.itemRows = [{}];
        document.getElementById('wiz-shell').style.display = 'flex';
        document.getElementById('wiz-success').style.display = 'none';
        this._wizRender();
    },

    _wizRender() {
        const steps = this._wizSteps();
        const s = this._wiz.step;
        const total = steps.length;

        // Progress
        document.getElementById('wiz-step-label').textContent = steps[s].label;
        document.getElementById('wiz-step-count').textContent = `${s + 1} من ${total}`;
        document.getElementById('wiz-progress').style.width = `${((s + 1) / total) * 100}%`;

        const body = document.getElementById('wiz-body');
        const nav  = document.getElementById('wiz-nav');

        body.innerHTML = '';
        nav.innerHTML  = '';

        // Render step content
        switch (s) {
            case 0: this._wizStepName(body); break;
            case 1: this._wizStepMobile(body); break;
            case 2: this._wizStepLocation(body); break;
            case 3: this._wizStepContact(body); break;
            case 4: this._wizStepProducts(body); break;
            case 5: this._wizStepPricing(body); break;
            case 6: this._wizStepConfirm(body); break;
        }

        // Nav buttons
        if (s > 0) {
            const back = document.createElement('button');
            back.className = 'btn-j btn-ghost';
            back.innerHTML = '<i class="fas fa-arrow-right"></i> تراجع';
            back.onclick = () => { this._wiz.step--; this._wizRender(); };
            nav.appendChild(back);
        }
        if (s < total - 1) {
            const next = document.createElement('button');
            next.className = 'btn-j btn-gold flex-fill';
            next.style.fontSize = '1rem';
            next.innerHTML = 'التالي <i class="fas fa-arrow-left"></i>';
            next.onclick = () => this._wizNext();
            nav.appendChild(next);
        } else {
            const save = document.createElement('button');
            save.className = 'btn-j btn-emerald flex-fill';
            save.style.fontSize = '1rem';
            save.innerHTML = '<i class="fas fa-check-circle"></i> تأكيد وحفظ الطلب';
            save.onclick = () => this._wizSave();
            nav.appendChild(save);
        }

        // Auto-focus first input
        setTimeout(() => { body.querySelector('input:not([type=hidden])') ?.focus(); }, 120);
    },

    _wizLabel(text, req = true) {
        return `<div style="font-size:1.5rem;font-weight:800;color:var(--ink);margin-bottom:1.5rem;line-height:1.3">${text}${req ? ' <span style="color:var(--ruby-light)">*</span>' : ''}</div>`;
    },

    _wizStepName(body) {
        body.innerHTML = this._wizLabel('ما اسم الزبون؟') + `
            <input type="text" id="wiz_custName" class="form-control-j" style="font-size:1.2rem;padding:.85rem 1rem"
                placeholder="الاسم الكامل..." value="${this._wiz.custName}"
                onkeydown="if(event.key==='Enter')app._wizNext()">`;
    },

   _wizStepMobile(body) {
        body.innerHTML = this._wizLabel('رقم الموبايل') + `
      <div style="display:flex;flex-direction:row;gap:.5rem;align-items:stretch" dir="ltr">
        <span style="background:var(--paper-warm);border:1.5px solid var(--border);border-radius:12px;padding:.9rem 1.1rem;font-size:1.15rem;font-weight:800;color:var(--ink-mid);white-space:nowrap;display:flex;align-items:center;flex-shrink:0">07</span>
        <input type="tel" id="wiz_mobile" class="form-control-j"
          inputmode="numeric" pattern="[0-9]*"
          style="font-size:1.4rem;padding:.9rem 1rem;flex:1;text-align:left;letter-spacing:2px;min-height:54px" dir="ltr"
          placeholder="9XXXXXXX" maxlength="8" value="${this._wiz.mobile}"
          oninput="this.value=this.value.replace(/\\D/g,'');app._wizCheckDup(this.value)"
          onkeydown="if(event.key==='Enter')app._wizNext()">
      </div>
      <div style="font-size:.75rem;color:var(--ink-mid);margin-top:.5rem;text-align:center">
        أدخل 8 أرقام بعد 07 — مثال: 9XXXXXXX
      </div>
      <div id="wiz_dup" style="margin-top:.75rem;font-size:.82rem;display:none"></div>`;
        // Check duplicate
        if (this._wiz.mobile.length === 8) this._wizCheckDup(this._wiz.mobile);
        document.getElementById('wiz_mobile')?.addEventListener('input', e => {
            if (e.target.value.length === 8) this._wizCheckDup(e.target.value);
        });
    },

    _wizCheckDup(mob) {
        const full = '07' + mob;
        const match = Object.values(this.orders).filter(o => o.custMob === full);
        const box = document.getElementById('wiz_dup');
        if (!box) return;
        if (match.length > 0) {
            const last = match.sort((a,b)=>b.timestamp-a.timestamp)[0];
            box.style.display = 'block';
            box.innerHTML = `<div style="background:rgba(201,168,76,.08);border:1px solid var(--gold);border-radius:10px;padding:.6rem .9rem">
                <i class="fas fa-history" style="color:var(--gold)"></i>
                زبون موجود: <strong>${last.custName}</strong> — آخر طلب: ${last.date}
            </div>`;
        } else {
            box.style.display = 'none';
        }
    },

    _wizStepLocation(body) {
        const govs = ['العاصمة (عمّان)','إربد','الزرقاء','المفرق','البلقاء','الكرك','الطفيلة','معان','العقبة','جرش','عجلون','مادبا'];
        const opts = govs.map(g => `<option value="${g}" ${this._wiz.governorate===g?'selected':''}>${g}</option>`).join('');
        body.innerHTML = this._wizLabel('الموقع والعنوان') + `
            <div class="select-wrapper" style="margin-bottom:1rem">
                <select id="wiz_gov" class="form-control-j select-j" style="font-size:1.05rem">${opts}</select>
            </div>
            <input type="text" id="wiz_addr" class="form-control-j" style="font-size:1.05rem;padding:.85rem 1rem"
                placeholder="المنطقة - الشارع - أقرب نقطة دالة..." value="${this._wiz.addr}"
                onkeydown="if(event.key==='Enter')app._wizNext()">`;
    },

    _wizStepContact(body) {
        const channels = [
            { key: 'واتس اب',  label: 'واتساب',    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.557 4.126 1.526 5.858L.057 23.888a.5.5 0 0 0 .617.6l6.162-1.615A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.694-.528-5.217-1.446l-.374-.224-3.878 1.016 1.033-3.772-.244-.389A9.952 9.952 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>`, color: '#25D366' },
            { key: 'انستا',    label: 'انستغرام',  icon: `<svg width="28" height="28" viewBox="0 0 24 24"><defs><radialGradient id="ig2" cx="30%" cy="107%" r="150%"><stop offset="0%" stop-color="#fdf497"/><stop offset="45%" stop-color="#fd5949"/><stop offset="60%" stop-color="#d6249f"/><stop offset="90%" stop-color="#285AEB"/></radialGradient></defs><path fill="url(#ig2)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`, color: '#d6249f' },
            { key: 'فيس بوك', label: 'فيسبوك',    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`, color: '#1877F2' },
        ];
        const cur = this._wiz.contactChannel;
        body.innerHTML = this._wizLabel('مكان التواصل مع الزبون') + `
            <div style="display:flex;gap:1rem;justify-content:center;margin-bottom:1.5rem" id="wiz_contact_btns">
                ${channels.map(ch => `
                    <button type="button" id="wiz_ch_${ch.key.replace(/\s/g,'_')}"
                        onclick="app._wizSelectContact('${ch.key}')"
                        style="display:flex;flex-direction:column;align-items:center;gap:.4rem;padding:.9rem 1.1rem;border-radius:14px;border:2.5px solid ${cur===ch.key ? ch.color : 'var(--border)'};background:${cur===ch.key ? ch.color+'15' : 'var(--paper-warm)'};cursor:pointer;transition:all .18s;min-width:80px">
                        ${ch.icon}
                        <span style="font-size:.78rem;font-weight:700;color:${cur===ch.key ? ch.color : 'var(--ink-mid)'}">${ch.label}</span>
                    </button>`).join('')}
            </div>
            <div style="border-top:1px solid var(--border);padding-top:1rem;margin-top:.5rem">
                <div style="font-size:.85rem;color:var(--ink-mid);font-weight:600;margin-bottom:.75rem">الوزن والطول <span style="color:var(--ink-mid);font-weight:400;font-size:.75rem">(اختياري)</span></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                    <div>
                        <label style="font-size:.78rem;color:var(--ink-mid);display:block;margin-bottom:.3rem">الوزن (kg)</label>
                        <input type="number" id="wiz_weight" class="form-control-j" style="font-size:1rem;padding:.65rem .8rem"
                            placeholder="مثال: 0.5" step="0.1" min="0" value="${this._wiz.weightKg}"
                            onkeydown="if(event.key==='Enter')app._wizNext()">
                    </div>
                    <div>
                        <label style="font-size:.78rem;color:var(--ink-mid);display:block;margin-bottom:.3rem">الطول (cm)</label>
                        <input type="number" id="wiz_length" class="form-control-j" style="font-size:1rem;padding:.65rem .8rem"
                            placeholder="مثال: 30" step="1" min="0" value="${this._wiz.lengthCm}"
                            onkeydown="if(event.key==='Enter')app._wizNext()">
                    </div>
                </div>
            </div>`;
    },

    _wizSelectContact(key) {
        this._wiz.contactChannel = key;
        // Re-render just the buttons highlight
        const channels = { 'واتس اب': '#25D366', 'انستا': '#d6249f', 'فيس بوك': '#1877F2' };
        Object.entries(channels).forEach(([k, color]) => {
            const btn = document.getElementById('wiz_ch_' + k.replace(/\s/g,'_'));
            if (!btn) return;
            const selected = k === key;
            btn.style.borderColor = selected ? color : 'var(--border)';
            btn.style.background  = selected ? color + '15' : 'var(--paper-warm)';
            btn.querySelector('span').style.color = selected ? color : 'var(--ink-mid)';
        });
    },

    _wizStepProducts(body) {
        body.innerHTML = `<div style="font-size:1.3rem;font-weight:800;color:var(--ink);margin-bottom:1.25rem"><i class="fas fa-boxes" style="color:var(--gold)"></i> المنتجات</div>
        <div id="eItemsList" style="display:block"></div>
        <button class="add-item-row-btn" onclick="app.addItemRow()">
            <i class="fas fa-plus-circle" style="color:var(--gold)"></i> إضافة منتج آخر
        </button>`;
        this.renderItemRows();
    },

    _wizStepPricing(body) {
        const hasAutoPage = !!this._wiz.pageName;
        const items = this._wiz.collectedItems || [];
        const savedDelivery = this._wiz.deliveryFee !== undefined ? this._wiz.deliveryFee : 3;

        // حساب مجموع أسعار كل الأصناف (كل صنف × كميته)
        const itemsBreakdown = items.map(it => {
            const w = this.warehouse[it.itemId];
            const sp = w?.sellPrice ? parseFloat(w.sellPrice) : null;
            return { name: it.itemName, qty: it.qty || 1, sellPrice: sp, itemId: it.itemId };
        });
        const totalItemsPrice = itemsBreakdown.every(i => i.sellPrice !== null)
            ? itemsBreakdown.reduce((sum, i) => sum + i.sellPrice * i.qty, 0)
            : null;
        const savedTotal = this._wiz.price || (totalItemsPrice !== null ? (totalItemsPrice + savedDelivery).toFixed(2) : '');

        // صفوف الأصناف مع سعر قابل للتعديل لكل صنف
        const itemRows = itemsBreakdown.map((it, idx) => `
            <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
                <div style="flex:1;font-size:.82rem;font-weight:700;color:var(--ink)">${it.name}
                    ${it.qty > 1 ? `<span style="font-size:.72rem;color:var(--ink-mid);margin-right:3px">×${it.qty}</span>` : ''}
                </div>
                <input type="number" id="wiz_item_price_${idx}" min="0" step="0.5"
                    style="width:80px;text-align:center;font-size:.88rem;font-weight:800;padding:3px 6px;border:1.5px solid var(--emerald);border-radius:8px;background:rgba(26,107,74,.06);color:var(--emerald)"
                    value="${it.sellPrice !== null ? it.sellPrice : ''}"
                    placeholder="السعر"
                    oninput="app._wizCalcTotal()">
                <span style="font-size:.72rem;color:var(--ink-mid)">JOD</span>
            </div>`).join('');

        body.innerHTML = this._wizLabel('السعر والمصدر') + `
            <!-- أسعار الأصناف -->
            <div style="background:rgba(26,107,74,.04);border:1px solid rgba(26,107,74,.18);border-radius:10px;padding:8px 12px;margin-bottom:.75rem">
                <div style="font-size:.72rem;color:var(--ink-mid);font-weight:700;margin-bottom:4px"><i class="fas fa-tag" style="color:var(--emerald)"></i> سعر القطعة لكل صنف</div>
                ${itemRows}
            </div>
            <!-- breakdown: مجموع الأصناف + توصيل -->
            <div style="background:rgba(26,107,74,.06);border:1px solid rgba(26,107,74,.2);border-radius:10px;padding:10px 12px;margin-bottom:.75rem">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:70px">
                        <span style="font-size:.68rem;color:var(--ink-mid);margin-bottom:2px">مجموع الأصناف</span>
                        <strong id="wiz_items_sum" style="font-size:.95rem;color:var(--emerald)">— JOD</strong>
                    </div>
                    <span style="font-size:1.1rem;color:var(--ink-mid);font-weight:300">+</span>
                    <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:90px">
                        <span style="font-size:.68rem;color:var(--ink-mid);margin-bottom:2px"><i class="fas fa-truck" style="color:var(--gold)"></i> توصيل (مرة واحدة)</span>
                        <div style="display:flex;align-items:center;gap:4px">
                            <input type="number" id="wiz_delivery" min="0" step="0.5"
                                style="width:68px;text-align:center;font-size:.95rem;font-weight:800;padding:3px 6px;border:1.5px solid var(--gold);border-radius:8px;background:var(--paper-warm);color:var(--ink)"
                                value="${savedDelivery}"
                                oninput="app._wizCalcTotal()">
                            <span style="font-size:.72rem;color:var(--ink-mid)">JOD</span>
                        </div>
                    </div>
                    <span style="font-size:1.1rem;color:var(--ink-mid);font-weight:300">=</span>
                    <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:70px">
                        <span style="font-size:.68rem;color:var(--ink-mid);margin-bottom:2px">الإجمالي</span>
                        <strong id="wiz_total_display" style="font-size:1rem;color:var(--emerald)">— JOD</strong>
                    </div>
                </div>
            </div>
            <!-- السعر النهائي قابل للتعديل -->
            <div style="font-size:.78rem;color:var(--ink-mid);font-weight:600;margin-bottom:.4rem">السعر الإجمالي للزبون</div>
            <div style="display:flex;gap:.75rem;align-items:center;margin-bottom:1.25rem">
                <span style="background:var(--paper-warm);border:1.5px solid var(--border);border-radius:10px;padding:.75rem 1rem;font-size:1rem;font-weight:700;color:var(--ink-mid)">JOD</span>
                <input type="number" id="wiz_price" class="form-control-j" style="font-size:1.3rem;font-weight:800;flex:1;padding:.75rem 1rem"
                    placeholder="0.00" step="0.5" value="${savedTotal}"
                    oninput="app._wiz.price = parseFloat(this.value) || ''"
                    onkeydown="if(event.key==='Enter')app._wizNext()">
            </div>
            <!-- اسم الصفحة -->
            <div style="margin-bottom:.75rem">
                <div style="font-size:.78rem;color:var(--ink-mid);font-weight:600;margin-bottom:.3rem">اسم الصفحة</div>
                <div style="display:flex;align-items:center;gap:.6rem;background:var(--paper-warm);border:1.5px solid var(--border);border-radius:10px;padding:.65rem 1rem;min-height:46px">
                    ${hasAutoPage
                        ? `<i class="fas fa-link" style="color:var(--gold);font-size:.8rem"></i>
                           <span style="font-size:1rem;font-weight:800;color:var(--ink)">${this._wiz.pageName}</span>
                           <span style="font-size:.68rem;color:var(--emerald);margin-right:auto"><i class="fas fa-check-circle"></i> تلقائي من الصنف</span>`
                        : `<i class="fas fa-exclamation-circle" style="color:var(--ruby-light);font-size:.8rem"></i>
                           <span style="font-size:.85rem;color:var(--ink-mid)">لم يُحدَّد — يرجى اختيار صنف مرتبط بصفحة</span>`
                    }
                </div>
                <input type="hidden" id="wiz_page" value="${this._wiz.pageName}">
            </div>
            <input type="text" id="wiz_tags" class="form-control-j" style="font-size:.95rem;padding:.7rem 1rem"
                placeholder="ملاحظات / Tags (اختياري)..." value="${this._wiz.tags}">`;

        setTimeout(() => this._wizCalcTotal(), 0);
    },

    _wizCalcTotal() {
        const items = this._wiz.collectedItems || [];
        const delivery = parseFloat(document.getElementById('wiz_delivery')?.value) || 0;
        this._wiz.deliveryFee = delivery;

        // مجموع كل الأصناف من الـ inputs (قابلة للتعديل)
        let itemsSum = 0;
        let allHavePrice = true;
        items.forEach((it, idx) => {
            const inp = document.getElementById(`wiz_item_price_${idx}`);
            const val = parseFloat(inp?.value);
            if (!isNaN(val) && val >= 0) {
                itemsSum += val * (it.qty || 1);
                // حفظ السعر المعدّل في الـ wiz
                if (!this._wiz._itemPrices) this._wiz._itemPrices = {};
                this._wiz._itemPrices[idx] = val;
            } else {
                allHavePrice = false;
            }
        });

        const sumEl  = document.getElementById('wiz_items_sum');
        const totalEl = document.getElementById('wiz_total_display');
        const priceInp = document.getElementById('wiz_price');

        if (allHavePrice) {
            const total = itemsSum + delivery;
            if (sumEl)   sumEl.textContent   = itemsSum.toFixed(2) + ' JOD';
            if (totalEl) totalEl.textContent = total.toFixed(2) + ' JOD';
            // نحدث السعر النهائي تلقائياً إلا لو المستخدم عدّله يدوياً
            if (priceInp && (priceInp.value === '' || parseFloat(priceInp.value) === this._wiz._lastAutoPrice)) {
                priceInp.value = total.toFixed(2);
                this._wiz._lastAutoPrice = total;
            }
        } else {
            if (sumEl)   sumEl.textContent   = '— JOD';
            if (totalEl) totalEl.textContent = '— JOD';
        }
    },

    _wizStepConfirm(body) {
        const items = this._wiz.collectedItems || [];
        const itemHtml = items.map(it => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--border)">
                <div>
                    <div style="font-weight:700;font-size:.9rem">${it.itemName}</div>
                    <div style="font-size:.75rem;color:var(--ink-mid)">${it.itemColor} — ${it.size} × ${it.qty}</div>
                </div>
            </div>`).join('');
        body.innerHTML = `
            <div style="font-size:1.1rem;font-weight:800;color:var(--gold);margin-bottom:1.25rem"><i class="fas fa-clipboard-check"></i> مراجعة الطلب</div>
            <div style="display:flex;flex-direction:column;gap:.6rem">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
                    <div class="wiz-summary-row"><span class="wiz-summary-label">الزبون</span><span class="wiz-summary-val">${this._wiz.custName}</span></div>
                    <div class="wiz-summary-row"><span class="wiz-summary-label">الموبايل</span><span class="wiz-summary-val" dir="ltr">07${this._wiz.mobile}</span></div>
                    <div class="wiz-summary-row"><span class="wiz-summary-label">المحافظة</span><span class="wiz-summary-val">${this._wiz.governorate}</span></div>
                    <div class="wiz-summary-row"><span class="wiz-summary-label">السعر</span><span class="wiz-summary-val" style="color:var(--emerald);font-weight:800">${this._wiz.price} JOD</span></div>
                    <div class="wiz-summary-row col-span-2"><span class="wiz-summary-label">العنوان</span><span class="wiz-summary-val">${this._wiz.addr}</span></div>
                    <div class="wiz-summary-row"><span class="wiz-summary-label">الصفحة</span><span class="wiz-summary-val">${this._wiz.pageName}</span></div>
                    <div class="wiz-summary-row"><span class="wiz-summary-label">التواصل</span><span class="wiz-summary-val">${this._wiz.contactChannel || '—'}</span></div>
                    ${this._wiz.weightKg ? `<div class="wiz-summary-row"><span class="wiz-summary-label">الوزن</span><span class="wiz-summary-val">${this._wiz.weightKg} kg</span></div>` : ''}
                    ${this._wiz.lengthCm ? `<div class="wiz-summary-row"><span class="wiz-summary-label">الطول</span><span class="wiz-summary-val">${this._wiz.lengthCm} cm</span></div>` : ''}
                    ${this._wiz.tags ? `<div class="wiz-summary-row"><span class="wiz-summary-label">ملاحظات</span><span class="wiz-summary-val">${this._wiz.tags}</span></div>` : ''}
                </div>
                <div style="margin-top:.5rem;font-weight:700;font-size:.85rem;color:var(--ink-mid)">المنتجات:</div>
                ${itemHtml}
            </div>`;
    },

    _wizNext() {
        const s = this._wiz.step;
        // Validate + collect
        if (s === 0) {
            const v = document.getElementById('wiz_custName')?.value.trim();
            if (!v) { this._wizErr('يرجى إدخال اسم الزبون'); return; }
            this._wiz.custName = v;
        } else if (s === 1) {
            const v = document.getElementById('wiz_mobile')?.value.replace(/\D/g,'');
            if (v.length !== 8) { this._wizErr('رقم الموبايل يجب أن يكون 8 أرقام'); return; }
            this._wiz.mobile = v;
        } else if (s === 2) {
            const gov  = document.getElementById('wiz_gov')?.value;
            const addr = document.getElementById('wiz_addr')?.value.trim();
            if (!addr) { this._wizErr('يرجى إدخال العنوان'); return; }
            this._wiz.governorate = gov;
            this._wiz.addr = addr;
        } else if (s === 3) {
            // مكان التواصل — إجباري
            if (!this._wiz.contactChannel) { this._wizErr('يرجى اختيار مكان التواصل مع الزبون'); return; }
            this._wiz.weightKg = document.getElementById('wiz_weight')?.value.trim() || '';
            this._wiz.lengthCm = document.getElementById('wiz_length')?.value.trim() || '';
        } else if (s === 4) {
            // Collect items from rows
            const items = [];
            const rows = document.querySelectorAll('.ir-item');
            for (let i = 0; i < rows.length; i++) {
                const itemName = rows[i].value;
                const found = Object.entries(this.warehouse).find(([,w]) => w.name === itemName);
                if (!found) { this._wizErr(`يرجى اختيار منتج للصف ${i+1}`); return; }
                const sizeCombo = document.querySelector(`.ir-size[data-idx="${i}"]`)?.value;
                const color = document.getElementById(`ir_color_${i}`)?.value || '';
                const qty = parseInt(document.querySelector(`.ir-qty[data-idx="${i}"]`)?.value) || 1;
                if (!sizeCombo || !color) { this._wizErr(`يرجى تحديد اللون والمقاس للصف ${i+1}`); return; }
                const avail = found[1].sizes?.[sizeCombo] || 0;
                if (qty > avail) { this._wizErr(`الكمية (${qty}) غير متوفرة لـ ${found[1].name}، المتوفر: ${avail}`); return; }
                let finalSize = sizeCombo, finalColor = color;
                if (sizeCombo.includes(' - ')) { finalSize = sizeCombo.split(' - ')[0]; finalColor = sizeCombo.split(' - ')[1]; }
                items.push({ itemId: found[0], itemName: found[1].name, itemColor: finalColor, size: finalSize, exactKey: sizeCombo, qty });
            }
            if (items.length === 0) { this._wizErr('أضف منتجاً واحداً على الأقل'); return; }
            this._wiz.collectedItems = items;
            // سعر تلقائي: مجموع sellPrice × qty لكل الأصناف + 3 دينار توصيل
            if (!this._wiz.price || this._wiz.price === '') {
                const allHavePrice = items.every(it => this.warehouse[it.itemId]?.sellPrice);
                if (allHavePrice) {
                    const itemsTotal = items.reduce((sum, it) => {
                        return sum + parseFloat(this.warehouse[it.itemId].sellPrice) * (it.qty || 1);
                    }, 0);
                    const delivery = this._wiz.deliveryFee !== undefined ? this._wiz.deliveryFee : 3;
                    this._wiz.price = itemsTotal + delivery;
                    this._wiz._lastAutoPrice = this._wiz.price;
                }
            }
        } else if (s === 5) {
            const price    = parseFloat(document.getElementById('wiz_price')?.value);
            const page     = document.getElementById('wiz_page')?.value || this._wiz.pageName;
            const tags     = document.getElementById('wiz_tags')?.value.trim() || '';
            const delivery = parseFloat(document.getElementById('wiz_delivery')?.value) || 0;
            if (!price || price <= 0) { this._wizErr('يرجى إدخال السعر'); return; }
            if (!page) { this._wizErr('لم يتم تحديد الصفحة — يرجى اختيار صنف مرتبط بصفحة'); return; }
            this._wiz.price       = price;
            this._wiz.pageName    = page;
            this._wiz.tags        = tags;
            this._wiz.deliveryFee = delivery;
        }
        this._wiz.step++;
        this._wizRender();
    },

    _wizErr(msg) {
        this.toast(msg, 'error');
        document.getElementById('wiz-card')?.classList.add('wiz-shake');
        setTimeout(() => document.getElementById('wiz-card')?.classList.remove('wiz-shake'), 400);
    },

    async _wizSave() {
        const w = this._wiz;
        const items = w.collectedItems || [];
        if (items.length === 0) { this._wizErr('لا توجد منتجات'); return; }

        const entryUser = this.role === 'User' ? this.userName : (w.entryUser || this.userName);
        const payload = {
            timestamp: Date.now(), date: new Date().toLocaleDateString('en-GB'),
            custName: w.custName, custMob: '07' + w.mobile,
            country: 'الأردن', governorate: w.governorate, custAddr: w.addr,
            itemId: items[0].itemId, itemName: items[0].itemName,
            itemColor: items[0].itemColor, size: items[0].size, exactKey: items[0].exactKey, qty: items[0].qty,
            items, price: w.price, currency: 'JOD',
            pageName: w.pageName, entryUser, tags: w.tags, status: 'new',
            contactChannel: w.contactChannel || '',
            weightKg: w.weightKg || '',
            lengthCm: w.lengthCm || '',
        };

        const btn = document.getElementById('wiz-nav')?.querySelector('button:last-child');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ الحفظ...'; }

        const newRef = await push(ordersRef, payload);
        this.lastOrderId = newRef.key;
        this.log('create', newRef.key, `إنشاء طلب للزبون: ${w.custName} | صفحة: ${w.pageName}`);
        this._auditLog('order_create', newRef.key, null, payload, `طلب جديد للزبون ${w.custName}`);

        // Show success screen
        document.getElementById('wiz-shell').style.display = 'none';
        const success = document.getElementById('wiz-success');
        success.style.display = 'flex';
        document.getElementById('wiz-success-summary').innerHTML = `
            <div class="wiz-summary-row"><span class="wiz-summary-label">الزبون</span><span class="wiz-summary-val">${w.custName}</span></div>
            <div class="wiz-summary-row"><span class="wiz-summary-label">الموبايل</span><span class="wiz-summary-val" dir="ltr">07${w.mobile}</span></div>
            <div class="wiz-summary-row"><span class="wiz-summary-label">المحافظة</span><span class="wiz-summary-val">${w.governorate}</span></div>
            <div class="wiz-summary-row"><span class="wiz-summary-label">السعر</span><span class="wiz-summary-val" style="color:var(--emerald);font-weight:800">${w.price} JOD</span></div>
            ${items.map(it=>`<div class="wiz-summary-row"><span class="wiz-summary-label">${it.itemName}</span><span class="wiz-summary-val">${it.itemColor} — ${it.size} × ${it.qty}</span></div>`).join('')}`;
        this.toast('تم حفظ الطلب بنجاح ✓', 'success');
    },

    // ══════════════════════════════════════════════════════════
    // ██████╗     █████╗ ██╗   ██╗██████╗ ██╗████████╗
    // ██╔══██╗   ██╔══██╗██║   ██║██╔══██╗██║╚══██╔══╝
    // ██████╔╝   ███████║██║   ██║██║  ██║██║   ██║
    // ██╔══██╗   ██╔══██║██║   ██║██║  ██║██║   ██║
    // ██║  ██║   ██║  ██║╚██████╔╝██████╔╝██║   ██║
    // ╚═╝  ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚═╝   ╚═╝
    // ════ FINANCIAL AUDIT TRAIL ════

    // _auditLog: detailed field-level change tracking
    _auditLog(eventType, entityId, before, after, description) {
        if (this.role !== 'Admin' && this.role !== 'User') return;

        const changes = [];
        const FIELD_LABELS = {
            price:      'السعر',
            status:     'الحالة',
            custName:   'اسم الزبون',
            custMob:    'رقم الموبايل',
            custAddr:   'العنوان',
            pageName:   'الصفحة',
            entryUser:  'المدخل',
            buyPrice:   'سعر الشراء',
            sellPrice:  'سعر البيع',
            qty:        'الكمية',
            sizes:      'المخزون',
            governorate:'المحافظة',
            name:       'الاسم',
            tags:       'الملاحظات',
        };

        // Compute field-level diff if both before/after provided
        if (before && after) {
            const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
            allKeys.forEach(k => {
                if (['timestamp','items'].includes(k)) return;
                const bVal = JSON.stringify(before[k] ?? '');
                const aVal = JSON.stringify(after[k] ?? '');
                if (bVal !== aVal) {
                    changes.push({
                        field: k,
                        fieldLabel: FIELD_LABELS[k] || k,
                        before: before[k],
                        after: after[k]
                    });
                }
            });
        }

        const entry = {
            ts: Date.now(),
            date: new Date().toLocaleString('ar-JO'),
            user: this.userName,
            role: this.role,
            eventType,
            entityId,
            description,
            changes,
            ip: 'client', // placeholder
        };

        push(ref(db, 'jawaher_audit'), entry);
    },

    // Render audit trail page
    renderAuditPage() {
        if (this.role !== 'Admin') return;
        const el = document.getElementById('auditBody'); if (!el) return;
        const q   = document.getElementById('auditSearch')?.value.toLowerCase() || '';
        const etF = document.getElementById('auditEventType')?.value || '';
        const userF = document.getElementById('auditUserFilter')?.value || '';

        const entries = Object.values(this.auditData || {})
            .sort((a, b) => b.ts - a.ts)
            .filter(e => {
                if (q && !(e.description||'').toLowerCase().includes(q) && !(e.entityId||'').includes(q)) return false;
                if (etF && e.eventType !== etF) return false;
                if (userF && e.user !== userF) return false;
                return true;
            });

        const eventColors = {
            order_create: 'badge-done',
            order_edit:   'badge-process',
            order_delete: 'badge-canceled',
            price_change: 'badge-postponed',
            stock_change: 'badge-new',
            user_action:  'badge-delivered',
        };

        el.innerHTML = entries.map(e => {
            const changesHtml = e.changes?.length ? `
                <div style="margin-top:.5rem;padding:.5rem .75rem;background:var(--paper-warm);border-radius:8px;border-right:3px solid var(--gold)">
                    ${e.changes.map(c => `
                        <div style="font-size:.75rem;display:flex;gap:.5rem;align-items:center;padding:.2rem 0;border-bottom:1px dashed var(--border)">
                            <span style="font-weight:700;color:var(--ink-mid);min-width:90px">${c.fieldLabel}</span>
                            <span style="color:var(--ruby-light);text-decoration:line-through;font-family:monospace">${this._auditVal(c.before)}</span>
                            <i class="fas fa-long-arrow-alt-left" style="color:var(--gold);font-size:.6rem"></i>
                            <span style="color:var(--emerald);font-weight:700;font-family:monospace">${this._auditVal(c.after)}</span>
                        </div>`).join('')}
                </div>` : '';
            return `<tr>
                <td style="font-size:.72rem;color:var(--ink-mid)" dir="ltr">${new Date(e.ts).toLocaleString('en-GB')}</td>
                <td style="font-weight:700;font-size:.85rem">${e.user || ''}</td>
                <td><span class="badge-j ${eventColors[e.eventType]||'badge-new'}" style="font-size:.7rem">${e.eventType||''}</span></td>
                <td style="font-size:.78rem;color:var(--gold);font-family:monospace">${(e.entityId||'').slice(-8)}</td>
                <td style="font-size:.82rem">
                    ${e.description || ''}
                    ${changesHtml}
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--ink-mid)">لا توجد سجلات</td></tr>';
    },

    _auditVal(v) {
        if (v === null || v === undefined) return '—';
        if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
        return String(v).slice(0, 50);
    },


    initKeys() {
        document.addEventListener('keydown', e => {
            if (!this.user) return;
            if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); this.gotoPage('entry'); }
            if (e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); this.gotoPage('warehouse'); }
            if (e.key === 'Escape') { this.closeModal('orderModal'); this.closeAllDropdowns(); }
        });
        document.addEventListener('click', e => { if (!e.target.closest('.dropdown-j')) this.closeAllDropdowns(); });
    },
    // ============ ITEM MOVEMENT LOGIC ============
    currentMvItemId: null,
    mvSortKey: 'timestamp',
    mvSortDir: 1,

    viewMovement(itemId) {
        this.currentMvItemId = itemId;
        const item = this.warehouse[itemId];
        if (!item) return;
        
        // تحديث العنوان في الصفحة الجديدة
        const header = document.getElementById('mvItemNameHeader');
        if (header) header.innerHTML = `<i class="fas fa-box" style="color:var(--gold)"></i> حركة الصنف: <span style="color:var(--gold)">${item.name}</span>`;
        
        // الانتقال للصفحة
  
                 this.gotoPage('movement');

    },
    renderMovementTable() {
        const itemId = this.currentMvItemId;
        const movements = [];
        
        // 1. جلب المشتريات
        Object.values(this.purchases).forEach(p => {
            if (p.itemId === itemId) {
                const qty = Object.values(p.sizes || {}).reduce((a, b) => a + b, 0);
                // استخراج الألوان من sizeColors المخزنة في سجل الشراء
                const colors = [...new Set(Object.values(p.sizeColors || {}).filter(Boolean))];
                // إذا لم تكن sizeColors موجودة، ارجع للون العام المخزن
                if (colors.length === 0 && p.color) colors.push(p.color);
                movements.push({
                    timestamp: p.timestamp,
                    date: p.date,
                    type: 'مشتريات',
                    color: colors.join('، '),
                    in: qty,
                    out: 0,
                    details: `شراء بضاعة جديدة - ${p.notes || ''}`,
                    user: p.user || 'نظام'
                });
            }
        });

        // 2. جلب المبيعات
        Object.values(this.orders).forEach(o => {
            const itemMatch = (o.items || []).find(it => it.itemId === itemId) || (o.itemId === itemId ? o : null);
            if (itemMatch && (o.status === 'delivered' || o.status === 'done')) {
                const qty = itemMatch.qty || 1;
                const color = itemMatch.itemColor || o.itemColor || '';
                movements.push({
                    timestamp: o.timestamp,
                    date: o.date,
                    type: 'مبيعات',
                    color,
                    in: 0,
                    out: qty,
                    details: `طلب رقم ${o.id ? o.id.slice(-6) : ''} للزبون ${o.custName}`,
                    user: o.entryUser || 'نظام'
                });
            }
        });

        // 3. جلب المرتجعات
        Object.values(this.returns).forEach(r => {
            if (r.itemId === itemId) {
                const color = r.itemColor || r.color || '';
                movements.push({
                    timestamp: r.timestamp,
                    date: r.date,
                    type: 'مرتجع',
                    color,
                    in: r.qty || 0,
                    out: 0,
                    details: `مرتجع من زبون: ${r.reason || ''}`,
                    user: r.user || 'نظام'
                });
            }
        });

        // 4. جلب تعديلات المخزون اليدوية
        Object.values(this.logsData).forEach(l => {
            if (l.action === 'stock_adjust' && l.id === itemId) {
                const qtyMatch = l.details.match(/تعديل مخزون: (-?\d+)/);
                const qty = qtyMatch ? parseInt(qtyMatch[1]) : 0;
                const colorMatch = l.details.match(/اللون: ([^|]+)/);
                movements.push({
                    timestamp: l.timestamp,
                    date: l.date,
                    type: 'تعديل',
                    color: colorMatch ? colorMatch[1].trim() : '',
                    in: qty > 0 ? qty : 0,
                    out: qty < 0 ? Math.abs(qty) : 0,
                    details: l.details,
                    user: l.user
                });
            }
        });

        // الترتيب حسب الوقت أولاً لحساب الرصيد بشكل صحيح
        movements.sort((a, b) => a.timestamp - b.timestamp);

        // حساب الرصيد التراكمي
        let runningBalance = 0;
        movements.forEach(m => {
            runningBalance += (m.in - m.out);
            m.balance = runningBalance;
        });

        // تحديث قائمة فلتر الألوان
        const mvColorSel = document.getElementById('mvColor');
        if (mvColorSel) {
            const curColor = mvColorSel.value;
            const allColors = [...new Set(movements.map(m => m.color).filter(Boolean))].sort();
            mvColorSel.innerHTML = '<option value="">كل الألوان</option>' + allColors.map(c => {
                return `<option value="${c}" ${curColor === c ? 'selected' : ''}>${c}</option>`;
            }).join('');
            mvColorSel.value = curColor;
        }

        // تطبيق الفلاتر
        const q = document.getElementById('mvSearch')?.value.toLowerCase() || '';
        const typeF = document.getElementById('mvType')?.value || '';
        const colorF = document.getElementById('mvColor')?.value || '';
        const fromD = document.getElementById('mvFrom')?.value || '';
        const toD = document.getElementById('mvTo')?.value || '';

        let filtered = movements.filter(m => {
            if (q && !m.details.toLowerCase().includes(q)) return false;
            if (typeF && m.type !== typeF) return false;
            if (colorF && m.color !== colorF) return false;
            if (fromD || toD) {
                const md = new Date(m.timestamp);
                if (fromD && md < new Date(fromD)) return false;
                if (toD && md > new Date(toD)) return false;
            }
            return true;
        });

        // الترتيب النهائي للعرض
        filtered.sort((a, b) => {
            let v1 = a[this.mvSortKey], v2 = b[this.mvSortKey];
            return v1 < v2 ? -this.mvSortDir : v1 > v2 ? this.mvSortDir : 0;
        });

        // عرض البيانات في الجدول
        const tbody = document.getElementById('movementTableBody');
        tbody.innerHTML = filtered.map(m => {
            const colorHex = this._colorHex(m.color);
            const colorDot = colorHex ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorHex};border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-left:3px"></span>` : '';
            return `
            <tr>
                <td style="font-size:.8rem">${new Date(m.timestamp).toLocaleString('ar-JO')}</td>
                <td><span class="badge-j badge-${this._getMvClass(m.type)}">${m.type}</span></td>
                <td style="font-size:.8rem">${colorDot}${m.color || '-'}</td>
                <td style="color:var(--emerald); font-weight:bold">${m.in || '-'}</td>
                <td style="color:var(--ruby); font-weight:bold">${m.out || '-'}</td>
                <td style="background:var(--paper-warm); font-weight:800">${m.balance}</td>
                <td style="font-size:.8rem">${m.details}</td>
                <td>${m.user}</td>
            </tr>`;
        }).join('');
    },
openWhatsApp(id) {
    const o = this.orders[id];
    if (!o) return;
    const items = (o.items || [{ itemName: o.itemName, size: o.size, itemColor: o.itemColor, qty: o.qty }])
        .map(it => `• ${it.itemName} (${it.size} - ${it.itemColor}) ×${it.qty}`).join('\n');
    const msg = `مرحباً ${o.custName} 👋\nطلبك جاهز للتوصيل:\n${items}\nالسعر: ${o.price} JOD\nالعنوان: ${o.governorate} - ${o.custAddr}\nشكراً لك ✨`;
    window.open(`https://wa.me/${o.custMob.replace(/[^0-9]/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
},

    _getMvClass(type) {
        if (type === 'مشتريات') return 'new';
        if (type === 'مبيعات') return 'delivered';
        if (type === 'مرتجع') return 'postponed';
        return 'process';
    },

    sortMovement(key) {
        if (this.mvSortKey === key) this.mvSortDir *= -1;
        else { this.mvSortKey = key; this.mvSortDir = -1; }
        this.renderMovementTable();
    },

    exportMovementExcel() {
        const item = this.warehouse[this.currentMvItemId];
        const table = document.getElementById('movementTable');
        const ws = XLSX.utils.table_to_sheet(table);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "حركة صنف");
        XLSX.writeFile(wb, `حركة_${item.name}_${Date.now()}.xlsx`);
    },
};

// ── DOM Ready ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // ── Pre-load Firebase system users before login ───────────
    onValue(sysUsersRef, snap => {
        app.sysUsers = snap.val() || {};
    });

    const saved = localStorage.getItem('shmSession');
    if (saved) {
        try {
            const s = JSON.parse(saved);

            const restoreSession = () => {
                // constants.js users don't need Firebase
                const builtIn = USERS[s.user];
                const fbUser  = app.sysUsers[s.user];
                const ud = builtIn || fbUser;
                if (!ud) return;
                if (ud.disabled) { localStorage.removeItem('shmSession'); return; }

                app.user = s.user; app.role = s.role; app.userName = s.name;
                app.userPerms = fbUser?.perms || {};
                document.getElementById('authScreen').classList.remove('visible');
                document.getElementById('appContainer').style.display = 'block';
                document.getElementById('userName').textContent = s.name;
                document.getElementById('userRole').textContent = s.role;
                document.getElementById('userAvatar').textContent = s.name[0];
                document.getElementById('eDate').value = new Date().toLocaleDateString('en-GB');
                document.getElementById('dashDate').textContent = new Date().toLocaleDateString('ar-JO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                app.applyDark();
                app.applyPermissions();
                app.startListeners();
                app.updateCountry();
            };

            // constants.js users: restore immediately
            if (USERS[s.user]) {
                restoreSession();
            } else {
                // Firebase users: short wait for snapshot
                setTimeout(restoreSession, 600);
            }
        } catch(e) { localStorage.removeItem('shmSession'); }
    }
    app.applyDark();
    app.initKeys();
    app.renderSavedAccounts();

    // ── Register Service Worker + Auto-Update System ─────────────
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {

            // عند تفعيل SW جديد → reload فوري
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker?.addEventListener('statechange', () => {
                    if (newWorker.state === 'activated') {
                        // SW جديد نشط — نعطي وقت قصير ثم reload
                        setTimeout(() => window.location.reload(true), 300);
                    }
                });
            });

            // استقبال رسائل من الـ SW
            navigator.serviceWorker.addEventListener('message', e => {
                if (e.data?.type === 'SW_UPDATED') {
                    window.location.reload(true);
                }
            });

            // تحقق من تحديثات كل دقيقتين (بدل 5)
            const checkUpdate = () => reg.update().catch(() => {});
            setTimeout(checkUpdate, 2000);
            setInterval(checkUpdate, 2 * 60 * 1000);

        }).catch(() => {});

        // إذا تغيّر الـ controller (SW جديد أخذ زمام) → reload
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload(true);
        });
    }

    document.getElementById('loginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') app.login(); });

    document.getElementById('eCustMob')?.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
        app.checkDuplicate();
    });

    // ── Intro screen ─────────────────────────────────────────
    const intro = document.getElementById('introScreen');
    const auth = document.getElementById('authScreen');
    const colors = ['rgba(201,168,76,.6)', 'rgba(232,201,122,.5)', 'rgba(154,122,46,.5)', 'rgba(255,255,255,.15)'];

    for (let i = 0; i < 22; i++) {
        const p = document.createElement('div');
        p.className = 'intro-particle';
        const size = 3 + Math.random() * 7;
        p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random() * 100}%;background:${colors[Math.floor(Math.random() * colors.length)]};animation-duration:${4 + Math.random() * 6}s;animation-delay:${Math.random() * 3}s`;
        intro.appendChild(p);
    }

    setTimeout(() => {
        intro.classList.add('fade-out');
        setTimeout(() => { intro.style.display = 'none'; auth.classList.add('visible'); }, 680);
    }, 2400);
});
