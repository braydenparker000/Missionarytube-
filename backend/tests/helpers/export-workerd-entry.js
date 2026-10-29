// Test-only Worker entry for export-workerd.test.js: the real Worker and Hub, plus a seed route on
// a Hub subclass, so the fixture tables are made without adding any write path to production.
import worker, {Hub} from '../../worker.js';

export class SeedHub extends Hub {
  async fetch(request) {
    if (new URL(request.url).pathname !== '/test/seed') return super.fetch(request);
    let written = 0;
    for (const [query, ...values] of await request.json()) written += this.ctx.storage.sql.exec(query, ...values).rowsWritten;
    // The same counter the export reports, shown to work here: seeding writes rows.
    return Response.json({written});
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/test/seed') return env.HUBS.get(env.HUBS.idFromName(url.searchParams.get('instance'))).fetch(request);
    return worker.fetch(request, env, ctx);
  },
};
