// Validate the effective generated config, not the source template. keep_vars
// preserves variables; it is not evidence that an R2 resource will survive.
// This check never adds a binding or grants access to a missing live bucket.
export function checkedMusicBindingPreservation(settings, config) {
  const fail = () => { throw Error('Existing music binding must be preserved by the effective Worker configuration'); };
  if (!Array.isArray(settings?.bindings)) fail();
  const live = settings.bindings.filter(binding => binding?.name === 'MUSIC_R2');
  if (live.length !== 1 || live[0].type !== 'r2_bucket' || live[0].bucket_name !== 'jarvis-music') fail();
  if (config?.name !== 'jarvis-hub-api' || config.keep_vars !== true ||
      !Array.isArray(config.r2_buckets) || config.r2_buckets.length !== 1) fail();
  const candidate = config.r2_buckets[0];
  if (!candidate || candidate.binding !== 'MUSIC_R2' || candidate.bucket_name !== live[0].bucket_name ||
      Object.keys(candidate).some(key => !['binding', 'bucket_name', 'jurisdiction'].includes(key)) ||
      (candidate.jurisdiction ?? '') !== (live[0].jurisdiction ?? '')) fail();
  // The preserving release uses empty vars and the top-level config only.
  // Refuse alternate environment or variable overrides rather than guessing
  // which binding Wrangler will actually upload.
  if (!config.vars || Array.isArray(config.vars) || typeof config.vars !== 'object' ||
      Object.keys(config.vars).length || config.env !== undefined) fail();
}
