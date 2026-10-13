import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
import { pathToFileURL } from 'node:url';
if (!process.env.SILLYTAVERN_ROOT) { test('compatibility tests require SILLYTAVERN_ROOT', {skip:true},()=>{}); } else {
const project=process.env.SILLYTAVERN_ROOT;
const {parse}=createRequire(process.env.REFUGE_TEST_DEPENDENCIES || import.meta.url)('acorn');
const source=fs.readFileSync(pathToFileURL(project+'/public/scripts/personas.js'),'utf8');
const node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='loadPersonaForCurrentChat');
test('same-named chats on different cards reload their own Persona; same chat still caches',async()=>{
 let reads=0;const context={getCurrentChatId:()=> '同名聊天',personaLastLoadedChatId:null,selected_group:null,this_chid:0,characters:[{avatar:'a.png'},{avatar:'b.png'}],getUserAvatars:async()=>{reads++;throw new Error('avatar probe');}};
 vm.createContext(context);vm.runInContext(source.slice(node.start,node.end),context);
 await assert.rejects(context.loadPersonaForCurrentChat(),/avatar probe/);context.this_chid=1;
 await assert.rejects(context.loadPersonaForCurrentChat(),/avatar probe/);assert.equal(reads,2);
 await context.loadPersonaForCurrentChat();assert.equal(reads,2);
});
test('missing current avatar cannot auto-lock over the selected chat Persona',async()=>{
 const selected=[];const context={getCurrentChatId:()=> '新聊天',personaLastLoadedChatId:null,selected_group:null,this_chid:0,characters:[{avatar:'a.png'}],getUserAvatars:async()=>['first.png','chosen.png'],user_avatar:'deleted.png',chat_metadata:{persona:'chosen.png'},power_user:{default_persona:null,persona_auto_lock:true,persona_show_notifications:false},console:{log:()=>{},warn:()=>{}},updatePersonaUIStates:()=>{},setUserAvatar:async avatar=>{selected.push(avatar);context.user_avatar=avatar;context.chat_metadata.persona=avatar;}};
 vm.createContext(context);vm.runInContext(source.slice(node.start,node.end),context);
 assert.equal(await context.loadPersonaForCurrentChat(),true);assert.deepEqual(selected,['chosen.png']);assert.equal(context.chat_metadata.persona,'chosen.png');
});

}
