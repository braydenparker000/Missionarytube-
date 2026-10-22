// List mode states that are preferences (c40): the insert positions of Add to
// Queue and Play Next (queue_insert_pos, play_next_insert_pos;
// enqueue_modes_args1 0 in order, 2 shuffled). The selection menu's mode
// buttons and Settings share them.
const STATE_PREFS = {state_queue_insert_pos: 'queue_insert_pos', state_play_next_insert_pos: 'play_next_insert_pos'};

/** A mode state's value: the preference for the preference states, else the list state. */
export function modeState(ctx, key) {
  const p = STATE_PREFS[key];
  if (p) return +(ctx.pref?.(p) ?? 0) || 0;
  return ctx.listState?.[key];
}

export function setModeState(ctx, key, value) {
  ctx.listState = Object.assign(ctx.listState ?? {}, {[key]: value});
  const p = STATE_PREFS[key];
  if (p && modeState(ctx, key) !== value) ctx.settingsUi?.setPref(p, String(value));
}
