import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {servePowerampFixture,openFixturePage,reportFixtureFailure} from './helpers/poweramp-fixture.js';

const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const SharedPlayerMotion='),source.indexOf('const ScreenDrag='));

// Production methods, actual authored CSS/native icons, and Chrome's complete
// computed-property inventory. The comparison runs outside the animation and
// does not replace trusted input or add a production debug export.
test('Poweramp mandatory Chromium compact snapshot appearance parity',{timeout:120000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const fixture=await servePowerampFixture();let browser;
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    for(const theme of ['dark','light'])await t.test(theme+' native masks, fonts, layout, shadows, and generated pseudos',async()=>{
      const h=await openFixturePage(browser,fixture,{count:5000}),{page}=h;
      try{
        await page.addScriptTag({content:code+'\nwindow.fixtureSnapshotMotion=SharedPlayerMotion;'});
        const report=await page.evaluate(theme=>{
          PA.SET.uiTheme=theme;PA.applySettings('uiTheme');PA.NativeSettings.apply();PA.UI.renderPlayState();PA.UI.renderProgress();
          const full=document.querySelector('#sc-player'),mini=document.querySelector('#mini');full.hidden=false;mini.hidden=false;mini.classList.remove('down');
          full.style.transform=mini.style.transform='none';full.style.opacity=mini.style.opacity='1';PA.UI.fitPlayer();
          const snapshotDiagnostics={fallback:null},motion={...fixtureSnapshotMotion,captureMode:'compact',snapshotPlan(style){return fixtureSnapshotMotion.snapshotPlan(style,snapshotDiagnostics);}},selectors=['#bg','#sc-player','#mini-art','#artA','.art-ov','#mini-title','#p-title','#mini-sub','#p-sub','#mini-play','#btn-play','#mini-seek','#seek'];
          const host=document.createElement('div');host.className='player-scene-layer';host.style.visibility='hidden';document.body.appendChild(host);
          const fullMotion={...motion,snapshotPlan:()=>null},cache=new Map(),fullCache=new Map(),differences=[],coverage=[],counts={compactProperties:0,fullProperties:0,compactCSS:0,fullCSS:0,nodes:0,pseudos:0,icons:0};
          const computed=getComputedStyle;let reads=0;
          window.getComputedStyle=(...args)=>{const style=computed(...args);return new Proxy(style,{get(target,key){if(key==='getPropertyValue')return property=>{reads++;return target.getPropertyValue(property);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
          try{
            for(const selector of selectors){
              const original=document.querySelector(selector),before=reads,compact=motion.clone(original,cache),middle=reads,baseline=fullMotion.clone(original,fullCache),after=reads;
              counts.compactProperties+=middle-before;counts.fullProperties+=after-middle;host.appendChild(compact);host.appendChild(baseline);
              for(const [source,copy] of compact._sceneNodes){
                const reference=baseline._sceneNodes.get(source),actual=computed(copy),expected=computed(reference);counts.nodes++;counts.compactCSS+=copy.style.cssText.length;counts.fullCSS+=reference.style.cssText.length;
                if(source.classList.contains('raster-icon'))counts.icons++;
                for(let i=0;i<expected.length;i++){const key=expected[i];if(key.startsWith('--'))continue;const a=actual.getPropertyValue(key),b=expected.getPropertyValue(key);if(a!==b)differences.push({selector,node:source.id||source.tagName+'.'+source.className,key,compact:a,full:b});}
                for(const pseudo of ['::before','::after']){const a=computed(copy,pseudo),b=computed(reference,pseudo);for(let i=0;i<b.length;i++){const key=b[i];if(key.startsWith('--'))continue;if(a.getPropertyValue(key)!==b.getPropertyValue(key))differences.push({selector,node:source.id||source.tagName+'.'+source.className,pseudo,key,compact:a.getPropertyValue(key),full:b.getPropertyValue(key)});}}
                const pseudos=[...copy.children].filter(n=>n.classList.contains('player-scene-pseudo')),references=[...reference.children].filter(n=>n.classList.contains('player-scene-pseudo'));counts.pseudos+=pseudos.length;
                if(pseudos.length!==references.length)differences.push({selector,key:'pseudo-count',compact:pseudos.length,full:references.length});
                for(let n=0;n<Math.min(pseudos.length,references.length);n++){const a=computed(pseudos[n]),b=computed(references[n]);for(let i=0;i<b.length;i++){const key=b[i];if(key.startsWith('--'))continue;if(a.getPropertyValue(key)!==b.getPropertyValue(key))differences.push({selector,node:'pseudo',key,compact:a.getPropertyValue(key),full:b.getPropertyValue(key)});}}
              }
              coverage.push(selector);compact.remove();baseline.remove();
            }
          }finally{window.getComputedStyle=computed;host.remove();}
          // A brand-new scene must discover CSSOM and inline changes. The chosen
          // longhands were never a handwritten member of a snapshot whitelist.
          const style=document.createElement('style');document.head.appendChild(style);style.sheet.insertRule('#p-title { outline: 3px dotted rgb(2, 70, 130); border-left: 2px solid red; border-right: 7px double blue; text-decoration-thickness: 3px; background-position-x: 37%; background-position-y: 61%; -webkit-mask-position-x: 17%; -webkit-mask-position-y: 71%; }');
          const title=document.querySelector('#p-title');title.style.letterSpacing='2px';
          const updated=motion.clone(title),expected=computed(title),keys=['outline-width','outline-style','outline-color','border-left-width','border-right-width','border-left-color','border-right-color','text-decoration-thickness','background-position','mask-position','letter-spacing'];
          for(const key of keys)if(updated.style.getPropertyValue(key)!==expected.getPropertyValue(key))differences.push({selector:'updated-title',key,compact:updated.style.getPropertyValue(key),full:expected.getPropertyValue(key)});
          style.remove();title.style.removeProperty('letter-spacing');
          // Classes and their real pseudos survive clone ID removal. A local
          // variable must remain available to those rules and !important paint.
          const edgeStyle=document.createElement('style');edgeStyle.textContent='.fixture-snapshot-edge{display:block;width:24px;height:24px;color:var(--edge-color)!important;mask:var(--edge-mask) center/contain no-repeat!important}.fixture-snapshot-edge::before{content:"";display:block;width:7px;height:8px;background:var(--edge-pseudo);color:var(--missing-edge-color,rgb(2,3,4))}.fixture-snapshot-edge::after{content:"x";color:var(--edge-color)}';document.head.appendChild(edgeStyle);
          const edge=document.createElement('span');edge.id='snapshot-local-edge';edge.className='fixture-snapshot-edge';edge.style.cssText='--edge-color:rgb(20,30,40);--edge-pseudo:rgb(50,60,70);--edge-mask:'+computed(document.querySelector('.raster-icon')).maskImage+';--unused-edge-schema:unused';document.body.appendChild(edge);
          const actualEdge=motion.clone(edge),expectedEdge=fullMotion.clone(edge),edgeHost=document.createElement('div');edgeHost.className='player-scene-layer';edgeHost.style.visibility='hidden';edgeHost.append(actualEdge,expectedEdge);document.body.appendChild(edgeHost);
          for(const pseudo of [null,'::before','::after']){const a=computed(actualEdge,pseudo),b=computed(expectedEdge,pseudo);for(let i=0;i<b.length;i++){const key=b[i];if(key.startsWith('--'))continue;if(a.getPropertyValue(key)!==b.getPropertyValue(key))differences.push({selector:'local-class-pseudo-important',pseudo,key,compact:a.getPropertyValue(key),full:b.getPropertyValue(key)});}}
          const localVariables={color:actualEdge.style.getPropertyValue('--edge-color').replace(/\s/g,''),pseudo:actualEdge.style.getPropertyValue('--edge-pseudo').replace(/\s/g,''),mask:!!actualEdge.style.getPropertyValue('--edge-mask'),unused:actualEdge.style.getPropertyValue('--unused-edge-schema'),missing:actualEdge.style.getPropertyValue('--missing-edge-color')};
          // The scene-local declaration-slot index must conservatively cover
          // every dependency found by the original full-inventory seeded probe.
          // This check is outside measured snapshot creation and adds no export.
          const inventory=[...computed(edge)].filter(key=>!key.startsWith('--')),probe=document.createElement('span').style,authored=new Set(['text-decoration-color','background-position-x','background-position-y','-webkit-mask','-webkit-mask-position-x','border','border-image','border-image-source','font','all']);
          for(const key of inventory)probe.setProperty(key,'initial');
          const initial=new Map(inventory.map(key=>[key,probe.getPropertyValue(key)])),plan=motion.snapshotPlan(computed(edge)),expansionParity={authoredNames:0,differences:[]};
          const collect=list=>{for(let i=0;i<list.length;i++){const rule=list[i];if(rule.style)for(let j=0;j<rule.style.length;j++)if(!rule.style[j].startsWith('--'))authored.add(rule.style[j]);if(rule.styleSheet)collect(rule.styleSheet.cssRules);if(rule.cssRules)collect(rule.cssRules);}};
          for(const sheets of [document.styleSheets,document.adoptedStyleSheets])if(sheets)for(let i=0;i<sheets.length;i++)collect(sheets[i].cssRules);
          for(const selector of selectors){const root=document.querySelector(selector);for(const node of [root,...root.querySelectorAll('*')])for(let i=0;i<node.style.length;i++)if(!node.style[i].startsWith('--'))authored.add(node.style[i]);}
          for(const key of authored){
            probe.setProperty(key,'inherit');const expected=inventory.filter(candidate=>probe.getPropertyValue(candidate)!==initial.get(candidate));if(inventory.includes(key)&&!expected.includes(key))expected.push(key);probe.setProperty(key,'initial');
            const actual=new Set(plan.expand(key));for(const property of expected)if(!property.startsWith('animation-')&&!property.startsWith('transition-')&&property!=='pointer-events'&&!actual.has(property))expansionParity.differences.push({key,property});
          }
          expansionParity.authoredNames=authored.size;
          edgeHost.remove();edge.remove();edgeStyle.remove();
          return {theme,light:document.body.classList.contains('theme-light'),coverage,counts,snapshotDiagnostics,localVariables,expansionParity,differences};
        },theme);
        if(process.env.POWERAMP_EVIDENCE_DIR){const directory=resolve(process.env.POWERAMP_EVIDENCE_DIR);await mkdir(directory,{recursive:true});await writeFile(join(directory,'snapshot-parity-report-'+theme+'.json'),JSON.stringify(report,null,2)+'\n');}
        t.diagnostic('POWERAMP_SNAPSHOT_PARITY '+JSON.stringify(report));
        assert.equal(report.light,theme==='light','the requested theme is actually active');
        assert.equal(report.snapshotDiagnostics.fallback,null,'compact plan must be active: '+JSON.stringify(report.snapshotDiagnostics));
        assert.deepEqual(report.snapshotDiagnostics.nodeFallbacks||[],[],'every real source uses compact keys');
        assert.deepEqual(report.differences,[],'every standard computed property and live pseudo equals the exhaustive snapshot');
        assert.deepEqual(report.expansionParity.differences,[],'native canonical slots cover every seeded-probe authored/inline dependency');
        assert.equal(report.localVariables.color,'rgb(20,30,40)');assert.equal(report.localVariables.pseudo,'rgb(50,60,70)');assert.equal(report.localVariables.mask,true);assert.equal(report.localVariables.unused,'');assert.equal(report.localVariables.missing,'');
        assert.ok(report.counts.icons>10,'actual native raster masks are compared');assert.ok(report.counts.pseudos>0,'actual generated pseudo appearance is compared');
        assert.ok(report.counts.compactProperties<report.counts.fullProperties*.65,'computed property serialization is materially reduced');
        assert.ok(report.counts.compactCSS<report.counts.fullCSS*.65,'CSS parse/text payload is materially reduced');
        assert.deepEqual(h.errors,[]);
      }catch(error){await reportFixtureFailure(h,error,'snapshot-parity-'+theme);throw error;}finally{await h.close();}
    });
  }finally{await browser?.close();await fixture.close();}
});
