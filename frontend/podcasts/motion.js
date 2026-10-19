// Presentation only. The persistent audio element and playback state never enter
// this module. Native dialogs retain modal semantics throughout an exit.
export function surfaceMotion(dialog,{miniArt,art,onDismiss,onResume}={}) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let phase='closed',animations=[],epoch=0,contact=null,blockClick=false;
  const y=()=>{const transform=getComputedStyle(dialog).transform;return transform==='none'?0:new DOMMatrixReadOnly(transform).m42;};
  function freeze(){
    for(const animation of animations){const target=animation.effect.target,style=getComputedStyle(target);
      target.style.transform=style.transform;target.style.opacity=style.opacity;animation.cancel();}
    animations=[];epoch++;
  }
  function clear(){dialog.style.transform='';dialog.style.opacity='';if(art){art.style.transform='';art.style.opacity='';}}
  async function travel(open){
    const fresh=phase==='closed',offset=y();freeze();const serial=epoch;
    phase=open?'opening':'closing';dialog.dataset.motion=phase;
    const bounds=dialog.getBoundingClientRect(),mini=miniArt?.getBoundingClientRect();
    const distance=mini&&mini.height?Math.max(24,mini.top-(bounds.top-offset)):Math.min(bounds.height,96);
    if(reduced.matches||typeof dialog.animate!=='function'){
      clear();phase=open?'open':'closed';dialog.dataset.motion=phase;return true;
    }
    const from=fresh?distance:offset,to=open?0:distance;
    const opacity=fresh ? 0.4 : Number(getComputedStyle(dialog).opacity);
    const artTransform=art?getComputedStyle(art).transform:'none';
    if(art)art.style.transform='none';const image=art?.getBoundingClientRect();if(art)art.style.transform=artTransform;
    animations.push(dialog.animate([{transform:`translateY(${from}px)`,opacity},{transform:`translateY(${to}px)`,opacity:open?1:0}],{duration:open?280:220,easing:'cubic-bezier(.22,.75,.2,1)',fill:'both'}));
    if(art&&mini?.width&&art.complete&&art.naturalWidth&&image.bottom>bounds.top&&image.top<bounds.bottom){
      const r=image,baseTop=r.top-offset,tx=mini.left-r.left;
      const small=`translate(${tx}px,${mini.top-baseTop-distance}px) scale(${mini.width/r.width})`;
      const current=fresh?small:artTransform;
      art.style.transformOrigin='top left';
      animations.push(art.animate([{transform:current},{transform:open?'none':small}],{duration:open?280:220,easing:'cubic-bezier(.22,.75,.2,1)',fill:'both'}));
    }
    await Promise.all(animations.map(a=>a.finished.catch(()=>{})));
    if(serial!==epoch)return false;
    for(const a of animations)a.cancel();animations=[];clear();
    phase=open?'open':'closed';dialog.dataset.motion=phase;return true;
  }
  function settle(){return travel(true);}
  function cancelContact(){
    if(!contact)return;contact=null;blockClick=true;settle();
  }
  dialog.addEventListener('pointerdown',event=>{
    if(contact){if(contact.id!==event.pointerId)cancelContact();return;}
    if(!event.target.closest('[data-drag-handle]')||event.target.closest('button,a,input,select,textarea')||event.button>0||event.isPrimary===false||event.clientX<24||event.clientX>innerWidth-24)return;
    const reopening=phase==='closing';if(reopening)onResume?.();
    const offset=y();freeze();dialog.style.transform=`translateY(${offset}px)`;
    contact={id:event.pointerId,x:event.clientX,y:event.clientY,offset,reopening,claimed:false,lastY:event.clientY,lastTime:event.timeStamp,velocity:0,distance:offset};
  });
  dialog.addEventListener('pointermove',event=>{
    const c=contact;if(!c||c.id!==event.pointerId)return;
    const dx=event.clientX-c.x,dy=event.clientY-c.y;
    if(!c.claimed){
      if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)){cancelContact();return;}
      if(Math.abs(dy)<10)return;
      c.claimed=true;blockClick=true;phase='dragging';dialog.dataset.motion=phase;
      try{dialog.setPointerCapture(event.pointerId);}catch{}
    }
    const dt=event.timeStamp-c.lastTime;
    if(dt>0)c.velocity=(event.clientY-c.lastY)/dt;
    c.lastTime=event.timeStamp;c.lastY=event.clientY;c.distance=Math.max(0,c.offset+dy);
    // Direct transform avoids inherited-variable recalculation in long notes.
    dialog.style.transform=`translateY(${c.distance}px)`;event.preventDefault();
  });
  dialog.addEventListener('pointerup',event=>{
    const c=contact;if(!c||c.id!==event.pointerId)return;contact=null;
    if(!c.claimed){settle();return;}
    const recent=event.timeStamp-c.lastTime<100,fling=recent&&c.velocity>.8&&c.distance>40;
    // A newly grabbed closing surface can already be beyond the threshold.
    // An upward reversal is new intent to reopen, not a completed down-drag.
    if(c.reopening&&event.clientY<c.y)settle();
    else if(c.distance>dialog.offsetHeight*.25||fling)onDismiss?.();else settle();
  });
  dialog.addEventListener('pointercancel',cancelContact);
  dialog.addEventListener('lostpointercapture',event=>{if(event.target===dialog&&!dialog.hasPointerCapture(event.pointerId))cancelContact();});
  // A drag's compatibility click cannot hit a control in the exposed view.
  dialog.addEventListener('click',event=>{if(blockClick){event.preventDefault();event.stopImmediatePropagation();blockClick=false;}},true);
  dialog.addEventListener('pointerdown',()=>{if(!contact)blockClick=false;},true);
  const finishReduced=()=>{if(!reduced.matches)return;const pending=animations.slice();for(const a of pending)a.finish();if(contact)cancelContact();};
  reduced.addEventListener('change',finishReduced);
  addEventListener('visibilitychange',()=>{if(document.hidden)cancelContact();});
  return {enter:()=>travel(true),exit:()=>{contact=null;return travel(false);},reset:()=>{contact=null;freeze();clear();phase='closed';dialog.dataset.motion=phase;}};
}

export function episodeHolds(root,openOptions){
  let contact=null,timer,consumed=null;
  const cancel=()=>{clearTimeout(timer);contact=null;root.querySelector('.hold-ready')?.classList.remove('hold-ready');};
  root.addEventListener('pointerdown',event=>{
    if(contact||event.isPrimary===false){cancel();return;}
    consumed=null;
    const target=event.target.closest('[data-details]');
    if(!target||event.button>0||event.target.closest('a,input,select,textarea,[data-play],[data-download],[data-options]'))return;
    contact={id:event.pointerId,x:event.clientX,y:event.clientY,target};
    timer=setTimeout(()=>{if(!contact||!target.isConnected)return;consumed=target;contact=null;target.classList.remove('hold-ready');openOptions(target.dataset.details,target);},450);
    target.classList.add('hold-ready');
  },{passive:true});
  root.addEventListener('pointermove',event=>{if(contact&&Math.hypot(event.clientX-contact.x,event.clientY-contact.y)>10)cancel();},{passive:true});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,cancel,{passive:true});
  document.addEventListener('click',event=>{if(consumed&&event.detail>0){event.preventDefault();event.stopImmediatePropagation();consumed=null;}},true);
  root.addEventListener('contextmenu',event=>{const target=event.target.closest('[data-details]');if(target){event.preventDefault();if(!consumed){cancel();consumed=target;openOptions(target.dataset.details,target);}}});
  // Scroll can start on an ancestor, not just the row. Route disposal and a
  // second contact outside the list must also cancel the pending hold.
  document.addEventListener('scroll',cancel,{capture:true,passive:true});
  document.addEventListener('pointerdown',event=>{consumed=null;if(contact&&event.pointerId!==contact.id)cancel();},true);
  addEventListener('visibilitychange',cancel);
  return cancel;
}
