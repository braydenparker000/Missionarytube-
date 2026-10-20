// Presentation only. The persistent audio element and playback state never enter
// this module. Native dialogs retain modal semantics throughout an exit.
export function surfaceMotion(dialog,{miniArt,art,onDismiss,onResume}={}) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const content=art?.closest('.player-content'), title=content?.querySelector('h3'), header=art?dialog.querySelector('.dialog-heading'):null;
  const miniTitle=miniArt?.closest('button')?.querySelector('strong');
  let phase='closed',animations=[],epoch=0,contact=null,blockClick=false,shared=null;
  const y=()=>{const transform=getComputedStyle(dialog).transform;return transform==='none'?0:new DOMMatrixReadOnly(transform).m42;};
  const setPhase=value=>{phase=value;dialog.dataset.motion=value;};
  function freeze(){
    // Preserve the current composited frame before cancelling. Reversals and
    // re-grabs therefore begin at the visible position, not an old keyframe.
    for(const animation of animations){const target=animation.effect.target,style=getComputedStyle(target);
      target.style.transform=style.transform;target.style.opacity=style.opacity;animation.cancel();}
    animations=[];epoch++;
  }
  function clear(open=false){
    dialog.style.transform='';dialog.style.opacity='';
    for(const node of [content,header])if(node){node.style.transform='';node.style.opacity='';}
    if(shared){shared.layer.remove();shared=null;}
    if(art)art.style.visibility='';if(title)title.style.visibility='';
    if(miniArt)miniArt.style.visibility=open?'hidden':'';
    if(miniTitle)miniTitle.style.visibility=open?'hidden':'';
  }
  function makeShared(bounds,offset,distance){
    if(!art||!miniArt?.isConnected||!art.complete||!art.naturalWidth)return;
    const destination=art.getBoundingClientRect(),source=miniArt.getBoundingClientRect();
    // Notes may have scrolled the full cover off-screen. Use the ordinary sheet
    // fallback then, rather than flying an unrelated or invisible rectangle.
    if(!source.width||destination.bottom<=bounds.top||destination.top>=bounds.bottom)return;
    const layer=document.createElement('div');layer.setAttribute('aria-hidden','true');
    Object.assign(layer.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:'4',overflow:'visible'});
    const image=art.cloneNode(false);image.removeAttribute('id');image.removeAttribute('class');image.alt='';
    const artStyle=getComputedStyle(art);
    Object.assign(image.style,{position:'absolute',left:(destination.left-bounds.left-dialog.clientLeft)+'px',top:(destination.top-bounds.top-dialog.clientTop+dialog.scrollTop)+'px',width:destination.width+'px',height:destination.height+'px',maxWidth:'none',margin:'0',objectFit:'cover',borderRadius:artStyle.borderRadius,transformOrigin:'top left'});
    const small=`translate(${source.left-destination.left}px,${source.top-destination.top-distance+offset}px) scale(${source.width/destination.width})`;
    layer.append(image);const items=[{node:image,small}];
    if(title&&miniTitle){
      const end=title.getBoundingClientRect(),start=miniTitle.getBoundingClientRect(),style=getComputedStyle(title),miniStyle=getComputedStyle(miniTitle);
      const label=document.createElement('div');label.textContent=title.textContent;
      Object.assign(label.style,{position:'absolute',left:(end.left-bounds.left-dialog.clientLeft)+'px',top:(end.top-bounds.top-dialog.clientTop+dialog.scrollTop)+'px',width:end.width+'px',fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,color:style.color,overflowWrap:'anywhere',display:'-webkit-box',webkitBoxOrient:'vertical',webkitLineClamp:style.webkitLineClamp,overflow:'hidden',transformOrigin:'top left'});
      const scale=parseFloat(miniStyle.fontSize)/parseFloat(style.fontSize);
      items.push({node:label,small:`translate(${start.left-end.left}px,${start.top-end.top-distance+offset}px) scale(${scale})`});layer.append(label);
    }
    dialog.append(layer);art.style.visibility='hidden';if(title)title.style.visibility='hidden';
    miniArt.style.visibility='hidden';if(miniTitle)miniTitle.style.visibility='hidden';
    shared={layer,items};
  }
  async function travel(open){
    const fresh=phase==='closed',offset=y();freeze();const serial=epoch;
    if(fresh)blockClick=false;
    setPhase(open?'opening':'closing');
    const bounds=dialog.getBoundingClientRect(),mini=miniArt?.getBoundingClientRect();
    const distance=mini?.height?Math.max(24,mini.top-(bounds.top-offset)-12):Math.min(bounds.height,96);
    if(reduced.matches||typeof dialog.animate!=='function'){
      clear(open);setPhase(open?'open':'closed');return true;
    }
    if(art&&!shared)makeShared(bounds,offset,distance);
    const from=fresh?distance:offset,to=open?0:distance;
    const options={duration:open?300:260,easing:'cubic-bezier(.22,.75,.2,1)',fill:'both'};
    // The surface is opaque: shared artwork must never fade through a second
    // cover underneath. Only controls fade, independently of the image layer.
    animations.push(dialog.animate([{transform:`translateY(${from}px)`,opacity:art?1:(fresh?0.4:Number(getComputedStyle(dialog).opacity))},{transform:`translateY(${to}px)`,opacity:art?1:open?1:0}],options));
    for(const node of [content,header])if(node)animations.push(node.animate([{opacity:fresh?0:Number(getComputedStyle(node).opacity)},{opacity:open?1:0}],options));
    for(const item of shared?.items||[]){
      const style=getComputedStyle(item.node);
      animations.push(item.node.animate([{transform:fresh?item.small:style.transform,opacity:Number(style.opacity)},{transform:open?'none':item.small,opacity:1}],options));
    }
    const pending=animations.slice();await Promise.all(pending.map(a=>a.finished.catch(()=>{})));
    if(serial!==epoch)return false;
    for(const a of animations)a.cancel();animations=[];clear(open);
    setPhase(open?'open':'closed');return true;
  }
  function settle(){return travel(true);}
  function release(c){if(c&&dialog.hasPointerCapture(c.id))try{dialog.releasePointerCapture(c.id);}catch{}}
  function cancelContact(){
    if(!contact)return;const c=contact;contact=null;release(c);blockClick=true;settle();
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
      c.claimed=true;blockClick=true;setPhase('dragging');
      try{dialog.setPointerCapture(event.pointerId);}catch{}
    }
    const dt=event.timeStamp-c.lastTime;
    if(dt>0)c.velocity=(event.clientY-c.lastY)/dt;
    c.lastTime=event.timeStamp;c.lastY=event.clientY;c.distance=Math.max(0,c.offset+dy);
    // No layout reads or inherited variables on the pointer path.
    dialog.style.transform=`translateY(${c.distance}px)`;event.preventDefault();
  });
  dialog.addEventListener('pointerup',event=>{
    const c=contact;if(!c||c.id!==event.pointerId)return;contact=null;release(c);
    if(!c.claimed){settle();return;}
    const recent=event.timeStamp-c.lastTime<100,fling=recent&&c.velocity>.8&&c.distance>40;
    if(c.reopening&&event.clientY<c.y)settle();
    else if(c.distance>dialog.offsetHeight*.25||fling)onDismiss?.();else settle();
  });
  dialog.addEventListener('pointercancel',cancelContact);
  dialog.addEventListener('lostpointercapture',event=>{if(event.target===dialog&&!dialog.hasPointerCapture(event.pointerId))cancelContact();});
  dialog.addEventListener('click',event=>{if(blockClick){event.preventDefault();event.stopImmediatePropagation();blockClick=false;}},true);
  dialog.addEventListener('pointerdown',()=>{if(!contact)blockClick=false;},true);
  document.addEventListener('pointerdown',event=>{if(contact&&contact.id!==event.pointerId)cancelContact();},true);
  // Finishing a transition keeps its intended history outcome. Cancelling a
  // held gesture returns to the open state; background/resizing cannot strand it.
  const finish=()=>{if(contact)cancelContact();for(const a of animations.slice())a.finish();};
  reduced.addEventListener('change',()=>{if(reduced.matches)finish();});
  addEventListener('visibilitychange',()=>{if(document.hidden)finish();});
  addEventListener('resize',finish);
  return {enter:()=>travel(true),exit:()=>{const c=contact;contact=null;release(c);return travel(false);},reset:()=>{const c=contact;contact=null;release(c);freeze();clear();setPhase('closed');}};
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
