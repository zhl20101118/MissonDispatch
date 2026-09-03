const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'tasks.json');
const HISTORY_DIR = path.join(__dirname, 'public', 'history');
const HISTORY_INDEX_FILE = path.join(HISTORY_DIR, 'index.json');

// 确保历史目录存在
if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

// 生成任务密钥
function generateTaskKey() {
    return crypto.randomBytes(16).toString('hex');
}

const DEFAULT_TASKS = [
    { id: 1, description: '完成项目报告', claimed: false, claimant: '', key: '', completed: false, notes: '', completionLock: 'none' },
    { id: 2, description: '代码审查', claimed: false, claimant: '', key: '', completed: false, notes: '', completionLock: 'none' },
    { id: 3, description: '部署测试环境', claimed: false, claimant: '', key: '', completed: false, notes: '', completionLock: 'none' }
];

let globalConfig = { allocationLocked: false };

// ==================== 历史记录管理 ====================
function saveHistorySnapshot(tasks, reason) {
    try {
        const timestamp = new Date().toISOString();
        const filename = `history_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`;
        const filePath = path.join(HISTORY_DIR, filename);
        
        // 统计任务状态
        const total = tasks.length;
        const claimed = tasks.filter(t => t.claimed).length;
        const completed = tasks.filter(t => t.completed).length;
        const unclaimed = total - claimed;
        
        // 保存快照数据（不含密钥，保护隐私）
        const snapshot = {
            timestamp,
            reason: reason || '手动保存',
            tasks: tasks.map(t => ({
                id: t.id,
                description: t.description,
                claimed: t.claimed,
                claimant: t.claimant || '',
                completed: t.completed,
                notes: t.notes || '',
                completionLock: t.completionLock || 'none'
                // 不保存 key 字段，保护隐私
            }))
        };
        
        fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
        
        // 更新索引
        let index = [];
        if (fs.existsSync(HISTORY_INDEX_FILE)) {
            index = JSON.parse(fs.readFileSync(HISTORY_INDEX_FILE, 'utf-8'));
        }
        
        index.unshift({
            id: filename.replace('.json', ''),
            filename: filename,
            timestamp: timestamp,
            reason: reason || '手动保存',
            total: total,
            claimed: claimed,
            completed: completed,
            unclaimed: unclaimed
        });
        
        // 限制历史数量（保留最近100条）
        if (index.length > 100) {
            const toRemove = index.slice(100);
            index = index.slice(0, 100);
            // 删除多余的文件
            toRemove.forEach(item => {
                try {
                    const filePath = path.join(HISTORY_DIR, item.filename);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {
                    console.warn('删除历史文件失败:', e);
                }
            });
        }
        
        fs.writeFileSync(HISTORY_INDEX_FILE, JSON.stringify(index, null, 2));
        console.log(`📚 已保存历史快照: ${filename} (${reason})`);
        return true;
    } catch (err) {
        console.error('保存历史快照失败:', err);
        return false;
    }
}

// ==================== 加载任务数据 ====================
function loadTasks() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        let tasks, config;
        if (Array.isArray(parsed)) {
            tasks = parsed;
            config = { allocationLocked: false };
            const newData = { tasks, config };
            fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2));
            globalConfig = config;
            tasks = tasks.map(t => ({
                ...t,
                completed: t.completed !== undefined ? t.completed : false,
                notes: t.notes !== undefined ? t.notes : '',
                completionLock: t.completionLock || 'none',
                key: t.key || ''
            }));
            return tasks;
        } else {
            tasks = parsed.tasks || [];
            config = parsed.config || { allocationLocked: false };
            tasks = tasks.map(t => ({
                ...t,
                completed: t.completed !== undefined ? t.completed : false,
                notes: t.notes !== undefined ? t.notes : '',
                completionLock: t.completionLock || 'none',
                key: t.key || ''
            }));
            globalConfig = config;
            return tasks;
        }
    } catch (err) {
        const defaultData = {
            tasks: DEFAULT_TASKS,
            config: { allocationLocked: false }
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
        globalConfig = defaultData.config;
        return defaultData.tasks;
    }
}

function saveTasks(tasks) {
    const data = { tasks, config: globalConfig };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let tasks = loadTasks();
let nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 重定向 /history 到 /history.html
app.get('/history', (req, res) => {
    res.redirect('/history.html');
});

// 重定向 /history-detail 到 /history-detail.html
app.get('/history-detail', (req, res) => {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect(`/history-detail.html${query}`);
});

// ---------- 公开 API ----------
app.get('/api/tasks', (req, res) => res.json({ tasks }));
app.get('/api/config', (req, res) => res.json(globalConfig));

// 获取历史索引
app.get('/api/history', (req, res) => {
    try {
        if (fs.existsSync(HISTORY_INDEX_FILE)) {
            const index = JSON.parse(fs.readFileSync(HISTORY_INDEX_FILE, 'utf-8'));
            res.json(index);
        } else {
            res.json([]);
        }
    } catch (err) {
        res.status(500).json({ message: '读取历史索引失败' });
    }
});

// 获取历史快照详情
app.get('/api/history/:id', (req, res) => {
    try {
        const id = req.params.id;
        const filename = `${id}.json`;
        const filePath = path.join(HISTORY_DIR, filename);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            res.json(data);
        } else {
            res.status(404).json({ message: '历史记录不存在' });
        }
    } catch (err) {
        res.status(500).json({ message: '读取历史详情失败' });
    }
});

// 认领任务（生成并返回密钥）
app.post('/api/tasks/claim', (req, res) => {
    const { taskId, name } = req.body;
    if (!taskId || !name) return res.status(400).json({ message: '缺少任务ID或姓名' });
    if (globalConfig.allocationLocked) return res.status(403).json({ message: '分配已被管理员锁定' });
    const task = tasks.find(t => t.id === taskId);
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (task.claimed) return res.status(409).json({ message: '该任务已被认领' });
    
    const key = generateTaskKey();
    task.claimed = true;
    task.claimant = name.trim();
    task.key = key;
    saveTasks(tasks);
    res.json({ message: '认领成功', key: key, taskId: task.id });
});

// 验证密钥
app.post('/api/tasks/:id/verify-key', (req, res) => {
    const id = parseInt(req.params.id);
    const { key } = req.body;
    if (!key) return res.status(400).json({ message: '缺少密钥' });
    
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!task.claimed) return res.status(403).json({ message: '任务未被认领' });
    if (task.key === key) {
        res.json({ valid: true, message: '密钥验证通过' });
    } else {
        res.status(403).json({ valid: false, message: '密钥错误' });
    }
});

// 切换完成状态（需要密钥验证）
app.patch('/api/tasks/:id/toggle-complete', (req, res) => {
    const id = parseInt(req.params.id);
    const { key } = req.body;
    if (!key) return res.status(400).json({ message: '缺少任务密钥' });
    
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!task.claimed) return res.status(403).json({ message: '任务未被认领，无需密钥' });
    if (task.key !== key) return res.status(403).json({ message: '密钥错误，无权操作此任务' });
    
    const lock = task.completionLock || 'none';
    if (lock !== 'none') {
        const msg = lock === 'force_completed' ? '该任务已被强制为已完成' : '该任务已被强制为未完成';
        return res.status(403).json({ message: msg });
    }
    task.completed = !task.completed;
    saveTasks(tasks);
    res.json({ message: task.completed ? '任务已完成' : '已撤销完成', completed: task.completed });
});

// 更新备注（需要密钥验证）
app.patch('/api/tasks/:id/notes', (req, res) => {
    const id = parseInt(req.params.id);
    const { notes, key } = req.body;
    if (!key) return res.status(400).json({ message: '缺少任务密钥' });
    
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!task.claimed) return res.status(403).json({ message: '任务未被认领，无需密钥' });
    if (task.key !== key) return res.status(403).json({ message: '密钥错误，无权操作此任务' });
    
    task.notes = notes !== undefined ? notes.trim() : '';
    saveTasks(tasks);
    res.json({ message: '备注已更新', notes: task.notes });
});

// ---------- 管理员 API ----------
const ADMIN_PASSWORD = 'whatever';

app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false, message: '密码错误' });
});

// 手动保存历史快照
app.post('/api/admin/save-history', (req, res) => {
    const { password, reason } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ message: '密码错误' });
    
    const success = saveHistorySnapshot(tasks, reason || '管理员手动保存');
    if (success) {
        res.json({ message: '历史快照已保存' });
    } else {
        res.status(500).json({ message: '保存历史快照失败' });
    }
});

app.post('/api/admin/config', (req, res) => {
    const { allocationLocked, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ message: '密码错误' });
    if (allocationLocked !== undefined) globalConfig.allocationLocked = !!allocationLocked;
    saveTasks(tasks);
    res.json({ message: '配置已更新', config: globalConfig });
});

app.post('/api/admin/reset', (req, res) => {
    tasks.forEach(t => {
        t.claimed = false;
        t.claimant = '';
        t.key = '';
        t.completed = false;
        t.notes = '';
        t.completionLock = 'none';
    });
    saveTasks(tasks);
    res.json({ message: '已重置所有内容' });
});

app.post('/api/admin/tasks', (req, res) => {
    const { description } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ message: '描述不能为空' });
    const newTask = {
        id: nextId++,
        description: description.trim(),
        claimed: false,
        claimant: '',
        key: '',
        completed: false,
        notes: '',
        completionLock: 'none'
    };
    tasks.push(newTask);
    saveTasks(tasks);
    res.json({ message: '任务添加成功', task: newTask });
});

app.post('/api/admin/tasks/batch', (req, res) => {
    const { tasks: newTasks } = req.body;
    if (!Array.isArray(newTasks) || newTasks.length === 0) {
        return res.status(400).json({ message: '请提供至少一个任务' });
    }
    tasks = newTasks.map((desc, index) => ({
        id: index + 1,
        description: desc.trim(),
        claimed: false,
        claimant: '',
        key: '',
        completed: false,
        notes: '',
        completionLock: 'none'
    }));
    nextId = tasks.length + 1;
    saveTasks(tasks);
    res.json({ message: `已设置 ${tasks.length} 个任务` });
});

app.delete('/api/admin/tasks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const index = tasks.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ message: '任务不存在' });
    tasks.splice(index, 1);
    saveTasks(tasks);
    res.json({ message: '任务已删除' });
});

app.patch('/api/admin/tasks/:id/completion-lock', (req, res) => {
    const id = parseInt(req.params.id);
    const { lock, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ message: '密码错误' });
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!['none', 'force_completed', 'force_uncompleted'].includes(lock)) {
        return res.status(400).json({ message: '无效的锁定模式' });
    }
    task.completionLock = lock;
    saveTasks(tasks);
    res.json({ message: '锁定状态已更新', completionLock: task.completionLock });
});

app.listen(PORT, () => {
    console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
    console.log(`📋 当前任务数: ${tasks.length}`);
    console.log(`🔐 管理员密码: ${ADMIN_PASSWORD}`);
    console.log(`🔒 分配锁定: ${globalConfig.allocationLocked}`);
    console.log(`📚 历史记录目录: ${HISTORY_DIR}`);
});
