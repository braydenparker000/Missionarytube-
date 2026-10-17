// Linked private files are fetched with the existing bearer, never credential URLs.
// Documents are downloads only. Object URLs and in-flight reads belong to this view.
export function createPrivateAttachmentContent({document:doc,read}={}){
  const views=new Map();
  const make=(tag,text='',className='')=>{const node=doc.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
  function row(item){
    const signature=JSON.stringify(item),existing=views.get(item.id);if(existing?.signature===signature)return existing.node;
    existing?.dispose();
    const node=make('section','','relay-linked-attachment'),name=make('p',item.name,'relay-attachment-name'),status=make('p',`${Math.ceil(item.sizeBytes/1024)} KB · Private file`,'request-meta'),controls=make('div','','relay-attachment-actions');
    status.setAttribute('role','status');node.append(name,status,controls);
    let active=null,previewURL=null,previewNode=null,disposed=false;const urls=new Set(),timers=new Set();
    const release=url=>{URL.revokeObjectURL(url);urls.delete(url);};
    const setBusy=value=>{for(const control of controls.children)control.disabled=value;};
    function hide(){active?.abort();active=null;previewNode?.remove();previewNode=null;if(previewURL)release(previewURL);previewURL=null;if(previewButton){previewButton.textContent='Preview image';previewButton.setAttribute('aria-label','Preview '+item.name);}}
    async function load(preview){
      if(active||disposed)return;if(preview&&previewURL){hide();status.textContent='Preview closed';return;}
      const abort=new AbortController();active=abort;setBusy(true);status.textContent=preview?'Loading private preview…':'Preparing private download…';
      try{
        const blob=await read(item,{preview,signal:abort.signal});if(disposed||abort.signal.aborted)return;
        const url=URL.createObjectURL(blob);urls.add(url);
        if(preview){previewURL=url;previewNode=make('img');previewNode.alt='Preview of '+item.name;previewNode.src=url;previewNode.className='relay-linked-preview';node.insertBefore(previewNode,controls);previewButton.textContent='Close preview';previewButton.setAttribute('aria-label','Close preview of '+item.name);status.textContent='Private image preview';}
        else{const link=make('a');link.href=url;link.download=item.name;link.rel='noopener';link.hidden=true;node.append(link);link.click();link.remove();status.textContent='Download started';const timer=setTimeout(()=>{release(url);timers.delete(timer);},1000);timers.add(timer);}
      }catch(error){if(!disposed&&!abort.signal.aborted)status.textContent=error?.name==='OwnerApiError'?error.message:'Could not read this private file. Check your connection and retry.';}
      finally{if(active===abort){active=null;if(!disposed)setBusy(false);}}
    }
    const download=make('button','Download','text-button');download.type='button';download.setAttribute('aria-label','Download '+item.name);download.onclick=()=>load(false);controls.append(download);
    let previewButton;
    if(['image/png','image/jpeg','image/webp'].includes(item.mimeType)){previewButton=make('button','Preview image','text-button');previewButton.type='button';previewButton.setAttribute('aria-label','Preview '+item.name);previewButton.onclick=()=>load(true);controls.prepend(previewButton);}
    const view={node,signature,dispose(){disposed=true;hide();for(const timer of timers)clearTimeout(timer);for(const url of urls)release(url);}};views.set(item.id,view);return node;
  }
  return {row,prune(){for(const [id,view]of views)if(!view.node.isConnected){view.dispose();views.delete(id);}},clear(){for(const view of views.values())view.dispose();views.clear();}};
}
