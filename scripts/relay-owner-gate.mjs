// Inspect only the named nonsecret feature flag. Never serialize provider settings.
export function ownerGateClassification(settings) {
  if (!Array.isArray(settings?.bindings)) return 'invalid';
  const matches = settings.bindings.filter(binding => binding?.name === 'RELAY_OWNER_ENABLED');
  if (matches.length === 0) return 'absent';
  if (matches.length !== 1 || matches[0].type !== 'plain_text') return 'invalid';
  if (matches[0].text === 'false') return 'false';
  if (matches[0].text === 'true') return 'enabled';
  return 'invalid';
}

export const ownerGateIsOff = classification => classification === 'absent' || classification === 'false';
