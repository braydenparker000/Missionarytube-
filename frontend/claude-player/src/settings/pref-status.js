// Status of every reference preference key (notebook F63; the generated table
// is docs/claude-player/settings-status.md, kept current by
// scripts/claude-player/pref-status.mjs and guarded by
// tests/claude-player-pref-status.test.mjs). Statuses:
// - UI: a structural entry (screen, category, link or text) the settings UI renders;
// - BUILT: the value is read by the app and changes its behaviour;
// - TODO: web-feasible and not built yet;
// - WEB: has no web counterpart (the reason says why);
// - OWNER: left out by an owner decision;
// - NA: belongs to the reference's own business (purchases, support, updates).
export const UI = 'ui', BUILT = 'built', TODO = 'todo', WEB = 'web', OWNER = 'owner', NA = 'na';

const ANDROID_OUTPUT = 'Android audio output devices and driver options; the browser owns the audio output';
const ANDROID_VOLUME = 'Android device volume; a web page cannot read or set it';
const ANDROID_FOCUS = 'Android audio focus (calls, other apps); the browser arbitrates audio';
const ANDROID_LOCKSCREEN = 'Android lock screen; the browser shows its own media controls';
const ANDROID_NOTIFY = 'Android notification and service; the browser shows its own media controls';
const ANDROID_HEADSET = 'Headset and Bluetooth events; the browser delivers only media keys (Media Session)';
const ANDROID_BITMAPS = 'Android bitmap memory options';
const ANDROID_MEDIA_API = 'Android media APIs for other apps and devices (lock screen, widgets, watches, intents)';
const ANDROID_DEVICES = 'Bluetooth / USB device detection';
const BROWSER_OUTPUT = 'The browser decodes, resamples and dithers the audio';
const ANDROID_EFFECTS = 'Android system audio effects (MusicFX)';
const TRACKER = 'Tracker module decoders; the browser cannot decode .mod / .xm / .it';
const ANDROID_STORAGE = 'Android storage scanning; the web library is the R2 index';
const ANDROID_APPS = 'Third-party Android apps';
const LOCAL_FILES = 'Applies to local files; local imports were removed (owner decision) and the R2 index carries decoded tags, no CUE sheets and no lyrics files';
const ANDROID_AUTO = 'Android Auto';
const ANDROID_SYSTEM = 'Android system services (wakelocks, intents, display, native libraries, screen state)';
const THIRD_PARTY_SKINS = 'Third-party skin APKs';
const BUNDLED_PRESETS = 'The visualizer presets ship with the app (butterchurn); there is nothing to scan';
const MEDIA_SESSION_ACTIONS = 'Notification buttons; Media Session offers only fixed actions, no custom buttons';
const BROWSER_ART_DECODE = 'The browser decodes album art at full resolution; there is no decode size to raise';
const BUTTERCHURN_ONLY = 'Owner decision: butterchurn is the visualizer; this option belongs to the native MilkDrop / bars renderer';
const ART_PICK_ONLY = 'Owner decision: album art comes only from tags, folders or a picked image file';
const NO_STREAMS = 'Owner decision: no network streams';
const NO_DELETE = 'Owner decision: no file deletion';
const NO_PURCHASES = 'Private non-commercial build: no purchases or feature packs';
const REFERENCE_SERVICES = "The reference's own sites, updates and crash reports";

/** Every preference key of the reference XML, by screen, in document order. */
export const PREF_STATUS = {
  // aa
  pref_aa_downloading: [UI, ''],
  download_album_art: [OWNER, ART_PICK_ONLY],
  download_artist_art: [OWNER, ART_PICK_ONLY],
  aa_download_hd: [OWNER, ART_PICK_ONLY],
  download_aa_wifi_only: [OWNER, ART_PICK_ONLY],
  reset_negative_aa_status: [OWNER, ART_PICK_ONLY],
  clear_aa_cache: [BUILT, ''],
  aa_force_default: [BUILT, ''],
  aa_8888: [WEB, ANDROID_BITMAPS],
  aa_hi_res_for_apis: [WEB, ANDROID_MEDIA_API],
  aa_always: [WEB, ANDROID_MEDIA_API],
  aa_no_ashmem: [WEB, ANDROID_BITMAPS],
  download_if_no_tags: [OWNER, ART_PICK_ONLY],
  prefer_downloaded_aa: [OWNER, ART_PICK_ONLY],
  aa_aspect: [BUILT, ''],
  aa_higher_res: [WEB, BROWSER_ART_DECODE],
  aa_per_stream_track: [OWNER, NO_STREAMS],
  restore_defaults: [BUILT, ''],
  // aa_bg
  aa_blur_enabled: [BUILT, ''],
  list_aa_blur_enabled: [BUILT, "Partial: the backdrop shows the playing track's art; the reference shows the opened list's own art"],
  lyrics_aa_blur_enabled: [BUILT, ''],
  aa_bg_gradient: [BUILT, ''],
  aa_bg_gradient_color: [BUILT, ''],
  aa_bg_gradient_for_list: [BUILT, ''],
  aa_blur: [BUILT, ''],
  aa_blur_scale: [BUILT, ''],
  aa_blur_intensity: [BUILT, ''],
  aa_blur_saturation: [BUILT, ''],
  // already_purchased
  restore_purchase: [NA, NO_PURCHASES],
  restore_unlocker: [NA, NO_PURCHASES],
  rustore: [NA, NO_PURCHASES],
  huawei: [NA, NO_PURCHASES],
  website: [NA, NO_PURCHASES],
  get_support: [UI, ''],
  // audio
  audio_info: [UI, ''],
  fade: [UI, ''],
  rg: [UI, ''],
  audio_focus: [UI, ''],
  audio_resampler: [UI, ''],
  audio_dvc: [UI, ''],
  audio_outputs2: [UI, ''],
  audio_bit_perfect: [UI, ''],
  audio_tweaks: [UI, ''],
  // audio_bit_perfect
  global_pipeline64: [WEB, ANDROID_OUTPUT],
  pipeline64_opts: [UI, ''],
  global_follow_sr: [WEB, ANDROID_OUTPUT],
  follow_sr_opts: [UI, ''],
  global_dsd_remaster: [WEB, ANDROID_OUTPUT],
  dsd_remaster_opts: [UI, ''],
  global_perfect_bit_perfect: [WEB, ANDROID_OUTPUT],
  perfect_bit_perfect_opts: [UI, ''],
  // audio_dvc
  dvc_enabled: [WEB, ANDROID_VOLUME],
  dvc_devices: [UI, ''],
  bluetooth_headset: [UI, ''],
  bt_absvol_status: [UI, ''],
  no_dvc_bt_absvol: [WEB, ANDROID_VOLUME],
  no_dvc_bt_absvol_hint: [UI, ''],
  no_dvc_bt_absvol_hint_15: [UI, ''],
  dvc_bt_msg: [UI, ''],
  no_dvc_gain_mb: [WEB, ANDROID_VOLUME],
  compensate_dvc_vol: [WEB, ANDROID_VOLUME],
  // audio_equ
  peq_equ_bands: [UI, ''],
  peq_equ_tone: [UI, ''],
  eq_labels: [BUILT, 'Band and preamp knob values: hidden, dB (-15..15 / -24..24) or percent (F68)'],
  tone_labels: [BUILT, 'Tone knob values: hidden, 0..15 or percent (F68)'],
  _autosave: [BUILT, 'Auto Save in the EQ menu (F67)'],
  dsp_border_gain: [WEB, 'Gain smoothing near full volume runs inside the native DSP library (an algorithm not in the bytecode); the web DSP guards overload with its limiter'],
  suggest_autoeq: [WEB, ANDROID_DEVICES],
  _clear_autoeq_known_devices: [UI, ''],
  _presets_to_peq: [UI, ''],
  _import_autoeq: [BUILT, 'Imports the AutoEq project zip\'s ParametricEQ / GraphicEQ files as AutoEq presets (F82)'],
  reset_eq_presets: [BUILT, 'Built-in EQ presets lose their edits and names (F69)'],
  // audio_focus
  resume_after_call: [WEB, ANDROID_FOCUS],
  resume_on_start: [WEB, ANDROID_FOCUS],
  resume_on_resume: [WEB, ANDROID_FOCUS],
  resume_on_mount: [WEB, ANDROID_FOCUS],
  cc_af_warning: [UI, ''],
  audio_focus_cat: [UI, ''],
  af_short: [WEB, ANDROID_FOCUS],
  pause_in_call: [WEB, ANDROID_FOCUS],
  resume_on_focus: [WEB, ANDROID_FOCUS],
  af_short_duck: [WEB, ANDROID_FOCUS],
  af_permanent: [WEB, ANDROID_FOCUS],
  // audio_output_device_opts
  eq_preset: [WEB, ANDROID_OUTPUT],
  output_api: [WEB, ANDROID_OUTPUT],
  bg_warn: [UI, ''],
  output_hint: [UI, ''],
  top_output_info: [UI, ''],
  top_output_info2: [UI, ''],
  output_info: [UI, ''],
  sample_rate: [WEB, ANDROID_OUTPUT],
  sample_rate_static: [UI, ''],
  follow_sr_hint1: [UI, ''],
  codec_sr_hint: [UI, ''],
  allowed_srs: [WEB, ANDROID_OUTPUT],
  follow_sr_hint2: [UI, ''],
  set_codec_sr: [WEB, ANDROID_OUTPUT],
  set_codec_sr_hint: [UI, ''],
  prefer_base_rate: [WEB, ANDROID_OUTPUT],
  sample_fmt: [WEB, ANDROID_OUTPUT],
  sample_bits_static: [UI, ''],
  sr_and_format_warnings: [UI, ''],
  direct_no_effect: [UI, ''],
  pref_sr_format_effects_override_hint: [UI, ''],
  pipeline64: [WEB, ANDROID_OUTPUT],
  pipeline64_static: [UI, ''],
  dsd_remaster: [WEB, ANDROID_OUTPUT],
  dsd_remaster_static: [UI, ''],
  dsd_remaster_sample_rate: [WEB, ANDROID_OUTPUT],
  dsd_remaster_sample_rate_static: [UI, ''],
  dsd_remaster_allow_48k: [WEB, ANDROID_OUTPUT],
  dsd_remaster_hint: [UI, ''],
  perfect_bit_perfect: [WEB, ANDROID_OUTPUT],
  perfect_bit_perfect_static: [UI, ''],
  volume_type: [WEB, ANDROID_OUTPUT],
  volume_type_static: [UI, ''],
  volume_type_hints: [UI, ''],
  sync_hw_volume: [WEB, ANDROID_OUTPUT],
  sync_hw_volume_hint: [UI, ''],
  float: [WEB, ANDROID_OUTPUT],
  buffer_size: [WEB, ANDROID_OUTPUT],
  reconfig_delay_ms: [WEB, ANDROID_OUTPUT],
  vis_latency_ms: [WEB, ANDROID_OUTPUT],
  pause_usb_release: [WEB, ANDROID_OUTPUT],
  play_silence_in_background: [WEB, ANDROID_OUTPUT],
  allow_dsd_dop: [WEB, ANDROID_OUTPUT],
  prefer_dsd_raw: [WEB, ANDROID_OUTPUT],
  warmup: [WEB, ANDROID_OUTPUT],
  pcm_dsd_extra_warmup: [WEB, ANDROID_OUTPUT],
  target_alt_sr_quirk: [WEB, ANDROID_OUTPUT],
  force_usb_full_speed: [WEB, ANDROID_OUTPUT],
  cc_force_aa: [WEB, ANDROID_OUTPUT],
  cc_show_meta: [WEB, ANDROID_OUTPUT],
  no_dvc: [WEB, ANDROID_OUTPUT],
  no_dvc_static: [UI, ''],
  no_headroom: [WEB, ANDROID_OUTPUT],
  no_equ: [WEB, ANDROID_OUTPUT],
  no_duck: [WEB, ANDROID_OUTPUT],
  no_af: [WEB, ANDROID_OUTPUT],
  // audio_outputs2
  output_headset: [WEB, ANDROID_OUTPUT],
  output_speaker: [WEB, ANDROID_OUTPUT],
  output_bt: [WEB, ANDROID_OUTPUT],
  output_usb: [WEB, ANDROID_OUTPUT],
  output_chromecast: [WEB, ANDROID_OUTPUT],
  output_other: [WEB, ANDROID_OUTPUT],
  audio_outputs_tweaks: [UI, ''],
  // audio_outputs_tweaks
  usb_activity: [WEB, ANDROID_OUTPUT],
  force_no_speaker: [WEB, ANDROID_OUTPUT],
  use_stream3_player: [WEB, ANDROID_OUTPUT],
  audio_platform_log: [UI, 'Shows the playback diagnostics: output rate, latency and underruns, stream and decoder events, recoveries, offline copies, output level, and a copyable report'],
  // audio_resampler
  resampler_type: [WEB, BROWSER_OUTPUT],
  resampler_cutoff: [WEB, BROWSER_OUTPUT],
  dither: [WEB, BROWSER_OUTPUT],
  // audio_tweaks
  volume_levels: [WEB, ANDROID_VOLUME],
  volume_popup: [WEB, ANDROID_VOLUME],
  pause_on_volume: [WEB, ANDROID_VOLUME],
  allow_platform_fx: [WEB, ANDROID_EFFECTS],
  force_audio_on_focus: [WEB, ANDROID_FOCUS],
  mod_gain_mb: [WEB, TRACKER],
  mod_separation: [WEB, TRACKER],
  reset_reverb_presets: [BUILT, 'Restores the eight built-in reverb presets (F69)'],
  // buy_methods
  buy_play_fv: [NA, NO_PURCHASES],
  buy_rustore_fv: [NA, NO_PURCHASES],
  buy_from_website: [NA, NO_PURCHASES],
  already_purchased: [NA, NO_PURCHASES],
  // fade
  crossfade_auto_advance: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  fade_manual_advance: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  fade_play_pause: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  fade_seek: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  gapless_preload_ms: [WEB, 'Gapless playback is automatic: the next track preloads a minute ahead (a stream needs more than this setting\'s 5 s) and the audio engine joins it to the playing track\'s last frame'],
  track_end_silence_ms: [BUILT, 'Silence after a track before the next one (F70)'],
  crossfade_length_ms: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  fade_short_xfade_ms: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  fade_short_ms: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  fade_seek_ms: [BUILT, 'Fades and crossfades on two media decks, run in the audio engine: equal-power crossfades, S-curve play, pause and seek fades that start with the sound (F70)'],
  // feature_packages
  isPriceReduced: [UI, ''],
  fp1: [NA, NO_PURCHASES],
  move_fp1_to_about: [NA, NO_PURCHASES],
  buy_uber_badges: [NA, NO_PURCHASES],
  uber_level: [NA, NO_PURCHASES],
  // general
  feature_packages: [NA, NO_PURCHASES],
  about_version: [BUILT, 'build id from release.json (commit, player tree, local edits)'],
  updates: [UI, ''],
  check_updates: [NA, REFERENCE_SERVICES],
  check_beta_updates: [NA, REFERENCE_SERVICES],
  check_update: [NA, REFERENCE_SERVICES],
  other: [UI, ''],
  visit_site_about: [UI, ''],
  translations: [UI, ''],
  oss: [BUILT, 'licenses page: butterchurn, butterchurn-presets, Manrope3, TT Norms Pro'],
  privacy: [UI, ''],
  addons: [UI, ''],
  // headset
  resume_on_headset: [WEB, ANDROID_HEADSET],
  resume_on_bt: [WEB, ANDROID_HEADSET],
  pause_on_headset: [WEB, ANDROID_HEADSET],
  pause_on_usb_connection: [WEB, ANDROID_HEADSET],
  headset_buttons: [UI, ''],
  enable_headset_controls: [WEB, ANDROID_HEADSET],
  headset_controls: [WEB, ANDROID_HEADSET],
  avrcp_controls: [WEB, ANDROID_HEADSET],
  long_volume_press: [UI, ''],
  follow_pl_exact: [WEB, ANDROID_HEADSET],
  ignore_bt_sec: [WEB, ANDROID_HEADSET],
  bt_ignore_repeat_shuffle: [WEB, ANDROID_HEADSET],
  headset_beep: [WEB, ANDROID_HEADSET],
  beep_more: [WEB, ANDROID_HEADSET],
  headset_vibrate: [WEB, ANDROID_HEADSET],
  no_android_long_press: [WEB, ANDROID_HEADSET],
  commands_history: [UI, ''],
  // library
  rescan_folders: [BUILT, 'Reloads the R2 index'],
  erase_and_rescan: [BUILT, 'Reloads the R2 index, even when it has not changed'],
  music_folders_button: [UI, ''],
  some_saf_folders_unavailable: [UI, ''],
  file_access_legacy: [WEB, ANDROID_STORAGE],
  _legacy_access_warning: [UI, ''],
  scan_min_track_duration: [BUILT, 'Shorter tracks are left out of the library (F73)'],
  skip_video: [BUILT, 'Files with a video stream are left out (F73)'],
  auto_find_button: [WEB, ANDROID_STORAGE],
  restore_pos: [BUILT, 'Long tracks start where they were left (last_pos, F73)'],
  long_skip_rewind: [BUILT, 'Pro category buttons become -10/+10 s on long tracks (F73)'],
  restore_pos_min_dur: [BUILT, 'Long tracks start where they were left (last_pos, F73)'],
  played_dur: [BUILT, ''],
  library_lists: [UI, ''],
  library_search: [UI, ''],
  library_queue: [UI, ''],
  library_playlists: [UI, ''],
  library_shuffle: [UI, ''],
  library_scanner: [UI, ''],
  reset_stats: [BUILT, 'Resets played times and last played (F73)'],
  // library_lists
  pref_look_and_feel: [UI, ''],
  library_list_opts: [BUILT, 'Opens the home List Options (categories, start category, zoom)'],
  static_navbar: [BUILT, 'bottom anchor becomes fixed: the navbar stays while lists scroll (F75)'],
  navbar_seekbar: [BUILT, ''],
  headers_meta: [BUILT, ''],
  az_scroll: [BUILT, ''],
  localized_az: [BUILT, ''],
  list_header_buttons: [BUILT, ''],
  list_bottom_toolbar: [BUILT, 'header buttons as a bottom toolbar above the navbar; semi-transparent 0.55 (F75)'],
  track_num_type: [BUILT, 'Track labels (library/labels.js)'],
  track_disc_meta: [BUILT, 'Track labels (library/labels.js)'],
  title_filename: [BUILT, 'Track labels (library/labels.js)'],
  list_action_resets: [BUILT, 'Tapping the playing track adopts the list as the queue without it'],
  list_item_action: [BUILT, ''],
  enable_deletion: [OWNER, NO_DELETE],
  join_albums: [BUILT, 'Album keys (album, album artist); Library.albums()'],
  use_albumartist: [BUILT, 'Track labels (library/labels.js)'],
  use_albumartist_albums: [BUILT, 'Album rows lead with the album artist (sources.js albumRowArtist)'],
  use_albumartist_albumartists: [BUILT, 'Track labels (library/labels.js)'],
  hide_unknown_album: [BUILT, 'Track labels (library/labels.js)'],
  hide_unknown_artist: [BUILT, 'Track labels (library/labels.js)'],
  show_unsplit_cats: [BUILT, 'Split categories (library/split.js); unsplit entries with show_unsplit_cats'],
  hier_no_advance: [BUILT, 'header Play in Folders Hierarchy sets Play All Categories unless on (F76)'],
  root_hier_immediate: [BUILT, 'Folders Hierarchy opens at the first folder with tracks or several subfolders (F76)'],
  hier_files_zoom: [BUILT, 'a files-only folder takes the Folders files zoom (F76)'],
  no_sort_field: [BUILT, 'Sort field drops The/A/An (sources.js sortKey)'],
  show_cue_source: [OWNER, LOCAL_FILES],
  stream_name_in_title: [OWNER, NO_STREAMS],
  // library_playlists
  playlists_import: [BUILT, 'Picks playlist files (the browser cannot read a system library); F66'],
  playlists_export: [BUILT, 'Downloads <name>.m3u8 per playlist (F66)'],
  pl_import_ratings: [BUILT, '#EXT-X-RATING sets ratings on import'],
  playlist_insert_pos: [BUILT, ''],
  pl_del_entry_w_track: [OWNER, NO_DELETE],
  pl_auto_resolve: [BUILT, 'Unresolved entries are matched again on library changes'],
  pl_no_dups: [BUILT, ''],
  // library_queue
  queue_start: [BUILT, 'Queue start: immediately, after the song, after the list (F65)'],
  queue_end: [BUILT, 'Queue end: return to the list, or stay / repeat (F65)'],
  queue_insert_pos: [BUILT, 'Shared with the selection menu mode (c40)'],
  play_next_insert_pos: [BUILT, 'Shared with the selection menu mode (c40)'],
  q_next_forces_after_song: [BUILT, 'Play Next sets queue_start to after the song'],
  queue_clear_on_add: [BUILT, 'Queue clearing on add (hs.y)'],
  queue_never_clear_on_add: [BUILT, 'Queue clearing on add (hs.y)'],
  queue_no_shuffle: [BUILT, 'The Queue plays in order'],
  // library_scanner
  auto_scan: [WEB, ANDROID_STORAGE],
  scan_no_wait: [WEB, ANDROID_STORAGE],
  initial_scan: [WEB, ANDROID_STORAGE],
  scan_providers: [WEB, ANDROID_STORAGE],
  scan_post_usb_mount: [WEB, ANDROID_STORAGE],
  scan_post_system: [WEB, ANDROID_STORAGE],
  artists_split_chars: [BUILT, 'Split categories (library/split.js); unsplit entries with show_unsplit_cats'],
  artists_split_ignore: [BUILT, 'Split categories (library/split.js); unsplit entries with show_unsplit_cats'],
  composers_split_chars: [BUILT, 'Split categories (library/split.js); unsplit entries with show_unsplit_cats'],
  genres_split_chars: [BUILT, 'Split categories (library/split.js); unsplit entries with show_unsplit_cats'],
  tag_encoding: [OWNER, LOCAL_FILES],
  m3u_utf8: [BUILT, '.m3u in UTF-8, else the tag encoding'],
  process_cues: [OWNER, LOCAL_FILES],
  // library_search
  msg: [UI, ''],
  list_opts: [BUILT, 'Opens the Search List Options (searched categories)'],
  search_play_tracks: [BUILT, 'Song taps queue the found songs only (vo1.g0)'],
  search_track_titles_only: [BUILT, 'Songs match by title only (uf1 field sets)'],
  // library_shuffle
  shuffle_random_factor: [BUILT, 'Least recently played tracks first below full randomization (ie.W, F72)'],
  no_reshuffle: [BUILT, 'Picking a track of the playing list keeps the shuffle order (F72)'],
  no_reshuffle_for_large_lists: [BUILT, 'Picking a track of the playing list keeps the shuffle order (F72)'],
  category_shuffle: [BUILT, 'header Shuffle mode on category lists and their albums (F76)'],
  hier_flat_shf: [BUILT, 'header Shuffle in Folders Hierarchy shuffles every song of the subtree (F76)'],
  // lockscreen
  ics_ls_cat: [UI, ''],
  ics_ls_aa: [WEB, ANDROID_LOCKSCREEN],
  ls_aa_blur: [WEB, ANDROID_LOCKSCREEN],
  ls_default_aa: [WEB, ANDROID_LOCKSCREEN],
  buttons: [UI, ''],
  pref_poweramp_ls: [UI, ''],
  ls_enable: [WEB, ANDROID_LOCKSCREEN],
  ls_force_timeout: [WEB, ANDROID_LOCKSCREEN],
  ls_app_settings: [WEB, ANDROID_LOCKSCREEN],
  ls_enable_land: [WEB, ANDROID_LOCKSCREEN],
  direct_unlock: [WEB, ANDROID_LOCKSCREEN],
  // misc
  scrobble_to_last_fm: [WEB, ANDROID_APPS],
  scrobble_to_simple_last_fm: [WEB, ANDROID_APPS],
  android_auto: [UI, ''],
  mb_a_grid: [WEB, ANDROID_AUTO],
  mb_a_aa_cats: [WEB, ANDROID_AUTO],
  mb_a_aa_tracks: [WEB, ANDROID_AUTO],
  send_mediasession_q: [WEB, ANDROID_MEDIA_API],
  tweaks: [UI, ''],
  send_metachanged: [WEB, ANDROID_MEDIA_API],
  use_wakelock: [WEB, ANDROID_SYSTEM],
  send_old_api_aa: [WEB, ANDROID_MEDIA_API],
  check_for_skin_reload: [WEB, THIRD_PARTY_SKINS],
  shutdown_intent: [WEB, ANDROID_SYSTEM],
  pause_on_screen_off: [WEB, ANDROID_SYSTEM],
  op_framerate: [WEB, ANDROID_SYSTEM],
  migrate_data_29: [UI, ''],
  stream_timeout_ms: [OWNER, NO_STREAMS],
  stream_buffer_bytes: [OWNER, NO_STREAMS],
  user_agent: [OWNER, NO_STREAMS],
  load_user_so: [WEB, ANDROID_SYSTEM],
  override_region: [NA, NO_PURCHASES],
  volume_keys_long_press_cat: [UI, ''],
  volume_keys_long_press_hint: [UI, ''],
  long_volume_controls: [WEB, ANDROID_VOLUME],
  // peq_equ_bands
  equ_bands_num: [BUILT, 'Band layout: ISO 10/15/31 centres; other counts log-spaced (inferred, F68)'],
  _number_of_bands_msg: [UI, ''],
  equ_custom_bands: [BUILT, 'Band layout: ISO 10/15/31 centres; other counts log-spaced (inferred, F68)'],
  equ_custom_bands_num: [BUILT, 'Band layout: ISO 10/15/31 centres; other counts log-spaced (inferred, F68)'],
  equ_custom_bands_first_fr: [BUILT, 'Band layout: ISO 10/15/31 centres; other counts log-spaced (inferred, F68)'],
  equ_custom_bands_last_fr: [BUILT, 'Band layout: ISO 10/15/31 centres; other counts log-spaced (inferred, F68)'],
  // peq_equ_tone
  _bassFreq: [BUILT, 'Tone shelf corner frequency and Q (tone_* values, F68)'],
  _bassQ: [BUILT, 'Tone shelf corner frequency and Q (tone_* values, F68)'],
  _trebleFreq: [BUILT, 'Tone shelf corner frequency and Q (tone_* values, F68)'],
  _trebleQ: [BUILT, 'Tone shelf corner frequency and Q (tone_* values, F68)'],
  // rg
  rg_type: [BUILT, 'ReplayGain from track/album tags with preamp, default gain and peak limiting (F71)'],
  rg_source: [BUILT, 'ReplayGain from track/album tags with preamp, default gain and peak limiting (F71)'],
  rg_preamp_mb: [BUILT, 'ReplayGain from track/album tags with preamp, default gain and peak limiting (F71)'],
  rg_default_mb: [BUILT, 'ReplayGain from track/album tags with preamp, default gain and peak limiting (F71)'],
  // singlepane
  manage_app_warn: [BUILT, ''],
  perm_warn: [UI, ''],
  buy_huawei_fv: [NA, NO_PURCHASES],
  ui: [UI, ''],
  audio: [UI, ''],
  vis: [UI, ''],
  aa_bg: [UI, ''],
  aa: [UI, ''],
  folders_library: [UI, ''],
  headset: [UI, ''],
  lockscreen: [UI, ''],
  misc: [UI, ''],
  general: [UI, ''],
  equalizer_for_spot_ytm_etc: [UI, ''],
  settings_export: [BUILT, ''],
  settings_import: [BUILT, ''],
  send_errors: [NA, REFERENCE_SERVICES],
  // space
  vis_full_rescan: [WEB, BUNDLED_PRESETS],
  // support
  faq: [NA, REFERENCE_SERVICES],
  purchase_faq: [NA, REFERENCE_SERVICES],
  poweramp_forum: [NA, REFERENCE_SERVICES],
  send_log: [NA, REFERENCE_SERVICES],
  // translations
  visit_crowdin: [NA, REFERENCE_SERVICES],
  // ui
  ui_theme: [UI, ''],
  follow_night_mode: [BUILT, ''],
  settings_theme: [BUILT, ''],
  settings_font: [BUILT, ''],
  ui_player: [UI, ''],
  ui_lyrics: [UI, ''],
  ui_notify: [UI, ''],
  lang: [BUILT, ''],
  ui_icon: [UI, ''],
  orientation: [BUILT, ''],
  anim_speed: [BUILT, ''],
  start_at_lib: [BUILT, ''],
  hide_status_bar: [BUILT, 'Substitute: the Fullscreen API, entered on the next touch'],
  keep_screen_on: [BUILT, 'Substitute: a screen wake lock'],
  num_settings_tags: [BUILT, ''],
  // ui_icon
  icon_list: [UI, ''],
  // ui_lyrics
  main_lyrics_swipe: [BUILT, ''],
  main_lyrics_button: [BUILT, ''],
  lyrics_in_menu: [BUILT, ''],
  lyrics_keep_screen: [BUILT, 'Substitute: a screen wake lock'],
  lyrics_offset: [BUILT, ''],
  list_zoom_lyrics: [BUILT, 'Partial: pinching steps the size without the list zoom transition'],
  lyrics_plugin: [BUILT, 'Partial: None and Browser via custom URL; the lyrics apps are Android apps and fall back to the custom URL'],
  lyrics_custom_url: [BUILT, "Default empty: the reference's default search host is not on the repository's host allowlist"],
  rescan_lyrics_tags: [OWNER, LOCAL_FILES],
  lrc_scan: [OWNER, LOCAL_FILES],
  lrc_utf8: [OWNER, LOCAL_FILES],
  // ui_mediaactions
  notify_action1: [WEB, MEDIA_SESSION_ACTIONS],
  notify_action2: [WEB, MEDIA_SESSION_ACTIONS],
  notify_action3: [WEB, MEDIA_SESSION_ACTIONS],
  notify_action4: [WEB, MEDIA_SESSION_ACTIONS],
  notify_action5: [WEB, MEDIA_SESSION_ACTIONS],
  notify_action6: [WEB, MEDIA_SESSION_ACTIONS],
  // ui_notify
  notification_type: [WEB, ANDROID_NOTIFY],
  notification_colors: [WEB, ANDROID_NOTIFY],
  notify_colorize: [WEB, ANDROID_NOTIFY],
  status_lib: [WEB, ANDROID_NOTIFY],
  notify_prefer_nav: [WEB, ANDROID_NOTIFY],
  notify_prio: [WEB, ANDROID_NOTIFY],
  notification_keeping: [UI, ''],
  keep_notification: [WEB, ANDROID_NOTIFY],
  notify_resume: [WEB, ANDROID_NOTIFY],
  _notify_resume_hint: [UI, ''],
  keep_service: [WEB, ANDROID_NOTIFY],
  no_keep_notif_on_dscn: [WEB, ANDROID_NOTIFY],
  // ui_player
  aa_anim: [BUILT, ''],
  anim_long_labels: [BUILT, ''],
  anim_long_labels_in_lists: [BUILT, ''],
  edit_player_screen_buttons: [BUILT, ''],
  sub_aa_buttons_no_gap: [BUILT, ''],
  sub_aa_buttons_no_lp_edit: [BUILT, ''],
  cc_button: [BUILT, ''],
  rating_type: [BUILT, ''],
  hint_5stars: [UI, ''],
  hide_menu: [BUILT, ''],
  menu_button_long_press: [BUILT, ''],
  line2_click: [BUILT, ''],
  line2_long_click: [BUILT, ''],
  show_counter: [BUILT, ''],
  _counter_hint: [UI, ''],
  previous_resets: [BUILT, ''],
  menu_nav_to_folders: [BUILT, 'track menu Folders: Folders instead of Folders Hierarchy (F76)'],
  // ui_theme
  theme_list: [BUILT, ''],
  theme_list_3rdparty: [WEB, THIRD_PARTY_SKINS],
  // vis
  enable_vis: [BUILT, ''],
  vis_frs_type: [BUILT, ''],
  vis_in_lib: [BUILT, ''],
  vis_preset_change_sec: [BUILT, ''],
  vis_panel_faded_alpha: [BUILT, ''],
  vis_controls_faded_alpha: [BUILT, ''],
  vis_temp_ui_ms: [BUILT, ''],
  vis_aa_visible: [BUILT, ''],
  vis_ignore_touch_faded: [BUILT, ''],
  vis_list_faded_alpha: [BUILT, ''],
  vis_fs_hide_bars: [BUILT, 'Substitute: the Fullscreen API, entered on the next touch'],
  vis_use_compact_bars: [OWNER, BUTTERCHURN_ONLY],
  milk_hd: [BUILT, ''],
  milk_crop_aspect: [OWNER, BUTTERCHURN_ONLY],
  milk_30_fps: [BUILT, ''],
  milk_strict: [OWNER, BUTTERCHURN_ONLY],
  vis_extra_delay_info: [UI, ''],
  list: [UI, ''],
  vis_rescan: [WEB, BUNDLED_PRESETS],
  vis_rescan_hint: [UI, ''],
  milk_hide_unliked: [BUILT, ''],
  list_3rdparty: [UI, ''],
};

/**
 * The line a settings row shows, greyed out, when this player has no
 * counterpart for its key (WEB, OWNER, NA); null for the others.
 */
export function unavailableNote(key) {
  const [status, reason = ''] = PREF_STATUS[key] ?? [];
  if (status === WEB) return 'Not available on the web: ' + reason;
  if (status === OWNER) {
    const why = reason.replace(/^Owner decision: /, '');
    return 'Turned off in this player: ' + why.charAt(0).toLowerCase() + why.slice(1);
  }
  if (status === NA) return 'Not part of this player';
  return null;
}

/** The keyed preference entries of a reference model: [{key, screen, type}] in document order, first occurrence. */
export function prefKeys(model) {
  const out = [], seen = new Set();
  for (const [name, tree] of Object.entries(model.xml ?? {})) {
    if (!name.startsWith('xml/')) continue;
    const walk = n => {
      if (!Array.isArray(n)) return;
      if (typeof n[0] !== 'string') { n.forEach(walk); return; }
      const key = n[1]?.['android:key'];
      if (key && !seen.has(key)) { seen.add(key); out.push({key, screen: name.slice(4), type: n[0].slice(n[0].lastIndexOf('.') + 1)}); }
      (n[2] ?? []).forEach(walk);
    };
    walk(tree);
  }
  return out;
}
