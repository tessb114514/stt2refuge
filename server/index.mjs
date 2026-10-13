import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSelector, setCoreIntegration } from './access.mjs';

export const info = { id: 'refuge', name: 'Refuge Neko Pizza', description: 'Chat selection, chat-scoped Personas and administrator-protected connection settings.' };
export async function init(router) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const checks = [
        ['public/script.js', 'requestCharacterChatSelection'],
        ['public/scripts/welcome-screen.js', 'sillyTavernChatSelectorEnabled'],
        ['public/scripts/personas.js', 'personaChatKey'],
        ['public/index.html', 'refuge_custom_credentials'],
        ['src/endpoints/chats.js', 'router.use(guardChat)'],
        ['src/endpoints/characters.js', 'hasProtectedChats'],
        ['src/endpoints/secrets.js', 'router.use(guardConnectionSecrets)'],
        ['src/endpoints/settings.js', 'router.use(guardConnectionSettings)'],
        ['src/chat-selector.js', 'plugins/ST-refuge/server/access.mjs'],
    ];
    const integrated = checks.every(([relative, needle]) => fs.existsSync(path.join(root, relative)) && fs.readFileSync(path.join(root, relative), 'utf8').includes(needle));
    setCoreIntegration(integrated);
    if (!integrated) {
        router.post('/status', (_request, response) => response.json({ version: '0.5.4', coreIntegration: false }));
        console.warn('[Refuge] Run the documented host installer to enable the navigation and access-control integration.');
        return;
    }
    registerSelector(router);
}
