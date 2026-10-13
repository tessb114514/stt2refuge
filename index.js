import { getUserAvatars } from '/scripts/personas.js';
import { power_user } from '/scripts/power-user.js';
import { randomPersona } from './quick-model.js';
import { initQuickStart } from './quick-start.js';
import { initConnectionGuard } from './connection-guard.js';
import { playPluginClickSound } from './ui-sound.js';
import { getRequestHeaders, saveSettingsDebounced, closeCurrentChat, getThumbnailUrl, characters, updateRemoteChatName, this_chid, getCurrentChatId } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { openWelcomeScreen } from '/scripts/welcome-screen.js';

// Scoped styles live inside each ShadowRoot and never enter the Tavern page.
const styleResponse = await fetch(new URL('./style.css', import.meta.url));
if (!styleResponse.ok) throw new Error('聊天选择器样式加载失败');
const styleText = await styleResponse.text();
const KEY = 'chat_selector';
const config = () => extension_settings[KEY] ??= { enabled: true };
let pending = false;
let backendReady = false;
window.chatSelectorToken = '';
window.refugeConnectionToken = '';
const element = (tag, text, cls) => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; };
async function api(action, data = {}, token) {
    const headers = getRequestHeaders();
    if (token) headers['X-Chat-Selector-Token'] = token;
    const response = await fetch('/api/plugins/refuge/' + action, { method: 'POST', headers, body: JSON.stringify(data) });
    const value = await response.json();
    if (!response.ok) { const error = new Error(value.error || '操作失败'); error.status = response.status; throw error; }
    return value;
}
function input(placeholder, type = 'text') { const el = element('input'); el.type = type; el.placeholder = placeholder; el.autocomplete = 'off'; return el; }
function button(text, handler, variant = '') { const el = element('button', text, 'cs-button ' + variant); el.type = 'button'; el.addEventListener('click', handler); return el; }
function surface(parent) {
    const host = element('st-chat-selector-ui');
    // Reset inherited styling at the boundary, including theme !important rules.
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    const root = host.attachShadow({ mode: 'open' });
    root.addEventListener('click', event => {
        const control = event.composedPath().find(node => node?.tagName === 'BUTTON' || (node?.tagName === 'A' && node.classList.contains('cs-button')) || node?.tagName === 'SUMMARY' || (node?.tagName === 'INPUT' && ['checkbox','radio'].includes(node.type)));
        if (control && !control.disabled && !control.closest('[inert]')) playPluginClickSound();
    }, { capture: true });
    const style = element('style'); style.textContent = styleText;
    root.append(style); parent.append(host);
    return { host, root };
}
const icons = {
    cloud: '<path d="M6 18h12a4 4 0 0 0 .5-8 6.5 6.5 0 0 0-12.3-1.8A5 5 0 0 0 6 18Z"/><path d="m17 3 .5 1.5L19 5l-1.5.5L17 7l-.5-1.5L15 5l1.5-.5Z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 11h18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
};
function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('cs-icon'); svg.innerHTML = icons[name]; return svg;
}
function field(caption, control) {
    const label = element('label', null, 'cs-field');
    label.append(element('span', caption, 'cs-field-label'), control); return label;
}
function actions(...controls) { const group = element('div', null, 'cs-actions'); group.append(...controls); return group; }
function modal(title, character) {
    const { host, root } = surface(document.body);
    const dialog = element('dialog', null, 'cs-dialog');
    const header = element('header', null, 'cs-header');
    const emblem = element('div', null, 'cs-emblem');
    if (character?.avatar) {
        const avatar = element('img'); avatar.src = getThumbnailUrl('avatar', character.avatar); avatar.alt = character.name + '的头像';
        avatar.addEventListener('error', () => { avatar.src = '/img/ai4.png'; }, { once: true }); emblem.append(avatar);
    } else emblem.append(icon('cloud'));
    const copy = element('div');
    const heading = element('h3', title); heading.id = 'cs-dialog-title';
    copy.append(element('span', 'CHAT CORNER', 'cs-eyebrow'), heading, element('p', 'Refuge喵提醒您，不要找错聊天记录哦喵~', 'cs-subtitle'));
    header.append(emblem, copy);
    const body = element('div', null, 'cs-body');
    const error = element('p', '', 'cs-error'); error.setAttribute('role', 'alert');
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.append(header, body, error); root.append(dialog); dialog.showModal();
    return { dialog, body, error, close: () => { dialog.close(); host.remove(); window.dispatchEvent(new Event('refuge:dialog-closed')); } };
}
const graphemes = value => [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(value)].map(x => x.segment);
function validateGlyph(value) {
    const clean = value.trim();
    if (clean && (graphemes(clean).length !== 1 || clean.length > 32 || /[\x00-\x1f]/.test(clean))) throw new Error('图标只能填一个Emoji或单字，也可留空恢复首字。');
    return clean;
}
const glyphKey = (avatar, name) => JSON.stringify([avatar, name]);
function glyphFor(avatar, name) {
    return config().rowIcons?.[glyphKey(avatar, name)] || config().defaultGlyph || graphemes(name)[0];
}
async function updateCurrentName(character, oldName, newName) {
    const id = characters.findIndex(x => x.avatar === character.avatar);
    if (id >= 0 && characters[id].chat === oldName) await updateRemoteChatName(id, newName);
    if (character.chat === oldName) character.chat = newName;
}
window.sillyTavernChatSelector = async (character, mode = 'existing') => {
    if (!config().enabled) return { name: character.chat, disabled: true };
    if (!backendReady) { toastr.error('请先完成Refuge主机端安装并重启酒馆。'); return undefined; }
    if (pending) return undefined;
    pending = true;
    try { return await choose(character, mode); } finally { pending = false; }
};
window.sillyTavernChatSelectorEnabled = () => Boolean(config().enabled && backendReady);
async function choose(character, mode) {
    const ui = modal('选择聊天 · ' + character.name, character);
    const avatar_url = character.avatar;
    const tabs = element('div', null, 'cs-tabs');
    const existing = element('section', null, 'cs-panel'), fresh = element('section', null, 'cs-panel');
    const filter = input('搜索聊天名称'); filter.setAttribute('aria-label', '搜索聊天名称');
    const list = element('div', null, 'cs-list');
    const login = element('div', null, 'cs-login'); login.hidden = true;
    const name = input('必填：至少3个汉字、英文字母或数字'); name.maxLength = 80; name.setAttribute('aria-label', '新聊天名称');
    let usePassword = false;
    const label = button('设置密码', () => {
        usePassword = !usePassword;
        label.setAttribute('aria-pressed', String(usePassword)); label.setAttribute('aria-expanded', String(usePassword));
        password.hidden = repeat.hidden = !usePassword;
    }, 'cs-secondary cs-toggle');
    label.setAttribute('aria-pressed', 'false'); label.setAttribute('aria-expanded', 'false');
    const password = input('聊天密码（4～128个字符）', 'password'); password.hidden = true; password.maxLength = 128; password.setAttribute('aria-label', '新聊天密码');
    const repeat = input('再次输入聊天密码', 'password'); repeat.hidden = true; repeat.maxLength = 128; repeat.setAttribute('aria-label', '再次输入密码');
    let bindPersona = false, selectedPersona = '', personaAvatars = [], personasLoading = false;
    const personaPanel = element('section', null, 'cs-persona-panel'); personaPanel.hidden = true;
    const personaList = element('div', null, 'qs-personas');
    const personaSearch = input('搜索已有Persona'); personaSearch.setAttribute('aria-label', '搜索聊天Persona');
    const renderPersonas = () => {
        personaList.replaceChildren();
        const shown = personaAvatars.filter(avatar => String(power_user.personas[avatar]).toLowerCase().includes(personaSearch.value.toLowerCase()));
        for (const avatar of shown) {
            const choice = element('label', null, 'cs-persona-option');
            const radio = input('', 'radio'); radio.name = 'refuge-chat-persona'; radio.value = avatar; radio.checked = avatar === selectedPersona;
            radio.setAttribute('aria-label', power_user.personas[avatar]); radio.onchange = () => { selectedPersona = avatar; };
            const image = element('img'); image.src = getThumbnailUrl('persona', avatar); image.alt = '';
            choice.append(radio, image, element('span', power_user.personas[avatar])); personaList.append(choice);
        }
        if (!shown.length) personaList.append(element('p', personasLoading ? '正在读取Persona…' : '暂无匹配Persona，请先在酒馆用户角色设置中创建喵。', 'cs-empty'));
    };
    const personaToggle = button('是否绑定已有角色', async () => {
        bindPersona = !bindPersona; personaPanel.hidden = !bindPersona;
        personaToggle.setAttribute('aria-pressed', String(bindPersona)); personaToggle.setAttribute('aria-expanded', String(bindPersona));
        if (!bindPersona) return;
        personasLoading = true; renderPersonas();
        try {
            const avatars = await getUserAvatars(false);
            personaAvatars = avatars.filter(avatar => Object.hasOwn(power_user.personas || {}, avatar));
        } catch (error) { ui.error.textContent = error.message; }
        finally { personasLoading = false; renderPersonas(); }
    }, 'cs-secondary cs-toggle');
    personaToggle.setAttribute('aria-pressed', 'false'); personaToggle.setAttribute('aria-expanded', 'false');
    const random = button('随机🎲', () => {
        if (personasLoading) return;
        selectedPersona = randomPersona(personaAvatars) || ''; personaSearch.value = ''; renderPersonas();
    }, 'cs-secondary');
    personaSearch.oninput = renderPersonas;
    personaPanel.append(element('p', '你要以什么样的身份参与进来呢？', 'cs-section-title'), actions(personaSearch, random), personaList);

    const switchTab = which => {
        existing.hidden = which !== 'existing'; fresh.hidden = which !== 'new'; login.hidden = true; ui.error.textContent = '';
        existingTab.setAttribute('aria-selected', String(which === 'existing'));
        newTab.setAttribute('aria-selected', String(which === 'new'));
    };
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '聊天类型');
    const existingTab = button('已有聊天', () => switchTab('existing'));
    const newTab = button('新建聊天', () => switchTab('new'));
    existingTab.prepend(icon('folder')); newTab.prepend(icon('plus'));
    existingTab.setAttribute('role', 'tab'); newTab.setAttribute('role', 'tab');
    existingTab.id = 'cs-existing-tab'; newTab.id = 'cs-new-tab';
    existing.id = 'cs-existing-panel'; fresh.id = 'cs-new-panel';
    for (const [tab, panel] of [[existingTab, existing], [newTab, fresh]]) {
        tab.setAttribute('aria-controls', panel.id); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
        tab.addEventListener('keydown', e => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                e.preventDefault(); const next = e.key === 'Home' ? existingTab : e.key === 'End' ? newTab : tab === existingTab ? newTab : existingTab;
                next.click(); next.focus();
            }
        });
    }
    tabs.append(existingTab, newTab);
    const search = element('label', null, 'cs-search'); search.append(icon('search'), filter);
    existing.append(element('p', '找到熟悉的名字，继续上次的故事。', 'cs-hint'), search, list, login);
    fresh.append(element('p', '为新的对话起个名字吧。', 'cs-section-title'), field('聊天名称', name), element('p', '3～80个汉字、英文字母或数字；同一角色下不能重名。', 'cs-hint'), label, field('聊天密码', password), field('确认密码', repeat), personaToggle, personaPanel);
    ui.body.append(tabs, existing, fresh);
    switchTab(mode);
    let rows = [];
    let busy = false;
    return await new Promise(resolve => {
        let finished = false;
        let editing = false;
        const finish = result => { if (finished) return; finished = true; ui.close(); resolve(result); };
        const run = async fn => {
            if (busy) return;
            busy = true; ui.error.textContent = ''; ui.dialog.setAttribute('aria-busy', 'true');
            const controls = [...ui.dialog.querySelectorAll('button,input')]; controls.forEach(x => x.disabled = true);
            try { await fn(); } catch (e) { ui.error.textContent = e.message; }
            finally { busy = false; ui.dialog.setAttribute('aria-busy', 'false'); controls.forEach(x => x.disabled = false); }
        };
        const unlock = async (row, secret) => {
            const result = await api('unlock', { avatar_url, name: row.name, password: secret });
            if (editing) { row.token = result.token; showEditor(row); }
            else finish(result);
        };
        const select = row => {
            if (!row.locked) { void run(() => unlock(row)); return; }
            login.replaceChildren(); login.hidden = false;
            const secret = input('请输入聊天密码', 'password'); secret.maxLength = 128; secret.setAttribute('aria-label', '聊天密码');
            const admin = input('管理员密码', 'password'); admin.maxLength = 128; admin.hidden = true; admin.setAttribute('aria-label', '管理员密码');
            const recovered = element('p', '', 'cs-recovered');
            const recover = button('验证管理员密码并显示聊天密码', () => run(async () => {
                const result = await api('recover', { avatar_url, name: row.name, adminPassword: admin.value });
                recovered.textContent = '此聊天的密码：' + result.password;
                admin.value = '';
            }), 'cs-secondary'); recover.hidden = true;
            login.append(element('h4', '解锁：' + row.name), field('聊天密码', secret),
                actions(button(editing ? '解锁并编辑' : '打开聊天', () => run(() => unlock(row, secret.value)), 'cs-primary'),
                    button('忘记密码', () => { admin.hidden = recover.hidden = false; admin.focus(); }, 'cs-secondary')),
                field('管理员密码', admin), recover, recovered);
            secret.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void run(() => unlock(row, secret.value)); } });
            secret.focus();
        };
        const render = () => {
            list.replaceChildren();
            const matches = rows.filter(row => row.name.toLowerCase().includes(filter.value.toLowerCase()));
            if (!matches.length) {
                const empty = element('div', null, 'cs-empty'); empty.append(icon('cloud'), element('p', rows.length ? '没有找到这个名字' : '这里还没有聊天'), element('span', rows.length ? '试试其他关键词吧。' : '点一下“新建聊天”，开启新的故事。')); list.append(empty);
            }
            for (const row of matches) {
                const control = button('', () => select(row)); control.classList.add('cs-row');
                const glyph = element('span', null, 'cs-row-icon'); glyph.textContent = glyphFor(avatar_url, row.name);
                const copy = element('span', null, 'cs-row-copy');
                copy.append(element('span', row.name, 'cs-row-name'), element('span', `${row.messages ?? 0}条消息` + (row.locked ? ' · 密码保护' : ' · 可直接打开'), 'cs-row-meta'));
                if (row.locked) { const lock = icon('lock'); lock.classList.add('cs-row-lock'); copy.append(lock); }
                control.append(glyph, copy, icon('arrow'));
                if (editing) control.classList.add('cs-editable');
                if (row.name === character.chat) { control.classList.add('cs-current'); control.setAttribute('aria-current', 'true'); }
                control.title = new Date(row.modified).toLocaleString(); list.append(control);
            }
        };
        const refresh = async () => { rows = await api('list', { avatar_url }); render(); };
        const showEditor = row => {
            const editor = modal('编辑聊天 · ' + row.name, character);
            const rename = input('至少3个汉字、英文字母或数字'); rename.value = row.name; rename.maxLength = 80;
            const glyph = input('留空使用默认图标，例如：喵、🌸、☁️'); glyph.value = config().rowIcons?.[glyphKey(avatar_url, row.name)] || ''; glyph.maxLength = 32;
            let editorBusy = false;
            const execute = async fn => {
                if (editorBusy) return;
                editorBusy = true; editor.error.textContent = '';
                const controls = [...editor.dialog.querySelectorAll('button,input')]; controls.forEach(x => x.disabled = true);
                try { await fn(); } catch (e) { editor.error.textContent = e.message; }
                finally { editorBusy = false; controls.forEach(x => x.disabled = false); }
            };
            const save = button('保存更改', () => execute(async () => {
                const customGlyph = validateGlyph(glyph.value), oldName = row.name;
                const wasActive = characters[this_chid]?.avatar === avatar_url && getCurrentChatId() === oldName;
                if (rename.value !== oldName) {
                    const result = await api('rename', { avatar_url, name: oldName, newName: rename.value }, row.token);
                    row.name = result.name; row.token = result.token;
                    if (wasActive) window.chatSelectorToken = result.token;
                    await updateCurrentName(character, oldName, row.name);
                }
                const overrides = config().rowIcons ??= {};
                delete overrides[glyphKey(avatar_url, oldName)];
                if (customGlyph) overrides[glyphKey(avatar_url, row.name)] = customGlyph; else delete overrides[glyphKey(avatar_url, row.name)];
                saveSettingsDebounced(); await refresh(); editor.close();
            }), 'cs-primary');
            const remove = button('删除聊天', () => {
                if (editorBusy) return;
                const confirm = modal('删除聊天 · ' + row.name, character);
                const warning = element('p', '删除不可逆，确定不是手滑吗喵？QwQ', 'cs-delete-warning');
                const admin = input('请输入管理员密码', 'password'); admin.maxLength = 128;
                const longChat = element('div'); longChat.hidden = !(row.messages > 20);
                longChat.append(element('p', `这条聊天有${row.messages}条消息，超过20条，需要管理员密码。`, 'cs-hint'), field('管理员密码', admin));
                let deleting = false;
                const yes = button('确认删除', async () => {
                    if (deleting) return;
                    deleting = true; yes.disabled = true; no.disabled = true; confirm.error.textContent = '';
                    try {
                        const wasActive = characters[this_chid]?.avatar === avatar_url && getCurrentChatId() === row.name;
                        await api('delete', { avatar_url, name: row.name, confirm: true, adminPassword: admin.value }, row.token);
                        if (wasActive && await closeCurrentChat()) { window.chatSelectorToken = ''; await openWelcomeScreen({ force: true }); }
                        delete (config().rowIcons ??= {})[glyphKey(avatar_url, row.name)]; saveSettingsDebounced();
                        await refresh(); await updateCurrentName(character, row.name, rows[0]?.name || '');
                        confirm.close(); editor.close();
                    } catch (e) { confirm.error.textContent = e.message; if (e.status === 428) longChat.hidden = false; }
                    finally { deleting = false; yes.disabled = no.disabled = false; }
                }, 'cs-danger');
                const no = button('取消', () => { if (!deleting) confirm.close(); }, 'cs-secondary');
                confirm.body.append(warning, longChat, actions(no, yes));
                confirm.dialog.addEventListener('cancel', e => { e.preventDefault(); if (!deleting) confirm.close(); });
            }, 'cs-danger-outline');
            editor.body.append(element('p', `${row.messages ?? 0}条消息${row.locked ? ' · 已解锁，改名后仍保留密码保护' : ''}`, 'cs-hint'), field('聊天名称', rename), field('左侧图标（Emoji或单字）', glyph), actions(save, remove), button('返回列表', () => { if (!editorBusy) editor.close(); }, 'cs-quiet cs-editor-back'));
            editor.dialog.addEventListener('cancel', e => { e.preventDefault(); if (!editorBusy) editor.close(); });
        };
        filter.oninput = () => { login.hidden = true; render(); };
        fresh.append(button('确定，新建聊天', () => run(async () => {
            if (![...name.value].length || !/^[\p{Script=Han}A-Za-z0-9]{3,80}$/u.test(name.value)) throw new Error('名称需为3～80个汉字、英文字母或数字，不能含空格或标点。');
            if (usePassword && (password.value.length < 4 || password.value !== repeat.value)) throw new Error('密码至少4个字符，两次输入必须一致。');
            if (bindPersona && (personasLoading || !selectedPersona || !personaAvatars.includes(selectedPersona))) throw new Error('请先勾选一个已有Persona，或使用随机🎲喵。');
            const result = await api('create', { avatar_url, name: name.value, password: usePassword ? password.value : '', personaAvatar: bindPersona ? selectedPersona : undefined });
            finish(result);
        }), 'cs-primary cs-create'));
        const footer = element('footer', null, 'cs-footer');
        const editButton = button('编辑', () => {
            editing = !editing; editButton.textContent = editing ? '完成编辑' : '编辑';
            editButton.setAttribute('aria-pressed', String(editing)); login.hidden = true;
            existing.querySelector('.cs-hint').textContent = editing ? '点选记录，即可改名、设置图标或删除。' : '找到熟悉的名字，继续上次的故事。';
            switchTab('existing'); render();
        }, 'cs-secondary'); editButton.setAttribute('aria-pressed', 'false');
        footer.append(editButton, button('取消，留在当前页面', () => { if (!busy) finish(undefined); }, 'cs-quiet'));
        ui.body.append(footer);
        ui.dialog.addEventListener('cancel', e => { e.preventDefault(); if (!busy) finish(undefined); });
        void run(async () => { rows = await api('list', { avatar_url }); render(); });
    });
}
$(async () => {
    initConnectionGuard({ surface, modal, element, input, button, api, available: () => backendReady });
    const { root } = surface(document.querySelector('#extensions_settings'));
    const container = element('div', null, 'cs-settings');
    const details = element('details');
    const summary = element('summary'); summary.append(icon('cloud'), element('span', 'Refuge · 快速启动与聊天选择'), element('span', '设置', 'cs-badge')); details.append(summary);
    const enabled = input('', 'checkbox'); enabled.checked = config().enabled;
    const label = element('label', null, 'cs-check'); label.append(enabled, document.createTextNode(' 启用Refuge快速启动与聊天选择'));
    const quickStart = initQuickStart({ surface, modal, element, button, input, icon, config, available: () => backendReady });
    enabled.onchange = async () => {
        config().enabled = enabled.checked; saveSettingsDebounced(); quickStart.update();

    };
    const defaultGlyph = input('留空为文件名首字；可填Emoji或单字'); defaultGlyph.value = config().defaultGlyph || ''; defaultGlyph.maxLength = 32;
    const glyphError = element('p', '', 'cs-error'); glyphError.setAttribute('role', 'alert');
    const glyphSave = button('保存图标设置', () => {
        try { config().defaultGlyph = validateGlyph(defaultGlyph.value); saveSettingsDebounced(); glyphError.textContent = '图标设置已保存。'; }
        catch (e) { glyphError.textContent = e.message; }
    }, 'cs-secondary');
    const quickSetting = element('label', null, 'cs-check');
    const automatic = input('', 'checkbox'); automatic.checked = config().quickStart !== false;
    automatic.onchange = () => { config().quickStart = automatic.checked; saveSettingsDebounced(); };
    quickSetting.append(automatic, document.createTextNode(' 打开酒馆时显示猫猫主界面'));
    details.append(label, quickSetting, button('打开猫猫主界面', quickStart.open, 'cs-secondary'), element('p', '每次打开角色聊天先选择已有或新建聊天。关闭弹窗后，已有密码保护仍有效。', 'cs-hint'), field('默认记录图标', defaultGlyph), element('p', '在选择页点“编辑”，也能为单条记录设置专属图标。', 'cs-hint'), glyphSave, glyphError);
    container.append(details); root.append(container);
    try {
        const status = await api('status');
        if (status.version !== '0.5.4' || !status.coreIntegration) throw new Error('主机端版本或兼容接入未就绪。');
        backendReady = true; quickStart.update(); quickStart.open({ automatic: true });
    } catch {
        container.append(element('p', 'Refuge 0.5.4：请由主机管理员按仓库README安装服务端及兼容接入，然后重启酒馆并刷新。仅安装前端不足以启用聊天密码和连接权限功能。', 'cs-notice'));
    }
});
