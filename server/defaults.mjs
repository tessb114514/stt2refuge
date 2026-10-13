import fs from 'node:fs';
import crypto from 'node:crypto';
const bootstrap = {'salt': '85b473c76db369ca34979c1873338a26', 'hash': '48bb9213ac66b602df533d88125534daaebfe881921398ffd4bd7f94e4b9690f'};
export function ensureAdministrator(file) {
    if (fs.existsSync(file)) return;
    const password = process.env.REFUGE_ADMIN_PASSWORD;
    if (password !== undefined && (password.length < 8 || password.length > 128)) throw new Error('REFUGE_ADMIN_PASSWORD must have 8 to 128 characters.');
    const salt = password ? crypto.randomBytes(16).toString('hex') : bootstrap.salt;
    const admin = password ? { salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') } : bootstrap;
    try { fs.writeFileSync(file, JSON.stringify(admin), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
}
