// Add to Playlist (dialog_PlaylistSelectActivity): the playlists as
// item_playlist_select_plus_checkbox rows (listItemSize 50 dp) under title
// buttons for a new playlist, sort (name, date added, date modified, number
// of tracks), insert position (top, bottom, shuffled) and the select type:
// add to one playlist (a tap adds, the frame shows "Added" with Open, then
// closes after 2 s), add to several (checks, then Add) or toggle (a tap adds
// to or removes from the playlist). PlaylistSelectAndAddToListLayout.
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {GONE, VISIBLE} from '../res/values.js';
import {PowerList, LAYOUT_FOR_TYPE} from '../list/power-list.js';
import {openDialog} from './dialog.js';
import {INSERT_BOTTOM, SORT_NAME} from '../library/playlists.js';

LAYOUT_FOR_TYPE.plsel = 'item_playlist_select_plus_checkbox';
const STORE = 'cp-pl-select';
const TYPE_SINGLE = 0, TYPE_MULTIPLE = 1, TYPE_TOGGLE = 2;

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { return {}; }
}

export class PlaylistSelectAndAddToListLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.itemSize = a.dim('listItemSize', Math.round(50 * ctx.dpr));
    const p = loadPrefs();
    this.sort = p.sort ?? SORT_NAME;
    this.insert = p.insert ?? (ctx.settings?.playlist_insert_pos ?? INSERT_BOTTOM);
    this.type = p.type ?? TYPE_SINGLE;
    this.checked = new Set();
    this.tracks = [];
    this.publish();
    this.list = new PowerList(ctx, null, null);
    this.list.selectable = false;
    this.list.noScroller = true;
    this.list.lp = this.generateLayoutParams(ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'fill_parent'}));
    this.addView(this.list);
    this.unsub = [
      ctx.bus.subscribe('playlist_list_layout', (msg, src, d) => this.onCmd(msg, d?.arg1)),
      ctx.bus.subscribe('bus_data', msg => { if (msg === 'msg_playlists_changed') this.refresh(); }),
    ];
  }

  savePrefs() {
    try { localStorage.setItem(STORE, JSON.stringify({sort: this.sort, insert: this.insert, type: this.type})); } catch { /* storage unavailable */ }
  }

  publish() {
    this.ctx.listState = Object.assign(this.ctx.listState ?? {}, {
      state_playlist_select_sort: this.sort, state_playlist_insert_pos: this.insert,
      state_playlist_select_type_single: this.type, state_playlist_select_type_multiple: this.type,
    });
  }

  onCmd(msg, arg) {
    if (msg === 'cmd_set_playlist_select_sort') this.sort = arg;
    else if (msg === 'cmd_set_playlist_insert_pos') this.insert = arg;
    else if (msg === 'cmd_set_playlist_select_type_single' || msg === 'cmd_set_playlist_select_type_multiple') { this.type = arg; this.checked.clear(); this.syncButtons(); }
    else return;
    this.publish();
    this.savePrefs();
    this.refresh();
  }

  /** Called by openAddToPlaylist once the dialog is up. */
  setup(dialog, tracks) {
    this.dialog = dialog;
    this.tracks = tracks;
    const add = dialog.find('add_to_pl_button');
    if (add) add.onClick = () => this.ctx.playlists.create();
    // Only the select-type button for the current types shows.
    dialog.find('state_playlist_select_type_multiple')?.setVisibility(GONE);
    this.syncButtons();
    this.refresh();
  }

  syncButtons() {
    const d = this.dialog;
    if (!d) return;
    const str = n => this.ctx.res.stringByName(n) ?? n;
    if (this.type === TYPE_MULTIPLE) {
      d.setButton(1, str('add'), () => this.addChecked());
      d.setButton(2, str('close'), () => d.close());
    } else {
      d.setButton(1, null);
      d.setButton(2, str('close'), () => d.close());
    }
    d.setButton(3, null);
    this.requestLayout();
  }

  refresh() {
    const pls = this.ctx.playlists?.sorted(this.sort) ?? [];
    this.items = pls;
    const lib = this.ctx.library;
    const contains = pl => this.tracks.length > 0 && this.tracks.every(t => pl.ids.includes(t.id));
    this.list.setSource({
      count: pls.length, itemType: 'plsel', itemScene: 'defaultScene', itemHeight: this.itemSize, header: null,
      bindItem: (v, i) => {
        const pl = pls[i];
        const first = lib.byId.get(pl.ids[0]);
        v.bind({id: 'pl:' + pl.id + ':' + pl.ids.length, group: true, title: pl.name, artist: '', art: first?.art, thumb: first?.thumb, artId: first?.artId, meta: ''});
        const box = v.findViewById('select_box');
        if (box) {
          const rec = box.sceneParams?.get('defaultScene');
          if (rec) rec.visibility = VISIBLE;
          box.setVisibility(VISIBLE);
          box.setChecked(this.type === TYPE_MULTIPLE ? this.checked.has(pl.id) : this.type === TYPE_TOGGLE ? contains(pl) : false);
        }
        v.setActivated?.(this.type === TYPE_MULTIPLE && this.checked.has(pl.id));
      },
      onItemClick: i => this.onPick(pls[i]),
    });
    this.requestLayout();
  }

  onPick(pl) {
    const P = this.ctx.playlists;
    if (this.type === TYPE_MULTIPLE) {
      if (this.checked.has(pl.id)) this.checked.delete(pl.id); else this.checked.add(pl.id);
      this.refresh();
      return;
    }
    if (this.type === TYPE_TOGGLE) {
      const ids = new Set(this.tracks.map(t => t.id));
      if (this.tracks.every(t => pl.ids.includes(t.id))) P.removeAt(pl, pl.ids.map((id, i) => (ids.has(id) ? i : -1)).filter(i => i >= 0));
      else P.add(pl, this.tracks.filter(t => !pl.ids.includes(t.id)), this.insert);
      return;
    }
    const n = P.add(pl, this.tracks, this.insert);
    this.done(n, pl);
  }

  addChecked() {
    const P = this.ctx.playlists;
    let n = 0, last = null;
    for (const id of this.checked) {
      const pl = P.get(id);
      if (pl) { n += P.add(pl, this.tracks, this.insert); last = pl; }
    }
    this.done(n, this.checked.size === 1 ? last : null);
  }

  /** "Added" (or duplicates not added) in the frame, with Open for one playlist. */
  done(n, pl) {
    const str = k => this.ctx.res.stringByName(k) ?? k;
    const open = pl ? () => this.ctx.bus.post('bus_gui', 'cmd_nav_to_playlist', this, {playlist: pl}) : null;
    this.dialog?.toast(n ? str('added') : str('duplicate_tracks_nothing_added'), 2000, open ? {button: str('open'), onButton: open} : {});
  }

  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getSize(wSpec);
    const want = this.paddingTop + this.paddingBottom + Math.max(1, this.items?.length ?? 0) * this.itemSize;
    const mode = MeasureSpec.getMode(hSpec), size = MeasureSpec.getSize(hSpec);
    const h = mode === MeasureSpec.EXACTLY ? size : mode === MeasureSpec.AT_MOST ? Math.min(size, want) : want;
    this.setMeasuredDimension(w, h);
    this.list.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(Math.max(0, h - this.paddingTop - this.paddingBottom), MeasureSpec.EXACTLY));
  }

  onLayout() {
    this.list.layout(0, this.paddingTop, this.width, this.height - this.paddingBottom);
  }
}

/** Opens Add to Playlist for tracks. */
export function openAddToPlaylist(ctx, tracks) {
  if (!tracks?.length || !ctx.playlists) return null;
  let content = null;
  const dialog = openDialog(ctx, {
    style: 'dialog_PlaylistSelectActivity', title: ctx.res.stringByName('add_to_playlist') ?? 'Add to Playlist',
    onClosed: () => content?.unsub.forEach(u => u()),
    setup: d => { content = d.find('playlist_list_layout'); content?.setup(d, tracks); },
  });
  return dialog;
}

register(['PlaylistSelectAndAddToListLayout'], PlaylistSelectAndAddToListLayout);
