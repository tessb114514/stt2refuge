import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import { pathToFileURL } from 'node:url';
if (!process.env.SILLYTAVERN_ROOT) { test('compatibility tests require SILLYTAVERN_ROOT', {skip:true},()=>{}); } else {
const bundle = new URL('../', import.meta.url);
const project = process.env.SILLYTAVERN_ROOT;
const require = createRequire(process.env.REFUGE_TEST_DEPENDENCIES || import.meta.url);
const {parse} = require('acorn');
const source = fs.readFileSync(pathToFileURL(project+'/public/script.js'),'utf8');
const welcome = fs.readFileSync(pathToFileURL(project+'/public/scripts/welcome-screen.js'),'utf8');
function functionCode(text,name) {
    const program=parse(text,{ecmaVersion:'latest',sourceType:'module'});
    for(const node of program.body) {
        const fn=node.type==='ExportNamedDeclaration'?node.declaration:node;
        if(fn?.type==='FunctionDeclaration' && fn.id.name===name) return text.slice(fn.start,fn.end);
    }
    throw new Error('Missing function '+name);
}
function fixture({home=false}={}) {
    const trace=[];
    let resolve;
    const choicePromise=new Promise(r=>resolve=r);
    const context={
        characters:[{name:'原角色',avatar:'old.png',chat:'原聊天'},{name:'目标角色',avatar:'new.png',chat:'目标旧聊天'}],
        this_chid:home?undefined:'0',selected_group:null,selected_button:'characters',name2:home?'Assistant':'原角色',
        menu_type:'character_edit',chat:[{mes:home?'主页欢迎面板':'原聊天正文'}],chat_metadata:{original:true},this_edit_mes_id:undefined,
        isChatSaving:false,is_send_press:false,is_group_generating:false,debounce_timeout:{extended:1,short:1},
        window:{chatSelectorToken:'original-token',sillyTavernChatSelectorEnabled:()=>true,sillyTavernChatSelector:async(character,mode)=>{trace.push(['choose',character.avatar,mode]);return choicePromise;}},
        toastr:{info:()=>{},error:()=>{}},console,
        setCharacterId:id=>{trace.push(['setId',id]);context.this_chid=id;},
        setCharacterName:value=>{context.name2=value;},resetSelectedGroup:()=>{trace.push(['resetGroup']);context.selected_group=null;},
        clearChat:async()=>{trace.push(['clear']);context.chat.splice(0);context.chat_metadata={};},
        cancelTtsPlay:()=>trace.push(['cancelTts']),waitUntilCondition:async()=>trace.push(['wait']),
        saveChatConditional:async()=>trace.push(['save']),createOrEditCharacter:async()=>trace.push(['editCard']),
        CustomEvent:class{constructor(type){this.type=type;}},
        updateRemoteChatName:async(id,name)=>{trace.push(['setName',id,name]);context.characters[id].chat=name;},
        unshallowCharacter:async()=>{},getCurrentChatId:()=>context.characters[context.this_chid]?.chat,
        getRequestHeaders:()=>({'X-Chat-Selector-Token':context.window.chatSelectorToken}),
        fetch:async(url,options)=>{trace.push(['fetch',url,JSON.parse(options.body).file_name,options.headers['X-Chat-Selector-Token']]);return{ok:true,json:async()=>[{chat_metadata:{integrity:'test'}},{mes:'目标聊天正文'}]};},
        ensureMessageMediaIsArray:()=>{},uuidv4:()=> 'id',getChatResult:async()=>trace.push(['render']),
        eventSource:{emit:async(...args)=>trace.push(['event',...args])},event_types:{CHAT_LOADED:'loaded'},delay:()=>({then:()=>{}}),
        $:()=>({val:value=>trace.push(['pole',value])}),
        preserveNeutralChat:()=>trace.push(['preserve']),refreshSwipeButtons:()=>trace.push(['swipes']),
        select_selected_character:()=>trace.push(['characterMenu']),
        setActiveCharacter:value=>trace.push(['active',value]),saveSettingsDebounced:()=>trace.push(['settings']),
    };
    vm.createContext(context);
    for(const name of ['requestCharacterChatSelection','getChat','selectCharacterById','openCharacterChat','doNewChat','reloadCurrentChatUnsafe']) vm.runInContext(functionCode(source,name),context);
    vm.runInContext(functionCode(welcome,'openRecentCharacterChat'),context);
    const snapshot=()=>JSON.stringify({characters:context.characters,id:context.this_chid,group:context.selected_group,name:context.name2,menu:context.selected_button,chat:context.chat,metadata:context.chat_metadata,token:context.window.chatSelectorToken});
    return{context,trace,resolve,snapshot};
}
for(const [label,invoke] of [
    ['角色卡切换',c=>c.selectCharacterById(1)],
    ['已有聊天',c=>c.openCharacterChat('其他记录')],
    ['新建聊天',c=>c.doNewChat()],
    ['重新加载',c=>c.reloadCurrentChatUnsafe()],
    ['加载入口',c=>c.getChat()],
    ['主页最近聊天',c=>c.openRecentCharacterChat('new.png','指定记录')],
    ['随机角色新建（其他角色）',c=>c.selectCharacterById(1,{selectorMode:'new'})],
    ['随机角色新建（当前角色）',c=>c.selectCharacterById(0,{selectorMode:'new'})],
]) test(label+'：弹窗等待和取消都保持原页面、正文、指针与凭据',async()=>{
    const f=fixture({home:label==='主页最近聊天'}),before=f.snapshot();
    const operation=invoke(f.context);
    assert.equal(f.snapshot(),before);
    assert.deepEqual(f.trace.map(x=>x[0]),['choose']);
    f.resolve(undefined);await operation;
    assert.equal(f.snapshot(),before);
    assert.deepEqual(f.trace.map(x=>x[0]),['choose']);
});
for(const id of [0,1]) test('random acceptance opens new-chat selection once and loads only after confirmation: '+id,async()=>{
 const f=fixture(),before=f.snapshot();
 const operation=f.context.selectCharacterById(id,{selectorMode:'new'});
 assert.equal(f.snapshot(),before);assert.equal(f.trace[0][2],'new');
 f.resolve({name:'随机新聊天',token:'random-token'});await operation;
 assert.equal(String(f.context.this_chid),String(id));assert.equal(f.context.characters[id].chat,'随机新聊天');
 assert.equal(f.trace.filter(x=>x[0]==='choose').length,1);
 assert.ok(f.trace.find(x=>x[0]==='fetch' && x[2]==='随机新聊天' && x[3]==='random-token'));
});
test('明确选中后才切换角色、清空旧视图、读取指定记录；只弹一次',async()=>{
    const f=fixture(),before=f.snapshot();
    const operation=f.context.selectCharacterById(1);
    assert.equal(f.snapshot(),before);
    f.resolve({name:'选中的记录',token:'selected-token'});await operation;
    assert.equal(f.context.this_chid,1);assert.equal(f.context.characters[1].chat,'选中的记录');
    assert.equal(f.context.chat[0].mes,'目标聊天正文');
    assert.equal(f.trace.filter(x=>x[0]==='choose').length,1);
    assert.ok(f.trace.find(x=>x[0]==='fetch' && x[2]==='选中的记录' && x[3]==='selected-token'));
});
test('最近聊天仅选择一次，遵循弹窗选择，不再次强制打开原点击文件',async()=>{
    const f=fixture({home:true});const operation=f.context.openRecentCharacterChat('new.png','原点击的文件');
    f.resolve({name:'弹窗选中的文件',token:'selected-token'});await operation;
    assert.equal(f.context.characters[1].chat,'弹窗选中的文件');
    assert.equal(f.trace.filter(x=>x[0]==='choose').length,1);assert.equal(f.trace.filter(x=>x[0]==='fetch').length,1);
});

}
