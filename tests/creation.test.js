import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
import { pathToFileURL } from 'node:url';
if (!process.env.SILLYTAVERN_ROOT) { test('compatibility tests require SILLYTAVERN_ROOT', {skip:true},()=>{}); } else {
const project=process.env.SILLYTAVERN_ROOT;
const {parse}=createRequire(process.env.REFUGE_TEST_DEPENDENCIES || import.meta.url)('acorn');
const source=fs.readFileSync(pathToFileURL(project+'/public/script.js'),'utf8');
const node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='createOrEditCharacter').declaration;
const code=source.slice(node.start,node.end);
function fixture(){
 const trace=[];let resolve;const pending=new Promise(r=>resolve=r);const values={'#character_name_pole':'新角色'};
 const context={settingsReady:true,fav_ch_checked:false,is_group_generating:false,is_send_press:false,crop_data:undefined,this_chid:undefined,characters:[],create_save:{alternate_greetings:[],extensions:{},extra_books:[]},world_info:{charLore:[]},
 File:class{},CustomEvent:class{},FormData:class{constructor(){this.data={ch_name:'新角色'};}get(k){return this.data[k];}set(k,v){this.data[k]=v;}append(){}delete(){}},
 getRequestHeaders:()=>({}),talkativeness_default:.5,depth_prompt_depth_default:4,depth_prompt_role_default:'system',
 window:{refugeChoosePersonaForNewCharacter:async(name)=>{trace.push(['choose',name]);return pending;},refugeBindNewCharacterPersona:async(avatar,selection)=>trace.push(['bind',avatar,selection.avatar])},
 fetch:async(url)=>{trace.push(['fetch',url]);return{ok:true,text:async()=> 'new.png'};},
 createTagMapFromList:()=>{},getCharacters:async()=>{},select_rm_info:()=>{},saveSettingsDebounced:()=>{},
 toastr:{error:()=>{}},console:{log:()=>{},error:()=>{},warn:()=>{}},
 $:selector=>{const wrapper={html:()=>wrapper,get:()=>({}),attr:k=>k==='actiontype'?'createcharacter':undefined,val:v=>{if(v===undefined)return values[selector]??'';values[selector]=v;return wrapper;},text:()=>wrapper,trigger:()=>wrapper,replaceWith:()=>wrapper,clone:()=>wrapper};return wrapper;}
 };
 vm.createContext(context);vm.runInContext(code,context);return{context,trace,values,resolve};
}
test('character creation is restored: no Persona prompt or character binding hook',async()=>{
 const f=fixture();await f.context.createOrEditCharacter({});
 assert.deepEqual(f.trace,[['fetch','/api/characters/create']]);assert.equal(f.values['#character_name_pole'],'');
});

}
