// Exercise the unchanged real importer
// and sharedStore with Node SQLite. Never contacts a provider.
import {mkdtemp,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url),dir=await mkdtemp(join(tmpdir(),'board-integration-'));
try {
  await cp(new URL('jarvis/backend',root),join(dir,'jarvis/backend'),{recursive:true});
  await cp(new URL('jarvis/public/content',root),join(dir,'jarvis/public/content'),{recursive:true});
  for(const path of ['drawercast','podcasts'])await cp(new URL('jarvis/public/'+path,root),join(dir,'jarvis/public',path),{recursive:true});
  await cp(new URL('daily-board-next',root),join(dir,'daily-board-next'),{recursive:true});
  await cp(new URL('frontend/daily-board',root),join(dir,'frontend/daily-board'),{recursive:true});
  await writeFile(join(dir,'package.json'),'{"type":"module"}');
  execFileSync(new URL('node_modules/.bin/esbuild',root).pathname,['jarvis/backend/worker.js','--bundle','--format=esm','--platform=browser','--external:node:crypto','--outfile='+join(dir,'worker.bundle.js')],{cwd:dir,stdio:'pipe'});
  console.log('Unchanged Worker bundle compiled.');
  await writeFile(join(dir,'check.mjs'),`
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sharedStore,sharedSchema} from './jarvis/backend/shared.js';
import {decodePublication} from './jarvis/backend/publications.js';
import {prepare} from './daily-board-next/publisher.mjs';
import {decodeReport,encodeReport} from './frontend/daily-board/v1/schema.js';
const db=new DatabaseSync(':memory:');let depth=0;
const ctx={storage:{sql:{exec:(q,...v)=>db.prepare(q).all(...v)},transactionSync:fn=>{const name='s'+depth++;db.exec('SAVEPOINT '+name);try{const result=fn();db.exec('RELEASE '+name);depth--;return result;}catch(e){db.exec('ROLLBACK TO '+name);db.exec('RELEASE '+name);depth--;throw e;}}}};
sharedSchema(ctx);
const r=JSON.parse(readFileSync('./daily-board-next/fixtures/one.json'));r.synthetic=false;
const publication=prepare(r,{reviewedPublic:true});
const comment={id:1,user:{id:183016859},created_at:'2026-10-18T12:00:00Z',body:JSON.stringify(publication)};
assert.equal(decodePublication({...comment,user:{id:999}}),null);
assert.equal(decodePublication({...comment,issue_url:'https://api.github.com/repos/wrong/repo/issues/2'}),null);
const p=decodePublication(comment);assert(p);
assert.equal(sharedStore(ctx,'/internal/shared/briefing',p).status,201);
assert.equal(sharedStore(ctx,'/internal/shared/briefing',p).status,200);

const state=await sharedStore(ctx,'/internal/shared/state').json();assert.equal(state.posts.length,1);assert.equal(state.posts[0].report,undefined);
assert.deepEqual(decodeReport(state.posts[0]),r);
const changed=structuredClone(r);changed.stories[0].blocks[1].items[0].text='Changed visual detail';assert.equal(sharedStore(ctx,'/internal/shared/briefing',{...p,body:encodeReport(changed)}).status,409);
const second=structuredClone(r);second.id='33333333-3333-4333-8333-333333333333';assert.equal(sharedStore(ctx,'/internal/shared/briefing',{...p,id:second.id,body:encodeReport(second)}).status,409);
assert.equal((await sharedStore(ctx,'/internal/shared/state').json()).posts.length,1);
console.log('Existing importer + SQLite integration passed; exact report readback and ID/date conflicts verified.');
`);
  process.stdout.write(execFileSync(process.execPath,['check.mjs'],{cwd:dir,encoding:'utf8'}));
} finally {await rm(dir,{recursive:true,force:true});}
