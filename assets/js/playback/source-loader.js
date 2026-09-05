/* Resolve providers independently without changing their declared order. */
(function(global){
  'use strict';
  function create({providers,load,onUpdate}){
    const controller=new AbortController();
    const slots=providers.map(()=>({state:'loading',streams:[]}));
    function snapshot(){return {pending:slots.filter(s=>s.state==='loading').length,failed:slots.filter(s=>s.state==='failed').length,streams:slots.flatMap(s=>s.streams)};}
    const done=Promise.allSettled(providers.map(async(provider,order)=>{
      try{slots[order]={state:'ready',streams:await load(provider,order,controller.signal)};}
      catch(error){slots[order]={state:'failed',streams:[]};}
      if(!controller.signal.aborted)onUpdate(snapshot());
    })).then(snapshot);
    return {done,snapshot,cancel:()=>controller.abort()};
  }
  global.AstraPlayback=global.AstraPlayback||{};
  global.AstraPlayback.sourceLoader={create};
})(globalThis);
