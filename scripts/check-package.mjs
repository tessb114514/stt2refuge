import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allowedRoot=new Set(['manifest.json','package.json','package-lock.json','index.js','quick-start.js','quick-model.js','connection-guard.js','ui-sound.js','style.css','README.md','CHANGELOG.md','LICENSE','NOTICE','ASSETS.md','.gitignore','release-files.json']);
const files=[];
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const absolute=path.join(directory,entry.name),relative=path.relative(root,absolute).replaceAll(path.sep,'/');
 if(['.git','node_modules'].includes(relative))continue;
 if(entry.isSymbolicLink())throw new Error('Symlink is not a release asset: '+relative);
 if(entry.isDirectory()){if(!['assets','server','scripts','patches','tests','docs','.github'].includes(relative.split('/')[0]))throw new Error('Unexpected release directory: '+relative);walk(absolute);continue;}
 if(!relative.includes('/')&&!allowedRoot.has(relative))throw new Error('Unexpected root file: '+relative);
 if(/(^|\/)(data|backups|chat-selector-backups)(\/|$)|\.jsonl$|secrets\.json$|vault\.json$|administrator-config\.json$|chat-selector-admin\.json$|\.log$|\.env/.test(relative))throw new Error('Private/runtime file found: '+relative);
 if(/\.(?:js|mjs|json|md|ya?ml)$/.test(relative)){
  const text=fs.readFileSync(absolute,'utf8');
  if(relative!=='scripts/check-package.mjs' && /[A-Za-z]:[\\/]Users[\\/]|installation\.json/.test(text))throw new Error('Local-only reference found: '+relative);
  if(!relative.startsWith('docs/') && !relative.startsWith('tests/') && !['README.md','CHANGELOG.md','scripts/check-package.mjs'].includes(relative) && /hsmygcs114514/.test(text))throw new Error('Bootstrap plaintext must not enter browser/runtime source: '+relative);
 }
 if(/\.(?:js|mjs)$/.test(relative)){const result=spawnSync(process.execPath,['--check',absolute],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw new Error('Syntax check failed: '+relative+'\n'+result.stderr);}
 files.push(relative);
}}
walk(root);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(manifest.version!=='0.5.4'||pkg.version!==manifest.version||manifest.js!=='index.js')throw new Error('Release metadata mismatch.');
if(manifest.css)throw new Error('Refuge uses Shadow DOM styles; do not publish a global CSS manifest entry.');
for(const file of ['index.js','quick-start.js','connection-guard.js'])if(fs.readFileSync(path.join(root,file),'utf8').includes("from '../"))throw new Error('Directory-dependent Tavern import: '+file);
const inventory=files.filter(file=>file!=='release-files.json').sort().map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),bytes:fs.statSync(path.join(root,file)).size}));
if(process.argv.includes('--write-inventory'))fs.writeFileSync(path.join(root,'release-files.json'),JSON.stringify({version:manifest.version,files:inventory},null,2)+'\n');
console.log(`Release audit passed: ${inventory.length} files; no private data or local-only paths.`);
