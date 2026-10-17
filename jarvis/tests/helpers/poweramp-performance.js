// Same-run synchronous setup summaries. Inclusive totals overlap; only a
// single create time is compared. These are never phone FPS or touch latency.
export const setupOperations=['shared.create','shared.clone','shared.snapshotPlan','shared.snapshotKeys','shared.snapshotCSS','shared.copyCanvas'];
export const setupImprovementLimit=.8;
export function median(values){
  if(!values.length||values.some(value=>!Number.isFinite(value)||value<0))throw Error('Expected finite nonnegative timing samples');
  const sorted=values.slice().sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
export function compareSetupModes(groups){
  const modes=Object.fromEntries(groups.map(group=>[group.mode,group]));
  if(!modes.baseline||!modes.compact)throw Error('Both exhaustive baseline and compact groups are required');
  const metric=(report,key)=>{
    const value=report.operations.find(operation=>operation.operation===key&&operation.phase==='shared:setup:expand');
    if(!value||!Number.isFinite(value.total_ms))throw Error('Missing real setup operation '+key);
    return value;
  };
  const samples=Object.fromEntries(Object.entries(modes).map(([mode,group])=>{
    const taps=group.reports.filter(report=>/^(first|warm-[12])-mini-tap$/.test(report.label));
    if(taps.length!==3||new Set(taps.map(report=>report.label)).size!==3)throw Error('Each mode requires first and two warm taps');
    return [mode,taps];
  }));
  const result={limit:setupImprovementLimit,scope:'Same candidate and serial browser process. First measured and two warm trusted taps per mode; medians are inclusive synchronous create times, not input latency. Group order is reversed for the second library size.',operations:{}};
  for(const key of setupOperations){
    const summary=Object.fromEntries(Object.entries(samples).map(([mode,taps])=>{
      const values=taps.map(report=>metric(report,key));
      return [mode,{inclusive_ms:values.map(value=>value.total_ms),self_ms:values.map(value=>value.self_ms),median_ms:median(values.map(value=>value.total_ms)),warm_median_ms:median(values.slice(1).map(value=>value.total_ms))}];
    }));
    result.operations[key]={...summary,medianRatio:summary.baseline.median_ms?summary.compact.median_ms/summary.baseline.median_ms:null,warmRatio:summary.baseline.warm_median_ms?summary.compact.warm_median_ms/summary.baseline.warm_median_ms:null};
  }
  const create=result.operations['shared.create'];result.materiallyImproved=create.medianRatio!==null&&create.warmRatio!==null&&create.medianRatio<=setupImprovementLimit&&create.warmRatio<=setupImprovementLimit;
  return result;
}
