let csrfToken = '';
let setupRequired = false;
let saving = false;

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
async function api(path, method = 'GET', data) {
    let response;
    try {
        response = await fetch(path, { method, credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    } catch { throw new Error('Cannot reach the server. Start it with npm start and open http://localhost:3000.'); }
    const result = await response.json();
    if (!response.ok) {
        if (response.status === 401 && !['/api/login', '/api/setup'].includes(path)) {
            currentUserRole = 'visitor'; csrfToken = ''; students = []; attendanceRecords = {};
            renderAll(); openLoginModal();
        }
        throw new Error(result.error || 'Request failed.');
    }
    return result;
}
function renderAll() {
    updateAuthUI(); renderAttendanceList(); updateAttendanceSummary(); renderStudentsList(); renderReportTable();
}
async function mutation(action, message) {
    if (saving) return;
    saving = true;
    document.body.classList.add('saving');
    try {
        await action();
        await loadData();
        renderAll();
        if (message) showToast(message);
        return true;
    } catch (error) { showToast(error.message, true); return false; }
    finally { saving = false; document.body.classList.remove('saving'); }
}

// Current Role State ('visitor' or 'admin')
let currentUserRole = 'visitor';

// Global State Variables
let students = [];
let attendanceRecords = {}; // Format: { "YYYY-MM-DD_Session": { "STU-001": "P", "STU-002": "A", ... } }

// Initialize App
window.addEventListener('DOMContentLoaded', async () => {
    initClock();

    // Set default date to today
    const today = localDate();
    document.getElementById('attendanceDate').value = today;

    renderAll();
    try {
        if (location.protocol === 'file:') throw new Error('Start the server with npm start, then open http://localhost:3000.');
        const auth = await api('/api/auth');
        currentUserRole = auth.role; csrfToken = auth.csrf; setupRequired = auth.setupRequired;
        if (currentUserRole === 'admin') await loadData();
        renderAll();
        if (currentUserRole !== 'admin') openLoginModal();
    } catch (error) { showToast(error.message, true); }
});

// Render controls for the server-authenticated role.
function updateAuthUI() {
    const authContainer = document.getElementById('authStatusContainer');
    const visitorBanner = document.getElementById('visitorBanner');
    const addStudentBtn = document.getElementById('addStudentBtn');
    const markAllBtn = document.getElementById('markAllBtn');

    if (currentUserRole === 'admin') {
        visitorBanner.classList.add('hidden');
        authContainer.innerHTML = `
            <span class="bg-amber-400/20 text-amber-200 border border-amber-400/30 text-xs px-2.5 py-1 rounded-lg font-semibold flex items-center">
                <i class="fa-solid fa-user-shield mr-1.5 text-amber-300"></i> Admin
            </span>
            <button onclick="handleLogout()" class="bg-rose-500/80 hover:bg-rose-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center transition border border-rose-400/30 active:scale-95" title="ចាកចេញ">
                <i class="fa-solid fa-right-from-bracket mr-1"></i> ចាកចេញ
            </button>
        `;
        if (addStudentBtn) addStudentBtn.disabled = false;
        if (markAllBtn) markAllBtn.disabled = false;
    } else {
        visitorBanner.classList.remove('hidden');
        authContainer.innerHTML = `
            <span class="bg-white/10 text-white border border-white/20 text-xs px-2.5 py-1 rounded-lg font-medium flex items-center">
                <i class="fa-solid fa-eye mr-1.5 opacity-80"></i> Visitor
            </span>
            <button onclick="openLoginModal()" class="bg-white hover:bg-slate-100 text-brand-800 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center transition shadow-sm active:scale-95">
                <i class="fa-solid fa-key mr-1 text-brand-600"></i> ចូលប្រព័ន្ធ
            </button>
        `;
        if (addStudentBtn) addStudentBtn.disabled = true;
        if (markAllBtn) markAllBtn.disabled = true;
    }
}

// Login Modal Handlers
function openLoginModal() {
    document.getElementById('loginTitle').textContent = setupRequired ? 'បង្កើតគណនី Admin / Create admin' : 'ចូលប្រព័ន្ធជា Admin';
    document.getElementById('loginHelp').textContent = setupRequired ? 'First use: choose your username and a password (10+ characters).' : 'សូមបញ្ចូល Username និង Password របស់អ្នក';
    document.getElementById('loginPassword').minLength = setupRequired ? 10 : 1;
    document.getElementById('loginPassword').autocomplete = setupRequired ? 'new-password' : 'current-password';
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('loginUsername').focus();
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    if (saving) return;
    saving = true;
    try {
        const auth = await api(setupRequired ? '/api/setup' : '/api/login', 'POST', { username: u, password: p });
        currentUserRole = auth.role; csrfToken = auth.csrf; setupRequired = false;
        await loadData();
        closeLoginModal();
        renderAll();
        showToast("ចូលប្រព័ន្ធជា Admin ជោគជ័យ!");
    } catch (error) { showToast(error.message, true); }
    finally { saving = false; }
}

async function handleLogout() {
    if (saving) return;
    try {
        await api('/api/logout', 'POST', {});
        currentUserRole = 'visitor'; csrfToken = ''; students = []; attendanceRecords = {};
        renderAll(); showToast("បានចាកចេញពីប្រព័ន្ធ");
    } catch (error) { showToast(error.message, true); }
}

// Clock Function
function initClock() {
    function update() {
        const now = new Date();
        document.getElementById('liveClock').innerText = now.toLocaleTimeString('km-KH');
        document.getElementById('liveDate').innerText = now.toLocaleDateString('km-KH', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    }
    update();
    setInterval(update, 1000);
}

// Refresh local display state from the database API.
async function loadData() {
    const data = await api('/api/data');
    students = data.students;
    attendanceRecords = data.attendanceRecords;
}

// Toast Notification Helper
function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    const toastIcon = document.getElementById('toastIcon');

    toastMsg.innerText = msg;
    if (isError) {
        toastIcon.className = "fa-solid fa-triangle-exclamation text-rose-400 text-lg";
    } else {
        toastIcon.className = "fa-solid fa-circle-check text-emerald-400 text-lg";
    }

    toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
    }, 3000);
}

// Navigation Tabs Toggle
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('border-brand-600', 'text-brand-600', 'bg-brand-50/50');
        btn.classList.add('border-transparent', 'text-slate-500');
    });

    document.getElementById(`sec-${tabId}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`tab-${tabId}`);
    activeBtn.classList.remove('border-transparent', 'text-slate-500');
    activeBtn.classList.add('border-brand-600', 'text-brand-600', 'bg-brand-50/50');

    if (tabId === 'dashboard') {
        renderReportTable();
    } else if (tabId === 'students') {
        renderStudentsList();
    } else if (tabId === 'take-attendance') {
        loadAttendanceForSelectedDate();
    }
}

// Key for current attendance: Date + Session
function getCurrentKey() {
    const date = document.getElementById('attendanceDate').value;
    const session = document.getElementById('attendanceSession').value;
    return `${date}_${session}`;
}

// Load attendance state for active date/session
function loadAttendanceForSelectedDate() {
    const key = getCurrentKey();
    renderAttendanceList();
    updateAttendanceSummary();
}

// Render attendance list
function renderAttendanceList() {
    const container = document.getElementById('attendanceListContainer');
    const key = getCurrentKey();
    const currentRecord = attendanceRecords[key] || {};
    const searchQuery = document.getElementById('searchAttendanceInput').value.toLowerCase().trim();

    const filteredStudents = students.filter(s =>
        s.name.toLowerCase().includes(searchQuery) || s.id.toLowerCase().includes(searchQuery)
    );

    document.getElementById('attendanceTotalCount').innerText = `សរុប: ${filteredStudents.length} នាក់`;

    if (filteredStudents.length === 0) {
        container.innerHTML = `
            <div class="p-8 text-center text-slate-400">
                <i class="fa-solid fa-user-slash text-3xl mb-2"></i>
                <p>មិនមានសិស្សត្រូវបានរកឃើញទេ</p>
            </div>
        `;
        return;
    }

    const isAdmin = currentUserRole === 'admin';

    container.innerHTML = filteredStudents.map((student, idx) => {
        const status = currentRecord[student.id];

        return `
        <div class="p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between hover:bg-slate-50/80 transition border-b border-slate-100 gap-3">
            <!-- Student Info -->
            <div class="flex items-center space-x-3 space-x-reverse w-full sm:w-auto">
                <span class="text-xs font-semibold text-slate-400 w-6 text-center">${idx + 1}</span>
                <div class="text-2xl bg-slate-100 p-2 rounded-xl flex items-center justify-center w-10 h-10 shadow-inner">
                    ${student.avatar || '👨‍🎓'}
                </div>
                <div>
                    <h3 class="font-bold text-slate-800 text-sm">${escapeHTML(student.name)}</h3>
                    <div class="flex items-center space-x-2 space-x-reverse text-xs text-slate-500 mt-0.5">
                        <span class="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">${student.id}</span>
                        <span>• ភេទ: ${escapeHTML(student.gender)}</span>
                    </div>
                </div>
            </div>

            <!-- Attendance Buttons -->
            <div class="flex items-center justify-between sm:justify-end space-x-1.5 sm:space-x-2 w-full sm:w-auto overflow-x-auto py-1">
                <!-- Present (P) -->
                <button ${!isAdmin ? 'disabled onclick="promptAdminLogin()"' : `onclick="setAttendance('${student.id}', 'P')"`} class="flex-1 sm:flex-none px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1 ${
                    status === 'P'
                    ? 'bg-emerald-600 text-white ring-2 ring-emerald-600 ring-offset-1 shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600'
                } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}">
                    <i class="fa-solid fa-check"></i>
                    <span>វត្តមាន</span>
                </button>

                <!-- Permission (L) -->
                <button ${!isAdmin ? 'disabled onclick="promptAdminLogin()"' : `onclick="setAttendance('${student.id}', 'L')"`} class="flex-1 sm:flex-none px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1 ${
                    status === 'L'
                    ? 'bg-amber-500 text-white ring-2 ring-amber-500 ring-offset-1 shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-600'
                } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}">
                    <i class="fa-solid fa-envelope"></i>
                    <span>ច្បាប់</span>
                </button>

                <!-- Absent (A) -->
                <button ${!isAdmin ? 'disabled onclick="promptAdminLogin()"' : `onclick="setAttendance('${student.id}', 'A')"`} class="flex-1 sm:flex-none px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1 ${
                    status === 'A'
                    ? 'bg-rose-600 text-white ring-2 ring-rose-600 ring-offset-1 shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-600'
                } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}">
                    <i class="fa-solid fa-xmark"></i>
                    <span>អវត្តមាន</span>
                </button>

                <!-- Late (T) -->
                <button ${!isAdmin ? 'disabled onclick="promptAdminLogin()"' : `onclick="setAttendance('${student.id}', 'T')"`} class="flex-1 sm:flex-none px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1 ${
                    status === 'T'
                    ? 'bg-blue-600 text-white ring-2 ring-blue-600 ring-offset-1 shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600'
                } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}">
                    <i class="fa-solid fa-clock"></i>
                    <span>យឺត</span>
                </button>
            </div>
        </div>
        `;
    }).join('');
}

function promptAdminLogin() {
    showToast("សូមចូលប្រព័ន្ធជា Admin ដើម្បីកែប្រែវត្តមាន!", true);
    openLoginModal();
}

// Set attendance for single student
async function setAttendance(studentId, status) {
    if (currentUserRole !== 'admin') {
        promptAdminLogin();
        return;
    }
    await mutation(() => api('/api/attendance', 'PUT', {
        date: document.getElementById('attendanceDate').value,
        session: document.getElementById('attendanceSession').value,
        records: { [studentId]: status }
    }), 'បានរក្សាទុក / Attendance saved');
}

// Mark All Present Shortcut
async function markAllPresent() {
    if (currentUserRole !== 'admin') {
        promptAdminLogin();
        return;
    }
    if (!students.length) return showToast('Add students first.', true);
    if (!confirm('Mark every student present for this date and session? This replaces existing marks.')) return;
    await mutation(() => api('/api/attendance', 'PUT', {
        date: document.getElementById('attendanceDate').value,
        session: document.getElementById('attendanceSession').value,
        records: Object.fromEntries(students.map(s => [s.id, 'P']))
    }), 'បានចុះវត្តមានទាំងអស់រួចរាល់!');
}

// Update top summary cards for active session
function updateAttendanceSummary() {
    const key = getCurrentKey();
    const currentRecord = attendanceRecords[key] || {};

    let present = 0, permission = 0, absent = 0, late = 0;

    students.forEach(s => {
        const st = currentRecord[s.id];
        if (st === 'P') present++;
        else if (st === 'L') permission++;
        else if (st === 'A') absent++;
        else if (st === 'T') late++;
    });

    document.getElementById('count-present').innerText = present;
    document.getElementById('count-permission').innerText = permission;
    document.getElementById('count-absent').innerText = absent;
    document.getElementById('count-late').innerText = late;
    document.getElementById('unmarkedCount').textContent = `មិនទាន់កត់ត្រា / Unmarked: ${students.length - present - permission - absent - late}`;
}

// Filter Dashboard Stats (All time, Month, Week)
let statsFilterMode = 'all';
function filterStats(mode) {
    statsFilterMode = mode;
    document.querySelectorAll('[data-stats-filter]').forEach(button => {
        const selected = button.dataset.statsFilter === mode;
        button.classList.toggle('bg-brand-600', selected);
        button.classList.toggle('text-white', selected);
        button.classList.toggle('bg-slate-100', !selected);
        button.classList.toggle('text-slate-600', !selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    renderReportTable();
}

function reportStats() {
    const now = new Date();
    const today = localDate(now);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const start = statsFilterMode === 'month' ? `${today.slice(0, 7)}-01` : localDate(monday);
    const keys = Object.keys(attendanceRecords).filter(key => {
        const day = key.slice(0, 10);
        return statsFilterMode === 'all' || (day >= start && day <= today);
    });
    return students.map(student => {
        let p = 0, l = 0, a = 0, t = 0;
        keys.forEach(key => {
            const status = attendanceRecords[key][student.id];
            if (status === 'P') p++;
            else if (status === 'L') l++;
            else if (status === 'A') a++;
            else if (status === 'T') t++;
        });
        const totalClasses = p + l + a + t;
        const rate = totalClasses ? Math.round((p + t * 0.8) / totalClasses * 100) : 0;
        return { ...student, p, l, a, t, totalClasses, rate };
    });
}

// Render Dashboard & Reports Table
function renderReportTable() {
    const searchQuery = document.getElementById('reportSearch').value.toLowerCase().trim();
    const tbody = document.getElementById('reportTableBody');

    const studentStats = reportStats();

    // Update top cards in dashboard
    document.getElementById('dashTotalStudents').innerText = students.length;

    const totalAbsents = studentStats.reduce((acc, curr) => acc + curr.a, 0);
    const totalPerms = studentStats.reduce((acc, curr) => acc + curr.l, 0);
    const totalMarks = studentStats.reduce((sum, st) => sum + st.totalClasses, 0);
    const avgRate = totalMarks ? Math.round(studentStats.reduce((sum, st) => sum + st.p + st.t * 0.8, 0) / totalMarks * 100) : 0;

    document.getElementById('dashTotalAbsent').innerText = totalAbsents;
    document.getElementById('dashTotalPerm').innerText = totalPerms;
    document.getElementById('dashAvgRate').innerText = `${avgRate}%`;

    if (!totalMarks) {
        document.getElementById('dashAvgStatus').innerText = 'មិនទាន់មានទិន្នន័យ / No records';
        document.getElementById('dashAvgStatus').className = 'text-xs text-slate-500';
    } else if (avgRate >= 90) {
        document.getElementById('dashAvgStatus').innerText = "ល្អប្រសើរ";
        document.getElementById('dashAvgStatus').className = "text-xs font-semibold text-emerald-600";
    } else if (avgRate >= 75) {
        document.getElementById('dashAvgStatus').innerText = "មធ្យម";
        document.getElementById('dashAvgStatus').className = "text-xs font-semibold text-amber-600";
    } else {
        document.getElementById('dashAvgStatus').innerText = "ត្រូវតាមដាន";
        document.getElementById('dashAvgStatus').className = "text-xs font-semibold text-rose-600";
    }

    // Filter Table Display
    const filteredStats = studentStats.filter(s =>
        s.name.toLowerCase().includes(searchQuery) || s.id.toLowerCase().includes(searchQuery)
    );

    if (filteredStats.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-6 text-slate-400">មិនមានទិន្នន័យរបាយការណ៍សិស្សឡើយ</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredStats.map(st => {
        let rateBg = 'bg-emerald-500';
        if (st.rate < 75) rateBg = 'bg-rose-500';
        else if (st.rate < 90) rateBg = 'bg-amber-500';

        return `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
            <td class="py-3 px-4 flex items-center space-x-3 space-x-reverse">
                <span class="text-xl">${st.avatar || '👨‍🎓'}</span>
                <div>
                    <p class="font-bold text-slate-800">${escapeHTML(st.name)}</p>
                    <p class="text-xs text-slate-400 font-mono">${st.id}</p>
                </div>
            </td>
            <td class="py-3 px-4 text-center font-bold text-emerald-600">${st.p}</td>
            <td class="py-3 px-4 text-center font-bold text-amber-600">${st.l}</td>
            <td class="py-3 px-4 text-center font-bold text-rose-600">${st.a}</td>
            <td class="py-3 px-4 text-center font-bold text-blue-600">${st.t}</td>
            <td class="py-3 px-4">
                <div class="flex items-center space-x-2 space-x-reverse">
                    <div class="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div class="${rateBg} h-2.5 rounded-full" style="width: ${st.rate}%"></div>
                    </div>
                <span class="text-xs font-bold text-slate-700 w-9 text-right">${st.totalClasses ? st.rate + '%' : '—'}</span>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// Render Student Management Grid
function renderStudentsList() {
    const grid = document.getElementById('studentCardsGrid');

    if (students.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white p-8 rounded-2xl text-center text-slate-400 border border-slate-200">
                <i class="fa-solid fa-users-slash text-4xl mb-3"></i>
                <p>ពុំទាន់មានសិស្សនៅក្នុងបញ្ជីនៅឡើយទេ</p>
            </div>
        `;
        return;
    }

    const isAdmin = currentUserRole === 'admin';

    grid.innerHTML = students.map(s => `
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition flex items-center justify-between">
            <div class="flex items-center space-x-3 space-x-reverse">
                <div class="text-3xl bg-brand-50 p-3 rounded-2xl flex items-center justify-center border border-brand-100">
                    ${s.avatar || '👨‍🎓'}
                </div>
                <div>
                    <h3 class="font-bold text-slate-800 text-base">${escapeHTML(s.name)}</h3>
                    <p class="text-xs text-slate-500 font-mono mt-0.5">អត្តលេខ: ${s.id}</p>
                    <span class="inline-block mt-1 text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">
                        ភេទ: ${escapeHTML(s.gender)}
                    </span>
                </div>
            </div>
            ${isAdmin ? `
            <div class="flex items-center space-x-1 no-print">
                <button onclick="editStudent('${s.id}')" class="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition" title="កែប្រែ">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button onclick="deleteStudent('${s.id}')" class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="លុប">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
            ` : ''}
        </div>
    `).join('');
}

// Student Modal Handlers
function openStudentModal(isEdit = false) {
    if (currentUserRole !== 'admin') {
        promptAdminLogin();
        return;
    }
    document.getElementById('studentModal').classList.remove('hidden');
    if (!isEdit) {
        document.getElementById('modalTitle').innerText = "បន្ថែមសិស្សថ្មី";
        document.getElementById('studentForm').reset();
        document.getElementById('studentEditId').value = "";
        // Auto generate ID
        let nextId = 1;
        while (students.some(s => s.id === 'STU-' + String(nextId).padStart(3, '0'))) nextId++;
        document.getElementById('studentIdInput').value = 'STU-' + String(nextId).padStart(3, '0');
    }
}

function closeStudentModal() {
    document.getElementById('studentModal').classList.add('hidden');
}

async function saveStudent(e) {
    e.preventDefault();
    if (currentUserRole !== 'admin') {
        promptAdminLogin();
        return;
    }

    const editId = document.getElementById('studentEditId').value;
    const id = document.getElementById('studentIdInput').value.trim();
    const name = document.getElementById('studentNameInput').value.trim();
    const gender = document.getElementById('studentGenderInput').value;
    const avatar = document.getElementById('studentAvatarInput').value;

    if (!id || !name) {
        showToast("សូមបំពេញព័ត៌មានឱ្យបានគ្រប់គ្រាន់", true);
        return;
    }

    const saved = await mutation(() => api(editId ? `/api/students/${encodeURIComponent(editId)}` : '/api/students',
        editId ? 'PUT' : 'POST', { id, name, gender, avatar }), 'បានរក្សាទុក / Student saved');
    if (saved) closeStudentModal();
}

function editStudent(id) {
    if (currentUserRole !== 'admin') {
        promptAdminLogin();
        return;
    }
    const student = students.find(s => s.id === id);
    if (!student) return;

    document.getElementById('modalTitle').innerText = "កែប្រែព័ត៌មានសិស្ស";
    document.getElementById('studentEditId').value = student.id;
    document.getElementById('studentIdInput').value = student.id;
    document.getElementById('studentNameInput').value = student.name;
    document.getElementById('studentGenderInput').value = student.gender;
    document.getElementById('studentAvatarInput').value = student.avatar || "👨‍🎓";

    openStudentModal(true);
}

async function deleteStudent(id) {
    if (currentUserRole !== 'admin') {
        promptAdminLogin();
        return;
    }
    if (confirm('លុបសិស្ស និងប្រវត្តិវត្តមានទាំងអស់? Delete this student and all their attendance history?')) {
        await mutation(() => api(`/api/students/${encodeURIComponent(id)}`, 'DELETE'), 'បានលុបសិស្សចេញពីបញ្ជី');
    }
}

// Export data as CSV File
function exportCSV() {
    if (currentUserRole !== 'admin') return promptAdminLogin();
    const cell = value => {
        let text = String(value);
        if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    };
    const rows = [['អត្តលេខ (ID)', 'ឈ្មោះសិស្ស (Name)', 'ភេទ (Gender)', 'Present', 'Permission', 'Absent', 'Late', 'Rate (%)']];
    reportStats().forEach(st => rows.push([st.id, st.name, st.gender, st.p, st.l, st.a, st.t, st.totalClasses ? st.rate : '']));
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const encodedUri = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `attendance_${statsFilterMode}_${localDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(encodedUri), 1000);
    showToast("បានទាញយកឯកសារ CSV រួចរាល់!");
}
