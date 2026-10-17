// Azure Static Web Apps managed Function. No token, URL, body, or headers in logs.
module.exports = async function (_context, req) {
  const {handleEgress} = await import('../shared/pinned-https.mjs');
  const result = await handleEgress({method: req.method, authorization: req.headers.authorization, rawBody: req.rawBody}, {token: process.env.RELAY_WEBHOOK_EGRESS_TOKEN});
  return {status: result.status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}, body: result.body};
};
