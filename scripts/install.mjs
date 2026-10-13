import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
export function targetPath(root, relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('..')) throw new Error('Unsafe relative path.');
    const target = path.resolve(root, relative);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Target escapes the installation root.');
    // Refuse symlink ancestors: containment must hold on disk, not just in a string.
    for (let current = path.dirname(target); current !== path.resolve(root); current = path.dirname(current)) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Refusing a symlink installation path.');
    }
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Refusing a symlink target.');
    return target;
}
export function applyHunks(source, hunks, file) {
    let output = normalize(source);
    for (const [index, hunk] of hunks.entries()) {
        if (!hunk.before || !hunk.after) throw new Error('Invalid compatibility hunk.');
        const before = output.split(hunk.before).length - 1;
        const after = output.split(hunk.after).length - 1;
        if (after === 1 && (before === 0 || before === 1 && hunk.after.includes(hunk.before))) continue;
        if (after > 0) throw new Error(`Ambiguous compatibility context: ${file}, change ${index + 1}.`);
        if (before !== 1) throw new Error(`Compatibility conflict: ${file}, change ${index + 1}. No files have been changed.`);
        output = output.replace(hunk.before, hunk.after);
    }
    return source.includes('\r\n') ? output.replace(/\n/g, '\r\n') : output;
}
function add(plan, root, relative, content) {
    const target = targetPath(root, relative);
    const prior = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const next = content === null ? null : Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (prior === null && next === null || prior && next && prior.equals(next)) return;
    plan.push({ relative, prior, next });
}
function listAssets(repo) {
    return fs.readdirSync(path.join(repo, 'assets')).filter(file => /^[\w-]+\.png$/.test(file)).map(file => 'assets/' + file);
}
export function planInstall(root, { repo = packageRoot, withFrontend = false, migrateLegacy = false } = {}) {
    const pkg = JSON.parse(fs.readFileSync(targetPath(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'sillytavern' || pkg.version !== '1.19.0') throw new Error('This release supports SillyTavern 1.19.0 only.');
    const plan = [];
    const patches = JSON.parse(fs.readFileSync(path.join(repo, 'patches/sillytavern-1.19.0.json'), 'utf8'));
    for (const file of patches.files) {
        const current = fs.readFileSync(targetPath(root, file.file), 'utf8');
        add(plan, root, file.file, applyHunks(current, file.hunks, file.file));
    }
    const shim = "// Refuge managed bridge. Server implementation lives in the plugin directory.\nexport * from '../plugins/ST-refuge/server/access.mjs';\n";
    const bridge = targetPath(root, 'src/chat-selector.js');
    if (fs.existsSync(bridge) && normalize(fs.readFileSync(bridge, 'utf8')) !== shim) {
        const known = JSON.parse(fs.readFileSync(path.join(repo, 'patches/legacy-backend.json'), 'utf8')).sha256;
        if (!migrateLegacy || !known.includes(sha(fs.readFileSync(bridge)))) throw new Error('An existing chat-selector backend requires an explicit supported --migrate-legacy installation.');
    }
    add(plan, root, 'src/chat-selector.js', shim);
    for (const relative of ['server/index.mjs', 'server/access.mjs', 'server/defaults.mjs']) {
        add(plan, root, 'plugins/ST-refuge/' + relative, fs.readFileSync(path.join(repo, relative)));
    }
    add(plan, root, 'plugins/ST-refuge/package.json', JSON.stringify({ name: 'st-refuge-server', version: '0.5.4', type: 'module', main: 'server/index.mjs' }, null, 2) + '\n');
    const configFile = targetPath(root, 'config.yaml');
    const config = fs.readFileSync(configFile, 'utf8');
    const updated = /^enableServerPlugins\s*:/m.test(config)
        ? config.replace(/^enableServerPlugins\s*:[^\r\n]*/m, 'enableServerPlugins: true')
        : config + (config.endsWith('\n') ? '' : '\n') + 'enableServerPlugins: true\n';
    add(plan, root, 'config.yaml', updated);
    const legacyManifest = 'public/scripts/extensions/chat-selector/manifest.json';
    if (fs.existsSync(targetPath(root, legacyManifest))) {
        if (!migrateLegacy) throw new Error('A legacy bundled frontend is present. Use --migrate-legacy after checking the README.');
        add(plan, root, legacyManifest, null); // The complete original is retained in the installation backup.
    }
    if (withFrontend) {
        for (const file of ['manifest.json', 'index.js', 'quick-start.js', 'quick-model.js', 'connection-guard.js', 'ui-sound.js', 'style.css', ...listAssets(repo)]) {
            add(plan, root, 'public/scripts/extensions/third-party/ST-refuge/' + file, fs.readFileSync(path.join(repo, file)));
        }
    }
    return plan;
}
function atomicWrite(target, bytes) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = target + '.refuge-write-' + crypto.randomBytes(5).toString('hex');
    try { fs.writeFileSync(temp, bytes); fs.renameSync(temp, target); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function install(root, options = {}) {
    root = fs.realpathSync(root);
    const plan = planInstall(root, options);
    if (options.check || !plan.length) return { changed: plan.map(item => item.relative), check: true };
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    const backup = 'chat-selector-backups/ST-refuge-' + id;
    const records = plan.map(item => ({ file: item.relative, existed: item.prior !== null, priorHash: item.prior ? sha(item.prior) : null, installedHash: item.next ? sha(item.next) : null }));
    for (const item of plan) if (item.prior) atomicWrite(targetPath(root, backup + '/files/' + item.relative), item.prior);
    const record = { version: '0.5.4', backup, files: records };
    atomicWrite(targetPath(root, backup + '/record.json'), Buffer.from(JSON.stringify(record, null, 2)));
    const written = [];
    try {
        for (const item of plan) {
            const target = targetPath(root, item.relative);
            const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
            if ((current === null) !== (item.prior === null) || current && !current.equals(item.prior)) throw new Error('File changed during installation: ' + item.relative);
            if (item.next) atomicWrite(target, item.next); else fs.unlinkSync(target);
            written.push(item);
        }
    } catch (error) {
        for (const item of written.reverse()) {
            const target = targetPath(root, item.relative);
            if (item.prior) atomicWrite(target, item.prior); else if (fs.existsSync(target)) fs.unlinkSync(target);
        }
        throw error;
    }
    return record;
}
export function uninstall(root, recordRelative) {
    root = fs.realpathSync(root);
    const record = JSON.parse(fs.readFileSync(targetPath(root, recordRelative), 'utf8'));
    if (record.version !== '0.5.4' || !Array.isArray(record.files)) throw new Error('Unsupported installation record.');
    for (const item of record.files) {
        const target = targetPath(root, item.file);
        const currentHash = fs.existsSync(target) ? sha(fs.readFileSync(target)) : null;
        if (currentHash !== item.installedHash) throw new Error('Refusing to overwrite a post-install change: ' + item.file);
        if (item.existed && sha(fs.readFileSync(targetPath(root, record.backup + '/files/' + item.file))) !== item.priorHash) throw new Error('Backup integrity failure: ' + item.file);
    }
    for (const item of [...record.files].reverse()) {
        const target = targetPath(root, item.file);
        if (item.existed) atomicWrite(target, fs.readFileSync(targetPath(root, record.backup + '/files/' + item.file)));
        else if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    return { restored: record.files.length };
}
function main() {
    const args = process.argv.slice(2);
    const value = option => args[args.indexOf(option) + 1];
    if (!args.includes('--sillytavern')) throw new Error('Usage: node scripts/install.mjs --sillytavern <path> [--check] [--with-frontend] [--migrate-legacy]');
    const root = path.resolve(value('--sillytavern'));
    const result = args.includes('--uninstall') ? uninstall(root, value('--uninstall')) : install(root, { check: args.includes('--check'), withFrontend: args.includes('--with-frontend'), migrateLegacy: args.includes('--migrate-legacy') });
    console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (error) { console.error('[Refuge] ' + error.message); process.exitCode = 1; }
}
