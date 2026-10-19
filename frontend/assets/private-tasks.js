// A projection of existing records, not a queue. Identity is always agent + ID.
export async function readTaskPages(read){let cursor='0';const seen=new Set(),records=new Map();do{if(seen.has(cursor))throw Error('Task pagination did not advance.');seen.add(cursor);const page=await read(cursor);for(const job of page.jobs)records.set(job.id,job);cursor=page.nextCursor;}while(cursor!==null);return [...records.values()];}
export function taskStatus(agent,job){
 if(job.cancelRequested&&!['completed','cancelled','failed'].includes(job.stage))return 'Stop requested · not confirmed';
 if(job.completion&&job.latestResult?.version>job.completion.resultVersion)return 'Latest correction not confirmed complete';
 if(job.stage==='completed')return job.completion?'Completed · exact evidence below':'Finish not confirmed';
 return {queued:'Queued with '+agent,running:'In progress',waiting_for_owner:'Needs your input',failed:'Failed',cancelled:'Stopped',outcome_unknown:'Outcome unknown'}[job.stage]||'Status unknown';
}
