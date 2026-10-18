import {validateReport, canonical, legacyBody} from './schema.js';
// Call only from the existing authenticated publisher/importer, never public writes.
// sharedStore and sharedSchema are injected to retain the existing DO ownership.
export function publishReport(ctx, report, {sharedStore, sharedSchema, reviewedPublic=false}) {
  if(!reviewedPublic) return Response.json({error:'Public-content review required'}, {status:403});
  try { validateReport(report); } catch { return Response.json({error:'Invalid report'}, {status:400}); }
  sharedSchema(ctx);
  const payload=canonical(report);
  return ctx.storage.transactionSync(()=>{
    const rows=q=>[...ctx.storage.sql.exec(q,report.id)];
    const prior=rows('SELECT payload FROM daily_board_reports WHERE entry_id=?')[0];
    if(prior && prior.payload!==payload)return Response.json({error:'Report ID conflict'},{status:409});
    const response=sharedStore(ctx,'/internal/shared/briefing',{id:report.id,title:report.title,body:legacyBody(report),date:report.date});
    if(!response.ok)return response;
    // The legacy same-date reservation may identify another ID. Never attach to it.
    const entry=rows('SELECT id FROM shared_entries WHERE id=?')[0];
    if(!entry)return Response.json({error:'Report date already reserved'},{status:409});
    if(!prior)ctx.storage.sql.exec('INSERT INTO daily_board_reports(entry_id,payload) VALUES(?,?)',report.id,payload);
    return Response.json({id:report.id,report:JSON.parse(payload)}, {status:prior?200:201});
  });
}
export function readReport(ctx,id) {
  const row=[...ctx.storage.sql.exec("SELECT r.payload FROM daily_board_reports r JOIN shared_entries e ON e.id=r.entry_id WHERE e.id=? AND e.kind='briefing'",id)][0];
  if(!row)return null;
  try{return validateReport(JSON.parse(row.payload));}catch{return null;}
}
