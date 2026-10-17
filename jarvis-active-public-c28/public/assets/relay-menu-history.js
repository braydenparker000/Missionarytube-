// Relay sheets own only their transient entry. No conversation or owner data is
// stored in history, and no other module opts into this lifecycle.
const KEY = 'jarvisRelayMenu';
export function createRelayMenuHistory({history, getURL, createId = () => crypto.randomUUID()}) {
  const current = () => ({url: getURL(), marker: history.state?.[KEY]});
  const matches = (entry, id, layer, url) => entry.url === url &&
    entry.marker?.id === id && entry.marker.layer === layer && entry.marker.url === url;
  let previous = current(), active = null, revision = 0;
  const finishing = new Map();

  function finish(record, allowAction) {
    active = null;
    finishing.set(record.dialog, {record, allowAction, revision});
    if (record.dialog.open) record.dialog.close();
    else closed(record.dialog);
  }
  function open(dialog) {
    revision++;
    const entry = current();
    // A dismissed Forward/reloaded entry can be reused, rather than adding a
    // second inert same-URL step above it.
    const reusable = entry.marker?.layer === 'menu' && entry.marker.url === entry.url;
    const id = reusable ? entry.marker.id : createId();
    if (!reusable) {
      const base = {...history.state, [KEY]: {id, layer: 'base', url: entry.url}};
      history.replaceState(base, '', entry.url);
      history.pushState({...base, [KEY]: {id, layer: 'menu', url: entry.url}}, '', entry.url);
    }
    active = {dialog, id, url: entry.url, closing: false, action: null};
    previous = current();
  }
  function close(dialog, action) {
    if (!active || active.dialog !== dialog) return;
    if (active.closing) return;
    active.closing = true;
    active.action = action || null;
    if (matches(current(), active.id, 'menu', active.url)) history.back();
    else finish(active, false);
  }
  function closed(dialog) {
    const done = finishing.get(dialog);
    if (done) {
      finishing.delete(dialog);
      const {record, allowAction, revision: expected} = done;
      if (allowAction && expected === revision &&
          matches(current(), record.id, 'base', record.url)) record.action?.();
    } else if (active?.dialog === dialog) {
      // Native/programmatic close must retire the owned entry too.
      close(dialog);
    }
  }
  function popstate() {
    const target = current(), from = previous;
    previous = target;
    if (active) {
      const record = active;
      const ownBase = matches(target, record.id, 'base', record.url);
      finish(record, ownBase);
      return ownBase;
    }
    if (from.marker?.layer === 'menu' &&
        matches(target, from.marker.id, 'base', from.url)) {
      // Reload/Forward never resurrect stale actions. Back through an already
      // dismissed entry must continue to the preceding real destination.
      history.back();
      return true;
    }
    return target.url === from.url && target.marker?.layer === 'menu' &&
      target.marker.url === target.url;
  }
  function navigate(action) {
    revision++;
    if (active) {
      // The latest destination replaces an earlier pending menu action.
      active.action = action;
      if (!active.closing) {
        active.closing = true;
        if (matches(current(), active.id, 'menu', active.url)) history.back();
        else finish(active, false);
      }
    } else action();
  }
  function invalidate() {
    revision++;
    previous = current();
    if (active) {
      active.action = null;
      close(active.dialog);
    }
  }
  return {open, close, closed, popstate, navigate, invalidate};
}
