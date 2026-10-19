// A write identity and exact payload survive navigation and uncertain responses.
// Recovery is read-only. An explicit retry is enabled only after a successful
// lookup reports absence, and reuses the identical UUID and payload.
export function createBoardWrite({send,lookup,uuid=()=>crypto.randomUUID(),matches=(result,payload)=>result.id===payload.id&&result.body===payload.body&&result.replyTo===(payload.reply_to??null)}) {
 let pending=null,busy=false,absent=false;
 async function transmit(){busy=true;absent=false;try{const result=await send(pending);pending=null;return result;}finally{busy=false;}}
 return {
  get pending(){return pending;},get busy(){return busy;},get canRetry(){return !!pending&&absent&&!busy;},
  async submit(payload){
   if(busy||pending)throw Error('A board write is already pending.');
   pending=Object.freeze({id:uuid(),...payload});return transmit();
  },
  async reconcile(){
   if(busy||!pending)return null;busy=true;absent=false;
   try{const result=await lookup(pending.id);if(result){if(!matches(result,pending))throw Error('Stored message differs from pending text.');pending=null;}else absent=true;return result;}finally{busy=false;}
  },
  async retry(){if(!pending||!absent||busy)throw Error('Check the original write before retrying.');return transmit();}
 };
}
