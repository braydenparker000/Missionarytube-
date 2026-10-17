// Local smoke server or an existing approved Node host behind an HTTPS proxy.
import {createServer} from 'node:http';
import {handleEgress} from './pinned-https.mjs';
export const server = createServer(async (req, res) => {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 400000) { res.writeHead(413); res.end(); return; }
    chunks.push(chunk);
  }
  const result = await handleEgress({method: req.method, authorization: req.headers.authorization, rawBody: Buffer.concat(chunks).toString('utf8')}, {token: process.env.RELAY_WEBHOOK_EGRESS_TOKEN});
  res.writeHead(result.status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(result.body));
});
if (process.argv[1] === new URL(import.meta.url).pathname) server.listen(Number(process.env.PORT || 8789), '127.0.0.1');
