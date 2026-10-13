import {RELAY_OWNER, RELAY_OAUTH_OBJECT, RELAY_SCOPES, RELAY_PUBLIC_SCOPES, RELAY_CALLBACK, relayEnabled, relayResource} from './relay-common.js';

// Policies are server-owned constants, never selected by request parameters.
export const relayOAuthPolicy = Object.freeze({
  path: '/relay', registry: RELAY_OAUTH_OBJECT, principal: RELAY_OWNER,
  scopes: RELAY_SCOPES, defaultScopes: RELAY_PUBLIC_SCOPES, callback: RELAY_CALLBACK,
  cookie: '__Host-jarvis-relay', enabled: relayEnabled, resource: relayResource,
});
