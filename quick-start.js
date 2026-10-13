import { characters, this_chid, selectCharacterById, unshallowCharacter, getThumbnailUrl, getEntitiesList, entitiesFilter, eventSource, event_types, getCurrentChatId, getRequestHeaders, saveSettingsDebounced } from '/script.js';
import { tags, getTagsList, compareTagsForSort, chooseBogusFolder } from '/scripts/tags.js';
import { FILTER_TYPES } from '/scripts/filters.js';
import { openGroupById } from '/scripts/group-chats.js';
import { pageItems, formatLastUsed, randomCharacter } from './quick-model.js';

export function initQuickStart(ui) {
    const { surface, modal, element, button, input, icon, config } = ui;
    let quick = null, page = 1, selecting = false, requested = false, ready = false, collectionCache = null, characterStats = {}, statsFailed = false;
    const launcher = surface(document.body);
    const launchButton = button('回到快速界面', () => openQuickStart(), 'qs-launcher'); launchButton.prepend(icon('cloud'));
    launchButton.hidden = true; launcher.root.append(launchButton);
    function closeQuickStart(notify = false) {
        if (!quick) return;
        const current = quick; quick = null; current.close();
        launchButton.hidden = !config().enabled;
        if (notify) toastr.info('点击右上角回到快速界面喵', '', { positionClass: 'toast-top-center' });
    }
    function otherDialogOpen() {
        return [...document.querySelectorAll('st-chat-selector-ui')].some(host => host.shadowRoot?.querySelector('dialog[open]:not(.refuge-navigation-dialog)'));
    }
    function clickTag(id, remove = false) {
        const source = document.getElementById('rm_characters_block');
        const native = [...document.querySelectorAll('#rm_characters_block .rm_tag_filter .tag')].find(el => el.id === id);
        if (remove && source && native) chooseBogusFolder(source, id, true);
        else if (native) $(native).trigger('click');
        else {
            const current = entitiesFilter.getFilterData(FILTER_TYPES.TAG) || { selected: [], excluded: [] };
            const selected = current.selected.filter(x => x !== id), excluded = current.excluded.filter(x => x !== id);
            if (!remove) {
                if (current.selected.includes(id)) excluded.push(id);
                else if (!current.excluded.includes(id)) selected.push(id);
            }
            entitiesFilter.setFilterData(FILTER_TYPES.TAG, { selected, excluded });
        }
        page = 1; render();
    }
    function render({ reuseCollection = false } = {}) {
        if (!quick?.list) return;
        const { list, tagList, sort, status, previous, next } = quick;
        list.className = config().quickView === 'list' ? 'qs-grid qs-list-view' : 'qs-grid';
        for (const control of quick.views.querySelectorAll('button')) control.setAttribute('aria-pressed', String(control.dataset.view === (config().quickView || 'grid')));
        const nativeSort = document.getElementById('character_sort_order');
        if (nativeSort) {
            sort.replaceChildren(...[...nativeSort.options].filter(o => !o.hidden).map(option => {
                const clone = element('option', option.textContent); clone.value = option.value; clone.selected = option.selected; return clone;
            }));
        }
        const filter = entitiesFilter.getFilterData(FILTER_TYPES.TAG) || { selected: [], excluded: [] };
        tagList.replaceChildren();
        for (const [type, label, nativeClass] of [[FILTER_TYPES.FAV, '收藏', 'filterByFavorites'], [FILTER_TYPES.GROUP, '群组', 'filterByGroups'], [FILTER_TYPES.FOLDER, '标签分组', 'filterByFolder']]) {
            if (!type) continue;
            const state = entitiesFilter.getFilterData(type);
            const selected = state === 'SELECTED' || state?.key === 'SELECTED' || state === true;
            const excluded = state === 'EXCLUDED' || state?.key === 'EXCLUDED';
            const chip = button(label, () => {
                const native = document.querySelector('#rm_characters_block .rm_tag_filter .' + nativeClass);
                if (native) $(native).trigger('click');
                else entitiesFilter.setFilterData(type, selected ? 'EXCLUDED' : excluded ? 'UNDEFINED' : 'SELECTED');
                page = 1; render();
            }, 'qs-chip');
            chip.setAttribute('aria-pressed', String(selected));
            if (excluded) chip.classList.add('qs-excluded');
            chip.title = '沿用酒馆筛选：包含 / 排除 / 不筛选'; tagList.append(chip);
        }

        const all = button('全部标签', () => {
            for (const id of [...filter.selected, ...filter.excluded]) clickTag(id, true);
            page = 1; render();
        }, 'qs-chip'); all.setAttribute('aria-pressed', String(!filter.selected.length && !filter.excluded.length)); tagList.append(all);
        for (const tag of [...tags].sort(compareTagsForSort)) {
            const control = button(tag.name, () => clickTag(tag.id), 'qs-chip');
            control.setAttribute('aria-pressed', String(filter.selected.includes(tag.id)));
            if (filter.excluded.includes(tag.id)) control.classList.add('qs-excluded');
            control.title = '点击轮换：包含 / 排除 / 不筛选'; tagList.append(control);
        }
        if (!reuseCollection || !collectionCache) collectionCache = getEntitiesList({ doFilter: true, doSort: true });
        const collection = collectionCache;
        // Fit a whole page into the available space, including short desktop windows.
        const layout = getComputedStyle(list);
        const columns = Math.max(1, parseInt(layout.getPropertyValue('--qs-columns')) || 4);
        const rowHeight = parseFloat(layout.getPropertyValue('--qs-row-height')) || 100;
        const gap = parseFloat(layout.rowGap) || 0;
        const rows = Math.max(1, Math.floor((list.clientHeight + gap) / (rowHeight + gap)));
        list.style.setProperty('--qs-rows', rows);
        const result = pageItems(collection, page, columns * rows); page = result.page;
        list.replaceChildren();
        if (!result.items.length) list.append(element('p', '这里暂时没有匹配的角色卡喵，试试换个关键词或标签。', 'cs-empty'));
        for (const entity of result.items) {
            const card = button('', async () => {
                if (selecting) return;
                if (entity.type === 'tag') {
                    const source = document.getElementById('rm_characters_block');
                    if (source) chooseBogusFolder(source, entity.id); else clickTag(entity.id);
                    page = 1; render(); return;
                }
                selecting = true; quick?.dialog.setAttribute('aria-busy', 'true');
                try {
                    if (entity.type === 'group') { await openGroupById(entity.id); closeQuickStart(); }
                    else {
                        const avatar = entity.item.avatar;
                        const id = characters.findIndex(c => c.avatar === avatar);
                        if (id === -1) { render(); return; }
                        const result = await selectCharacterById(id, { chatFile: characters[id].chat });
                        if (result !== false) closeQuickStart();
                    }
                } catch (error) { if (quick) quick.error.textContent = error.message; }
                finally { selecting = false; quick?.dialog.setAttribute('aria-busy', 'false'); }
            }, 'qs-card');
            if (entity.type === 'tag') {
                const folder = element('div', null, 'qs-folder'); folder.append(icon('folder')); card.append(folder);
            } else {
                const avatar = element('img'); avatar.loading = 'lazy'; avatar.alt = entity.item.name;
                avatar.src = entity.type === 'character' ? getThumbnailUrl('avatar', entity.item.avatar) : (entity.item.avatar_url || '/img/five.png');
                avatar.addEventListener('error', () => { avatar.src = '/img/ai4.png'; }, { once: true }); card.append(avatar);
            }
            const copy = element('span', null, 'qs-card-copy');
            copy.append(element('strong', entity.item.name, 'qs-card-name'));
            const subtitle = entity.type === 'tag' ? `${entity.entities?.length ?? 0}个角色 / 群组` : entity.type === 'group' ? '群组聊天' : entity.item.creator_notes || entity.item.description || '开始属于你的故事喵';
            copy.append(element('span', String(subtitle).replace(/<[^>]*>/g, '').slice(0, 100), 'qs-card-description'));
            if (entity.type === 'character') {
                const stats = characterStats[entity.item.avatar];
                const count = stats ? `${stats.chats}个聊天` : statsFailed ? '聊天数量暂不可用' : '聊天数量加载中';
                const detail = count + ' · ' + formatLastUsed(stats?.lastUsed ?? entity.item.date_last_chat);
                const statsLabel = element('span', detail, 'qs-card-stats');
                statsLabel.title = '最近使用：' + detail; copy.append(statsLabel);
                const labels = element('span', null, 'qs-card-tags');
                for (const tag of getTagsList(entity.item.avatar).slice(0, 3)) labels.append(element('span', tag.name));
                copy.append(labels);
            }
            card.title = entity.item.name + '\n' + subtitle;
            card.append(copy); list.append(card);
        }
        status.textContent = `共${result.total}项 · ${page} / ${result.pages}页`;
        previous.disabled = page <= 1; next.disabled = page >= result.pages;
    }
    function navigationDialog(title, className, character) {
        const current = modal(title, character); quick = current;
        current.dialog.classList.add('refuge-navigation-dialog', className);
        launchButton.hidden = true;
        return current;
    }
    function returnHome() { if (selecting) return; closeQuickStart(); openQuickStart(); }
    function openQuickStart({ automatic = false } = {}) {
        if (ui.available && !ui.available()) return;
        if (!ready || !config().enabled || (automatic && config().quickStart === false)) return;
        if (quick) return;
        if (otherDialogOpen()) { requested = true; return; }
        requested = false;
        const current = navigationDialog('🍕小披萨馆の快速点餐模式', 'cs-home-dialog');
        current.dialog.querySelector('.cs-eyebrow').textContent = 'Welcome to Refuge Neko Pizza meow~';
        current.dialog.querySelector('.cs-subtitle').textContent = '欢迎光临喵，今天想开启哪一段故事？';
        const emblem = current.dialog.querySelector('.cs-emblem');
        const mascot = element('img'); mascot.src = new URL('./assets/cat-avatar.png', import.meta.url).href;
        mascot.alt = '小披萨馆猫猫'; mascot.width = mascot.height = 1254; mascot.decoding = 'async';
        emblem.replaceChildren(mascot);
        const dismiss = button('×', () => closeQuickStart(true), 'cs-home-dismiss');
        dismiss.setAttribute('aria-label', '关闭猫猫主界面'); dismiss.title = '关闭猫猫主界面';
        current.dialog.querySelector('.cs-header').append(dismiss);
        const menu = element('div', null, 'cs-home-menu');
        const tile = (title, note, handler, cls, asset) => {
            const control = button('', handler, 'cs-home-tile ' + cls);
            if (asset) {
                const art = element('span', null, 'cs-home-art');
                const image = element('img'); image.src = new URL('./assets/' + asset, import.meta.url).href;
                image.alt = ''; image.width = image.height = 1254; image.decoding = 'async'; image.draggable = false;
                image.addEventListener('error', () => { art.hidden = true; control.classList.add('cs-home-no-art'); }, { once: true });
                art.append(image); control.append(art);
            } else control.classList.add('cs-home-no-art');
            const caption = element('span', null, 'cs-home-caption');
            caption.append(element('strong', title), element('span', note)); control.append(caption); return control;
        };
        menu.append(
            tile('开始游玩', '挑选角色，开启你的故事喵', () => { closeQuickStart(); openCharacterPicker(); }, 'cs-home-play', 'play.png'),
            tile('随机角色', '让缘分替你选一次 🎲', () => { closeQuickStart(); openRandomCharacter(); }, 'cs-home-random', 'random.png'),
            tile('使用教程', '第一次来？从这里开始', () => { closeQuickStart(); openTutorial(); }, 'cs-home-guide', 'tutorial.png'),
            tile('项目相关', '', () => {}, 'cs-home-project'),
        );
        const footer = element('footer', null, 'cs-home-footer');
        footer.append(button('回到经典版', () => closeQuickStart(true), 'cs-secondary'));
        current.body.append(menu, footer);
        current.dialog.addEventListener('cancel', event => { event.preventDefault(); closeQuickStart(true); });
    }
    function openTutorial() {
        const current = navigationDialog('使用教程', 'cs-tutorial-dialog');
        current.dialog.querySelector('.cs-subtitle').textContent = '一点小指引，轻松开始喵';
        current.body.append(element('p', '是否转到教程界面？', 'cs-tutorial-question'));
        const controls = element('div', null, 'cs-actions');
        const yes = element('a', '是', 'cs-button cs-primary');
        yes.href = 'https://docs.qq.com/doc/DZkRCRXh3a2VTdGhF'; yes.target = '_blank'; yes.rel = 'noopener noreferrer';
        // Let the anchor open its tab before removing the confirmation dialog.
        yes.addEventListener('click', () => setTimeout(returnHome, 0));
        controls.append(button('否', returnHome, 'cs-quiet'), yes); current.body.append(controls);
        current.dialog.addEventListener('cancel', event => { event.preventDefault(); returnHome(); });
    }
    function openRandomCharacter() {
        const current = navigationDialog('随机角色', 'cs-random-dialog');
        current.dialog.querySelector('.cs-subtitle').textContent = '看看今天会遇见谁喵~';
        const preview = element('section', null, 'cs-random-preview'); preview.setAttribute('aria-live', 'polite');
        const image = element('img'); image.alt = '';
        image.addEventListener('error', () => { if (!image.src.endsWith('/img/ai4.png')) image.src = '/img/ai4.png'; });
        const copy = element('div', null, 'cs-random-copy'), name = element('h4'), description = element('p', '', 'cs-random-description');
        copy.append(name, description); preview.append(image, copy);
        let chosen, drawing = false;
        const choose = button('就是这个', async () => {
            if (!chosen || drawing || selecting) return;
            const id = characters.findIndex(card => card.avatar === chosen.avatar);
            if (id < 0) { current.error.textContent = '这张角色卡已不存在，请再抽一次喵。'; return; }
            selecting = true; controls.inert = true;
            const oldId = this_chid, oldChat = getCurrentChatId();
            try {
                const result = await selectCharacterById(id, { selectorMode: 'new' });
                if (result !== false && String(this_chid) === String(id) && (String(oldId) !== String(id) || getCurrentChatId() !== oldChat)) closeQuickStart();
            } catch (error) { current.error.textContent = error.message; }
            finally { selecting = false; controls.inert = false; }
        }, 'cs-primary');
        async function draw() {
            if (drawing || selecting) return;
            chosen = randomCharacter(characters, chosen?.avatar);
            if (!chosen) { image.hidden = true; name.textContent = '还没有角色卡喵'; description.textContent = '回到主界面，点击开始游玩即可新建角色卡。'; choose.disabled = true; return; }
            drawing = true; controls.inert = true; choose.disabled = true; current.error.textContent = '';
            const avatar = chosen.avatar;
            image.hidden = false; image.src = getThumbnailUrl('avatar', avatar); image.alt = chosen.name;
            name.textContent = chosen.name; description.textContent = '正在读取角色卡描述…';
            try {
                const id = characters.findIndex(card => card.avatar === avatar);
                if (id >= 0) await unshallowCharacter(id);
                if (quick !== current) return;
                chosen = characters.find(card => card.avatar === avatar);
                description.textContent = chosen?.description || chosen?.data?.description || '这张角色卡暂时没有描述喵。';
            } catch (error) { description.textContent = '角色卡描述暂时无法读取，请再抽一次喵。'; current.error.textContent = error.message; }
            finally { drawing = false; controls.inert = false; choose.disabled = !chosen; }
        }
        const controls = element('div', null, 'cs-actions cs-random-actions');
        controls.append(button('回到主界面', returnHome, 'cs-quiet'), button('再抽一次', draw, 'cs-secondary'), choose);
        current.body.append(preview, controls);
        current.dialog.addEventListener('cancel', event => { event.preventDefault(); returnHome(); });
        void draw();
    }
    function openCharacterPicker() {
        if (!ready || !config().enabled || quick) return;
        requested = false; page = 1; collectionCache = null;
        const current = navigationDialog('🍕小披萨馆の快速点餐模式', 'qs-dialog');
        current.dialog.querySelector('.cs-subtitle').textContent = '找到喜欢的角色卡，快速开启故事喵~';
        const tools = element('div', null, 'qs-tools');
        const search = input('搜索角色名、描述，或选择标签'); search.setAttribute('aria-label', '快速搜索角色卡');
        search.value = entitiesFilter.getFilterData(FILTER_TYPES.SEARCH) || '';
        search.addEventListener('input', () => {
            const native = document.getElementById('character_search_bar'); if (native) native.value = search.value;
            entitiesFilter.setFilterData(FILTER_TYPES.SEARCH, search.value); page = 1; render();
        });
        const sort = element('select'); sort.setAttribute('aria-label', '角色卡排序');
        sort.addEventListener('change', () => {
            const native = document.getElementById('character_sort_order');
            if (native) $(native).val(sort.value).trigger('change'); page = 1; render();
        });
        const views = element('div', null, 'qs-views'); views.setAttribute('aria-label', '角色卡视图');
        for (const [value, label] of [['list', '条目'], ['grid', '图片']]) {
            const control = button(label, () => { config().quickView = value; saveSettingsDebounced(); render({ reuseCollection: true }); }, 'cs-quiet');
            control.dataset.view = value; views.append(control);
        }
        tools.append(search, sort, views, button('新建角色卡', () => { closeQuickStart(); $('#rm_button_create').trigger('click'); }, 'cs-secondary'));
        const tagList = element('div', null, 'qs-tag-list'), list = element('div', null, 'qs-grid');
        const footer = element('footer', null, 'qs-footer'), status = element('span', '', 'cs-hint');
        const previous = button('上一页', () => { page--; render({ reuseCollection: true }); }, 'cs-quiet');
        const next = button('下一页', () => { page++; render({ reuseCollection: true }); }, 'cs-quiet');
        const paging = element('div', null, 'cs-actions'); paging.append(previous, status, next);
        footer.append(paging, button('回到主界面', returnHome, 'cs-secondary'));
        Object.assign(current, { list, tagList, sort, views, status, previous, next });
        current.dialog.querySelector('.cs-header').append(tools);
        current.body.append(tagList, list, footer);
        const resize = new ResizeObserver(() => render({ reuseCollection: true }));
        resize.observe(list);
        const originalClose = current.close;
        current.close = () => { resize.disconnect(); originalClose(); };
        current.dialog.addEventListener('cancel', event => { event.preventDefault(); returnHome(); });
        render();
        statsFailed = false;
        void fetch('/api/plugins/refuge/character-stats', { method: 'POST', headers: getRequestHeaders(), body: '{}' }).then(async response => {
            if (!response.ok) throw new Error('读取聊天信息失败');
            characterStats = await response.json();
        }).catch(() => { statsFailed = true; }).finally(() => render({ reuseCollection: true }));
    }
    window.refugeOpenQuickStart = openQuickStart;
    eventSource.on(event_types.APP_READY, () => { ready = true; launchButton.hidden = !config().enabled; openQuickStart({ automatic: true }); });
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, render);
    eventSource.on(event_types.CHARACTER_EDITED, render);
    eventSource.on(event_types.CHARACTER_DELETED, render);
    eventSource.on(event_types.CHAT_CHANGED, () => { if (getCurrentChatId() === undefined) openQuickStart({ automatic: true }); });
    window.addEventListener('pageshow', e => { if (e.persisted) openQuickStart({ automatic: true }); });
    window.addEventListener('popstate', () => openQuickStart({ automatic: true }));
    window.addEventListener('hashchange', () => openQuickStart({ automatic: true }));
    window.addEventListener('refuge:dialog-closed', () => { if (requested && !quick && !otherDialogOpen()) openQuickStart(); });
    return { open: openQuickStart, close: closeQuickStart, update: () => { launchButton.hidden = !config().enabled || Boolean(quick); if (!config().enabled) closeQuickStart(); } };
}
