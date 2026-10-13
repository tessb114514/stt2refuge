import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { registerSelector, connectionAuthorized, guardConnectionSettings, guardConnectionSecrets } from '../server/access.mjs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'refuge-connection-'));
const adminSalt='test-salt';fs.writeFileSync(path.join(root,'chat-selector-admin.json'),JSON.stringify({salt:adminSalt,hash:crypto.scryptSync('testingAdmin4321',adminSalt,32).toString('hex')}));
const routes=new Map();registerSelector({post:(name,handler)=>routes.set(name,handler)});
function req(account,body={},token=''){
 const home=path.join(root,account);fs.mkdirSync(home,{recursive:true});
 return {body,ip:account,user:{directories:{root:home}},get:name=>name==='X-Refuge-Connection-Token'?token:''};
}
function response(){let status=200,body;const res={status:n=>{status=n;return res;},json:value=>{body=value;return res;}};return{res,result:()=>({status,body})};}
function call(route,request){const out=response();routes.get(route)(request,out.res);return out.result();}
let token;
test('connection viewing requires actual administrator verification, and tokens stay account-scoped',()=>{
 req('alice');
 fs.writeFileSync(path.join(root,'alice','settings.json'),JSON.stringify({oai_settings:{custom_url:'https://example.test/v1'},unrelated:42}));
 assert.equal(call('/connection-details',req('alice')).status,403);
 assert.equal(call('/connection-unlock',req('alice',{adminPassword:'wrong'})).status,403);
 const grant=call('/connection-unlock',req('alice',{adminPassword:'testingAdmin4321'}));
 assert.equal(grant.status,200);token=grant.body.token;
 assert.equal(call('/connection-details',req('alice',{},token)).body.url,'https://example.test/v1');
 assert.equal(connectionAuthorized(req('bob',{},token)),false);
});
test('ordinary settings saves pass; custom URL changes and snapshot restores require the grant',()=>{
 const run=(request)=>{const out=response();let next=false;guardConnectionSettings(request,out.res,()=>next=true);return{next,...out.result()};};
 const same=req('alice',{oai_settings:{custom_url:'https://example.test/v1'},unrelated:77});same.path='/save';assert.equal(run(same).next,true);
 const changed=req('alice',{oai_settings:{custom_url:'https://new.test/v1'}});changed.path='/save';assert.equal(run(changed).status,403);
 const permitted=req('alice',changed.body,token);permitted.path='/save';assert.equal(run(permitted).next,true);
 const restore=req('alice');restore.path='/restore-snapshot';assert.equal(run(restore).status,403);
});
test('custom key find/write/delete/rotate/rename are guarded, other provider keys remain unchanged',()=>{
 for(const route of ['/find','/write','/delete','/rotate','/rename']){
  const denied=req('alice',{key:'api_key_custom'});denied.path=route;const out=response();guardConnectionSecrets(denied,out.res,()=>assert.fail());assert.equal(out.result().status,403);
  for(const [key,grant] of [['api_key_openai',''],['api_key_custom',token]]){let next=false;const accepted=req('alice',{key},grant);accepted.path=route;guardConnectionSecrets(accepted,response().res,()=>next=true);assert.equal(next,true);}
 }
});
test('validated URL changes preserve unrelated settings and reject unsafe protocols',()=>{
 assert.equal(call('/connection-save',req('alice',{url:'https://new.test/v1'})).status,403);
 assert.equal(call('/connection-save',req('alice',{url:'javascript:alert(1)'},token)).status,400);
 assert.equal(call('/connection-save',req('alice',{url:'https://new.test/v1'},token)).status,200);
 const saved=JSON.parse(fs.readFileSync(path.join(root,'alice/settings.json'),'utf8'));assert.equal(saved.unrelated,42);assert.equal(saved.oai_settings.custom_url,'https://new.test/v1');
});
test('connection tokens expire and are revoked on closing without touching chat tokens',()=>{
 const original=Date.now;try{Date.now=()=>original()+6*60*1000;assert.equal(connectionAuthorized(req('alice',{},token)),false);}finally{Date.now=original;}
 assert.equal(call('/connection-lock',req('alice',{},token)).status,200);assert.equal(connectionAuthorized(req('alice',{},token)),false);
});
function nativeRoute(name, exposure = false) {
 const project=process.env.SILLYTAVERN_ROOT;
 const {parse}=createRequire(process.env.REFUGE_TEST_DEPENDENCIES || import.meta.url)('acorn');
 const source=fs.readFileSync(pathToFileURL(project+'/src/endpoints/secrets.js'),'utf8');
 const program=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const node=program.body.find(node=>node.expression?.callee?.object?.name==='router' && node.expression.arguments[0]?.value===name);
 const handler=node.expression.arguments[1];
 const context={allowKeysExposure:exposure,EXPORTABLE_KEYS:[],SECRET_KEYS:{CUSTOM:'api_key_custom'},connectionAuthorized,console:{error:()=>{}},getAllSecrets:()=>({api_key_custom:['demo-key'],api_key_openai:['other']}),SecretManager:class{getSecretState(){return{api_key_custom:true};}readSecret(){return'demo-key';}}};
 vm.createContext(context);return vm.runInContext('('+source.slice(handler.start,handler.end)+')',context);
}
test('native secret find permits only the admin-verified custom key without changing global exposure policy',{skip:!process.env.SILLYTAVERN_ROOT},()=>{
 token=call('/connection-unlock',req('alice',{adminPassword:'testingAdmin4321'})).body.token;
 const handler=nativeRoute('/find');
 const invoke=request=>{let status=200,value;const res={status:code=>{status=code;return res;},sendStatus:code=>status=code,send:body=>value=body};handler(request,res);return{status,value};};
 assert.equal(invoke(req('alice',{key:'api_key_custom'})).status,403);
 assert.equal(invoke(req('alice',{key:'api_key_custom'},token)).value.value,'demo-key');
 assert.equal(invoke(req('alice',{key:'api_key_openai'},token)).status,403);
});
test('native bulk secret view excludes custom keys until administrator verification',{skip:!process.env.SILLYTAVERN_ROOT},()=>{
 const handler=nativeRoute('/view');
 // Native allowKeysExposure remains false; bulk views stay forbidden for everyone.
 let code;handler(req('alice',{},token),{sendStatus:status=>code=status});assert.equal(code,403);
 const exposed=nativeRoute('/view',true);let result;
 exposed(req('alice'),{send:body=>result=body});assert.equal(result.api_key_custom,undefined);assert.equal(result.api_key_openai[0],'other');
 exposed(req('alice',{},token),{send:body=>result=body});assert.equal(result.api_key_custom[0],'demo-key');
});
