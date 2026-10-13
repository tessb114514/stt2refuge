import test from 'node:test';
import assert from 'node:assert/strict';
import {pageItems,randomPersona,formatLastUsed,randomCharacter} from '../quick-model.js';
test('pagination preserves order and clamps after filtering',()=>{
 const values=Array.from({length:30},(_,i)=>i);assert.deepEqual(pageItems(values,2).items,[24,25,26,27,28,29]);
 assert.equal(pageItems([1,2],8).page,1);assert.deepEqual(pageItems([],1).items,[]);
});
test('random choice is one existing Persona; empty list selects nothing',()=>{
 assert.equal(randomPersona(['a','b'],()=>0),'a');assert.equal(randomPersona(['a','b'],()=>.99),'b');assert.equal(randomPersona([]),undefined);
});
test('last-used formatting handles never-used cards and timestamps',()=>{
 assert.equal(formatLastUsed(0),'尚未使用');assert.equal(formatLastUsed(undefined),'尚未使用');assert.ok(formatLastUsed(1700000000000).includes('2023'));
});
test('random character ignores folders, avoids repeating the previous draw, and handles empty or single collections',()=>{
 const cards=[{avatar:'a.png',name:'A'},{avatar:'b.png',name:'B'},{name:'Folder'}];
 assert.equal(randomCharacter(cards,undefined,()=>0).avatar,'a.png');
 assert.equal(randomCharacter(cards,'a.png',()=>0).avatar,'b.png');
 assert.equal(randomCharacter(cards,'b.png',()=>.99).avatar,'a.png');
 assert.equal(randomCharacter([cards[0]],'a.png',()=>0).avatar,'a.png');
 assert.equal(randomCharacter([]),undefined);
});
