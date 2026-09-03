// ==================== 共享配置 & 状态 ====================
export const API_BASE = '/api';

export const appState = {
    tasks: [],
    config: { allocationLocked: false },
    isAdminMode: false,
    claimTargetId: null,
    refreshInterval: null  // 定时器句柄
};

// ==================== DOM 引用 ====================
export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);

export const taskListEl = $('#taskList');
export const totalCountEl = $('#totalCount');
export const claimedCountEl = $('#claimedCount');
export const completedCountEl = $('#completedCount');
export const taskCountBadge = $('#taskCount');
export const adminToggleBtn = $('#adminToggleBtn');

export const claimModal = $('#claimModal');
export const claimTaskDesc = $('#claimTaskDesc');
export const claimNameInput = $('#claimNameInput');
export const claimCancelBtn = $('#claimCancelBtn');
export const claimConfirmBtn = $('#claimConfirmBtn');

export const adminModal = $('#adminModal');
export const adminLoginArea = $('#adminLoginArea');
export const adminPanel = $('#adminPanel');
export const adminPasswordInput = $('#adminPasswordInput');
export const adminLoginBtn = $('#adminLoginBtn');
export const adminCloseBtn = $('#adminCloseBtn');
export const adminCloseBtn2 = $('#adminCloseBtn2');
export const adminLogoutBtn = $('#adminLogoutBtn');
export const adminResetBtn = $('#adminResetBtn');
export const adminTaskInput = $('#adminTaskInput');
export const adminAddBtn = $('#adminAddBtn');
export const adminBatchInput = $('#adminBatchInput');
export const adminBatchSetBtn = $('#adminBatchSetBtn');
export const adminTaskListEl = $('#adminTaskList');
export const saveConfigBtn = $('#saveConfigBtn');
export const toastContainer = $('#toastContainer');

// ==================== 工具函数 ====================
export function showToast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 3200);
}

export function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ==================== 自动刷新控制 ====================
export function startAutoRefresh() {
    if (appState.refreshInterval) {
        clearInterval(appState.refreshInterval);
        appState.refreshInterval = null;
    }
    appState.refreshInterval = setInterval(() => {
        loadTasks();
    }, 1000);
    console.log('🔄 自动刷新已启动');
}

export function stopAutoRefresh() {
    if (appState.refreshInterval) {
        clearInterval(appState.refreshInterval);
        appState.refreshInterval = null;
        console.log('⏸️ 自动刷新已暂停');
    }
}

// ==================== 数据加载 ====================
export async function loadConfig() {
    try {
        const res = await fetch(`${API_BASE}/config`);
        if (res.ok) {
            appState.config = await res.json();
        }
    } catch (e) {
        console.warn('加载配置失败', e);
    }
}

export async function loadTasks() {
    try {
        await loadConfig();
        const res = await fetch(`${API_BASE}/tasks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        appState.tasks = data.tasks || [];
        document.dispatchEvent(new CustomEvent('tasksUpdated', { detail: { tasks: appState.tasks } }));
    } catch (err) {
        showToast('加载失败: ' + err.message, 'error');
    }
}

export function updateStats() {
    const total = appState.tasks.length;
    const claimed = appState.tasks.filter(t => t.claimed).length;
    const completed = appState.tasks.filter(t => t.completed).length;
    totalCountEl.textContent = total;
    claimedCountEl.textContent = claimed;
    completedCountEl.textContent = completed;
    taskCountBadge.textContent = total;
}

// ==================== 初始化共享事件 ====================
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!claimModal.classList.contains('hidden')) {
            claimModal.classList.add('hidden');
            appState.claimTargetId = null;
        }
        if (!adminModal.classList.contains('hidden')) {
            adminModal.classList.add('hidden');
            // 关闭面板时恢复自动刷新
            if (appState.isAdminMode) {
                startAutoRefresh();
            }
        }
    }
});

console.log('✅ common.js 已加载');
