import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerSelector, guardChat, canReadChat, canReadPath, validateName } from '../server/access.mjs';
import crypto from 'node:crypto';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-selector-test-'));
const salt='fixture-salt';fs.writeFileSync(path.join(root,'chat-selector-admin.json'),JSON.stringify({salt,hash:crypto.scryptSync('administrator123',salt,32).toString('hex')}));
const routes = new Map();
registerSelector({ post: (name, handler) => routes.set(name, handler) });
function request(account, body = {}, token = '', admin = true) {
    const home = path.join(root, account);
    const characters = path.join(home, 'characters'), chats = path.join(home, 'chats');
    fs.mkdirSync(characters, { recursive: true }); fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(path.join(characters, '角色.png'), 'fixture');
    return { body, ip: account, user: { profile: { handle: account, admin }, directories: { root: home, chats, characters } }, get: () => token };
}
function call(route, req) {
    let code = 200, body;
    const res = { status: value => { code = value; return res; }, json: value => { body = value; return res; } };
    routes.get(route)(req, res);
    return { code, body };
}
const data = { avatar_url: '角色.png', name: '张三Chat1', password: 'pass1234' };
let token;
test('required name, allowed characters, Unicode and Windows reserved names', () => {
    for (const name of ['', 'ab', '中文', 'abc def', 'a_b', '../abc', 'CON', 'COM0', 'abc😀']) assert.throws(() => validateName(name));
    assert.equal(validateName('张三Chat1'), '张三Chat1');
});
test('existing administrator configuration is preserved', () => {
    assert.equal(call('/status', request('alice')).body.adminConfigured, true);
    assert.equal(routes.has('/admin'), true);
    assert.equal(call('/admin', request('alice', {current:'administrator123',password:'administrator123'})).code, 200);
});
test('create named JSONL, encrypt password, reject exact and case duplicate', () => {
    const result = call('/create', request('alice', data));
    assert.equal(result.code, 200); token = result.body.token;
    assert.ok(fs.existsSync(path.join(root, 'alice/chats/角色/张三Chat1.jsonl')));
    const vault = fs.readFileSync(path.join(root, 'alice/chat-selector/vault.json'), 'utf8');
    assert.ok(!vault.includes('pass1234')); assert.ok(!vault.includes('administrator123'));
    assert.equal(call('/create', request('alice', data)).code, 409);
    assert.equal(call('/create', request('alice', { ...data, name: '张三chat1' })).code, 409);
});
test('per-account list and token isolation', () => {
    const result = call('/list', request('alice', data));
    assert.equal(result.body[0].name, data.name); assert.equal(result.body[0].locked, true);
    assert.deepEqual(call('/list', request('bob', data)).body, []);
    assert.equal(canReadChat(request('alice', data), data.avatar_url, data.name), false);
    assert.equal(canReadChat(request('alice', data, token), data.avatar_url, data.name), true);
    call('/create', request('bob', data));
    assert.equal(canReadChat(request('bob', data, token), data.avatar_url, data.name), false);
});
test('unlock wrong/correct passwords and administrator recovery', () => {
    assert.equal(call('/unlock', request('alice', { ...data, password: 'wrong' })).code, 403);
    assert.equal(call('/unlock', request('alice', data)).code, 200);
    assert.equal(call('/recover', request('alice', { ...data, adminPassword: 'wrong' })).code, 403);
    assert.equal(call('/recover', request('alice', { ...data, adminPassword: 'administrator123' })).body.password, 'pass1234');
});
test('protected read/write/export/delete and rename guard', () => {
    for (const [route, field] of Object.entries({ '/get': 'file_name', '/save': 'file_name', '/export': 'file', '/delete': 'chatfile', '/rename': 'original_file' })) {
        const req = request('alice', { avatar_url: data.avatar_url, [field]: data.name + (field === 'file_name' ? '' : '.jsonl') }); req.path = route;
        let status, next = false;
        const res = { status: code => { status = code; return res; }, json: () => res };
        guardChat(req, res, () => { next = true; }); assert.equal(status, 403); assert.equal(next, false);
        req.get = () => token; status = undefined;
        guardChat(req, res, () => { next = true; });
        if (route === '/rename') assert.equal(status, 400); else assert.equal(next, true);
    }
    assert.equal(canReadPath(request('alice'), path.join(root, 'alice/chats/角色/张三Chat1.jsonl')), false);
});
test('group flags cannot bypass character get/save protection', () => {
    for (const route of ['/get', '/save']) {
        const req = request('alice', { avatar_url: data.avatar_url, file_name: data.name, is_group: true, group_id: 'fake' }); req.path = route;
        let status;
        const res = { status: code => { status = code; return res; }, json: () => res };
        guardChat(req, res, () => assert.fail('must not bypass password'));
        assert.equal(status, 403);
    }
});
test('plain chat, legacy filename, traversal rejection and cross-character tokens', () => {
    assert.equal(call('/create', request('alice', { avatar_url: data.avatar_url, name: '无密码聊天' })).code, 200);
    const dir = path.join(root, 'alice/chats/角色'); fs.writeFileSync(path.join(dir, 'Old Chat - 2024.jsonl'), '{}');
    assert.equal(call('/unlock', request('alice', { avatar_url: data.avatar_url, name: 'Old Chat - 2024' })).code, 200);
    assert.equal(call('/list', request('alice', { avatar_url: '../角色.png' })).code, 400);
    assert.equal(call('/unlock', request('alice', { avatar_url: data.avatar_url, name: '../vault' })).code, 400);
    const req = request('alice', data); fs.writeFileSync(path.join(req.user.directories.characters, '其他.png'), 'fixture');
    call('/create', request('alice', { ...data, avatar_url: '其他.png' }));
    assert.equal(canReadChat(request('alice', data, token), '其他.png', data.name), false);
});
test('password throttling blocks brute force', () => {
    for (let i = 0; i < 5; i++) assert.equal(call('/unlock', request('alice', { ...data, password: 'bad' })).code, 403);
    assert.equal(call('/unlock', request('alice', data)).code, 429);
});
test('delete requires confirmation; 20 messages need no administrator', () => {
    const body = { avatar_url: data.avatar_url, name: '二十条聊天' };
    const created = call('/create', request('alice', body)); assert.equal(created.code, 200);
    const file = path.join(root, 'alice/chats/角色/二十条聊天.jsonl');
    fs.appendFileSync(file, Array.from({length:20}, (_,i)=>JSON.stringify({mes:String(i),is_user:i%2===0})).join('\n'));
    const listed = call('/list', request('alice', body)).body.find(x=>x.name===body.name); assert.equal(listed.messages,20);
    assert.equal(call('/delete', request('alice', body)).code,400); assert.ok(fs.existsSync(file));
    assert.equal(call('/delete', request('alice', {...body,confirm:true})).code,200); assert.ok(!fs.existsSync(file));
});
test('21 messages require the default administrator password', () => {
    const body = {avatar_url:data.avatar_url,name:'二十一条聊天',confirm:true};
    assert.equal(call('/create',request('alice',body)).code,200);
    const file = path.join(root,'alice/chats/角色/二十一条聊天.jsonl');
    fs.appendFileSync(file,Array.from({length:21},()=>JSON.stringify({mes:'test',is_user:false})).join('\n'));
    const nativeReq = request('alice', {avatar_url:data.avatar_url,chatfile:'二十一条聊天.jsonl'}); nativeReq.path='/delete';
    let nativeCode; const nativeRes={status:code=>{nativeCode=code;return nativeRes;},json:()=>nativeRes};
    guardChat(nativeReq,nativeRes,()=>assert.fail('native endpoint must also require administrator'));
    assert.equal(nativeCode,403); assert.ok(fs.existsSync(file));
    assert.equal(call('/delete',request('alice',body)).code,428);
    assert.equal(call('/delete',request('alice',{...body,adminPassword:'wrong'})).code,403); assert.ok(fs.existsSync(file));
    assert.equal(call('/delete',request('alice',{...body,adminPassword:'administrator123'})).code,200); assert.ok(!fs.existsSync(file));
});
test('locked rename preserves password and invalidates old grants', () => {
    const body = {...data,newName:'张三改名1'};
    assert.equal(call('/rename',request('alice',body)).code,403);
    assert.equal(call('/rename',request('alice',{...body,newName:'无密码聊天'},token)).code,409);
    assert.equal(call('/rename',request('alice',{...body,newName:'../bad'},token)).code,400);
    const result=call('/rename',request('alice',body,token));assert.equal(result.code,200);
    assert.ok(!fs.existsSync(path.join(root,'alice/chats/角色/张三Chat1.jsonl')));
    assert.ok(fs.existsSync(path.join(root,'alice/chats/角色/张三改名1.jsonl')));
    assert.equal(canReadChat(request('alice',body,token),data.avatar_url,body.newName),false);
    assert.equal(canReadChat(request('alice',body,result.body.token),data.avatar_url,body.newName),true);
    assert.equal(call('/recover',request('alice',{avatar_url:data.avatar_url,name:body.newName,adminPassword:'administrator123'})).body.password,data.password);
    assert.equal(call('/delete',request('alice',{avatar_url:data.avatar_url,name:body.newName,confirm:true})).code,403);
    assert.equal(call('/delete',request('alice',{avatar_url:data.avatar_url,name:body.newName,confirm:true},result.body.token)).code,200);
});
test('cross-account grants cannot edit a protected chat', () => {
    assert.equal(call('/rename',request('bob',{...data,newName:'新的名字'},token)).code,403);
    assert.equal(call('/delete',request('bob',{...data,confirm:true},token)).code,403);
});
test('new chat Persona is written into native chat metadata, not character settings',()=>{
 const req=request('personaAccount',{avatar_url:data.avatar_url,name:'带人设聊天',personaAvatar:'user.png'});
 req.user.directories.avatars=path.join(req.user.directories.root,'User Avatars');fs.mkdirSync(req.user.directories.avatars,{recursive:true});fs.writeFileSync(path.join(req.user.directories.avatars,'user.png'),'fixture');
 const result=call('/create',req);assert.equal(result.code,200);
 const header=JSON.parse(fs.readFileSync(path.join(req.user.directories.chats,'角色','带人设聊天.jsonl'),'utf8').trim());
 assert.equal(header.chat_metadata.persona,'user.png');
 const missing={...req,body:{...req.body,name:'不存在人设',personaAvatar:'missing.png'}};assert.equal(call('/create',missing).code,400);
 assert.ok(!fs.existsSync(path.join(req.user.directories.chats,'角色','不存在人设.jsonl')));
 const traversal={...req,body:{...req.body,name:'非法人设测试',personaAvatar:'../user.png'}};assert.equal(call('/create',traversal).code,400);
});
test('character stats report real JSONL count and last modification, isolated per account',()=>{
 const req=request('statsAccount');const dir=path.join(req.user.directories.chats,'角色');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'one.jsonl'),'{}');fs.writeFileSync(path.join(dir,'two.jsonl'),'{}');fs.writeFileSync(path.join(dir,'ignore.txt'),'x');
 const stats=call('/character-stats',req);assert.equal(stats.code,200);assert.equal(stats.body['角色.png'].chats,2);assert.ok(stats.body['角色.png'].lastUsed>0);
 assert.equal(call('/character-stats',request('emptyStats')).body['角色.png'].chats,0);
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
