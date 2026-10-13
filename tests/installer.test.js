import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyHunks, targetPath, install, uninstall } from '../scripts/install.mjs';

test('checked context changes apply once, preserve CRLF, and refuse conflicts',()=>{
    const h=[{before:'a\nb\n',after:'a\nprotected\nb\n'}];
    assert.equal(applyHunks('a\r\nb\r\n',h,'sample'),'a\r\nprotected\r\nb\r\n');
    assert.equal(applyHunks('a\nprotected\nb\n',h,'sample'),'a\nprotected\nb\n');
    assert.throws(()=>applyHunks('different\n',h,'sample'),/conflict/);
    assert.equal(applyHunks('added\na\nb\n',[{before:'a\nb\n',after:'added\na\nb\n'}],'sample'),'added\na\nb\n');
    assert.throws(()=>targetPath(os.tmpdir(),'../outside'),/Unsafe/);
});
function fixture(){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'refuge-installer-'));
    const repo=fs.mkdtempSync(path.join(os.tmpdir(),'refuge-repo-'));
    fs.mkdirSync(path.join(repo,'patches'));fs.mkdirSync(path.join(repo,'server'));
    fs.mkdirSync(path.join(root,'src'));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'sillytavern',version:'1.19.0'}));
    fs.writeFileSync(path.join(root,'config.yaml'),'enableServerPlugins: false\nother: untouched\n');
    fs.writeFileSync(path.join(root,'src/example.js'),'original\n');
    fs.writeFileSync(path.join(repo,'patches/sillytavern-1.19.0.json'),JSON.stringify({files:[{file:'src/example.js',hunks:[{before:'original\n',after:'integrated\n'}]}]}));
    fs.writeFileSync(path.join(repo,'patches/legacy-backend.json'),JSON.stringify({sha256:[]}));
    for(const file of ['index.mjs','access.mjs','defaults.mjs'])fs.writeFileSync(path.join(repo,'server',file),'// fixture\n');
    return{root,repo};
}
test('installation plans first, backs up changes, is idempotent, and restores only owned files',()=>{
    const{root,repo}=fixture();const config=fs.readFileSync(path.join(root,'config.yaml'));
    const check=install(root,{repo,check:true});assert.ok(check.changed.length);assert.equal(fs.readFileSync(path.join(root,'src/example.js'),'utf8'),'original\n');
    const record=install(root,{repo});assert.equal(fs.readFileSync(path.join(root,'src/example.js'),'utf8'),'integrated\n');
    assert.equal(install(root,{repo}).changed.length,0);
    fs.writeFileSync(path.join(root,'plugins/ST-refuge/user-owned.txt'),'preserve');
    uninstall(root,record.backup+'/record.json');
    assert.equal(fs.readFileSync(path.join(root,'src/example.js'),'utf8'),'original\n');assert.deepEqual(fs.readFileSync(path.join(root,'config.yaml')),config);
    assert.equal(fs.readFileSync(path.join(root,'plugins/ST-refuge/user-owned.txt'),'utf8'),'preserve');
});
test('post-install edits prevent rollback, and patch conflicts leave the project unchanged',()=>{
    const{root,repo}=fixture();const record=install(root,{repo});
    fs.writeFileSync(path.join(root,'src/example.js'),'user change\n');
    assert.throws(()=>uninstall(root,record.backup+'/record.json'),/post-install/);
    assert.equal(fs.readFileSync(path.join(root,'src/example.js'),'utf8'),'user change\n');
    const second=fixture();fs.writeFileSync(path.join(second.root,'src/example.js'),'unexpected\n');
    assert.throws(()=>install(second.root,{repo:second.repo}),/conflict/);assert.equal(fs.existsSync(path.join(second.root,'plugins')),false);
});
