const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'tasks.json');

// 默认管理员密码（可在管理面板中修改）
const DEFAULT_ADMIN_PASSWORD = '滚木！';

// 洛谷风格难度档位（与前端 public/common.js 一致）
const DIFFICULTIES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'black'];

// ---------- 工具函数 ----------
function hashPassword(pw) {
    return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

let nextAccountId = 1, nextTaskId = 1, nextCompetitionId = 1, nextProblemId = 1;

// ---------- 默认数据 ----------
function defaultData() {
    return {
        config: { adminPassword: DEFAULT_ADMIN_PASSWORD, lockEditing: false },
        accounts: [],          // { id, name, password(hash), createdAt }
        dailyTasks: [],        // { id, date, title, createdAt }
        competitions: [],      // { id, dailyTaskId, accountId, title, progress, notes, createdAt, updatedAt }
        problems: []           // { id, dailyTaskId, accountId, title, link, difficulty, createdAt }
    };
}

function loadData() {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        // 兼容/迁移：直接取需要的字段
        const data = defaultData();
        data.config = Object.assign(data.config, (parsed && parsed.config) || {});
        data.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
        data.dailyTasks = Array.isArray(parsed.dailyTasks) ? parsed.dailyTasks : [];
        data.competitions = Array.isArray(parsed.competitions) ? parsed.competitions : [];
        data.problems = Array.isArray(parsed.problems) ? parsed.problems : [];
        // 重新计算自增 id
        nextAccountId = (data.accounts.reduce((m, a) => Math.max(m, a.id || 0), 0)) + 1;
        nextTaskId = (data.dailyTasks.reduce((m, a) => Math.max(m, a.id || 0), 0)) + 1;
        nextCompetitionId = (data.competitions.reduce((m, a) => Math.max(m, a.id || 0), 0)) + 1;
        nextProblemId = (data.problems.reduce((m, a) => Math.max(m, a.id || 0), 0)) + 1;
        return data;
    } catch (err) {
        const data = defaultData();
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return data;
    }
}

let data = loadData();

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 公开数据（去掉账号密码）
function publicData() {
    return {
        config: {
            adminPasswordSet: !!data.config.adminPassword,
            lockEditing: !!data.config.lockEditing
        },
        accounts: data.accounts.map(a => ({ id: a.id, name: a.name, createdAt: a.createdAt })),
        dailyTasks: data.dailyTasks,
        competitions: data.competitions,
        problems: data.problems
    };
}

// 管理员鉴权
function isAdmin(password) {
    return hashPassword(password) === hashPassword(data.config.adminPassword);
}

// 成员鉴权：返回账号或 null
function findAccount(id) {
    return data.accounts.find(a => a.id === Number(id));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 公开读取 ----------
app.get('/api/data', (req, res) => {
    res.json(publicData());
});

// ---------- 成员认证 ----------
app.post('/api/auth/login', (req, res) => {
    const { name, password } = req.body;
    if (!name || password === undefined) return res.status(400).json({ message: '缺少姓名或密码' });
    const account = data.accounts.find(a => a.name.trim() === String(name).trim());
    if (!account) return res.status(401).json({ message: '账号不存在' });
    if (account.password !== hashPassword(password)) return res.status(401).json({ message: '密码错误' });
    res.json({ success: true, account: { id: account.id, name: account.name } });
});

// 修改自己的密码
app.post('/api/auth/change-password', (req, res) => {
    const { accountId, oldPassword, newPassword } = req.body;
    const account = findAccount(accountId);
    if (!account) return res.status(404).json({ message: '账号不存在' });
    if (account.password !== hashPassword(oldPassword)) return res.status(401).json({ message: '原密码错误' });
    if (!newPassword || String(newPassword).length < 1) return res.status(400).json({ message: '新密码不能为空' });
    account.password = hashPassword(newPassword);
    saveData();
    res.json({ message: '密码修改成功' });
});

// ---------- 成员操作（需账号+密码） ----------
// 校验成员身份
function verifyMember(accountId, password) {
    const account = findAccount(accountId);
    if (!account) return null;
    if (account.password !== hashPassword(password)) return null;
    return account;
}

// 更新自己比赛的进度/备注
app.patch('/api/competition/:id/progress', (req, res) => {
    const id = Number(req.params.id);
    const { accountId, password, progress, notes } = req.body;
    const comp = data.competitions.find(c => c.id === id);
    if (!comp) return res.status(404).json({ message: '比赛不存在' });
    const member = verifyMember(accountId, password);
    if (!member) return res.status(401).json({ message: '身份校验失败' });
    if (comp.accountId !== member.id) return res.status(403).json({ message: '无权更新该比赛' });
    if (data.config.lockEditing) return res.status(403).json({ message: '当前已锁定，禁止编辑' });
    if (['pending', 'ongoing', 'done'].includes(progress)) comp.progress = progress;
    comp.notes = notes !== undefined ? String(notes) : comp.notes;
    comp.updatedAt = new Date().toISOString();
    saveData();
    res.json({ message: '已更新', competition: comp });
});

// 删除自己推送的题目
app.delete('/api/problem/:id', (req, res) => {
    const id = Number(req.params.id);
    const { accountId, password } = req.body;
    const prob = data.problems.find(p => p.id === id);
    if (!prob) return res.status(404).json({ message: '题目不存在' });
    const member = verifyMember(accountId, password);
    if (!member) return res.status(401).json({ message: '身份校验失败' });
    if (prob.accountId !== member.id) return res.status(403).json({ message: '只能删除自己推送的题目' });
    if (data.config.lockEditing) return res.status(403).json({ message: '当前已锁定，禁止编辑' });
    data.problems = data.problems.filter(p => p.id !== id);
    saveData();
    res.json({ message: '题目已删除' });
});

// 推送题目
app.post('/api/problems', (req, res) => {
    const { accountId, password, dailyTaskId, title, link, difficulty } = req.body;
    const member = verifyMember(accountId, password);
    if (!member) return res.status(401).json({ message: '身份校验失败' });
    if (data.config.lockEditing) return res.status(403).json({ message: '当前已锁定，禁止推题' });
    if (!title || !title.trim()) return res.status(400).json({ message: '请填写题目名称' });
    if (!link || !link.trim()) return res.status(400).json({ message: '请填写题目链接' });
    const task = data.dailyTasks.find(t => t.id === Number(dailyTaskId));
    if (!task) return res.status(404).json({ message: '每日任务不存在' });

    // 简单校验链接
    const finalLink = String(link).trim();
    const normalized = /^https?:\/\//i.test(finalLink) ? finalLink : `https://${finalLink}`;

    const problem = {
        id: nextProblemId++,
        dailyTaskId: Number(dailyTaskId),
        accountId: member.id,
        title: String(title).trim(),
        link: normalized,
        difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'red',
        createdAt: new Date().toISOString()
    };
    data.problems.push(problem);
    saveData();
    res.json({ message: '题目推送成功', problem });
});

// ---------- 管理员 API ----------
app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body;
    if (isAdmin(password)) res.json({ success: true });
    else res.status(401).json({ success: false, message: '密码错误' });
});

// 修改管理员密码
app.post('/api/admin/change-password', (req, res) => {
    const { password, newPassword } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    if (!newPassword || String(newPassword).length < 1) return res.status(400).json({ message: '新密码不能为空' });
    data.config.adminPassword = String(newPassword);
    saveData();
    res.json({ message: '管理员密码已修改' });
});

// 添加账号（初始密码=用户名，可由成员修改）
app.post('/api/admin/account', (req, res) => {
    const { password, name } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    if (!name || !name.trim()) return res.status(400).json({ message: '请输入账号名' });
    const finalName = String(name).trim();
    if (data.accounts.some(a => a.name === finalName)) return res.status(409).json({ message: '账号名已存在' });
    const account = {
        id: nextAccountId++,
        name: finalName,
        password: hashPassword(finalName), // 初始密码=用户名
        createdAt: new Date().toISOString()
    };
    data.accounts.push(account);
    saveData();
    res.json({ message: `账号已添加，初始密码：${finalName}`, account: { id: account.id, name: account.name } });
});

// 重置账号密码
app.patch('/api/admin/account/:id/password', (req, res) => {
    const { password, newPassword } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const account = findAccount(req.params.id);
    if (!account) return res.status(404).json({ message: '账号不存在' });
    account.password = hashPassword(newPassword);
    saveData();
    res.json({ message: '账号密码已重置' });
});

// 删除账号
app.delete('/api/admin/account/:id', (req, res) => {
    const { password } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const id = Number(req.params.id);
    if (!data.accounts.some(a => a.id === id)) return res.status(404).json({ message: '账号不存在' });
    data.accounts = data.accounts.filter(a => a.id !== id);
    // 连带删除该账号的比赛与题目
    data.competitions = data.competitions.filter(c => c.accountId !== id);
    data.problems = data.problems.filter(p => p.accountId !== id);
    saveData();
    res.json({ message: '账号已删除' });
});

// 添加每日任务
app.post('/api/admin/daily-task', (req, res) => {
    const { password, date, title } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    if (!date) return res.status(400).json({ message: '请选择日期' });
    if (!title || !title.trim()) return res.status(400).json({ message: '请填写任务标题' });
    const task = {
        id: nextTaskId++,
        date: String(date),
        title: String(title).trim(),
        createdAt: new Date().toISOString()
    };
    data.dailyTasks.push(task);
    saveData();
    res.json({ message: '每日任务已添加', task });
});

// 删除每日任务（连带比赛与题目）
app.delete('/api/admin/daily-task/:id', (req, res) => {
    const { password } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const id = Number(req.params.id);
    if (!data.dailyTasks.some(t => t.id === id)) return res.status(404).json({ message: '每日任务不存在' });
    data.dailyTasks = data.dailyTasks.filter(t => t.id !== id);
    data.competitions = data.competitions.filter(c => c.dailyTaskId !== id);
    data.problems = data.problems.filter(p => p.dailyTaskId !== id);
    saveData();
    res.json({ message: '每日任务已删除' });
});

// 给账号分配比赛
app.post('/api/admin/competition', (req, res) => {
    const { password, dailyTaskId, accountId, title, link } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    if (!data.dailyTasks.some(t => t.id === Number(dailyTaskId))) return res.status(404).json({ message: '每日任务不存在' });
    const account = findAccount(accountId);
    if (!account) return res.status(404).json({ message: '账号不存在' });
    if (!title || !title.trim()) return res.status(400).json({ message: '请填写比赛名称' });
    const now = new Date().toISOString();
    const comp = {
        id: nextCompetitionId++,
        dailyTaskId: Number(dailyTaskId),
        accountId: account.id,
        title: String(title).trim(),
        link: (link && link.trim()) ? ((/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`)) : '',
        progress: 'pending',
        notes: '',
        createdAt: now,
        updatedAt: now
    };
    data.competitions.push(comp);
    saveData();
    res.json({ message: '比赛已分配', competition: comp });
});

// 管理员修改/强制设置任何比赛（标题、成员、进度、备注、链接）
app.patch('/api/admin/competition/:id', (req, res) => {
    const { password, title, accountId, progress, notes, link } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const id = Number(req.params.id);
    const comp = data.competitions.find(c => c.id === id);
    if (!comp) return res.status(404).json({ message: '比赛不存在' });
    if (accountId !== undefined && findAccount(accountId)) comp.accountId = Number(accountId);
    if (title !== undefined && title.trim()) comp.title = String(title).trim();
    if (progress !== undefined && ['pending', 'ongoing', 'done'].includes(progress)) comp.progress = progress;
    if (notes !== undefined) comp.notes = String(notes);
    if (link !== undefined) comp.link = link.trim() ? (/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`) : '';
    comp.updatedAt = new Date().toISOString();
    saveData();
    res.json({ message: '比赛已更新', competition: comp });
});

// 删除比赛
app.delete('/api/admin/competition/:id', (req, res) => {
    const { password } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const id = Number(req.params.id);
    if (!data.competitions.some(c => c.id === id)) return res.status(404).json({ message: '比赛不存在' });
    data.competitions = data.competitions.filter(c => c.id !== id);
    saveData();
    res.json({ message: '比赛已删除' });
});

// 管理员删除任意题目
app.delete('/api/admin/problem/:id', (req, res) => {
    const { password } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const id = Number(req.params.id);
    if (!data.problems.some(p => p.id === id)) return res.status(404).json({ message: '题目不存在' });
    data.problems = data.problems.filter(p => p.id !== id);
    saveData();
    res.json({ message: '题目已删除' });
});

// 管理员推题（归属显示为“管理员”）
app.post('/api/admin/problem', (req, res) => {
    const { password, dailyTaskId, title, link, difficulty } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    if (!title || !title.trim()) return res.status(400).json({ message: '请填写题目名称' });
    if (!link || !link.trim()) return res.status(400).json({ message: '请填写题目链接' });
    const task = data.dailyTasks.find(t => t.id === Number(dailyTaskId));
    if (!task) return res.status(404).json({ message: '每日任务不存在' });
    const finalLink = String(link).trim();
    const normalized = /^https?:\/\//i.test(finalLink) ? finalLink : `https://${finalLink}`;
    const problem = {
        id: nextProblemId++,
        dailyTaskId: Number(dailyTaskId),
        accountId: 0, // 0 = 管理员
        title: String(title).trim(),
        link: normalized,
        difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'red',
        createdAt: new Date().toISOString()
    };
    data.problems.push(problem);
    saveData();
    res.json({ message: '题目推送成功', problem });
});

// 管理员编辑任意题目
app.patch('/api/admin/problem/:id', (req, res) => {
    const { password, title, link, difficulty } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const id = Number(req.params.id);
    const prob = data.problems.find(p => p.id === id);
    if (!prob) return res.status(404).json({ message: '题目不存在' });
    if (title !== undefined && title.trim()) prob.title = String(title).trim();
    if (link !== undefined && link.trim()) {
        const finalLink = String(link).trim();
        prob.link = /^https?:\/\//i.test(finalLink) ? finalLink : `https://${finalLink}`;
    }
    if (difficulty !== undefined && DIFFICULTIES.includes(difficulty)) prob.difficulty = difficulty;
    saveData();
    res.json({ message: '题目已更新', problem: prob });
});

// 全局配置
app.post('/api/admin/config', (req, res) => {
    const { password, lockEditing } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    if (lockEditing !== undefined) data.config.lockEditing = !!lockEditing;
    saveData();
    res.json({ message: '配置已更新' });
});

// 重置全部数据（保留当前管理员密码）
app.post('/api/admin/reset', (req, res) => {
    const { password } = req.body;
    if (!isAdmin(password)) return res.status(401).json({ message: '密码错误' });
    const adminPassword = data.config.adminPassword;
    data = defaultData();
    data.config.adminPassword = adminPassword;
    nextAccountId = 1; nextTaskId = 1; nextCompetitionId = 1; nextProblemId = 1;
    saveData();
    res.json({ message: '已重置全部数据' });
});

app.listen(PORT, () => {
    console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
    console.log(`👥 账号数: ${data.accounts.length}`);
    console.log(`📋 每日任务数: ${data.dailyTasks.length}`);
    console.log(`🎯 比赛数: ${data.competitions.length}`);
    console.log(`🧩 题目数: ${data.problems.length}`);
    console.log(`🔐 管理员密码: ${'*'.repeat(String(data.config.adminPassword).length)}（可在管理面板修改）`);
    console.log(`⚠️  管理员默认密码: ${DEFAULT_ADMIN_PASSWORD}`);
});