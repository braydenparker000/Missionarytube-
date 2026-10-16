// Private, bounded, non-authorizing observations. Never pass request bodies,
// OAuth values, credential hashes, URLs or exception messages into this module.
const TTL = 15 * 60 * 1000;
const LIMIT = 100;
const EVENTS = 12;
export const diagnosticId = kind => { try { return `${kind}_${crypto.randomUUID()}`; } catch { return undefined; } };
export const validDiagnosticId = (value, kind) => typeof value === 'string' && new RegExp(`^${kind}_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`).test(value);
const outcomes = {
  consent_put: ['ok', 'capacity', 'storage_error'],
  consent_consume: ['ok', 'not_found', 'expired', 'binding_mismatch', 'storage_error'],
  grant_authorize: ['ok', 'rejected', 'storage_error'],
  redirect_constructed: ['302'],
  continuation_constructed: ['200'],
};
export function recordMakimaDiagnostic(ctx, observation, now) {
  try {
    const {flowId, requestId, stage, outcome, verified, create = false} = observation || {};
    if (!validDiagnosticId(flowId, 'mf') || !validDiagnosticId(requestId, 'mr') || !outcomes[stage]?.includes(outcome) || !Number.isSafeInteger(now)) return;
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS makima_oauth_diagnostics (flow_id TEXT PRIMARY KEY, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, event_count INTEGER NOT NULL, events TEXT NOT NULL)');
    ctx.storage.transactionSync(() => {
      sql.exec('DELETE FROM makima_oauth_diagnostics WHERE expires_ms<=?', now);
      const existing = [...sql.exec('SELECT * FROM makima_oauth_diagnostics WHERE flow_id=?', flowId)][0];
      // Submitted correlation IDs never allocate rows or establish authorization.
      if (!existing && (!create || stage !== 'consent_put' || outcome !== 'ok' || verified !== true)) return;
      if (!existing && [...sql.exec('SELECT COUNT(*) AS n FROM makima_oauth_diagnostics')][0].n >= LIMIT) return;
      const event = {request_id: requestId, at_ms: now, stage, outcome, correlation: verified === true ? 'store_verified' : 'submitted_unverified', build: 'makima-diagnostic-v1'};
      const events = existing ? JSON.parse(existing.events) : [];
      if (!Array.isArray(events)) return;
      events.push(event);
      // Failed or submitted-only correlations cannot evict the successful
      // store lifecycle. Keep the remaining recent observations bounded.
      const trustedLifecycle = event => event.correlation === 'store_verified' &&
        (event.stage === 'consent_put' && event.outcome === 'ok' ||
         event.stage === 'consent_consume' && event.outcome === 'ok' ||
         event.stage === 'grant_authorize' || event.stage === 'redirect_constructed' || event.stage === 'continuation_constructed');
      while (events.length > EVENTS) {
        const discard = events.findIndex(event => !trustedLifecycle(event));
        if (discard < 0) return; // Unexpected shape: preserve stored evidence.
        events.splice(discard, 1);
      }
      sql.exec('INSERT OR REPLACE INTO makima_oauth_diagnostics VALUES(?,?,?,?,?)', flowId, existing?.created_ms ?? now, existing?.expires_ms ?? now + TTL, Math.min((existing?.event_count || 0) + 1, 1000000), JSON.stringify(events));
    });
  } catch { /* Diagnostics must never determine an OAuth result. */ }
}

const tokenOutcomes = {
  token_request: ['received'],
  token_result: ['content_type_rejected', 'duplicate_parameter_rejected', 'resource_rejected', 'credential_format_rejected', 'scope_rejected', 'unsupported_grant_type', 'exchange_rejected', 'issued', 'processing_error', 'disabled', 'token_origin_rejected'],
};
export function recordMakimaTokenDiagnostic(ctx, observation, now) {
  try {
    // These IDs and the start time are generated independently at ingress, not
    // copied from any OAuth input or correlated with a consent/grant/token.
    const {requestId, startedAt, stage, outcome} = observation || {};
    if (!validDiagnosticId(requestId, 'mt') || !tokenOutcomes[stage]?.includes(outcome)
      || !Number.isSafeInteger(now) || !Number.isSafeInteger(startedAt) || startedAt < 0 || startedAt > now) return;
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS makima_token_diagnostics (request_id TEXT PRIMARY KEY, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, at_ms INTEGER NOT NULL, stage TEXT NOT NULL, outcome TEXT NOT NULL, build TEXT NOT NULL)');
    ctx.storage.transactionSync(() => {
      // As with consent observations, expiry is logical and deletion happens
      // on the next write. Delayed results cannot restart the retention window.
      sql.exec('DELETE FROM makima_token_diagnostics WHERE expires_ms<=?', now);
      if (startedAt + TTL <= now) return;
      const existing = [...sql.exec('SELECT * FROM makima_token_diagnostics WHERE request_id=?', requestId)][0];
      // Independent background writes can arrive out of order. A received
      // event or duplicate result must not overwrite the first terminal result.
      if (existing && (existing.created_ms !== startedAt || existing.stage === 'token_result' || stage === 'token_request')) return;
      if (!existing && [...sql.exec('SELECT COUNT(*) AS n FROM makima_token_diagnostics')][0].n >= LIMIT) return;
      sql.exec('INSERT OR REPLACE INTO makima_token_diagnostics VALUES(?,?,?,?,?,?,?)', requestId, startedAt, startedAt + TTL, now, stage, outcome, 'makima-token-diagnostic-v1');
    });
  } catch { /* Diagnostics must never determine an OAuth result. */ }
}
