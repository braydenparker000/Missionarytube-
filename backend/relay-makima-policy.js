import {MAKIMA_CONSENT_SCRIPT, MAKIMA_CONSENT_SCRIPT_HASH} from './relay-makima-consent.js';
import {relayEnabled, relayIssuer} from './relay-common.js';

export const MAKIMA_PATH = '/relay/makima';
export const MAKIMA_OBJECT = 'jarvis-makima-v1';
export const MAKIMA_SCOPE = 'relay:makima';
export const MAKIMA_VERSION = '2025-06-18';
export const MAKIMA_CALLBACK = 'https://www.cursor.com/agents/mcp/oauth/callback';
export const makimaEnabled = env => relayEnabled(env) && env.RELAY_MAKIMA_ENABLED === 'true'
  && /^[a-f0-9]{64}$/.test(env.RELAY_MAKIMA_CLIENT_ID || '')
  && !!env.RELAY_MAKIMA_GITHUB_CLIENT_ID && !!env.RELAY_MAKIMA_GITHUB_CLIENT_SECRET
  && env.RELAY_MAKIMA_GITHUB_CLIENT_ID !== env.RELAY_GITHUB_CLIENT_ID
  && env.RELAY_MAKIMA_GITHUB_CLIENT_SECRET !== env.RELAY_GITHUB_CLIENT_SECRET;
export const makimaOAuthPolicy = Object.freeze({
  path: MAKIMA_PATH, registry: MAKIMA_OBJECT, principal: 'agent:makima',
  scopes: [MAKIMA_SCOPE], defaultScopes: [MAKIMA_SCOPE], callback: MAKIMA_CALLBACK,
  // Cursor canonicalizes www to the apex host with a 308. Chromium applies
  // form-action to that redirect too; OAuth registration stays exact and unchanged.
  formActionRedirects: ['https://cursor.com/agents/mcp/oauth/callback'],
  consentDiagnostics: true,
  consentGuard: Object.freeze({script: MAKIMA_CONSENT_SCRIPT, hash: MAKIMA_CONSENT_SCRIPT_HASH}),
  retainTerminalCookie: true,
  loginCookie: '__Host-jarvis-makima-login',
  cookie: '__Host-jarvis-makima', clientName: 'Makima', enabled: makimaEnabled,
  resource: env => relayIssuer(env) + MAKIMA_PATH + '/mcp',
  staticClient: env => env.RELAY_MAKIMA_CLIENT_ID,
  githubClientId: env => env.RELAY_MAKIMA_GITHUB_CLIENT_ID,
  githubClientSecret: env => env.RELAY_MAKIMA_GITHUB_CLIENT_SECRET,
  consentText: '<p><strong>Private Makima channel:</strong> Allow this Grok Bot connection to act as Makima and read/send text explicitly shared in its separate channel. No owner inbox, Lucy–Muse history, project tools, files or events are included. Channel text does not authorize account actions. Confirm this connection belongs to Makima.</p>',
});

