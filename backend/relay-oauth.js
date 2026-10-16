import {diagnosticId, validDiagnosticId, recordMakimaDiagnostic, recordMakimaTokenDiagnostic} from './relay-makima-diagnostics.js';
// OAuth 2.1 broker. GitHub authenticates the one owner; public Relay keys are never identity.
import {RELAY_PUBLIC_SCOPES, RELAY_OWNER_SCOPE, RELAY_CALLBACK, random, hash, challenge, equal, boundedText, isObject, json, relayIssuer} from './relay-common.js';
import {relayOAuthPolicy as DEFAULT_POLICY} from './relay-oauth-policy.js';
const SESSION_MS = 600000;
const ACCESS_MS = 3600000;
const DEFAULT_REFRESH_DAYS = 30;
const REFRESH_DAYS = [DEFAULT_REFRESH_DAYS, 365];
// Public DCR identity is not a session or bearer credential. ChatGPT registers
// once per connection and reuses the client even after a cancelled first login.
const CLIENT_EXPIRY = Number.MAX_SAFE_INTEGER;
const cookieHeader = (value, age = 600, policy = DEFAULT_POLICY) => `${policy.cookie}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const cookie = (request, policy = DEFAULT_POLICY) => request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(policy.cookie + '='))?.slice(policy.cookie.length + 1);
const scopes = (value, policy = DEFAULT_POLICY) => typeof value === 'string' && value.length > 0 && value.split(' ').every(x => policy.scopes.includes(x)) && new Set(value.split(' ')).size === value.split(' ').length;
const oauthError = (error = 'invalid_request', status = 400, description) => json({error, ...(description ? {error_description: description} : {})}, status);
const registry = async (env, body, policy = DEFAULT_POLICY) => {
  const r = await env.HUBS.get(env.HUBS.idFromName(policy.registry)).fetch(new Request('https://internal/internal' + policy.path + '/oauth', {method: 'POST', body: JSON.stringify(body)}));
  if (!r.ok) throw Error('OAuth storage unavailable');
  return r.json();
};
const read = (env, key, policy = DEFAULT_POLICY) => registry(env, {op: 'get', key}, policy).then(x => x.value);
const put = (env, key, value, expiresAt, category, policy = DEFAULT_POLICY) => registry(env, {op: 'put', key, value, expiresAt, category}, policy);
const consume = (env, key, match = {}, policy = DEFAULT_POLICY, diagnostic) => registry(env, {op: 'consume', key, match, ...(diagnostic ? {diagnostic} : {})}, policy);
function authParamsError(b, client, env, policy) {
  // Fixed diagnostic codes only: never echo IDs, URIs, state, PKCE or input.
  if (!client || !b.client_id) return 'client_not_registered';
  if (b.redirect_uri !== client.redirect) return 'redirect_uri_mismatch';
  if (b.response_type !== 'code') return 'unsupported_response_type';
  if (b.code_challenge_method !== 'S256') return 'pkce_s256_required';
  if (typeof b.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.code_challenge)) return 'invalid_code_challenge';
  if (b.resource !== policy.resource(env)) return 'resource_mismatch';
  if (typeof b.state !== 'string' || b.state.length === 0 || b.state.length > 2048) return 'invalid_state';
  if (!scopes(b.scope, policy)) return 'invalid_scope';
  return null;
}
const redirect = (url, headers = {}) => new Response(null, {status: 302, headers: {Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers}});
function oauthRedirect(p, env, params, policy) {
  const url = new URL(p.redirect_uri);
  for (const [k, v] of Object.entries({...params, state: p.state, iss: relayIssuer(env) + policy.path})) url.searchParams.set(k, v);
  // A delayed terminal response must not delete a newer Makima flow's shared
  // cookie. Consumed login/consent records remain unusable until cookie expiry.
  return redirect(url.href, policy.retainTerminalCookie ? {} : {'Set-Cookie': cookieHeader('', 0, policy)});
}
function consentReturn(p, env, params, policy) {
  const response = oauthRedirect(p, env, params, policy);
  if (!policy.consentContinuation) return response;
  // A committed document and a new user-tapped link end the form-navigation
  // chain. Keep the exact registered callback; never accept a submitted target.
  if (p.redirect_uri !== policy.callback) throw Error('Invalid consent callback');
  const href = response.headers.get('Location').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const headers = new Headers(response.headers);
  headers.delete('Location');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Content-Security-Policy', "default-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Continue to Makima</title><body><h1>Continue to Makima</h1><p>Your decision was saved. Tap the link to return to Makima.</p><a id="makima-oauth-continue" href="${href}" rel="noreferrer" referrerpolicy="no-referrer">Continue to Makima</a></body></html>`, {headers});
}
function consentPage(csrf, scope, policy, flowId, params) {
  // No upstream content or input enters the fixed optional script.
  // CSRF is random lowercase hex. The restart URL encodes validated parameters.
  const guard = policy.consentGuard;
  const restart = guard ? policy.path + '/oauth/authorize?' + new URLSearchParams(params).toString().replace(/&/g, '&amp;') : '';
  // no-referrer makes browser form POSTs send Origin:null. Keep same-origin
  // Origin validation and suppress referrers across origins. Chrome also checks
  // form-action on redirects, so include the fixed OAuth return destination.
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Jarvis Relay</title><body><h1>Connect Jarvis Relay</h1>${policy.consentText || ''}${scope.split(' ').some(s=>RELAY_PUBLIC_SCOPES.includes(s)) ? '<p>Allow ChatGPT to read the public Relay inbox, post replies in that inbox, and subscribe to new messages. Public messages are unverified visitor content. This connection does not authorize account actions or secret sharing.</p>' : '<p>Connect only the separately listed capabilities below. This scope alone grants no public inbox or owner-history access.</p>'}${scope.split(' ').includes('relay:agents-lucy') ? '<p><strong>Private Lucy–Muse channel:</strong> Allow this connection to act as Lucy, reading and sending existing/future text and files in the separate private Lucy–Muse channel. This does not authorize owner-history access, project actions, or sharing owner conversations with Muse. Confirm this connection is Lucy; never give its credential to Muse.</p>' : ''}${scope.split(' ').includes(RELAY_OWNER_SCOPE) ? '<p><strong>Owner chat access:</strong> Allow ChatGPT to inspect and approve individual phone pairing requests, list and revoke paired devices, read and reply in your private owner inbox, and subscribe to private message events. Each phone approval separately grants persistent device access with a 365-day inactivity expiry renewed on use. Private replies stay outside the public inbox. This connection alone does not pair a phone or approve account actions.</p>' : ''}<form method="post" action="${policy.path}/oauth/approve"><input type="hidden" name="csrf" value="${csrf}">${flowId ? `<input type="hidden" name="diagnostic_id" value="${flowId}">` : ''}<fieldset><legend>How long may ${policy.clientName || 'ChatGPT'} renew this connection?</legend><label><input type="radio" name="refresh_days" value="30" checked>30 days (default)</label> <label><input type="radio" name="refresh_days" value="365">365 days</label><p>Choosing 365 days authorizes ${policy.clientName || 'ChatGPT'} to renew this Relay connection for up to 365 days from this approval. Access tokens last at most one hour. Renewing does not extend the chosen expiry. A stolen refresh token could let someone renew this access until expiry or revocation. You can revoke the connection sooner. ${policy.clientName || 'ChatGPT'} may require reconnection earlier; this does not guarantee that ${policy.clientName || 'ChatGPT'} will retain the connection for the full period.</p></fieldset><button name="decision" value="allow">Allow this connection</button> <button name="decision" value="deny">Cancel</button></form>${guard ? `<p id="makima-submit-status" role="status" hidden>Sending your decision. If navigation stopped, <a href="${restart}">start this connection again</a>.</p><p id="makima-navigation-status" role="status" hidden>The browser blocked the return navigation under this page’s security policy.</p><script>${guard.script}</script>` : ''}</body></html>`, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; form-action 'self' ${[policy.callback, ...(policy.formActionRedirects || [])].join(' ')}; frame-ancestors 'none'; base-uri 'none'${guard ? `; script-src '${guard.hash}'` : ''}`, 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff'}});
}
export async function relayGrantActive(env, grantId, requiredScope, policy = DEFAULT_POLICY) {
  if (!policy.enabled(env) || typeof grantId !== 'string') return false;
  const grant = await read(env, 'grant:' + grantId, policy);
  return !!grant && (!policy.staticClient || grant.client_id===policy.staticClient(env)) && grant.principal === policy.principal && !grant.revoked && grant.expiresAt > Date.now() && grant.resource === policy.resource(env) && (!requiredScope || grant.scope.split(' ').includes(requiredScope));
}
function localValue(ctx,key,now=Date.now()){
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay_oauth (key TEXT PRIMARY KEY, category TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  const row=[...ctx.storage.sql.exec('SELECT value FROM relay_oauth WHERE key=? AND expires_at>?',key,now)][0];
  return row?JSON.parse(row.value):null;
}
export function relayGrantActiveInStore(ctx,env,grantId,requiredScope,policy=DEFAULT_POLICY){
  if(!policy.enabled(env)||typeof grantId!=='string')return false;
  const grant=localValue(ctx,'grant:'+grantId);
  return !!grant&&(!policy.staticClient||grant.client_id===policy.staticClient(env))&&!grant.revoked&&grant.principal===policy.principal&&grant.resource===policy.resource(env)&&(!requiredScope||grant.scope.split(' ').includes(requiredScope));
}
export function relayTokenActiveInStore(ctx,env,principal,requiredScope,policy=DEFAULT_POLICY){
  if(principal.principal!==policy.principal||typeof principal.accessHash!=='string')return false;
  const token=localValue(ctx,'access:'+principal.accessHash);
  return !!token&&(!policy.staticClient||token.client_id===policy.staticClient(env)&&token.resource===policy.resource(env))&&token.grantId===principal.grantId&&(!requiredScope||token.scope.split(' ').includes(requiredScope))&&relayGrantActiveInStore(ctx,env,principal.grantId,requiredScope,policy);
}
// Readiness inspection must not initialize or clean up the OAuth registry.
export function relayReadOnlyPrincipal(ctx, env, accessHash, now = Date.now(), policy = DEFAULT_POLICY) {
  if (!policy.enabled(env) || !/^[a-f0-9]{64}$/.test(accessHash || '')) return null;
  const readExisting = (key, category) => {
    const row = [...ctx.storage.sql.exec('SELECT category,value,expires_at FROM relay_oauth WHERE key=?',key)][0];
    if (!row) return null;
    if (row.category !== category || !Number.isSafeInteger(row.expires_at)) throw Error('Invalid OAuth storage');
    const value = JSON.parse(row.value);
    if (!isObject(value) || !scopes(value.scope, policy)) throw Error('Invalid OAuth storage');
    return row.expires_at > now ? value : null;
  };
  const token = readExisting('access:'+accessHash,'access');
  if (!token || typeof token.client_id !== 'string' || !token.client_id || typeof token.grantId !== 'string' || !token.grantId || token.resource !== policy.resource(env) || policy.staticClient && token.client_id !== policy.staticClient(env)) return null;
  const grant = readExisting('grant:'+token.grantId,'grant');
  if (!grant || grant.revoked !== false || grant.principal !== policy.principal || grant.resource !== policy.resource(env)
    || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now || token.client_id !== grant.client_id
    || token.scope.split(' ').some(scope=>!grant.scope.split(' ').includes(scope))) return null;
  return {principal:policy.principal,grantId:token.grantId,scopes:token.scope.split(' '),accessHash};
}
export async function relayAuthenticate(request, env, readOnly = false, policy = DEFAULT_POLICY) {
  if (!policy.enabled(env)) return null;
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const accessHash=await hash(token);
  if(readOnly)return (await registry(env,{op:'authenticate-readonly',accessHash},policy)).principal;
  const value = await read(env, 'access:' + accessHash, policy);
  if (!value || policy.staticClient && (value.client_id !== policy.staticClient(env) || value.resource !== policy.resource(env)) || !await relayGrantActive(env, value.grantId, undefined, policy)) return null;
  return {principal: policy.principal, grantId: value.grantId, scopes: value.scope.split(' '),accessHash};
}
export async function relayOAuth(request, env, fetcher = fetch, policy = DEFAULT_POLICY, executionCtx) {
  const url = new URL(request.url), path = url.pathname, issuer = relayIssuer(env), resource = policy.resource(env);
  const requestId = policy.consentDiagnostics ? diagnosticId('mr') : undefined;
  const err = (...args) => {
    const response = oauthError(...args);
    if (requestId) response.headers.set('X-Jarvis-OAuth-Diagnostic-Id', requestId);
    return response;
  };
  let tokenDiagnostic;
  if (policy.consentDiagnostics && policy.path === '/relay/makima' && path === policy.path + '/oauth/token' && request.method === 'POST') {
    try { tokenDiagnostic = {requestId: diagnosticId('mt'), startedAt: Date.now()}; } catch {}
  }
  const reportToken = outcome => {
    try {
      if (!tokenDiagnostic?.requestId) return;
      const task = registry(env, {op: 'token-diagnostic', diagnostic: {...tokenDiagnostic, stage: outcome === 'received' ? 'token_request' : 'token_result', outcome}}, policy).catch(() => {});
      // Best effort only: neither diagnostics nor a missing execution context
      // can delay token validation, rejection or issuance.
      if (executionCtx?.waitUntil) executionCtx.waitUntil(task);
    } catch {}
  };
  const tokenError = (outcome, ...args) => {
    const response = err(...args); reportToken(outcome); return response;
  };
  const reportConsentReturn = async (flowId, status) => {
    if (!requestId || !validDiagnosticId(flowId, 'mf')) return;
    const stage = status === 200 ? 'continuation_constructed' : 'redirect_constructed', outcome = status === 200 ? '200' : '302';
    const task = registry(env, {op: 'diagnostic', diagnostic: {flowId, requestId, stage, outcome, verified: true}}, policy).catch(() => {});
    if (executionCtx?.waitUntil) { try { executionCtx.waitUntil(task); } catch {} }
    else await task; // Local fixtures have no execution context.
  };
  // Login redirects may arrive after a newer consent page. Separate Makima
  // phases so a delayed authorize response cannot replace its consent cookie.
  const loginPolicy = policy.loginCookie ? {...policy, cookie: policy.loginCookie} : policy;
  const githubClientId = policy.githubClientId ? policy.githubClientId(env) : env.RELAY_GITHUB_CLIENT_ID;
  const githubClientSecret = policy.githubClientSecret ? policy.githubClientSecret(env) : env.RELAY_GITHUB_CLIENT_SECRET;
  const protectedPath = '/.well-known/oauth-protected-resource' + policy.path + '/mcp';
  const metadataPath = '/.well-known/oauth-authorization-server' + policy.path;
  if (!(path.startsWith(policy.path + '/oauth/') || path === protectedPath || path === metadataPath)) return null;
  reportToken('received');
  if (!policy.enabled(env)) return tokenError('disabled', 'temporarily_unavailable', 503);
  if (path === protectedPath && request.method === 'GET') return json({resource, authorization_servers: [issuer + policy.path], scopes_supported: policy.scopes});
  if (path === metadataPath && request.method === 'GET') return json({issuer: issuer + policy.path, authorization_endpoint: issuer + policy.path + '/oauth/authorize', token_endpoint: issuer + policy.path + '/oauth/token', ...(policy.staticClient ? {} : {registration_endpoint: issuer + policy.path + '/oauth/register'}), revocation_endpoint: issuer + policy.path + '/oauth/revoke', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true, scopes_supported: policy.scopes});
  let processingFailure;
  try {
    if (path === policy.path + '/oauth/register' && request.method === 'POST') {
      if (policy.staticClient) return err('invalid_client_metadata');
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return err('invalid_client_metadata');
      const b = JSON.parse(await boundedText(request));
      if (!isObject(b) || !Array.isArray(b.redirect_uris) || b.redirect_uris.length !== 1 || b.redirect_uris[0] !== RELAY_CALLBACK
        || b.token_endpoint_auth_method && b.token_endpoint_auth_method !== 'none'
        || b.grant_types && (!Array.isArray(b.grant_types) || b.grant_types.some(x => !['authorization_code', 'refresh_token'].includes(x)))
        || b.response_types && (!Array.isArray(b.response_types) || b.response_types.some(x => x !== 'code'))) return err('invalid_client_metadata');
      const limited = await registry(env, {op: 'rate', identity: await hash(request.headers.get('CF-Connecting-IP') || 'unknown')});
      if (limited.error) return err('temporarily_unavailable', 429);
      // Keep this exact-callback public identity valid for the connection. Rate
      // limits still bound DCR; identical public client instances share a known
      // registered identity, never a grant. Reuse and creation are atomic.
      const stored = await registry(env, {op: 'register', client_id: random()});
      if (!stored.client_id) return err('temporarily_unavailable', 503);
      const client_id = stored.client_id;
      return json({client_id, redirect_uris: [RELAY_CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']}, 201);
    }
    if (path === policy.path + '/oauth/authorize' && request.method === 'GET') {
      if (!githubClientId || !githubClientSecret) return err('temporarily_unavailable', 503);
      const p = Object.fromEntries(url.searchParams); p.scope ||= policy.defaultScopes.join(' ');
      if ([...url.searchParams.keys()].some(k => url.searchParams.getAll(k).length !== 1)) return err('invalid_request', 400, 'duplicate_parameter');
      const issue = authParamsError(p, await read(env, 'client:' + p.client_id, policy), env, policy);
      if (issue) return err('invalid_request', 400, issue);
      const state = random(), browser = random(), verifier = random();
      const stored = await put(env, 'login:' + await hash(state), {p, browser: await hash(browser), verifier}, Date.now() + SESSION_MS, 'session', policy);
      if (stored.error) return err('temporarily_unavailable', 503);
      const github = new URL('https://github.com/login/oauth/authorize');
      github.search = new URLSearchParams({client_id: githubClientId, redirect_uri: issuer + policy.path + '/oauth/github/callback', state, code_challenge: await challenge(verifier), code_challenge_method: 'S256', allow_signup: 'false', scope: ''});
      return redirect(github.href, {'Set-Cookie': cookieHeader(browser, 600, loginPolicy)});
    }
    if (path === policy.path + '/oauth/github/callback' && request.method === 'GET') {
      processingFailure = 'github_callback_processing_failed';
      if([...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))return err('invalid_request', 400, 'callback_duplicate_parameter');
      const state = url.searchParams.get('state'), browser = cookie(request, loginPolicy);
      if (!/^[a-f0-9]{64}$/.test(state || '')) return err('invalid_request', 400, 'callback_state_invalid');
      if (browser === undefined) return err('invalid_request', 400, 'login_cookie_missing');
      if (!/^[a-f0-9]{64}$/.test(browser)) return err('invalid_request', 400, 'login_cookie_invalid');
      processingFailure = 'login_registry_unavailable';
      const consumed = await consume(env, 'login:' + await hash(state), {browser: await hash(browser)}, policy), login = consumed.value;
      if (!login) return err('invalid_request', 400, consumed.reason === 'binding_mismatch' ? 'login_cookie_mismatch' : 'login_state_expired_or_used');
      if (url.searchParams.has('error')) return oauthRedirect(login.p, env, {error: 'access_denied'}, policy);
      const code = url.searchParams.get('code');
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(code)) return err('invalid_request', 400, 'github_code_invalid');
      processingFailure = 'github_token_exchange_unavailable';
      // Workers rejects redirect:'error'. Manual never forwards credentials to
      // a redirect target; the existing !ok checks below reject every 3xx.
      const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: new URLSearchParams({client_id: githubClientId, client_secret: githubClientSecret, code, redirect_uri: issuer + policy.path + '/oauth/github/callback', code_verifier: login.verifier}).toString()});
      if (!tokenResponse.ok) return err('temporarily_unavailable', 503, 'github_token_endpoint_error');
      processingFailure = 'github_token_response_invalid';
      const githubToken = JSON.parse(await boundedText(tokenResponse, 65536));
      if (typeof githubToken.access_token !== 'string' || githubToken.access_token.length > 1000 || githubToken.token_type?.toLowerCase() !== 'bearer') return err('access_denied', 403, 'github_authorization_failed');
      processingFailure = 'github_identity_lookup_unavailable';
      const userResponse = await fetcher('https://api.github.com/user', {redirect: 'manual', signal: AbortSignal.timeout(10000), headers: {Authorization: 'Bearer ' + githubToken.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'jarvis-relay-identity'}});
      if (!userResponse.ok) return err('access_denied', 403, 'github_identity_endpoint_error');
      processingFailure = 'github_identity_response_invalid';
      const user = JSON.parse(await boundedText(userResponse, 65536));
      // Upstream token is never persisted or forwarded to the MCP client.
      if (user.id !== 183016859) return err('access_denied', 403, 'github_owner_not_allowed');
      const csrf = random(), session = random();
      const flowId = requestId ? diagnosticId('mf') : undefined;
      processingFailure = 'consent_registry_unavailable';
      const stored = await put(env, 'consent:' + await hash(session), {p: login.p, csrf, ...(flowId ? {diagnosticId: flowId, diagnosticRequestId: requestId} : {})}, Date.now() + SESSION_MS, 'session', policy);
      if (stored.error) return err('temporarily_unavailable', 503, 'consent_capacity_unavailable');
      processingFailure = 'consent_response_unavailable';
      const response = consentPage(csrf, login.p.scope, policy, flowId, login.p), headers = new Headers(response.headers); headers.set('Set-Cookie', cookieHeader(session, 600, policy));
      return new Response(response.body, {status: 200, headers});
    }
    if (path === policy.path + '/oauth/approve' && request.method === 'POST') {
      processingFailure = 'consent_request_processing_failed';
      if (request.headers.get('Origin') !== issuer || !request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return err('access_denied', 403, 'consent_origin_or_content_type_invalid');
      const session = cookie(request, policy),params=new URLSearchParams(await boundedText(request));
      if([...params.keys()].some(k=>params.getAll(k).length!==1))return err('invalid_request', 400, 'consent_duplicate_parameter');
      const b = Object.fromEntries(params);
      if (session === undefined) return err('invalid_request', 400, 'consent_cookie_missing');
      if (!/^[a-f0-9]{64}$/.test(session)) return err('invalid_request', 400, 'consent_cookie_invalid');
      if (!/^[a-f0-9]{64}$/.test(b.csrf || '')) return err('invalid_request', 400, 'consent_csrf_invalid');
      if (!['allow', 'deny'].includes(b.decision)) return err('invalid_request', 400, 'consent_decision_invalid');
      // Only this owner-submitted consent form selects a longer lifetime.
      // Missing selection preserves the thirty-day contract for older forms.
      if (b.decision === 'allow' && b.refresh_days !== undefined && !['30', '365'].includes(b.refresh_days)) return err('invalid_request', 400, 'consent_duration_invalid');
      processingFailure = 'consent_registry_unavailable';
      const consumed = await consume(env, 'consent:' + await hash(session), {csrf: b.csrf}, policy, requestId ? {flowId: validDiagnosticId(b.diagnostic_id, 'mf') ? b.diagnostic_id : undefined, requestId} : undefined), consent = consumed.value;
      if (!consent) return err('invalid_request', 400, consumed.reason === 'binding_mismatch' ? 'consent_csrf_mismatch' : 'consent_session_expired_or_used');
      if (b.decision === 'deny') {
        const response = consentReturn(consent.p, env, {error: 'access_denied'}, policy);
        await reportConsentReturn(consent.diagnosticId, response.status); return response;
      }
      const code = random(), grantId = random();
      processingFailure = 'consent_grant_processing_failed';
      const stored = await registry(env, {op: 'authorize', grantId, codeKey: 'code:' + await hash(code), params: consent.p, resource, durationDays: b.refresh_days === '365' ? 365 : DEFAULT_REFRESH_DAYS, ...(requestId ? {diagnostic: {flowId: consent.diagnosticId, requestId}} : {})}, policy);
      if (stored.error) return stored.error === 'Client expired'
        ? err('invalid_request', 400, 'consent_client_not_registered')
        : err('temporarily_unavailable', 503, 'consent_grant_capacity_unavailable');
      const response = consentReturn(consent.p, env, {code}, policy);
      await reportConsentReturn(consent.diagnosticId, response.status); return response;
    }
    if (path === policy.path + '/oauth/token' && request.method === 'POST') {
      if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return tokenError('content_type_rejected');
      const params = new URLSearchParams(await boundedText(request));
      if ([...params.keys()].some(k => params.getAll(k).length !== 1)) return tokenError('duplicate_parameter_rejected');
      const b = Object.fromEntries(params);
      if (b.resource !== resource) return tokenError('resource_rejected', 'invalid_target');
      const access = random(), refresh = random(); let match, key;
      if (b.grant_type === 'authorization_code') {
        if (!/^[a-f0-9]{64}$/.test(b.code || '') || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier || '')) return tokenError('credential_format_rejected', 'invalid_grant');
        key = 'code:' + await hash(b.code);
        match = {client_id: b.client_id, redirect_uri: b.redirect_uri, challenge: await challenge(b.code_verifier), resource};
      } else if (b.grant_type === 'refresh_token') {
        if (!/^[a-f0-9]{64}$/.test(b.refresh_token || '')) return tokenError('credential_format_rejected', 'invalid_grant');
        key = 'refresh:' + await hash(b.refresh_token); match = {client_id: b.client_id, resource};
        if (b.scope !== undefined && !scopes(b.scope, policy)) return tokenError('scope_rejected', 'invalid_scope');
      } else return tokenError('unsupported_grant_type', 'unsupported_grant_type');
      const result = await registry(env, {op: 'exchange', key, match, scope: b.scope, accessKey: 'access:' + await hash(access), refreshKey: 'refresh:' + await hash(refresh)}, policy);
      if (!result.scope) return tokenError('exchange_rejected', 'invalid_grant');
      const response = json({access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: result.expiresIn, scope: result.scope});
      reportToken('issued'); return response;
    }
    if (path === policy.path + '/oauth/revoke' && request.method === 'POST') {
      if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return err();
      const params=new URLSearchParams(await boundedText(request));
      if([...params.keys()].some(k=>params.getAll(k).length!==1))return err();
      const b = Object.fromEntries(params);
      if (!/^[a-f0-9]{64}$/.test(b.token || '') || !/^[a-f0-9]{64}$/.test(b.client_id || '')) return json({});
      await registry(env, {op: 'revoke', tokenHash: await hash(b.token), client_id: b.client_id}, policy);
      return json({});
    }
    return err('not_found', 404);
  } catch { reportToken('processing_error'); return err('invalid_request', 400, processingFailure || (path === policy.path + '/oauth/authorize' ? 'authorization_processing_failed' : undefined)); }
}

// Every exchange/rotation and consume is atomic. Rows hold only hashed bearer IDs.
export function relayOAuthStore(ctx, b, now = Date.now(), env, policy = DEFAULT_POLICY) {
  if (!policy.consentDiagnostics) return relayOAuthStoreCore(ctx, b, now, env, policy);
  if (b.op === 'token-diagnostic' && policy.path === '/relay/makima') {
    // Internal-only write with no public read route or OAuth correlation.
    recordMakimaTokenDiagnostic(ctx, b.diagnostic, now);
    return json({ok: true});
  }
  if (b.op === 'diagnostic') {
    // Internal-only write; no diagnostic read operation or public endpoint.
    const d = b.diagnostic;
    if (['redirect_constructed', 'continuation_constructed'].includes(d?.stage)) recordMakimaDiagnostic(ctx, d, now);
    return json({ok: true});
  }
  const trace = {};
  if (b.op === 'consume' && b.key?.startsWith('consent:')) {
    Object.assign(trace, {flowId: b.diagnostic?.flowId, requestId: b.diagnostic?.requestId, stage: 'consent_consume', outcome: 'storage_error', verified: false});
    // Inspect only expiry before normal cleanup; never copy the lookup key.
    try { trace.expired = [...ctx.storage.sql.exec('SELECT expires_at FROM relay_oauth WHERE key=?', b.key)][0]?.expires_at <= now; } catch {}
  } else if (b.op === 'authorize') Object.assign(trace, {flowId: b.diagnostic?.flowId, requestId: b.diagnostic?.requestId, stage: 'grant_authorize', outcome: 'storage_error', verified: true});
  else if (b.op === 'put' && b.key?.startsWith('consent:')) Object.assign(trace, {flowId: b.value?.diagnosticId, requestId: b.value?.diagnosticRequestId, stage: 'consent_put', outcome: 'storage_error', verified: true, create: true});
  try {
    const response = relayOAuthStoreCore(ctx, b, now, env, policy, trace);
    recordMakimaDiagnostic(ctx, trace, now);
    return response;
  } catch (error) { trace.outcome = 'storage_error'; recordMakimaDiagnostic(ctx, trace, now); throw error; }
}
function relayOAuthStoreCore(ctx, b, now, env, policy, trace = {}) {
  if(b.op==='authenticate-readonly')return json({principal:relayReadOnlyPrincipal(ctx,env,b.accessHash,now,policy)});
  const sql = ctx.storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS relay_oauth (key TEXT PRIMARY KEY, category TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS relay_oauth_expiry ON relay_oauth(expires_at)');
  sql.exec('CREATE INDEX IF NOT EXISTS relay_oauth_category_expiry ON relay_oauth(category,expires_at)');
  return ctx.storage.transactionSync(() => {
    // Preserve only still-valid legacy client rows. Already-expired/deleted
    // identities must re-register, never be reconstructed from an authorize URL.
    sql.exec("UPDATE relay_oauth SET expires_at=? WHERE category='client' AND expires_at>? AND expires_at<?", CLIENT_EXPIRY, now, CLIENT_EXPIRY);
    sql.exec('DELETE FROM relay_oauth WHERE expires_at<=?', now);
    const get = key => {
      if (policy.staticClient && key.startsWith('client:')) return policy.enabled(env) && key === 'client:' + policy.staticClient(env) ? {redirect: policy.callback} : null;
      const r = [...sql.exec('SELECT value FROM relay_oauth WHERE key=?', key)][0]; return r ? JSON.parse(r.value) : null; };
    const store = (key, category, value, expiration) => sql.exec('INSERT OR REPLACE INTO relay_oauth VALUES(?,?,?,?)', key, category, JSON.stringify(value), expiration);
    const remove = key => sql.exec('DELETE FROM relay_oauth WHERE key=?', key);
    const count = category => [...sql.exec('SELECT COUNT(*) AS n FROM relay_oauth WHERE category=?', category)][0].n;
    const revoke = grantId => {
      const grant = get('grant:' + grantId);
      if (grant) { grant.revoked = true; store('grant:' + grantId, 'grant', grant, grant.expiresAt); }
      if (grant?.accessKey) remove(grant.accessKey);
      if (grant?.refreshKey) remove(grant.refreshKey);
    };
    if (b.op === 'get') return json({value: get(b.key)});
    if (b.op === 'rate') {
      const key='rate:'+b.identity, rate=get(key)||{count:0};
      if (rate.count>=5 || !get(key)&&count('rate')>=500) return json({error:'Rate limit'});
      store(key,'rate',{count:rate.count+1},now+SESSION_MS);return json({ok:true});
    }
    if (b.op === 'register') {
      if (policy.staticClient) return json({error:'Registration disabled'},400);
      // RFC 7591 permits reuse for instances with the same registration. This
      // broker accepts only one fixed ChatGPT public callback/security policy.
      // Reuse before the row cap so unauthenticated DCR cannot fill it forever.
      const existing = [...sql.exec("SELECT key,value FROM relay_oauth WHERE category='client' ORDER BY key")]
        .find(row => /^client:[a-f0-9]{64}$/.test(row.key) && JSON.parse(row.value).redirect === RELAY_CALLBACK);
      if (existing) return json({client_id: existing.key.slice(7)});
      if (!/^[a-f0-9]{64}$/.test(b.client_id || '') || count('client') >= 50) return json({error: 'Registry full'});
      store('client:' + b.client_id, 'client', {redirect: RELAY_CALLBACK}, CLIENT_EXPIRY);
      return json({client_id: b.client_id});
    }
    if (b.op === 'put') {
      const limits = {client: 50, session: 100};
      const validExpiry = Number.isFinite(b.expiresAt) && b.expiresAt > now;
      if (!(b.category in limits) || !validExpiry || count(b.category) >= limits[b.category]) { trace.outcome = 'capacity'; return json({error: 'Registry full'}); }
      store(b.key, b.category, b.value, b.category === 'client' ? CLIENT_EXPIRY : b.expiresAt); trace.outcome = 'ok'; return json({ok: true});
    }
    if (b.op === 'consume') {
      const value = get(b.key);
      if (!value) { trace.outcome = trace.expired ? 'expired' : 'not_found'; return json({value: null, reason: 'not_found'}); }
      if (trace.stage === 'consent_consume') { trace.flowId = value.diagnosticId; trace.verified = true; }
      if (Object.entries(b.match || {}).some(([k, v]) => !equal(value[k], v))) { trace.outcome = 'binding_mismatch'; return json({value: null, reason: 'binding_mismatch'}); }
      remove(b.key); trace.outcome = 'ok'; return json({value});
    }
    if (b.op === 'authorize') {
      trace.outcome = 'rejected';
      const durationDays = b.durationDays === undefined ? DEFAULT_REFRESH_DAYS : b.durationDays;
      if (!REFRESH_DAYS.includes(durationDays)) return json({error: 'Invalid duration'}, 400);
      const p = b.params, expiration = now + durationDays * 86400000;
      const client=get('client:'+p.client_id);
      if(!client || policy.staticClient && (authParamsError(p,client,env,policy) || b.resource !== policy.resource(env)))return json({error:'Client expired'});
      // Legacy Allow stored a thirty-day grant before its ten-minute code was
      // redeemed. An expired, never-issued consent must not exhaust the ten
      // usable-family slots. Preserve every row; only omit proven abandoned
      // families from admission accounting, regardless of client/scope/resource.
      // Pointer absence alone is not proof: legacy tokens, replay evidence and
      // event/device approvals may still refer to a pointerless grant.
      const referenced = new Set();
      const addReference = id => {
        if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))return false;
        referenced.add(id);return true;
      };
      for(const row of sql.exec("SELECT value FROM relay_oauth WHERE category IN ('code','access','refresh','used') OR key LIKE 'code:%' OR key LIKE 'access:%' OR key LIKE 'refresh:%' OR key LIKE 'used:%'")){
        const value = JSON.parse(row.value);
        // Corrupt live reference rows cannot establish which family is safe to
        // omit. Deny admission rather than guessing that no family depends on it.
        if(!isObject(value)||!addReference(value.grantId))return json({error:'Registry full'});
      }
      const tables = new Set([...sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('relay_subscriptions','relay_owner_sessions','relay_owner_pairings')")]
        .map(row => row.name));
      if(tables.has('relay_subscriptions'))for(const row of sql.exec('SELECT grant_id FROM relay_subscriptions WHERE expires_ms>?',now))if(!addReference(row.grant_id))return json({error:'Registry full'});
      if(tables.has('relay_owner_sessions'))for(const row of sql.exec('SELECT approval_grant_id FROM relay_owner_sessions WHERE expires_ms>? AND revoked_ms IS NULL',now))if(!addReference(row.approval_grant_id))return json({error:'Registry full'});
      if(tables.has('relay_owner_pairings'))for(const row of sql.exec('SELECT approval_grant_id FROM relay_owner_pairings WHERE expires_ms>? AND approved_ms IS NOT NULL',now))if(!addReference(row.approval_grant_id))return json({error:'Registry full'});
      const grantRows=[...sql.exec("SELECT key,category,value,expires_at FROM relay_oauth WHERE category='grant' OR key LIKE 'grant:%'")];
      const counted = grantRows.filter(row => {
        const grant = JSON.parse(row.value);
        if(grant?.revoked===true)return false;
        // Unknown legacy shapes are not proof of a never-issued consent.
        let knownResource = false;
        try{
          const resource = new URL(grant?.resource);
          knownResource = resource.protocol==='https:' && !resource.username && !resource.password
            && grant.resource===resource.origin+'/relay/mcp';
        }catch{}
        const knownPending = row.category==='grant' && /^grant:[a-f0-9]{64}$/.test(row.key) && isObject(grant)
          && grant.revoked===false && grant.principal===policy.principal
          && typeof grant.client_id==='string' && /^[a-f0-9]{64}$/.test(grant.client_id) && scopes(grant.scope, policy)
          && knownResource && Number.isSafeInteger(grant.expiresAt) && grant.expiresAt>now
          && Number.isSafeInteger(row.expires_at) && row.expires_at>now && row.expires_at<=grant.expiresAt
          && (grant.consentDurationDays===undefined||REFRESH_DAYS.includes(grant.consentDurationDays))
          && Object.keys(grant).every(key=>['principal','client_id','scope','resource','expiresAt','revoked','consentDurationDays'].includes(key));
        return !knownPending || referenced.has(row.key.slice(6));
      });
      if(counted.length>=10)return json({error:'Registry full'});
      const grant = {principal: policy.principal, client_id: p.client_id, scope: p.scope, resource: b.resource, expiresAt: expiration, revoked: false, consentDurationDays: durationDays};
      // Pending grants physically expire with the code. Keep the original
      // absolute lifetime in the value: a valid atomic exchange below promotes
      // this same family to that expiry, including on an older rollback worker.
      store('grant:' + b.grantId, 'grant', grant, now + SESSION_MS);
      store(b.codeKey, 'code', {grantId: b.grantId, client_id: p.client_id, redirect_uri: p.redirect_uri, challenge: p.code_challenge, resource: b.resource, scope: p.scope}, now + SESSION_MS);
      trace.outcome = 'ok'; return json({ok: true});
    }
    if (b.op === 'exchange') {
      const value = get(b.key);
      if (!value) {
        // A reused refresh token indicates a compromised family. Wrong clients cannot revoke it.
        const used = get('used:' + b.key);
        if (used && used.client_id === b.match.client_id && used.resource === b.match.resource) revoke(used.grantId);
        return json({});
      }
      if (Object.entries(b.match).some(([k, v]) => !equal(value[k], v))) return json({});
      const grant = get('grant:' + value.grantId);
      if (!grant || grant.revoked || grant.principal !== policy.principal || policy.staticClient && (!policy.enabled(env) || value.client_id !== policy.staticClient(env) || value.resource !== policy.resource(env))) return json({});
      const scope = b.scope || value.scope;
      if (!scopes(scope, policy) || scope.split(' ').some(s => !value.scope.split(' ').includes(s))) return json({});
      if(b.key.startsWith('refresh:')&&count('used')>=10000)return json({});
      remove(b.key);
      if (b.key.startsWith('refresh:')) {
        // Keep reuse detection for the entire family lifetime. Fail closed at the
        // bounded cap rather than deleting evidence for a still-active family.
        store('used:' + b.key, 'used', {grantId: value.grantId, client_id: value.client_id, resource: value.resource},grant.expiresAt);
      }
      if (grant.accessKey) remove(grant.accessKey);
      if (grant.refreshKey) remove(grant.refreshKey);
      const token = {grantId: value.grantId, client_id: value.client_id, scope, resource: value.resource};
      const accessExpiry=Math.min(now+ACCESS_MS,grant.expiresAt);
      store(b.accessKey, 'access', token, accessExpiry);
      store(b.refreshKey, 'refresh', token, grant.expiresAt);
      grant.accessKey = b.accessKey; grant.refreshKey = b.refreshKey; grant.scope = scope;
      store('grant:' + value.grantId, 'grant', grant, grant.expiresAt);
      return json({scope,expiresIn:Math.floor((accessExpiry-now)/1000)});
    }
    if (b.op === 'revoke') {
      for (const prefix of ['access:', 'refresh:']) {
        const token = get(prefix + b.tokenHash);
        if (token?.client_id === b.client_id) revoke(token.grantId);
      }
      return json({ok: true});
    }
    return json({error: 'Invalid operation'}, 400);
  });
}


