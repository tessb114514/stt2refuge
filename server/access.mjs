import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureAdministrator } from './defaults.mjs';
let coreIntegration = false;
export function setCoreIntegration(value) { coreIntegration = Boolean(value); }

// Passwords are encrypted for administrator recovery; chat JSONL stays native.
const grants = new Map();
const attempts = new Map();
const connectionGrants = new Map();
const CONNECTION_TTL = 5 * 60 * 1000;
const TOKEN_TTL = 12 * 60 * 60 * 1000;
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export function validateName(name) {
    if (typeof name !== 'string' || [...name].length < 3 || [...name].length > 80 || !/^[\p{Script=Han}A-Za-z0-9]+$/u.test(name)) fail('名称需为3～80个汉字、英文字母或数字。');
    if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(name)) fail('该名称为系统保留名，请换一个名称。');
    return name;
}
function location(req, avatar = req.body?.avatar_url) {
    if (typeof avatar !== 'string' || !avatar.endsWith('.png') || avatar.includes('..') || /[\\/\x00]/.test(avatar)) fail('无效角色卡。');
    if (!fs.existsSync(path.join(req.user.directories.characters, avatar))) fail('角色卡不存在。', 404);
    return path.join(req.user.directories.chats, avatar.replace('.png', ''));
}
function readState(req) {
    const directory = path.join(req.user.directories.root, 'chat-selector');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'vault.json');
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { chats: {} };
    const adminFile = path.join(path.dirname(req.user.directories.root), 'chat-selector-admin.json');
    ensureAdministrator(adminFile);
    data.admin = JSON.parse(fs.readFileSync(adminFile, 'utf8'));
    return { directory, file, data, adminFile };
}
function writeState(state) {
    const temp = state.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ chats: state.data.chats }), { mode: 0o600 });
    fs.renameSync(temp, state.file);
}
function master(state) {
    const file = path.join(state.directory, 'key');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
    return fs.readFileSync(file);
}
function encrypt(state, password) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', master(state), iv);
    const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), value: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decrypt(state, record) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', master(state), Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.value, 'base64')), decipher.final()]).toString('utf8');
}
function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function chatKey(avatar, name) { return JSON.stringify([avatar, name]); }
function issue(req, key) {
    const now = Date.now();
    for (const [token, grant] of grants) if (grant.expires < now) grants.delete(token);
    const token = crypto.randomBytes(32).toString('hex');
    grants.set(token, { root: req.user.directories.root, key, expires: now + TOKEN_TTL });
    return token;
}
function authorized(req, key) {
    const grant = grants.get(req.get('X-Chat-Selector-Token'));
    return Boolean(grant && grant.root === req.user.directories.root && grant.key === key && grant.expires > Date.now());
}
function rate(req, action, verify) {
    const key = req.user.directories.root + ':' + req.ip + ':' + action;
    const now = Date.now();
    for (const [k, v] of attempts) if (now > v.until) attempts.delete(k);
    const entry = attempts.get(key) || { count: 0, until: now + 60000 };
    if (entry.count >= 5) fail('尝试过多，请一分钟后再试。', 429);
    if (!verify()) { entry.count++; attempts.set(key, entry); fail('密码错误。', 403); }
    attempts.delete(key);
}
function validPassword(password) {
    if (typeof password !== 'string' || password.length < 4 || password.length > 128) fail('密码需为4～128个字符。');
}

export function connectionAuthorized(req) {
    const grant = connectionGrants.get(req.get('X-Refuge-Connection-Token'));
    return Boolean(grant && grant.root === req.user.directories.root && grant.expires > Date.now() && grant.adminHash === readState(req).data.admin?.hash);
}
function connectionSettings(req) {
    const file = path.join(req.user.directories.root, 'settings.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
export function guardConnectionSettings(req, res, next) {
    try {
        if (req.path === '/save') {
            const existing = connectionSettings(req).oai_settings?.custom_url || '';
            const incoming = req.body?.oai_settings?.custom_url || '';
            if (incoming !== existing && !connectionAuthorized(req)) fail('修改自定义端点需要管理员验证。', 403);
        }
        if (req.path === '/restore-snapshot' && !connectionAuthorized(req)) fail('恢复连接配置需要管理员验证。', 403);
        next();
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '连接配置校验失败。' }); }
}
export function guardConnectionSecrets(req, res, next) {
    try {
        if (req.body?.key === 'api_key_custom' && ['/find','/write','/delete','/rotate','/rename'].includes(req.path) && !connectionAuthorized(req)) fail('查看或更改自定义 API 密钥需要管理员验证。', 403);
        next();
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '密钥权限校验失败。' }); }
}
export function canReadChat(req, avatar, name) {
    const key = chatKey(avatar, name);
    return !readState(req).data.chats[key] || authorized(req, key);
}
export function hasProtectedChats(req, avatar) {
    return Object.keys(readState(req).data.chats).some(key => JSON.parse(key)[0] === avatar);
}
export function canReadPath(req, file) {
    const relative = path.relative(req.user.directories.chats, file);
    const parts = relative.split(path.sep);
    return parts.length !== 2 || canReadChat(req, parts[0] + '.png', parts[1].replace(/\.jsonl$/, ''));
}
export function guardChat(req, res, next) {
    try {
        if (['/rename', '/export'].includes(req.path) && req.body?.is_group) return next();
        const fields = { '/get': 'file_name', '/save': 'file_name', '/delete': 'chatfile', '/export': 'file', '/rename': 'original_file' };
        const field = fields[req.path];
        if (!field) return next();
        location(req);
        const raw = req.body?.[field];
        if (typeof raw !== 'string') return next();
        if (/[<>:"/\\|?*\x00-\x1f]/.test(raw)) fail('无效聊天文件名。');
        const name = raw.replace(/\.jsonl$/, '');
        if (!canReadChat(req, req.body.avatar_url, name)) fail('请先通过聊天选择器验证密码。', 403);
        if (req.path === '/delete' && messageCount(path.join(location(req), name + '.jsonl')) > 20) rate(req, 'admin', () => verifyAdmin(readState(req), req.body.adminPassword));
        if (req.path === '/rename' && readState(req).data.chats[chatKey(req.body.avatar_url, name)]) fail('密码聊天暂不支持重命名，请保留原文件名。');
        next();
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '聊天校验失败。' }); }
}
function existingFile(req) {
    const dir = location(req), name = req.body.name;
    if (typeof name !== 'string' || !name || /[<>:"/\\|?*\x00-\x1f]/.test(name)) fail('无效聊天名称。');
    const file = path.join(dir, name + '.jsonl');
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) fail('聊天不存在。', 404);
    return { dir, name, file, key: chatKey(req.body.avatar_url, name) };
}
export function messageCount(file) {
    let count = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(x => x.trim())) {
        let value;
        try { value = JSON.parse(line); } catch { fail('聊天文件损坏，无法核对消息楼层数。', 409); }
        if (count === 0 && !('mes' in value) && ('chat_metadata' in value || 'user_name' in value)) continue;
        count++;
    }
    return count;
}
function revoke(req, key) {
    for (const [token, grant] of grants) if (grant.root === req.user.directories.root && grant.key === key) grants.delete(token);
}
export function registerSelector(router) {
    const route = (name, fn) => router.post(name, (req, res) => {
        try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '操作失败，请检查服务端日志。' }); if (!e.status) console.error(e); }
    });
    route('/status', req => ({ adminConfigured: Boolean(readState(req).data.admin), version: '0.5.4', coreIntegration }));
    route('/connection-unlock', req => {
        const state = readState(req);
        rate(req, 'admin', () => verifyAdmin(state, req.body.adminPassword));
        const token = crypto.randomBytes(32).toString('hex'), expires = Date.now() + CONNECTION_TTL;
        for (const [key, grant] of connectionGrants) if (grant.expires <= Date.now()) connectionGrants.delete(key);
        connectionGrants.set(token, { root: req.user.directories.root, adminHash: state.data.admin.hash, expires });
        return { token, expires };
    });
    route('/connection-details', req => {
        if (!connectionAuthorized(req)) fail('请先验证管理员密码。', 403);
        return { url: connectionSettings(req).oai_settings?.custom_url || '' };
    });
    route('/connection-save', req => {
        if (!connectionAuthorized(req)) fail('请先验证管理员密码。', 403);
        if (typeof req.body.url !== 'string' || req.body.url.length > 4096) fail('无效自定义端点。');
        const url = req.body.url.trim();
        if (url) { let parsed; try { parsed = new URL(url); } catch { fail('请输入有效的 http 或 https 基础 URL。'); } if (!['http:','https:'].includes(parsed.protocol)) fail('基础 URL 仅支持 http 或 https。'); }
        const settings = connectionSettings(req); settings.oai_settings ??= {}; settings.oai_settings.custom_url = url;
        const file = path.join(req.user.directories.root, 'settings.json'), temp = file + '.refuge.tmp';
        fs.writeFileSync(temp, JSON.stringify(settings, null, 4)); fs.renameSync(temp, file);
        return { ok: true, url };
    });
    route('/connection-lock', req => {
        const token = req.get('X-Refuge-Connection-Token'), grant = connectionGrants.get(token);
        if (grant?.root === req.user.directories.root) connectionGrants.delete(token);
        return { ok: true };
    });
    route('/character-stats', req => {
        const result = {};
        const chatsRoot = path.resolve(req.user.directories.chats);
        for (const avatar of fs.readdirSync(req.user.directories.characters)) {
            if (!avatar.endsWith('.png')) continue;
            const dir = path.resolve(chatsRoot, avatar.replace('.png', ''));
            result[avatar] = { chats: 0, lastUsed: 0 };
            if (!dir.startsWith(chatsRoot + path.sep) || !fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) continue;
            for (const file of fs.readdirSync(dir)) {
                if (!file.endsWith('.jsonl')) continue;
                const stat = fs.lstatSync(path.join(dir, file));
                if (!stat.isFile()) continue;
                result[avatar].chats++;
                result[avatar].lastUsed = Math.max(result[avatar].lastUsed, stat.mtimeMs);
            }
        }
        return result;
    });
    route('/list', req => {
        const dir = location(req), state = readState(req);
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isFile() && x.name.endsWith('.jsonl')).map(x => {
            const name = x.name.slice(0, -6);
            return { name, locked: Boolean(state.data.chats[chatKey(req.body.avatar_url, name)]), modified: fs.statSync(path.join(dir, x.name)).mtimeMs, messages: messageCount(path.join(dir, x.name)) };
        }).sort((a, b) => b.modified - a.modified);
    });
    route('/admin', req => {
        if (!req.user.profile.admin) fail('只有SillyTavern管理员账号能设置管理员密码。', 403);
        const state = readState(req);
        if (state.data.admin) {
            rate(req, 'admin', () => verifyAdmin(state, req.body.current));
        }
        validPassword(req.body.password);
        if (req.body.password.length < 8) fail('管理员密码至少8个字符。');
        const salt = crypto.randomBytes(16).toString('hex');
        state.data.admin = { salt, hash: crypto.scryptSync(req.body.password, salt, 32).toString('hex') };
        const temp = state.adminFile + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(state.data.admin), { mode: 0o600 });
        fs.renameSync(temp, state.adminFile);
        return { ok: true };
    });
    route('/create', req => {
        const dir = location(req), name = validateName(req.body.name), state = readState(req);
        const key = chatKey(req.body.avatar_url, name);
        const password = req.body.password;
        const persona = req.body.personaAvatar;
        if (persona !== undefined && persona !== null && persona !== '') {
            if (typeof persona !== 'string' || /[\\/\x00]/.test(persona) || !req.user.directories.avatars || !fs.existsSync(path.join(req.user.directories.avatars, persona)) || !fs.lstatSync(path.join(req.user.directories.avatars, persona)).isFile()) fail('所选Persona头像不存在，请重新选择。');
        }
        const metadata = persona ? { persona } : {};
        if (password !== undefined && password !== '') { validPassword(password); if (!state.data.admin) fail('管理员密码尚未配置。'); }
        fs.mkdirSync(dir, { recursive: true });
        // Case-insensitive collision check is consistent on Windows and Linux.
        if (fs.readdirSync(dir).some(x => x.toLowerCase() === (name + '.jsonl').toLowerCase())) fail('同一角色卡下已有同名聊天。', 409);
        const file = path.join(dir, name + '.jsonl');
        try { fs.writeFileSync(file, JSON.stringify({ user_name: 'unused', character_name: 'unused', chat_metadata: metadata }) + '\n', { flag: 'wx' }); }
        catch (e) { if (e.code === 'EEXIST') fail('同名聊天已存在。', 409); throw e; }
        try {
            if (password) state.data.chats[key] = encrypt(state, password); else delete state.data.chats[key];
            writeState(state);
        } catch (e) { fs.unlinkSync(file); throw e; }
        return { name, token: issue(req, key) };
    });
    route('/unlock', req => {
        const dir = location(req), name = req.body.name;
        if (typeof name !== 'string' || /[\\/\x00]/.test(name)) fail('无效聊天名称。');
        if (!fs.existsSync(path.join(dir, name + '.jsonl'))) fail('聊天不存在。', 404);
        const state = readState(req), key = chatKey(req.body.avatar_url, name), record = state.data.chats[key];
        if (record) rate(req, 'unlock', () => typeof req.body.password === 'string' && equal(decrypt(state, record), req.body.password));
        return { name, token: issue(req, key) };
    });
    route('/rename', req => {
        const old = existingFile(req), newName = validateName(req.body.newName), state = readState(req);
        if (!canReadChat(req, req.body.avatar_url, old.name)) fail('请先验证聊天密码。', 403);
        if (newName === old.name) return { name: newName, token: issue(req, old.key) };
        if (fs.readdirSync(old.dir).some(x => x.toLowerCase() === (newName + '.jsonl').toLowerCase())) fail('同一角色卡下已有同名聊天。', 409);
        const destination = path.join(old.dir, newName + '.jsonl'), newKey = chatKey(req.body.avatar_url, newName);
        const oldRecord = state.data.chats[old.key], priorDestinationRecord = state.data.chats[newKey];
        // Exclusive creation prevents an existing file from being overwritten.
        try { fs.linkSync(old.file, destination); } catch (e) { if (e.code === 'EEXIST') fail('同名聊天已存在。', 409); throw e; }
        try {
            if (oldRecord) state.data.chats[newKey] = oldRecord; else delete state.data.chats[newKey];
            delete state.data.chats[old.key]; writeState(state); fs.unlinkSync(old.file);
        } catch (e) {
            if (oldRecord) state.data.chats[old.key] = oldRecord;
            if (priorDestinationRecord) state.data.chats[newKey] = priorDestinationRecord; else delete state.data.chats[newKey];
            writeState(state); fs.unlinkSync(destination); throw e;
        }
        revoke(req, old.key);
        return { name: newName, token: issue(req, newKey) };
    });
    route('/delete', req => {
        const old = existingFile(req), state = readState(req);
        if (req.body.confirm !== true) fail('请先确认删除。');
        if (!canReadChat(req, req.body.avatar_url, old.name)) fail('请先验证聊天密码。', 403);
        if (messageCount(old.file) > 20) {
            if (!req.body.adminPassword) fail('这条记录超过20条消息，请输入管理员密码。', 428);
            rate(req, 'admin', () => verifyAdmin(state, req.body.adminPassword));
        }
        const oldRecord = state.data.chats[old.key];
        delete state.data.chats[old.key]; writeState(state);
        try { fs.unlinkSync(old.file); } catch (e) { if (oldRecord) state.data.chats[old.key] = oldRecord; writeState(state); throw e; }
        revoke(req, old.key);
        return { ok: true };
    });
    route('/recover', req => {
        location(req);
        const state = readState(req), record = state.data.chats[chatKey(req.body.avatar_url, req.body.name)];
        rate(req, 'admin', () => verifyAdmin(state, req.body.adminPassword));
        if (!record) fail('该聊天没有密码。', 404);
        return { password: decrypt(state, record) };
    });
}
function verifyAdmin(state, password) {
    return Boolean(state.data.admin && typeof password === 'string' && password.length <= 128 && equal(crypto.scryptSync(password, state.data.admin.salt, 32).toString('hex'), state.data.admin.hash));
}
