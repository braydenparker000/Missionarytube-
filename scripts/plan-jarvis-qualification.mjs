import {readFileSync, writeFileSync, appendFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BROWSER_IDENTITY} from './install-jarvis-browser.mjs';

// Explicitly reviewed recipe blobs, rather than code selected by an arbitrary
// source pin. A recipe upgrade requires review here; old/unknown recipes use
// full current in-run qualification and cannot assert their own proof.
export const trustedRecipe = {
  '.github/workflows/validate-r2.yml':'dbf7f38877b4b2b9fbcc2e93908eac114f71da9a',
  'scripts/qualification-proof.mjs':'48e0933755ac574b6e039eab6a9c6a5c6aa0e900',
  'scripts/install-qualification-browser.mjs':'6c409f044097fc6ad2460d48efa4d2a4c95685cc',
  'tests/helpers/ci-test-inventory.mjs':'a377536b073a7b90d9e3537b7bd9164c30313081',
};
const components = ['relay','frontend','poweramp','blankLibrary','podcasts','migration','performance','owner24'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
export function recipeAllowed(root, expected = trustedRecipe) {
  return Object.entries(expected).every(([path,sha]) => {
    try {return blob(readFileSync(resolve(root,path))) === sha;} catch {return false;}
  });
}
export function checkedRelease(release, sourceHead) {
  if (release.repository !== 'braydenparker999/jarvis' || !/^[a-f0-9]{40}$/.test(release.commit || '') || sourceHead !== release.commit ||
      release.storageOrigin !== 'https://missionarytube.z13.web.core.windows.net' || release.apiOrigin !== 'https://jarvis-hub-api.braydenparker999.workers.dev')
    throw Error('Unexpected release source, pin or deployment origin');
  return release;
}
function sourceHead(root) {return execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();}
const root = resolve('.jarvis-source');
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,name] = process.argv.slice(2), release = checkedRelease(JSON.parse(readFileSync('jarvis-release.json','utf8')),sourceHead(root));
    if (command === 'plan') {
      const chrome = process.env.JARVIS_CHROME;
      if (!chrome || !chrome.startsWith('/')) throw Error('Mandatory qualification browser is missing');
      execFileSync(chrome,['--version'],{stdio:'pipe'});
      const node22=process.env.QUALIFICATION_NODE22,node24=process.env.QUALIFICATION_NODE24;
      if (!/^v22\.[0-9]+\.[0-9]+$/.test(node22||'') || !/^v24\.[0-9]+\.[0-9]+$/.test(node24||'')) throw Error('Exact qualification runtimes are required');
      let plan, proof={qualified:false,reuse:{}}, trusted=false;
      if (recipeAllowed(root)) {
        trusted=true;
        const q=await import(pathToFileURL(resolve(root,'scripts/qualification-proof.mjs')));
        plan=q.makePlan(q.localEntries(root),q.declaredEnvironment(root));
        proof=await q.findProof(plan,{sourceSha:release.commit});
        if (!proof.qualified) proof=await q.findProof(plan);
      } else {
        const {inventory}=await import(pathToFileURL(resolve(root,'tests/helpers/ci-test-inventory.mjs')));
        const paths=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
        const coverage=inventory(paths.filter(p=>/^tests\/[^/]+\.test\.js$/.test(p)));
        const heavy=p=>/^tests\/(?:poweramp|drawercast|audio-fidelity|r2-playback|drive-catalog)/.test(p);
        const tests={...coverage.groups,frontend:coverage.groups.regressions.filter(p=>!heavy(p)),poweramp:coverage.groups.regressions.filter(heavy),owner24:coverage.groups.relay};
        const digest=hash(JSON.stringify({release,paths:paths.map(p=>[p,blob(readFileSync(resolve(root,p)))]),node22,node24,browser:BROWSER_IDENTITY}));
        plan={digest,environment:{node22,node24,python:process.env.QUALIFICATION_PYTHON,browser:BROWSER_IDENTITY},components:Object.fromEntries(components.map(c=>[c,{digest,tests:tests[c]||[]}]))};
      }
      const matrix=components.map(component=>({component,digest:plan.components[component].digest,node:(component==='owner24'?node24:node22).slice(1),
        reuse:proof.qualified || !!proof.reuse?.[component],provenance:proof.qualified?proof:proof.reuse?.[component]||null,trusted}));
      writeFileSync('jarvis-qualification-plan.json',JSON.stringify({schema:1,release,plan,proof,matrix},null,2)+'\n');
      if (!process.env.GITHUB_OUTPUT) throw Error('GitHub outputs required');
      appendFileSync(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nnode22=${node22.slice(1)}\nnode24=${node24.slice(1)}\nsource=${release.commit}\npython=${process.env.QUALIFICATION_PYTHON.slice(7)}\n`);
      console.log(JSON.stringify({source:release.commit,qualified:proof.qualified,trustedRecipe:trusted,matrix:matrix.map(({component,reuse})=>({component,reuse}))}));
    } else if (command === 'run' && components.includes(name)) {
      const file=JSON.parse(readFileSync('jarvis-qualification-plan.json','utf8'));
      if (JSON.stringify(file.release)!==JSON.stringify(release)) throw Error('Release changed after qualification planning');
      const item=file.matrix.find(c=>c.component===name);
      if (!item || process.version !== 'v'+item.node) throw Error('Qualification runtime or component mismatch');
      if (item.trusted) {
        if (!recipeAllowed(root)) throw Error('Trusted qualification implementation changed');
        process.env.QUALIFICATION_COMPONENT_DIGEST=item.digest;
        process.env.QUALIFICATION_REUSE=String(item.reuse);
        process.env.QUALIFICATION_PROVENANCE=JSON.stringify(item.provenance);
        const result=spawnSync(process.execPath,[resolve(root,'scripts/qualification-proof.mjs'),'run',name],{cwd:root,env:process.env,stdio:'inherit'});
        if(result.error||result.status!==0)throw Error('Required source qualification failed');
      } else {
        if (item.reuse) throw Error('Unknown qualification recipe cannot reuse evidence');
        const before=execFileSync('git',['-C',root,'diff','--exit-code'],{stdio:'pipe'});
        const performance=['tests/poweramp-render-trace-browser.mjs','tests/poweramp-persistent-prototype-browser.mjs','tests/poweramp-preview-setup-browser.mjs'];
        const commands=name==='migration'?[['python',['-m','py_compile','scripts/migrate-drive-to-r2.py']],['python',['-m','unittest','discover','-s','tests','-p','test_r2*.py','-v']]]:
          name==='performance'?performance.map(p=>[process.execPath,['--test',p]]):[[process.execPath,['--test',...file.plan.components[name].tests]]];
        if (!process.env.JARVIS_CHROME || execFileSync(process.env.JARVIS_CHROME,['--version'],{encoding:'utf8'}).trim() !== file.plan.environment.browser) throw Error('Exact current qualification browser is missing or changed');
        if (name==='migration' && execFileSync('python',['--version'],{encoding:'utf8'}).trim() !== file.plan.environment.python) throw Error('Exact Python qualification runtime changed');
        let failed=false;
        for(const [binary,args] of commands){const result=spawnSync(binary,args,{cwd:root,env:{...process.env,POWERAMP_BASELINE_REF:'8aa7fce4dd83d5417614ae112134631dd98df7b6',
          ...(name==='owner24'?{REQUIRE_RELAY_OWNER_BROWSER:'1',CHROMIUM_PATH:process.env.JARVIS_CHROME,PLAYWRIGHT_CHROMIUM_EXECUTABLE:process.env.JARVIS_CHROME}:{})},stdio:'inherit'});
          if(result.error||result.status!==0)failed=true;}
        execFileSync('git',['-C',root,'diff','--exit-code'],{stdio:'pipe'});
        if(failed)throw Error('Full current source qualification failed');
      }
      writeFileSync('qualification-'+name+'.json',JSON.stringify({schema:1,source:release.commit,component:name,digest:item.digest,outcome:item.reuse?'verified-reused':'freshly-executed',provenance:item.provenance})+'\n');
    } else throw Error('Use plan or run <component>');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
