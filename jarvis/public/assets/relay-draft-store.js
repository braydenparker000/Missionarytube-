export const OWNER_DRAFT_KEY = 'jarvis.relay.owner-draft.v1';
// Unsent text only, kept for this tab. Never store history or authentication.
export function createOwnerDraftStore({storage} = {}) {
  if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch {} }
  let unreadable = false;
  return {
    read() {
      try {
        const raw = storage?.getItem(OWNER_DRAFT_KEY); if (!raw) return '';
        const value = JSON.parse(raw);
        if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.body !== 'string' || value.body.length > 4000) throw Error();
        return value.body;
      } catch { unreadable = true; return ''; }
    },
    save(body) {
      if (unreadable && body) return false;
      try {
        if (body) storage?.setItem(OWNER_DRAFT_KEY, JSON.stringify({body}));
        else { storage?.removeItem(OWNER_DRAFT_KEY); unreadable = false; }
        return !!storage || typeof document === 'undefined';
      } catch { return false; }
    }
  };
}
