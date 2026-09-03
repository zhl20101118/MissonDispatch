import {
    API_BASE, appState,
    $, $$, taskListEl, totalCountEl, claimedCountEl, completedCountEl, taskCountBadge,
    claimModal, claimTaskDesc, claimNameInput, claimCancelBtn, claimConfirmBtn,
    showToast, escapeHtml, loadTasks, updateStats, startAutoRefresh, stopAutoRefresh
} from './common.js';

// ==================== 密钥管理 ====================
// 存储格式：{ taskId: key }
let taskKeys = {};

// 从 localStorage 加载密钥
function loadKeysFromStorage() {
    try {
        const stored = localStorage.getItem('taskKeys');
        if (stored) {
            taskKeys = JSON.parse(stored);
        } else {
            taskKeys = {};
        }
    } catch (e) {
        console.warn('加载密钥失败', e);
        taskKeys = {};
    }
}

// 保存密钥到 localStorage
function saveKeysToStorage() {
    try {
        localStorage.setItem('taskKeys', JSON.stringify(taskKeys));
    } catch (e) {
        console.warn('保存密钥失败', e);
    }
}

// 获取任务密钥
function getTaskKey(taskId) {
    return taskKeys[taskId] || '';
}

// 设置任务密钥
function setTaskKey(taskId, key) {
    taskKeys[taskId] = key;
    saveKeysToStorage();
}

// 检查是否已绑定密钥
function hasTaskKey(taskId) {
    return !!taskKeys[taskId];
}

// ==================== 渲染任务列表 ====================
export function renderTasks() {
    const tasks = appState.tasks;
    const config = appState.config;
    if (!tasks || tasks.length === 0) {
        taskListEl.innerHTML = `<div class="empty-state"><span class="emoji">📭</span><p>暂无任务，请管理员添加。</p></div>`;
        return;
    }
    let html = '';
    tasks.forEach(task => {
        const claimed = task.claimed;
        const completed = task.completed;
        const claimant = task.claimant || '';
        const notes = task.notes || '';
        const lock = task.completionLock || 'none';
        const hasKey = hasTaskKey(task.id);

        // 任务级强制模式覆盖显示完成状态
        let displayCompleted = completed;
        if (lock === 'force_completed') displayCompleted = true;
        else if (lock === 'force_uncompleted') displayCompleted = false;

        const statusBadge = claimed ? `<span class="badge claimed">✅ 已认领</span>` : `<span class="badge unclaimed">⬜ 未认领</span>`;
        const completeBadge = displayCompleted ? `<span class="badge completed">✔ 已完成</span>` : `<span class="badge incomplete">⏳ 未完成</span>`;

        let actionsHtml = '';
        if (!claimed) {
            const disabled = config.allocationLocked ? 'disabled' : '';
            actionsHtml += `<button class="btn btn-success btn-sm claim-btn" data-id="${task.id}" ${disabled}>✋ 认领</button>`;
            if (config.allocationLocked) {
                actionsHtml += `<span style="font-size:12px;color:#c62828;margin-left:4px;">🔒 分配已锁定</span>`;
            }
        } else {
            actionsHtml += `<span class="claimant-name">👤 ${escapeHtml(claimant)}</span>`;
            
            // 密钥绑定状态
            if (hasKey) {
                actionsHtml += `<span class="badge" style="background:#d4edda;color:#155724;">🔑 已绑定</span>`;
            } else {
                actionsHtml += `<button class="btn btn-outline btn-sm bind-key-btn" data-id="${task.id}">🔑 绑定密钥</button>`;
            }
        }

        // 完成/撤销按钮（受任务级锁定控制）
        const isLocked = lock !== 'none';
        const hasValidKey = hasKey && getTaskKey(task.id) === task.key;
        // 只有绑定了正确密钥才能操作
        const canOperate = claimed && hasValidKey;

        if (displayCompleted) {
            actionsHtml += `<button class="btn btn-outline btn-sm undo-complete-btn" data-id="${task.id}" ${(isLocked || !canOperate) ? 'disabled' : ''}>↩️ 撤销完成</button>`;
        } else {
            actionsHtml += `<button class="btn btn-primary btn-sm complete-btn" data-id="${task.id}" ${(isLocked || !canOperate) ? 'disabled' : ''}>✅ 完成</button>`;
        }

        const notesDisplay = notes ? escapeHtml(notes) : '<span class="notes-text empty">无备注</span>';
        html += `
            <div class="task-card ${claimed ? 'claimed' : ''}" data-id="${task.id}">
                <div class="task-row">
                    <div class="task-info">
                        <span class="task-id">#${task.id}</span>
                        <span class="task-desc">${escapeHtml(task.description)}</span>
                    </div>
                    <div class="task-status">
                        ${statusBadge}
                        ${completeBadge}
                    </div>
                </div>
                <div class="task-row">
                    <div class="task-actions">
                        ${actionsHtml}
                    </div>
                </div>
                <div class="task-notes">
                    <span class="notes-text ${notes ? '' : 'empty'}">${notesDisplay}</span>
                    <button class="btn btn-outline btn-sm edit-notes-btn" data-id="${task.id}" ${!canOperate ? 'disabled' : ''}>✏️ 编辑备注</button>
                </div>
            </div>
        `;
    });
    taskListEl.innerHTML = html;

    // 绑定事件
    taskListEl.querySelectorAll('.claim-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const id = parseInt(btn.dataset.id, 10);
            openClaimModal(id);
        });
    });
    taskListEl.querySelectorAll('.bind-key-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const id = parseInt(btn.dataset.id, 10);
            openBindKeyModal(id);
        });
    });
    taskListEl.querySelectorAll('.complete-btn, .undo-complete-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const id = parseInt(btn.dataset.id, 10);
            if (!btn.disabled) toggleComplete(id);
        });
    });
    taskListEl.querySelectorAll('.edit-notes-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const id = parseInt(btn.dataset.id, 10);
            if (!btn.disabled) editNotes(id);
        });
    });
}

// ==================== 认领 ====================
function openClaimModal(taskId) {
    const task = appState.tasks.find(t => t.id === taskId);
    if (!task) { showToast('任务不存在', 'error'); return; }
    if (task.claimed) { showToast('已认领', 'error'); return; }
    if (appState.config.allocationLocked) { showToast('分配已被锁定', 'error'); return; }
    appState.claimTargetId = taskId;
    claimTaskDesc.textContent = `「${task.description}」`;
    claimNameInput.value = '';
    claimNameInput.focus();
    claimModal.classList.remove('hidden');
}

function closeClaimModal() {
    claimModal.classList.add('hidden');
    appState.claimTargetId = null;
}

async function confirmClaim() {
    const name = claimNameInput.value.trim();
    if (!name) { showToast('请输入姓名', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/tasks/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: appState.claimTargetId, name })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || '认领失败', 'error'); return; }
        
        // 认领成功，显示密钥
        if (data.key) {
            // 自动绑定密钥
            setTaskKey(appState.claimTargetId, data.key);
            showToast(`认领成功！密钥已自动绑定`, 'success');
        } else {
            showToast('认领成功', 'success');
        }
        
        closeClaimModal();
        await loadTasks();
    } catch (err) { showToast('网络错误', 'error'); }
}

// ==================== 绑定密钥 ====================
function openBindKeyModal(taskId) {
    const task = appState.tasks.find(t => t.id === taskId);
    if (!task) { showToast('任务不存在', 'error'); return; }
    if (!task.claimed) { showToast('任务未被认领', 'error'); return; }
    if (hasTaskKey(taskId)) { showToast('已绑定密钥', 'info'); return; }
    
    const key = prompt(`请输入任务 #${taskId} 的密钥：\n（请联系认领者获取）`);
    if (key === null) return;
    if (!key.trim()) { showToast('密钥不能为空', 'error'); return; }
    
    verifyAndBindKey(taskId, key.trim());
}

async function verifyAndBindKey(taskId, key) {
    try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}/verify-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (!res.ok || !data.valid) {
            showToast(data.message || '密钥错误', 'error');
            return;
        }
        // 绑定密钥
        setTaskKey(taskId, key);
        showToast('密钥绑定成功！', 'success');
        await loadTasks();
    } catch (err) {
        showToast('验证失败', 'error');
    }
}

// ==================== 完成/撤销 ====================
async function toggleComplete(taskId) {
    // 检查任务级锁定
    const task = appState.tasks.find(t => t.id === taskId);
    if (!task) { showToast('任务不存在', 'error'); return; }
    if (task.completionLock && task.completionLock !== 'none') {
        const msg = task.completionLock === 'force_completed' ? '该任务已被强制为已完成' : '该任务已被强制为未完成';
        showToast(msg, 'error');
        return;
    }
    
    const key = getTaskKey(taskId);
    if (!key) {
        showToast('请先绑定任务密钥', 'error');
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}/toggle-complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (!res.ok) {
            // 如果密钥错误，清除本地密钥
            if (res.status === 403 && data.message.includes('密钥错误')) {
                delete taskKeys[taskId];
                saveKeysToStorage();
                showToast('密钥已失效，请重新绑定', 'error');
                await loadTasks();
                return;
            }
            showToast(data.message || '操作失败', 'error');
            return;
        }
        showToast(data.message, 'success');
        await loadTasks();
    } catch (err) { showToast('操作失败', 'error'); }
}

// ==================== 备注 ====================
function editNotes(taskId) {
    const task = appState.tasks.find(t => t.id === taskId);
    if (!task) return;
    const key = getTaskKey(taskId);
    if (!key) {
        showToast('请先绑定任务密钥', 'error');
        return;
    }
    const currentNotes = task.notes || '';
    const newNotes = prompt('编辑备注内容：', currentNotes);
    if (newNotes === null) return;
    updateNotes(taskId, newNotes, key);
}

async function updateNotes(taskId, notes, key) {
    try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}/notes`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes, key })
        });
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 403 && data.message.includes('密钥错误')) {
                delete taskKeys[taskId];
                saveKeysToStorage();
                showToast('密钥已失效，请重新绑定', 'error');
                await loadTasks();
                return;
            }
            showToast(data.message || '更新备注失败', 'error');
            return;
        }
        showToast('备注已更新', 'success');
        await loadTasks();
    } catch (err) { showToast('更新失败', 'error'); }
}

// ==================== 事件绑定 ====================
claimCancelBtn.addEventListener('click', closeClaimModal);
claimConfirmBtn.addEventListener('click', confirmClaim);
claimNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmClaim(); if (e.key === 'Escape') closeClaimModal(); });
claimModal.addEventListener('click', e => { if (e.target === claimModal) closeClaimModal(); });

document.addEventListener('tasksUpdated', (e) => {
    renderTasks();
    updateStats();
});

// ==================== 初始化 ====================
// 加载存储的密钥
loadKeysFromStorage();

loadTasks().then(() => {
    renderTasks();
    updateStats();
});
startAutoRefresh();  // 启动自动刷新

console.log('✅ user.js 已加载');
console.log(`📌 已加载 ${Object.keys(taskKeys).length} 个任务密钥`);
