import { getRequestHeaders } from '/script.js';
import { oai_settings } from '/scripts/openai.js';
import { readSecretState } from '/scripts/secrets.js';

export function initConnectionGuard(ui) {
    const { surface, modal, element, input, button, api } = ui;
    const form = document.getElementById('custom_form');
    if (!form) return;
    if (!document.getElementById('refuge_custom_credentials')) {
        const wrapper = document.createElement('div'); wrapper.id = 'refuge_custom_credentials';
        wrapper.hidden = true; wrapper.style.setProperty('display', 'none', 'important');
        const model = document.getElementById('custom_model_id')?.parentElement?.previousElementSibling;
        if (model) {
            for (const node of [...form.childNodes]) { if (node === model) break; wrapper.append(node); }
            form.prepend(wrapper);
        }
    }
    const { host, root } = surface(form);
    form.insertBefore(host, document.getElementById('refuge_custom_credentials')?.nextSibling || form.firstChild);
    const box = element('div', null, 'cs-connection-gate');
    box.append(element('p', '自定义端点（基础 URL）和自定义 API 密钥已隐藏', 'cs-hint'), button('管理员验证 · 查看或更改', open, 'cs-secondary'));
    root.append(box);
    let active = false;
    async function nativeSecret(action, data) {
        const response = await fetch('/api/secrets/' + action, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(data) });
        if (action === 'find' && response.status === 404) return { value: '' };
        if (!response.ok) throw new Error('密钥操作失败，请重新验证管理员密码。');
        return response.status === 204 ? {} : await response.json();
    }
    async function open() {
        if (ui.available && !ui.available()) { toastr.error('请先完成Refuge主机端安装并重启酒馆。'); return; }
        if (active) return; active = true;
        const dialog = modal('管理员验证');
        const secret = input('管理员密码', 'password'); secret.setAttribute('aria-label', '管理员密码');
        dialog.body.append(element('p', '查看或更改自定义连接前，请输入管理员密码喵。', 'cs-hint'), secret);
        let busy = false;
        const close = () => { if (!busy) { secret.value = ''; dialog.close(); active = false; } };
        const confirm = button('验证', async () => {
            if (busy) return; busy = true; confirm.disabled = cancel.disabled = true; dialog.error.textContent = '';
            try {
                const grant = await api('connection-unlock', { adminPassword: secret.value }); secret.value = '';
                window.refugeConnectionToken = grant.token;
                const details = await api('connection-details');
                const key = await nativeSecret('find', { key: 'api_key_custom' });
                dialog.close(); edit(details.url, key.value || '', grant.expires);
            } catch (error) {
                dialog.error.textContent = error.message;
                void api('connection-lock').catch(() => {}); window.refugeConnectionToken = '';
            } finally { busy = false; confirm.disabled = cancel.disabled = false; }
        }, 'cs-primary');
        const cancel = button('取消', close, 'cs-quiet');
        const controls = element('div', null, 'cs-actions'); controls.append(cancel, confirm); dialog.body.append(controls);
        secret.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); confirm.click(); } });
        dialog.dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    }
    function edit(originalUrl, originalKey, expires) {
        const dialog = modal('自定义连接 · 管理员');
        const url = input('https://example.com/v1'); url.value = originalUrl; url.setAttribute('aria-label', '自定义端点（基础 URL）');
        const key = input('自定义 API 密钥', 'password'); key.value = originalKey; key.setAttribute('aria-label', '自定义 API 密钥');
        const label = (text, control) => { const row = element('label', null, 'cs-field'); row.append(element('span', text, 'cs-field-label'), control); return row; };
        const show = button('显示密钥', () => { key.type = key.type === 'password' ? 'text' : 'password'; show.textContent = key.type === 'text' ? '隐藏密钥' : '显示密钥'; }, 'cs-quiet');
        dialog.body.append(element('p', '本次验证最多有效5分钟；关闭后立即隐藏并撤销权限。', 'cs-hint'), label('自定义端点（基础 URL）', url), label('自定义 API 密钥', key), show);
        let busy = false;
        const close = () => {
            if (busy) return;
            clearTimeout(timer); url.value = key.value = ''; originalKey = '';
            void api('connection-lock').catch(() => {}); window.refugeConnectionToken = '';
            dialog.close(); active = false;
        };
        const save = button('保存并隐藏', async () => {
            if (busy) return; busy = true; save.disabled = cancel.disabled = true; dialog.error.textContent = '';
            try {
                const value = url.value.trim();
                if (value) { const parsed = new URL(value); if (!['http:','https:'].includes(parsed.protocol)) throw new Error('基础 URL 仅支持 http 或 https。'); }
                if (key.value !== originalKey) {
                    await nativeSecret(key.value ? 'write' : 'delete', { key: 'api_key_custom', value: key.value, label: 'Refuge 自定义连接' });
                    originalKey = key.value; await readSecretState();
                }
                const saved = await api('connection-save', { url: value });
                oai_settings.custom_url = saved.url;
                const native = document.getElementById('custom_api_url_text'); if (native) native.value = saved.url;
                toastr.success('自定义连接已保存喵'); busy = false; close();
            } catch (error) { dialog.error.textContent = error.message; }
            finally { busy = false; save.disabled = cancel.disabled = false; if (Date.now() >= expires) close(); }
        }, 'cs-primary');
        const cancel = button('关闭并隐藏', close, 'cs-quiet');
        const controls = element('div', null, 'cs-actions'); controls.append(cancel, save); dialog.body.append(controls);
        const timer = setTimeout(() => { if (!busy) close(); else dialog.error.textContent = '管理员验证已过期，请关闭后重新验证。'; }, Math.max(0, expires - Date.now()));
        dialog.dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    }
}
