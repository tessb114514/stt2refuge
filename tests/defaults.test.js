import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ensureAdministrator } from '../server/defaults.mjs';

test('fresh instances receive the requested public bootstrap password as a hash', () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'refuge-bootstrap-'));
    const file=path.join(dir,'admin.json');const prior=process.env.REFUGE_ADMIN_PASSWORD;delete process.env.REFUGE_ADMIN_PASSWORD;
    try {
        ensureAdministrator(file);const admin=JSON.parse(fs.readFileSync(file,'utf8'));
        assert.equal(crypto.scryptSync('hsmygcs114514',admin.salt,32).toString('hex'),admin.hash);
        assert.equal(fs.readFileSync(file,'utf8').includes('hsmygcs114514'),false);
        const bytes=fs.readFileSync(file);process.env.REFUGE_ADMIN_PASSWORD='a-different-test-admin';ensureAdministrator(file);assert.deepEqual(fs.readFileSync(file),bytes);
    } finally { if(prior===undefined)delete process.env.REFUGE_ADMIN_PASSWORD;else process.env.REFUGE_ADMIN_PASSWORD=prior; }
});
test('optional private deployment password initializes only a new instance', () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'refuge-bootstrap-env-')),file=path.join(dir,'admin.json');const prior=process.env.REFUGE_ADMIN_PASSWORD;
    try {
        process.env.REFUGE_ADMIN_PASSWORD='deployment-test-admin';ensureAdministrator(file);
        const admin=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(crypto.scryptSync(process.env.REFUGE_ADMIN_PASSWORD,admin.salt,32).toString('hex'),admin.hash);
    } finally { if(prior===undefined)delete process.env.REFUGE_ADMIN_PASSWORD;else process.env.REFUGE_ADMIN_PASSWORD=prior; }
});
