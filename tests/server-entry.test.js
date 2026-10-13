import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../server/index.mjs';
test('a partial host installation exposes diagnostics only, not unenforced password features',async()=>{
    const routes=new Map();await init({post:(route,handler)=>routes.set(route,handler)});
    assert.deepEqual([...routes.keys()],['/status']);let status;
    routes.get('/status')({}, {json:value=>status=value});assert.equal(status.version,'0.5.4');assert.equal(status.coreIntegration,false);
});
