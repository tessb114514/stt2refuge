import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../ui-sound.js',import.meta.url),'utf8').replace('export function','function');
test('button sound reuses native source, handles playback restrictions, and leaves message audio untouched',async()=>{
 let cloned=0,played=0,paused=0;
 const audio={src:'https://example.test/sounds/message.mp3',cloneNode:()=>{cloned++;return{src:audio.src,pause:()=>paused++,play:()=>{played++;return Promise.reject(new Error('blocked'));}};}};
 const context={document:{getElementById:()=>audio}};vm.createContext(context);vm.runInContext(source,context);
 context.playPluginClickSound();context.playPluginClickSound();await Promise.resolve();
 assert.equal(cloned,1);assert.equal(played,2);assert.equal(paused,2);assert.equal(audio.volume,undefined);
 context.document.getElementById=()=>null;assert.doesNotThrow(()=>context.playPluginClickSound());
});
