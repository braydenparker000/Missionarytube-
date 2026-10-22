// Window preferences (BaseActivity, j22, fp0; notebook F63):
// - keep_screen_on keeps the screen on in the app (FLAG_KEEP_SCREEN_ON), and
//   lyrics_keep_screen while the lyrics page is shown. The web counterpart is
//   a screen wake lock, taken again when the page becomes visible.
// - hide_status_bar hides the status bar (FLAG_FULLSCREEN), and
//   vis_fs_hide_bars hides the system bars in the full-screen visualisation
//   (scene_vis). The web counterpart is the Fullscreen API, which needs a user
//   gesture: hide_status_bar enters full screen on the next touch.

export function installScreenPrefs(ctx) {
  let lock = null, pending = false;
  const wantAwake = () => !!ctx.pref('keep_screen_on') || (!!ctx.pref('lyrics_keep_screen') && ctx.topNav?.nav === 'nav_lyrics');
  const syncWake = async () => {
    const want = wantAwake() && document.visibilityState === 'visible';
    if (want && !lock && !pending && navigator.wakeLock) {
      pending = true;
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener?.('release', () => { lock = null; });
      } catch { lock = null; }
      pending = false;
      if (!wantAwake()) syncWake();
    } else if (!want && lock) {
      const l = lock;
      lock = null;
      l.release().catch(() => {});
    }
  };

  // Full screen: ours (entered by these preferences) or the user's.
  let ours = false;
  const fullscreen = () => !!document.fullscreenElement;
  const enter = () => {
    if (fullscreen() || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({navigationUI: 'hide'}).then(() => { ours = true; }).catch(() => {});
  };
  const leave = () => {
    if (!ours || !fullscreen()) { ours = false; return; }
    ours = false;
    document.exitFullscreen?.().catch(() => {});
  };
  const visFullScreen = () => ctx.topNav?.nav === 'nav_main' && ctx.topNav.scenes?.scene === 'scene_vis';
  const wantFullscreen = () => !!ctx.pref('hide_status_bar') || (!!ctx.pref('vis_fs_hide_bars') && visFullScreen());
  const syncFullscreen = () => {
    if (wantFullscreen()) enter();
    else leave();
  };
  // Without a user gesture the request fails: try again on the next touch.
  window.addEventListener('pointerup', () => { if (wantFullscreen() && !fullscreen()) enter(); }, true);
  document.addEventListener('fullscreenchange', () => { if (!fullscreen()) ours = false; });

  ctx.bus.subscribe('bus_gui', msg => {
    if (msg === 'msg_nav_changed') { syncWake(); syncFullscreen(); }
  });
  ctx.bus.subscribe('bus_app', (msg, src, d) => {
    if (msg !== 'msg_app_setting_changed') return;
    if (/^(keep_screen_on|lyrics_keep_screen)$/.test(d?.key)) syncWake();
    if (/^(hide_status_bar|vis_fs_hide_bars)$/.test(d?.key)) syncFullscreen();
  });
  document.addEventListener('visibilitychange', syncWake);
  syncWake();
  return {syncWake, syncFullscreen, get wakeLocked() { return !!lock; }};
}
