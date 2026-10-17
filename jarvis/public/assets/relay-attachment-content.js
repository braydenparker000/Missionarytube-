// Linked private files are fetched with the existing bearer, never credential URLs.
// Private bytes remain in memory; no credential URLs or persistent file cache.
import {createFileDownload, nativeSaveMode, saveToDevice, triggerDownload} from './file-save.js';
export function createPrivateAttachmentContent({document:doc,read,inlineImages=false}={}){
  const views=new Map();
  const make=(tag,text='',className='')=>{const node=doc.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
  function row(item){
    const signature=JSON.stringify(item),existing=views.get(item.id);if(existing?.signature===signature)return existing.node;
    existing?.dispose();
    const node=make('section','','relay-linked-attachment'),name=make('p',item.name,'relay-attachment-name'),status=make('p',`${Math.ceil(item.sizeBytes/1024)} KB · Private file`,'request-meta'),controls=make('div','','relay-attachment-actions');
    status.setAttribute('role','status');node.append(name,status,controls);
    let active=null,previewURL=null,previewNode=null,disposed=false,observer=null,prepared=null,saving=false;const urls=new Set();
    const release=url=>{URL.revokeObjectURL(url);urls.delete(url);};
    const setBusy=value=>{for(const control of controls.children)if(control!==cancel)control.disabled=value;};
    function hide(){active?.abort();active=null;previewNode?.remove();previewNode=null;if(previewURL)release(previewURL);previewURL=null;if(previewButton){previewButton.textContent='Preview image';previewButton.setAttribute('aria-label','Preview '+item.name);}}
    async function load(preview){
      if(active||disposed)return;if(preview&&previewURL){hide();status.textContent='Preview closed';return;}
      const abort=new AbortController();active=abort;setBusy(true);cancel.hidden=false;status.textContent=preview?'Loading private preview…':'Preparing private download…';
      try{
        const blob=await read(item,{preview,signal:abort.signal});if(disposed||abort.signal.aborted)return;
        if(preview){const url=URL.createObjectURL(blob);urls.add(url);previewURL=url;previewNode=make('img');previewNode.alt='Preview of '+item.name;previewNode.src=url;previewNode.className='relay-linked-preview';node.insertBefore(previewNode,controls);previewButton.textContent='Close preview';previewButton.setAttribute('aria-label','Close preview of '+item.name);status.textContent='Private image preview';}
        else{prepared=createFileDownload(blob,item.name);open.href=prepared.url;direct.href=prepared.url;direct.download=prepared.name;open.hidden=false;direct.hidden=false;save.textContent=nativeSaveMode(prepared)==='share'?'Save / share file':'Save to Files';status.textContent='File ready. Tap Save to Files or Save / share file to choose an available destination, or Open file.';}
      }catch(error){if(!disposed&&!abort.signal.aborted)status.textContent=error?.name==='OwnerApiError'?error.message:'Could not read this private file. Check your connection and retry.';}
      finally{if(active===abort){active=null;if(!disposed){setBusy(false);cancel.hidden=true;}}}
    }
    const save=make('button','Save to Files','text-button');save.type='button';save.setAttribute('aria-label','Save to Files: '+item.name);
    const open=make('a','Open file','text-button');open.target='_blank';open.rel='noopener';open.hidden=true;open.setAttribute('aria-label','Open '+item.name);
    const direct=make('a','Direct download','text-button');direct.hidden=true;direct.setAttribute('aria-label','Download '+item.name);
    save.onclick=async()=>{
      if(disposed||active||saving)return;
      if(!prepared){await load(false);return;}
      saving=true;setBusy(true);open.hidden=true;direct.hidden=true;
      try{
        // No fetch/await before this call: the ready-file tap owns activation.
        const result=saveToDevice(prepared);
        const mode=await result;
        if(disposed)return;
        if(mode==='file-picker')status.textContent='File saved to the location you chose.';
        else if(mode==='share')status.textContent='File handed to the selected app. Saving there is not confirmed.';
        else status.textContent='Save/share is unavailable in this browser. Use Open file or Direct download; check browser Downloads.';
      }catch(error){if(!disposed)status.textContent=error?.name==='AbortError'?'Save cancelled. The file is still ready.':'Could not save or share. The file is ready; try Open file or Direct download.';}
      finally{saving=false;if(!disposed){setBusy(false);open.hidden=false;direct.hidden=false;}}
    };
    open.onclick=()=>{if(disposed||saving)return false;prepared.handoff();status.textContent='Open requested. Use the viewer’s save or download action; opening is not confirmed.';};
    direct.onclick=event=>{event.preventDefault();if(disposed||saving)return;triggerDownload(prepared,doc);status.textContent='Download requested. Check browser Downloads; saving is not confirmed.';};
    const cancel=make('button','Cancel','text-button');cancel.type='button';cancel.hidden=true;cancel.setAttribute('aria-label','Cancel file preparation');cancel.onclick=()=>{active?.abort();active=null;setBusy(false);cancel.hidden=true;status.textContent='Preparation cancelled. Tap Save to Files to retry.';};
    controls.append(save,open,direct,cancel);
    let previewButton;
    if(['image/png','image/jpeg','image/webp'].includes(item.mimeType)){previewButton=make('button','Preview image','text-button');previewButton.type='button';previewButton.setAttribute('aria-label','Preview '+item.name);previewButton.onclick=()=>load(true);controls.prepend(previewButton);}
    if(inlineImages&&previewButton&&doc.defaultView?.IntersectionObserver){observer=new doc.defaultView.IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load(true);}});observer.observe(node);}
    const view={node,signature,dispose(){disposed=true;observer?.disconnect();hide();prepared?.revoke();prepared=null;for(const url of urls)release(url);}};views.set(item.id,view);return node;
  }
  return {row,prune(){for(const [id,view]of views)if(!view.node.isConnected){view.dispose();views.delete(id);}},clear(){for(const view of views.values())view.dispose();views.clear();}};
}
