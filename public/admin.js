import {
    API_BASE, appState,
    $, $$, adminToggleBtn, adminModal, adminLoginArea, adminPanel,
    adminPasswordInput, adminLoginBtn, adminCloseBtn, adminCloseBtn2,
    adminLogoutBtn, adminResetBtn, adminTaskInput, adminAddBtn,
    adminBatchInput, adminBatchSetBtn, adminTaskListEl, saveConfigBtn,
    showToast, escapeHtml, loadTasks, loadConfig, startAutoRefresh, stopAutoRefresh
} from './common.js';

// ==================== 管理员密码存储 ====================
let storedAdminPassword = '';

// ==================== 管理员功能 ====================
function openAdminModal() {
    adminModal.classList.remove('hidden');
    if (appState.isAdminMode) {
        adminLoginArea.style.display = 'none';
        adminPanel.style.display = 'block';
        stopAutoRefresh();
        updateAdminFormValues();
        renderAdminTaskList();
    } else {
        adminLoginArea.style.display = 'block';
        adminPanel.style.display = 'none';
        adminPasswordInput.value = '';
        adminPasswordInput.focus();
    }
}

function closeAdminModal() {
    adminModal.classList.add('hidden');
    if (appState.isAdminMode) {
        startAutoRefresh();
    }
}

function updateAdminFormValues() {
    const config = appState.config;
    const allocRadios = document.querySelectorAll('input[name="allocationLock"]');
    allocRadios.forEach(r => r.checked = (r.value === String(config.allocationLocked)));
}

async function adminLogin() {
    const pwd = adminPasswordInput.value.trim();
    if (!pwd) { showToast('请输入密码', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/admin/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.message || '密码错误', 'error');
            return;
        }
        storedAdminPassword = pwd;
        appState.isAdminMode = true;
        adminLoginArea.style.display = 'none';
        adminPanel.style.display = 'block';
        adminToggleBtn.textContent = '🔐 管理员 ✓';
        adminToggleBtn.classList.add('active');
        stopAutoRefresh();
        await loadTasks();
        updateAdminFormValues();
        renderAdminTaskList();
        showToast('验证成功', 'success');
    } catch (err) {
        showToast('验证失败: ' + err.message, 'error');
    }
}

function adminLogout() {
    storedAdminPassword = '';
    appState.isAdminMode = false;
    adminToggleBtn.textContent = '🔐 管理员';
    adminToggleBtn.classList.remove('active');
    closeAdminModal();
    startAutoRefresh();
    showToast('已退出管理', 'info');
}

// 保存历史快照
async function saveHistorySnapshot() {
    if (!storedAdminPassword) {
        showToast('请先登录管理员', 'error');
        return;
    }
    const reason = prompt('请输入本次保存的备注（可选）：') || '手动保存';
    try {
        const res = await fetch(`${API_BASE}/admin/save-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: storedAdminPassword,
                reason: reason 
            })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || '保存失败', 'error');
            return;
        }
        showToast(`历史快照已保存（${reason}）`, 'success');
    } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
    }
}

// 保存分配配置
async function saveConfig() {
    if (!storedAdminPassword) {
        showToast('请先登录管理员', 'error');
        return;
    }
    const allocationLocked = document.querySelector('input[name="allocationLock"]:checked').value === 'true';
    try {
        const res = await fetch(`${API_BASE}/admin/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allocationLocked, password: storedAdminPassword })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || '保存失败', 'error');
            return;
        }
        showToast('配置已更新', 'success');
        await loadTasks();
        updateAdminFormValues();
    } catch (err) {
        showToast('保存失败', 'error');
    }
}

// 重置
async function adminResetClaims() {
    if (!confirm('确定要重置所有任务的认领、完成状态和备注吗？')) return;
    try {
        const res = await fetch(`${API_BASE}/admin/reset`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' } 
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || '重置失败', 'error'); return; }
        showToast(data.message || '已重置', 'success');
        await loadTasks();
        if (appState.isAdminMode) renderAdminTaskList();
    } catch (err) { showToast('重置失败', 'error'); }
}

// 添加任务
async function adminAddTask() {
    const desc = adminTaskInput.value.trim();
    if (!desc) { showToast('请输入任务描述', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/admin/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: desc })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || '添加失败', 'error'); return; }
        adminTaskInput.value = '';
        showToast('任务已添加', 'success');
        await loadTasks();
        if (appState.isAdminMode) renderAdminTaskList();
    } catch (err) { showToast('添加失败', 'error'); }
}

// 批量设置
async function adminBatchSet() {
    const raw = adminBatchInput.value;
    const lines = raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (lines.length === 0) { showToast('请至少输入一个任务', 'error'); return; }
    if (!confirm(`替换为 ${lines.length} 个任务，清除所有数据，确定？`)) return;
    try {
        const res = await fetch(`${API_BASE}/admin/tasks/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks: lines })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || '批量设置失败', 'error'); return; }
        adminBatchInput.value = '';
        showToast(data.message || '设置成功', 'success');
        await loadTasks();
        if (appState.isAdminMode) renderAdminTaskList();
    } catch (err) { showToast('批量设置失败', 'error'); }
}

// 设置任务完成锁定
async function setCompletionLock(taskId, lock) {
    if (!storedAdminPassword) {
        showToast('请先登录管理员', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/admin/tasks/${taskId}/completion-lock`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lock, password: storedAdminPassword })
        });
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 401) {
                showToast('会话已过期，请重新登录', 'error');
                adminLogout();
                return;
            }
            showToast(data.message || '设置锁定失败', 'error');
            return;
        }
        showToast('锁定状态已更新', 'success');
        await loadTasks();
        if (appState.isAdminMode) renderAdminTaskList();
    } catch (err) {
        showToast('设置锁定失败', 'error');
    }
}

// 渲染管理员任务列表
function renderAdminTaskList() {
    const tasks = appState.tasks;
    if (!tasks || tasks.length === 0) {
        adminTaskListEl.innerHTML = '<div style="padding:12px;color:#7a8fa3;text-align:center;">暂无任务</div>';
        return;
    }
    let html = '';
    tasks.forEach(task => {
        const status = task.claimed ? `✅ ${task.claimant || '已认领'}` : '⬜ 未认领';
        const comp = task.completed ? '✔已完成' : '⏳未完成';
        const lock = task.completionLock || 'none';
        html += `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #eef2f6;gap:8px;flex-wrap:wrap;">
                <span style="font-size:14px;flex:1;min-width:120px;">
                    <strong>#${task.id}</strong> ${escapeHtml(task.description)}
                    <span style="color:#7a8fa3;font-size:13px;margin-left:8px;">${status} ${comp}</span>
                </span>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                    <select class="lock-select" data-id="${task.id}" style="padding:4px 8px;border-radius:8px;border:1.5px solid #d0d9e4;font-size:13px;background:#fff;">
                        <option value="none" ${lock === 'none' ? 'selected' : ''}>不强制</option>
                        <option value="force_completed" ${lock === 'force_completed' ? 'selected' : ''}>强制已完成</option>
                        <option value="force_uncompleted" ${lock === 'force_uncompleted' ? 'selected' : ''}>强制未完成</option>
                    </select>
                    <button class="btn btn-primary btn-sm apply-lock-btn" data-id="${task.id}" style="padding:2px 12px;font-size:12px;">应用</button>
                    <button class="btn btn-danger btn-sm admin-del-btn" data-id="${task.id}" style="padding:2px 12px;font-size:12px;">删除</button>
                </div>
            </div>
        `;
    });
    adminTaskListEl.innerHTML = html;

    adminTaskListEl.querySelectorAll('.admin-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.id, 10);
            if (!confirm(`删除任务 #${id} ？`)) return;
            try {
                const res = await fetch(`${API_BASE}/admin/tasks/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) { showToast(data.message || '删除失败', 'error'); return; }
                showToast('已删除', 'success');
                await loadTasks();
                if (appState.isAdminMode) renderAdminTaskList();
            } catch (err) { showToast('删除失败', 'error'); }
        });
    });

    adminTaskListEl.querySelectorAll('.apply-lock-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id, 10);
            const select = btn.parentElement.querySelector('.lock-select');
            const lock = select.value;
            setCompletionLock(id, lock);
        });
    });
}

// ==================== 事件绑定 ====================
adminToggleBtn.addEventListener('click', openAdminModal);
adminCloseBtn.addEventListener('click', closeAdminModal);
adminCloseBtn2.addEventListener('click', closeAdminModal);
adminModal.addEventListener('click', e => { if (e.target === adminModal) closeAdminModal(); });
adminLoginBtn.addEventListener('click', adminLogin);
adminPasswordInput.addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); if (e.key === 'Escape') closeAdminModal(); });
adminLogoutBtn.addEventListener('click', adminLogout);
adminResetBtn.addEventListener('click', adminResetClaims);
adminAddBtn.addEventListener('click', adminAddTask);
adminTaskInput.addEventListener('keydown', e => { if (e.key === 'Enter') adminAddTask(); });
adminBatchSetBtn.addEventListener('click', adminBatchSet);
saveConfigBtn.addEventListener('click', saveConfig);

// 绑定保存历史按钮
document.addEventListener('DOMContentLoaded', () => {
    const saveHistoryBtn = document.getElementById('saveHistoryBtn');
    if (saveHistoryBtn) {
        saveHistoryBtn.addEventListener('click', saveHistorySnapshot);
    }
});

document.addEventListener('tasksUpdated', () => {
    if (!adminModal.classList.contains('hidden') && appState.isAdminMode) {
        renderAdminTaskList();
        updateAdminFormValues();
    }
});

console.log('✅ admin.js 已加载');
