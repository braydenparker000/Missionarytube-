import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../public/assets/pip-diagnostics.js', import.meta.url), 'utf8');
function fixture() {
  let time = 0;
  const media = Object.assign(new EventTarget(), {paused:false, ended:false, readyState:4,
    src:'https://private.example/secret-stream?token=credential-sentinel', title:'private-title-sentinel'});
  const document = Object.assign(new EventTarget(), {visibilityState:'visible', pictureInPictureElement:null,
    fullscreenElement:null, hasFocus:() => document.focused, focused:true});
  const window = Object.assign(new EventTarget(), {matchMedia:() => ({matches:false})});
  const forbidden = () => { throw Error('Observer must never control playback or the window'); };
  media.play = media.pause = media.requestPictureInPicture = forbidden;
  document.exitPictureInPicture = forbidden; window.focus = forbidden;
  const context = vm.createContext({document, navigator:{userAgent:'Android 14; Chrome/140.0.7339.155 private-ua-sentinel'},
    performance:{now:() => time}, console});
  vm.runInContext(source, context);
  const observer = context.JarvisPiPDiagnostics.observe(media, {document, window, navigator:context.navigator, now:() => time});
  const emit = (target, type) => { time += 17; target.dispatchEvent(new Event(type)); };
  const snapshot = () => JSON.parse(observer.report({app:'mymedia', release:'0.37.1'}));
  return {media, document, window, observer, emit, snapshot, context};
}

test('PiP observer records both exit orderings without taking playback or focus actions', () => {
  for (const visibleFirst of [true, false]) {
    const f = fixture();
    f.document.pictureInPictureElement = f.media; f.emit(f.media, 'enterpictureinpicture');
    f.document.visibilityState = 'hidden'; f.document.focused = false; f.emit(f.document, 'visibilitychange');
    f.emit(f.window, 'blur');
    const makeVisible = () => { f.document.visibilityState = 'visible'; f.document.focused = true;
      f.emit(f.document, 'visibilitychange'); f.emit(f.window, 'focus'); };
    if (visibleFirst) makeVisible();
    f.document.pictureInPictureElement = null; f.emit(f.media, 'leavepictureinpicture');
    if (!visibleFirst) makeVisible();
    const report = f.snapshot();
    assert.equal(report.nativeExitReason, 'unavailable');
    assert.equal(report.lastExit.visibility, visibleFirst ? 'visible' : 'hidden');
    assert.equal(report.lastExit.pipEventActive, false);
    assert.equal(report.state.paused, false, 'observer leaves intentional expand playback unchanged');
    assert.equal(report.state.focused, true);
    assert.deepEqual(report.events.map(event => event.sequence), [1,2,3,4,5,6,7]);
    assert.ok(report.events.every((event, i, events) => !i || event.milliseconds >= events[i-1].milliseconds));
    f.observer.dispose();
  }
});

test('PiP request intents and outcomes are allowlisted, with native exits left unclassified', () => {
  const f = fixture();
  for (const intent of ['app-enter','app-exit','media-stop','private-title-sentinel']) f.observer.markIntent(intent);
  for (const outcome of ['enter-resolved','enter-rejected','exit-resolved','exit-rejected','system-unavailable','attempt-dispose','player-dispose','credential-sentinel']) f.observer.markOutcome(outcome);
  assert.deepEqual(f.snapshot().events.map(event=>event.event), ['observe','app-enter','app-exit','media-stop','enter-resolved','enter-rejected','exit-resolved','exit-rejected','system-unavailable','attempt-dispose','player-dispose']);
  f.emit(f.media, 'leavepictureinpicture');
  assert.equal(f.snapshot().nativeExitReason, 'unavailable');
});

test('PiP reports are bounded and retain the latest exit after later playback noise', () => {
  const f = fixture(); f.emit(f.media, 'leavepictureinpicture');
  for (let i=0;i<100;i++) f.emit(f.media, i%2 ? 'pause' : 'play');
  const report=f.snapshot();
  assert.equal(report.events.length,48);
  assert.equal(report.lastExit.event,'leavepictureinpicture');
  assert.equal(report.lastExit.sequence,2);
  assert.equal(report.events.at(-1).sequence,102);
  const changed=f.snapshot(); changed.lastExit.event='changed'; changed.events[0].event='changed';
  assert.equal(f.snapshot().lastExit.event,'leavepictureinpicture');
  assert.notEqual(f.snapshot().events[0].event,'changed');
});

test('PiP report excludes private source, title, credentials, raw UA, and unknown metadata', () => {
  const f=fixture();
  f.observer.markIntent('https://private.example/secret-stream');
  const report=f.observer.report({app:'private-title-sentinel',release:'credential-sentinel'});
  for(const sentinel of ['private.example','secret-stream','credential-sentinel','private-title-sentinel','private-ua-sentinel']) assert.ok(!report.includes(sentinel),sentinel);
  const data=JSON.parse(report);
  assert.equal(data.environment.chrome,'140.0.7339.155');
  assert.equal(data.environment.android,'14');
  assert.equal(data.environment.tabContext,'unknown');
  assert.equal(data.app,'unknown'); assert.equal(data.release,'unknown');
});

test('PiP observer disposal is idempotent and replacement media gets only its own events', () => {
  const f=fixture(), before=f.snapshot().events.length;
  f.observer.dispose(); f.observer.dispose();
  f.emit(f.media,'leavepictureinpicture'); f.emit(f.document,'visibilitychange'); f.emit(f.window,'focus');
  f.observer.markIntent('app-enter'); f.observer.markOutcome('enter-resolved');
  assert.equal(f.snapshot().events.length,before);
  const replacement=Object.assign(new EventTarget(),{paused:true,ended:false,readyState:0});
  const next=f.context.JarvisPiPDiagnostics.observe(replacement,{document:f.document,window:f.window});
  f.emit(f.media,'enterpictureinpicture');
  assert.equal(next.snapshot().events.length,1);
  f.emit(replacement,'enterpictureinpicture');
  assert.equal(next.snapshot().events.length,2);
  next.dispose();
});

test('both apps load the same observer and retain their existing native exit policy', async () => {
  const mymedia=await readFile(new URL('../public/mymedia/app.js',import.meta.url),'utf8');
  const astra=await readFile(new URL('../public/media/assets/js/app.js',import.meta.url),'utf8');
  const index=await readFile(new URL('../public/media/index.html',import.meta.url),'utf8');
  assert.match(mymedia,/import '\.\.\/assets\/pip-diagnostics\.js\?v=0\.37\.1'/);
  assert.match(mymedia,/if \(document\.visibilityState === 'hidden'\) \{\s*video\.pause\(\)/);
  assert.equal((index.match(/\/assets\/pip-diagnostics\.js/g)||[]).length,1);
  assert.match(astra,/pip:player\.pipDiagnostics\?\.snapshot/);
  assert.ok(!astra.includes('leavepictureinpicture'),'Astra native exit playback policy is unchanged');
  assert.ok(!source.includes('localStorage')&&!source.includes('fetch('),'no persistence or upload');
});

test('Astra PiP requests retain enter, explicit exit, unavailable, and rejected-request behavior', async () => {
  const app=await readFile(new URL('../public/media/assets/js/app.js',import.meta.url),'utf8');
  const begin=app.indexOf('    async function pictureInPicture(){'), end=app.indexOf('    function playerAction(',begin);
  assert.ok(begin>=0 && end>begin);
  for(const mode of ['enter','exit','unavailable','rejected']) {
    const intents=[],outcomes=[],minis=[],messages=[]; let requests=0,exits=0;
    const media={readyState:4,requestPictureInPicture:()=>{requests++;return mode==='rejected'?Promise.reject(Error('private-raw-error-sentinel')):Promise.resolve();}};
    const context=vm.createContext({document:{pictureInPictureElement:mode==='exit'?media:null,pictureInPictureEnabled:mode!=='unavailable',exitPictureInPicture:()=>{exits++;return Promise.resolve();}},
      player:{audioMode:false,pipDiagnostics:{markIntent:x=>intents.push(x),markOutcome:x=>outcomes.push(x)}},
      $:()=>media,miniPlayer:x=>minis.push(x),toast:x=>messages.push(x)});
    vm.runInContext(app.slice(begin,end),context); await context.pictureInPicture();
    assert.equal(requests,['enter','rejected'].includes(mode)?1:0);
    assert.equal(exits,mode==='exit'?1:0);
    assert.deepEqual(minis,mode==='exit'?[]:[true]);
    assert.deepEqual(intents,mode==='unavailable'?[]:[mode==='exit'?'app-exit':'app-enter']);
    assert.deepEqual(outcomes,[{enter:'enter-resolved',exit:'exit-resolved',unavailable:'system-unavailable',rejected:'enter-rejected'}[mode]]);
    assert.ok(!JSON.stringify({intents,outcomes,messages}).includes('private-raw-error-sentinel'));
  }
});
