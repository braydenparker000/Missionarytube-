// One artwork transition at a time. Network requests never wait for motion.
export function coverNavigation(){
  let pending=null,animation=null,proxy=null,destination=null,timer;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cancel(){clearTimeout(timer);animation?.cancel();animation=null;proxy?.remove();proxy=null;if(destination)destination.style.visibility='';destination=null;pending=null;}
  function capture(image,key){
    cancel();if(reduced()||!image?.complete||!image.naturalWidth)return;
    const rect=image.getBoundingClientRect();if(rect.bottom<0||rect.top>innerHeight)return;
    pending={rect,src:image.currentSrc,key,time:performance.now()};
    // Stale network results fall back to an ordinary reveal, without a flying
    // image lingering over the loading state.
    timer=setTimeout(cancel,450);
  }
  function connect(image,key){
    if(!pending||pending.key!==key||!image||reduced()||!image.animate){cancel();return;}
    const start=pending,rect=image.getBoundingClientRect();
    if(image.src!==start.src){cancel();return;}
    if(rect.bottom<0||rect.top>innerHeight||performance.now()-start.time>450){cancel();return;}
    clearTimeout(timer);pending=null;destination=image;
    proxy=document.createElement('img');proxy.src=start.src;proxy.alt='';proxy.setAttribute('aria-hidden','true');
    Object.assign(proxy.style,{position:'fixed',pointerEvents:'none',zIndex:'6',top:rect.top+'px',left:rect.left+'px',width:rect.width+'px',height:rect.height+'px',objectFit:'cover',borderRadius:'12px',transformOrigin:'top left'});
    document.body.append(proxy);image.style.visibility='hidden';
    const a=proxy.animate([{transform:`translate(${start.rect.left-rect.left}px,${start.rect.top-rect.top}px) scale(${start.rect.width/rect.width})`},{transform:'none'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});animation=a;
    a.finished.then(()=>{if(animation===a)cancel();}).catch(()=>{});
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',cancel);
  addEventListener('resize',cancel);addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  return {capture,connect,cancel};
}
