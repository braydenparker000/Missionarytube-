// Original browser scene controller. APK configuration provenance: docs/poweramp-v2/REFERENCE.md.
export const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));

export class SceneMotion extends EventTarget {
  progress = 0;
  target = 0;
  frame = 0;
  constructor(render, {duration = 250, reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches} = {}) {
    super(); this.render = render; this.duration = duration; this.reduced = reduced;
  }
  set(progress) { this.progress = clamp(progress); this.render(this.progress); }
  interrupt() { cancelAnimationFrame(this.frame); this.frame = 0; return this.progress; }
  settle(target, {immediate = false} = {}) {
    this.interrupt(); this.target = clamp(target);
    const start = this.progress, distance = this.target - start;
    const finish = () => { this.frame = 0; this.set(this.target); this.dispatchEvent(new Event('settled')); };
    if (immediate || this.reduced() || Math.abs(distance) < .0001) { finish(); return; }
    const began = performance.now(), duration = this.duration * Math.max(.35, Math.abs(distance));
    const tick = now => {
      const t = clamp((now - began) / duration);
      this.set(start + distance * (1 - (1-t) ** 3));
      if (t < 1) this.frame = requestAnimationFrame(tick); else finish();
    };
    this.frame = requestAnimationFrame(tick);
  }
  dispose() { this.interrupt(); }
}

// The thresholds below are explicit V2 tuning values, NOT recovered Poweramp constants.
// One owner per contact sequence; a second contact cancels instead of switching tracks.
export function attachDrag(element, handlers, {slop = 8, axes = 'xy'} = {}) {
  const controller = new AbortController(), signal = controller.signal;
  let gesture = null, suppressClick = false;
  const end = (event, cancelled) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const g = gesture; gesture = null;
    if (element.hasPointerCapture(g.id)) element.releasePointerCapture(g.id);
    suppressClick = g.moved || cancelled;
    handlers.end?.({...g, event, cancelled});
  };
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (gesture) { end({pointerId: gesture.id}, true); suppressClick = true; return; }
    if (!event.isPrimary || handlers.enabled?.() === false) return;
    const now = performance.now();
    gesture = {id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,vx:0,vy:0,axis:null,moved:false,lastX:event.clientX,lastY:event.clientY,lastTime:now};
    suppressClick = false;
    element.setPointerCapture(event.pointerId);
    handlers.start?.({...gesture,event});
  }, {signal});
  document.addEventListener('pointerdown', event => {
    if(gesture && event.pointerId!==gesture.id) end({pointerId:gesture.id},true);
  },{capture:true,signal});
  element.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const g = gesture, now = performance.now(), dt = Math.max(1,now-g.lastTime);
    g.dx = event.clientX-g.x; g.dy = event.clientY-g.y;
    if (!g.axis && Math.hypot(g.dx,g.dy) >= slop) {
      g.axis = Math.abs(g.dx)>Math.abs(g.dy)?'x':'y';
      if (!axes.includes(g.axis)) { end(event,true); return; }
      g.moved = true;
    }
    g.vx=(event.clientX-g.lastX)/dt; g.vy=(event.clientY-g.lastY)/dt;
    g.lastX=event.clientX; g.lastY=event.clientY; g.lastTime=now;
    if(g.moved) { event.preventDefault(); handlers.move?.({...g,event}); }
  }, {signal});
  element.addEventListener('pointerup', event => end(event,false), {signal});
  element.addEventListener('pointercancel', event => end(event,true), {signal});
  element.addEventListener('lostpointercapture', event => end(event,true), {signal});
  element.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick=false; }
  }, {capture:true,signal});
  return () => { if(gesture)end({pointerId:gesture.id},true); controller.abort(); };
}
