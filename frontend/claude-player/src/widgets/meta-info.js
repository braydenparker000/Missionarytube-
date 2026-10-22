// Meta info line under the art (merge_meta_info_layout): a tap cycles what it
// shows (cmd_player_switch_track_meta), a long press opens the audio info
// popup (F51). Modes, in the reference's cycle order from the default:
// decode info (the track's format line) -> output info -> category info
// ("<category> - <position> / <count>") -> folder info (the folder's name) ->
// next track info ("<title> - <artist> - <album>", or the end/next category
// note) -> decode info. The browser has no output device report, so the
// output line names the web audio output and its sample rate (substitute).
const KEY = 'cp-track-meta';
const CYCLE = {decode: 'output', output: 'category', category: 'folder', folder: 'next', next: 'decode'};
const ICON = {folder: '?micro_folders', next: '?meta_next_12dp'};

export function installMetaInfo(ctx) {
  let mode = 'decode';
  try { mode = CYCLE[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'decode'; } catch { /* storage unavailable */ }
  const str = (k, f = k) => ctx.res.stringByName(k) ?? f;
  const labels = () => {
    const out = [];
    ctx.root?.walk?.(v => { if (v.id === '_label' && v.parent?.id === 'meta_info') out.push(v); });
    return out;
  };

  /** Parent folder's name of a path (k51's folder rule). */
  const folderName = path => {
    const k = path.lastIndexOf('/');
    if (k <= 0) return '/';
    const j = path.lastIndexOf('/', k - 1);
    return j === -1 ? path.slice(0, k) : j === 0 ? path.slice(1, k) : path.slice(j + 1, k);
  };

  const text = () => {
    const p = ctx.player, t = p?.track;
    if (!t) return '';
    switch (mode) {
      case 'output': {
        const rate = ctx.dsp?.ac?.sampleRate ?? null;
        return ['Web Audio', rate ? `${Math.round(rate / 100) / 10} ${str('khz', 'kHz')}` : null].filter(Boolean).join('  ');
      }
      case 'category': {
        const src = ctx.listWidget?.queueStack?.[ctx.listWidget.queueStack.length - 1];
        const name = src?.title || str('all_songs', 'All Songs');
        const n = p.queue.length, i = p.index;
        return `${name} - ${n ? `${i + 1} / ${n}` : '- / -'}`;
      }
      case 'folder':
        return folderName(t.path || t.fileName || '');
      case 'next': {
        const next = p.trackAt(1);
        if (next) return [next.title, next.artist || str('unknown', 'Unknown'), next.album].filter(Boolean).join(' - ');
        if (p.categoryNavigable) {
          const name = p.categoryTitle(1);
          return name ? (str('next_cat_s', 'Next %s')).replace('%s', name) : str('next_list', 'Next category');
        }
        return str('end_reached', 'End reached');
      }
      default:
        return t.meta ?? '';
    }
  };

  const update = () => {
    const icon = ICON[mode] ?? null;
    for (const v of labels()) {
      v.setText(text());
      v.setDrawable?.(icon ? ctx.drawables.fromValue(icon, ctx.theme) : null);
      v.parent?.requestLayout();
    }
  };

  ctx.bus.subscribe('bus_player_cmd', msg => {
    if (msg !== 'cmd_player_switch_track_meta') return;
    mode = CYCLE[mode];
    try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ }
    ctx.bus.post('bus_player', 'msg_player_track_meta_switched', null);
  });
  ctx.bus.subscribe('bus_player', msg => {
    if (msg === 'msg_player_track_changed' || msg === 'msg_player_track_meta_switched' || msg === 'msg_player_repeat_mode_changed' || msg === 'msg_player_queue_changed' || msg === 'msg_player_category_changed') update();
  });
  update();
  return {update};
}

