import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {previewHooks} from '../scripts/build-poweramp-preview.mjs';

function harness(){
  let now=100,next=0;const frames=new Map(),events=new Map(),toasts=[],dialogs=[];
  const help={textContent:'?',title:''};
  const document={hidden:false,getElementById:id=>id==='preview-help'?help:null,querySelector:()=>({content:'fixture-source-hash'}),
    addEventListener(type,fn,capture=false){if(!events.has(type))events.set(type,[]);events.get(type).push({fn,capture:!!capture});},
    removeEventListener(type,fn,capture=false){events.set(type,(events.get(type)||[]).filter(e=>e.fn!==fn||e.capture!==!!capture));}};
  const context=vm.createContext({document,performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
    innerWidth:393,innerHeight:852,devicePixelRatio:2.75,Preview:{count:60,ready:true},SET:{animations:'normal',playerLayout:'classic',bgBlur:10,vizOnPlayer:false,listZoom:{files:1}},
    NativeSettings:{values:{list_header_buttons:1}},InputLifecycle:{gesture:null,version:1},LibraryPageMotion:{state:null,finish:null},LibraryPageHistory:{index:1,entries:[{},{}]},ScreenDrag:{state:null,settling:null},Nav:{cur:'list'},
    toast:(...args)=>toasts.push(args),dialog:(...args)=>dialogs.push(args),esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
  vm.runInContext(previewHooks.slice(previewHooks.indexOf('const PreviewDiagnostics='),previewHooks.indexOf('Preview.prepare();'))+'\nglobalThis.diagnostics=PreviewDiagnostics;',context);
  const h={context,diagnostics:context.diagnostics,frames,events,help,toasts,dialogs,
    tick(ms=16){now+=ms;const first=frames.entries().next().value;if(first){frames.delete(first[0]);first[1](now);}},
    advance(ms){now+=ms;},
    fire(type,target={id:'sc-list',tagName:'SECTION'},detail={},targetHandler=()=>{}){const event={type,target,pointerType:'touch',...detail};for(const {fn,capture} of events.get(type)||[])if(capture)fn(event);targetHandler(event);for(const {fn,capture} of events.get(type)||[])if(!capture)fn(event);},
    listenerCount(){return [...events.values()].reduce((n,v)=>n+v.length,0);}};return h;
}

test('preview diagnostics are off by default with no listeners or scheduled callbacks',()=>{
  const h=harness();assert.equal(h.diagnostics.active,false);assert.equal(h.frames.size,0);assert.equal(h.listenerCount(),0);assert.equal(h.help.textContent,'?');
  h.diagnostics.show();assert.equal(h.dialogs.length,0);assert.match(h.toasts[0][0],/No diagnostics/);
});

test('an optional measurement stops after 30 seconds and keeps bounded samples/events',()=>{
  const h=harness();h.diagnostics.start();assert.equal(h.diagnostics.active,true);assert.equal(h.help.textContent,'●');
  for(let i=0;i<100;i++)h.fire('pointerdown');
  for(let i=0;i<1900;i++)h.tick();
  assert.equal(h.diagnostics.active,false);assert.equal(h.frames.size,0);assert.equal(h.listenerCount(),0);assert.equal(h.help.textContent,'?');
  const report=h.diagnostics.result;assert.equal(report.stop,'30 seconds elapsed');assert.equal(report.tracks,60);assert.ok(report.raf_gap_ms.samples>1000);assert.equal(report.raf_gap_ms.recent_samples,600);assert.equal(report.raf_gap_ms.p95_recent,16);assert.ok(report.events.length<=80);
  assert.match(report.metric,/not display frames or input latency/);assert.equal(report.source,'fixture-source-hash');assert.equal(report.settings.headerButtons,1);
});

test('report records owner/commit outcomes and callback gaps without collecting input text',async()=>{
  const h=harness();h.diagnostics.start();h.tick();h.tick(80);h.fire('keydown',{id:'q',tagName:'INPUT',value:'private typed content'});
  h.context.InputLifecycle.gesture={node:{id:'sc-list'},phase:'drag'};h.diagnostics.observe();
  h.context.InputLifecycle.gesture=null;h.context.LibraryPageMotion.finish={pending:true};h.context.Nav.cur='library';h.context.LibraryPageHistory.index=0;h.diagnostics.observe();
  h.diagnostics.show();await Promise.resolve();
  const report=h.diagnostics.result;assert.equal(report.raf_gap_ms.over_50ms,1);assert.equal(report.final.screen,'library');assert.equal(report.final.historyIndex,0);
  assert.ok(report.events.some(e=>e.owner==='sc-list'&&e.phase==='drag'));assert.ok(report.events.some(e=>e.phase==='settle'&&e.screen==='library'));
  assert.doesNotMatch(JSON.stringify(report),/private typed content/);assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0][1],/<textarea[^>]*readonly/);assert.match(h.dialogs[0][1],/Nothing is sent automatically/);assert.equal(h.listenerCount(),0);
});

test('hiding the page stops all work and restarting does not accumulate listeners',()=>{
  const h=harness();h.diagnostics.start();h.context.document.hidden=true;h.fire('visibilitychange');
  assert.equal(h.diagnostics.result.stop,'page hidden');assert.equal(h.frames.size,0);assert.equal(h.listenerCount(),0);
  h.context.document.hidden=false;h.context.Preview.count=5000;h.diagnostics.start();assert.equal(h.listenerCount(),12);h.diagnostics.stop('fixture reset');
  assert.equal(h.diagnostics.result.tracks,5000);assert.equal(h.diagnostics.result.stop,'fixture reset');assert.equal(h.listenerCount(),0);
});


test('optional operation timings distinguish setup and release work and restore all wrappers',()=>{
  const h=harness(),shared={
    clone(){assert.equal(this,shared);h.advance(20);return {};},
    create(){assert.equal(this,shared);this.clone();h.advance(40);return {};},
    paint(){h.advance(3);},settle(){h.advance(2);},clean(){h.advance(2);}
  };
  h.context.SharedPlayerMotion=shared;h.context.UI={fitPlayer(){h.advance(1);},drawViz(){h.advance(4);}};
  const save=function(){h.advance(53);return 'saved';};h.context.LibraryPageHistory.save=save;
  const create=shared.create;assert.equal(shared.create,create,'inactive diagnostics do not patch functions');
  h.diagnostics.start();assert.notEqual(shared.create,create);shared.create({target:'player'});
  h.context.ScreenDrag.phase='settle';h.context.ScreenDrag.settling={morph:{opening:true,p:.2}};
  assert.equal(h.context.LibraryPageHistory.save(),'saved');shared.settle({opening:true,p:.2},1,220);
  h.context.UI.fitPlayer();h.diagnostics.stop();
  assert.equal(shared.create,create);assert.equal(h.context.LibraryPageHistory.save,save);assert.equal(h.diagnostics.wrappers.length,0);
  const operations=h.diagnostics.result.operations,setup=operations.find(v=>v.operation==='shared.create'),capture=operations.find(v=>v.operation==='history.save');
  assert.equal(setup.phase,'shared:setup:expand');assert.equal(setup.max_ms,60);assert.equal(setup.calls,1);assert.equal(setup.self_ms,40);
  const clone=operations.find(v=>v.operation==='shared.clone');assert.equal(clone.total_ms,20);assert.equal(clone.self_ms,20);
  assert.equal(capture.phase,'shared:settle:expand');assert.equal(capture.max_ms,53);
  assert.ok(h.diagnostics.result.long_operations.some(v=>v.operation==='shared.clone'&&v.duration_ms===20));
  assert.ok(h.diagnostics.result.events.some(v=>v.type==='motion-settle'&&v.planned_ms===220&&v.from===.2));
  assert.match(h.diagnostics.result.operation_timing_note,/Nested durations overlap/);
});

test('gap timestamps and scene state retain their distinct phases without a GPU-latency claim',()=>{
  const h=harness();h.diagnostics.start();h.tick(10);
  h.context.InputLifecycle.gesture={node:{id:'mini'},phase:'drag'};
  h.context.ScreenDrag.phase='drag';h.context.ScreenDrag.state={morph:{opening:true,p:.25}};
  h.tick(72);h.diagnostics.stop();const report=h.diagnostics.result;
  assert.equal(report.long_gaps.length,1);assert.equal(report.long_gaps[0].gap_ms,72);assert.equal(report.long_gaps[0].from_phase,'idle');assert.equal(report.long_gaps[0].to_phase,'shared:drag:expand');
  assert.equal(report.final.owner,'mini');assert.equal(report.final.phase,'drag');assert.equal(report.final.scene,'shared-player');assert.equal(report.final.scene_phase,'drag');assert.equal(report.final.scene_progress,.25);
  assert.equal(report.phase_gap_ms[0].max,72);assert.match(report.operation_timing_note,/do not prove GPU/);
});

test('contact displacement is sampled without logging pointer moves or typed input',()=>{
  const h=harness();h.diagnostics.start();const target={id:'mini-title',tagName:'SPAN'};
  h.fire('pointerdown',target,{pointerId:7,clientX:10,clientY:100});
  h.fire('pointermove',target,{pointerId:7,clientX:10,clientY:60});
  h.fire('pointermove',target,{pointerId:7,clientX:10,clientY:50});
  h.fire('pointerup',target,{pointerId:7,clientX:10,clientY:30});h.diagnostics.stop();
  const event=h.diagnostics.result.events.find(e=>e.type==='pointerup');assert.equal(event.moves,2);assert.equal(event.dx,0);assert.equal(event.dy,-70);assert.equal(event.travel,70);
  assert.equal(h.diagnostics.result.events.some(e=>e.type==='pointermove'),false);assert.equal(h.diagnostics.contactSamples.size,0);
});


test('owner snapshots occur after target handlers while contact timestamps remain before synchronous work',()=>{
  const h=harness();h.diagnostics.start();
  h.fire('pointerup',{id:'mini',tagName:'DIV'},{pointerId:3,clientX:20,clientY:100},()=>{
    h.advance(53);h.context.Nav.cur='player';h.context.ScreenDrag.phase='settle';h.context.ScreenDrag.settling={morph:{opening:true,p:.4}};
  });
  const contact=h.diagnostics.events.find(e=>e.type==='pointerup'),owner=h.diagnostics.events.find(e=>e.type==='owner'&&e.scene==='shared-player');
  assert.equal(contact.ms,0);assert.equal(owner.ms,53);assert.equal(owner.scene_phase,'settle');assert.equal(owner.scene_progress,.4);
  h.diagnostics.stop();assert.equal(h.listenerCount(),0);
});


test('preview snapshot subphase self times exclude recursive and nested measured calls',()=>{
  const h=harness(),shared={
    snapshotPlan(){h.advance(7);return {};},
    snapshotKeys(node){if(node.parent)this.snapshotKeys(node.parent);h.advance(3);return [];},
    snapshotCSS(){h.advance(5);return '';},copyCanvas(){h.advance(2);},
    clone(){this.snapshotPlan();this.snapshotKeys({parent:{}});this.snapshotCSS();this.copyCanvas();h.advance(11);return {};},
    create(){this.clone();h.advance(13);return {};}
  };
  h.context.SharedPlayerMotion=shared;const originals=Object.fromEntries(Object.entries(shared));h.diagnostics.start();shared.create({target:'player'});h.diagnostics.stop();
  const operations=new Map(h.diagnostics.result.operations.map(v=>[v.operation,v]));
  for(const [key,expected] of [['snapshotPlan',7],['snapshotKeys',6],['snapshotCSS',5],['copyCanvas',2],['clone',11],['create',13]]){
    assert.equal(operations.get('shared.'+key).self_ms,expected,key+' self time');assert.equal(shared[key],originals[key],key+' restored');
  }
  assert.equal(operations.get('shared.snapshotKeys').calls,2);assert.equal(operations.get('shared.snapshotKeys').total_ms,9,'recursive inclusive time overlaps');
  assert.equal(operations.get('shared.clone').total_ms,31);assert.equal(operations.get('shared.create').total_ms,44);assert.equal(h.diagnostics.operationFrames.length,0);
});
