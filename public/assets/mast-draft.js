// This tab's unsent intent only. Never persist history, credentials or file bytes.
export const MAST_DRAFT_KEY='jarvis.mast.draft.v1';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
export function createMastDraftStore(storage){
  const fail=()=>{const error=Error('Cannot retain the private draft. Restore browser storage or explicitly clear the local draft before sending.');error.name='MastDraftError';throw error;};
  return {
    read(device){
      try{
        const raw=storage?.getItem(MAST_DRAFT_KEY);if(!raw)return null;const r=JSON.parse(raw);
        if(r.version!==1||!uuid(r.device)||typeof r.body!=='string'||r.body.length>4000||!Number.isFinite(r.savedAt))return fail();
        if(r.device!==device){storage.removeItem(MAST_DRAFT_KEY);return null;}
        if(r.pending&&(!uuid(r.pending.id)||r.pending.body!==r.body||!Array.isArray(r.pending.files)||r.pending.files.length>4||r.pending.files.some(id=>!uuid(id))||new Set(r.pending.files).size!==r.pending.files.length))return fail();
        if(!r.pending&&Date.now()-r.savedAt>86400000){storage.removeItem(MAST_DRAFT_KEY);return null;}
        return r;
      }catch{return fail();}
    },
    save(device,body,pending){
      try{if(!storage||!uuid(device))return fail();this.read(device);if(!body&&!pending)storage.removeItem(MAST_DRAFT_KEY);else storage.setItem(MAST_DRAFT_KEY,JSON.stringify({version:1,device,body,pending,savedAt:Date.now()}));}catch{return fail();}
    },
    clear(){try{storage?.removeItem(MAST_DRAFT_KEY);}catch{return fail();}}
  };
}
