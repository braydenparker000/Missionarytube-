let input;
self.onmessage=function({data}){
  if(data.type==='start'){input={...data,queue:[],saved:data.saved?{...data.saved}:null};return;}
  if(!input)return;
  if(data.type==='tracks'){input.queue.push(...data.value);return;}
  if(data.type==='saved'){if(!input.saved[data.field])input.saved[data.field]=[];input.saved[data.field].push(...data.value);return;}
  if(data.type!=='finish')return;
  try{
    const state=new ShuffleCycle(input.queue,input.mode,input.saved);
    if(input.seedIndex>=0&&state.cursor<0)state.select(input.seedIndex);
    if(input.cycle){
      const work=state.cycleWork();let step;while(!(step=work.next()).done){}
      state.ranks=step.value;state.numericRanks=state.ranks.map(k=>state.indices.get(k));state.rankJSON=JSON.stringify(state.numericRanks);
    }else if(Number.isInteger(input.anchor)){
      const at=state.numericRanks.indexOf(input.anchor);
      if(at>=0){if(input.mode===1){state.ranks.unshift(...state.ranks.splice(at,1));state.numericRanks.unshift(...state.numericRanks.splice(at,1));}else{state.ranks.push(...state.ranks.splice(0,at));state.numericRanks.push(...state.numericRanks.splice(0,at));}state.rankJSON=JSON.stringify(state.numericRanks);}
    }
    for(let i=0;i<state.numericRanks.length;i+=256)self.postMessage({type:'ranks',value:state.numericRanks.slice(i,i+256)});
    for(const field of ['idsJSON','rankJSON','canonicalJSON'])for(let i=0;i<state[field].length;i+=8192)self.postMessage({type:'json',field,value:state[field].slice(i,i+8192)});
    self.postMessage({type:'done',mode:state.mode,cursor:state.cursor,consumed:state.packedConsumed,history:state.packedHistory,recent:state.recent});
  }catch(error){self.postMessage({type:'failed',message:error?.message||'Shuffle generation failed'});}
  input=null;
};
