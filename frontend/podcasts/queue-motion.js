// Queue presentation owns only a tentative DOM order. Storage changes once,
// after release; cancellation restores the original nodes without a commit.
export function queueReorder(root,{commit,announce}) {
  let drag=null,frame=0,blocked=false;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows=list=>[...list.children];
  const order=list=>rows(list).map(row=>row.dataset.episode);
  function clearTransforms(d){for(const row of d.original){row.getAnimations().forEach(a=>a.cancel());row.style.transform='';}d.row.classList.remove('queue-dragging');d.handle.setAttribute('aria-pressed','false');}
  function finish(save=false){
    const d=drag;if(!d)return;drag=null;cancelAnimationFrame(frame);frame=0;
    const keys=order(d.list),changed=keys.some((key,i)=>key!==d.original[i].dataset.episode);
    clearTransforms(d);
    if(!save)d.list.append(...d.original);
    if(root.hasPointerCapture(d.id))root.releasePointerCapture(d.id);
    if(save&&d.claimed&&changed){commit(keys);announce('Moved to position '+(keys.indexOf(d.row.dataset.episode)+1));}
    if(save&&d.claimed&&!reduced()&&d.row.isConnected&&d.row.animate){
      // A small settle from the actual pointer position; no scale on text.
      const delta=d.lastTop-d.row.getBoundingClientRect().top;
      d.row.animate([{transform:`translateY(${delta}px)`},{transform:'none'}],{duration:150,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
  }
  function position(){
    const d=drag;if(!d?.claimed)return;
    const top=d.y-d.grab,all=rows(d.list),others=all.filter(r=>r!==d.row);
    const center=top+d.height/2;
    const before=others.find(row=>{const r=row.getBoundingClientRect();return center<r.top+r.height/2;});
    const index=before?all.indexOf(before):all.length;
    const current=all.indexOf(d.row);
    if(index!==current&&index!==current+1){
      // Measure once per insertion, never reconstruct rows or their listeners.
      const previous=new Map(others.map(r=>[r,r.getBoundingClientRect().top]));
      for(const row of others)row.getAnimations().forEach(a=>a.cancel());
      d.list.insertBefore(d.row,before||null);
      for(const row of others){const delta=previous.get(row)-row.getBoundingClientRect().top;if(delta&&!reduced()&&row.animate)row.animate([{transform:`translateY(${delta}px)`},{transform:'none'}],{duration:140,easing:'ease-out'});}
    }
    d.row.style.transform='none';const base=d.row.getBoundingClientRect().top;
    d.row.style.transform=`translateY(${top-base}px)`;d.lastTop=top;
  }
  function tick(){
    const d=drag;if(!d?.claimed)return;
    const clearance=parseFloat(getComputedStyle(document.body).getPropertyValue('--bottom-clearance'))||100;
    const bottom=innerHeight-clearance,edge=56;
    const speed=d.y<edge?-Math.min(12,(edge-d.y)/4):d.y>bottom-edge?Math.min(12,(d.y-bottom+edge)/4):0;
    if(speed){scrollBy(0,speed);position();}
    frame=requestAnimationFrame(tick);
  }
  root.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-reorder]');if(!handle||e.button>0||e.isPrimary===false)return;
    if(drag){finish();return;}blocked=false;
    const row=handle.closest('.episode-row'),list=row.parentElement,r=row.getBoundingClientRect();
    drag={id:e.pointerId,handle,row,list,original:rows(list),start:e.clientY,y:e.clientY,grab:e.clientY-r.top,height:r.height,lastTop:r.top,claimed:false};
    root.setPointerCapture(e.pointerId);e.preventDefault();
  });
  root.addEventListener('pointermove',e=>{
    const d=drag;if(!d||e.pointerId!==d.id)return;d.y=e.clientY;
    if(!d.claimed&&Math.abs(d.y-d.start)<4)return;
    if(!d.claimed){d.claimed=true;blocked=true;d.row.classList.add('queue-dragging');d.handle.setAttribute('aria-pressed','true');frame=requestAnimationFrame(tick);}
    position();e.preventDefault();
  });
  root.addEventListener('pointerup',e=>{if(drag?.id===e.pointerId)finish(true);});
  root.addEventListener('pointercancel',()=>finish());
  root.addEventListener('lostpointercapture',()=>finish());
  document.addEventListener('pointerdown',e=>{if(drag&&drag.id!==e.pointerId)finish();else if(!drag)blocked=false;},true);
  root.addEventListener('click',e=>{if(blocked||e.target.closest('[data-reorder]')){e.preventDefault();e.stopImmediatePropagation();blocked=false;}},true);
  root.addEventListener('keydown',e=>{
    const handle=e.target.closest('[data-reorder]');if(!handle||!['ArrowUp','ArrowDown','Home','End','Escape'].includes(e.key))return;
    e.preventDefault();finish();if(e.key==='Escape')return;
    const row=handle.closest('.episode-row'),list=row.parentElement,keys=order(list),i=keys.indexOf(row.dataset.episode);
    const next=e.key==='Home'?0:e.key==='End'?keys.length-1:Math.max(0,Math.min(keys.length-1,i+(e.key==='ArrowUp'?-1:1)));
    if(next===i)return;keys.splice(next,0,keys.splice(i,1)[0]);
    const nodes=new Map(rows(list).map(n=>[n.dataset.episode,n]));list.append(...keys.map(key=>nodes.get(key)));handle.focus({preventScroll:true});commit(keys);announce('Moved to position '+(next+1));
  });
  addEventListener('resize',()=>finish());addEventListener('pagehide',()=>finish());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish();});
  return ()=>finish();
}
