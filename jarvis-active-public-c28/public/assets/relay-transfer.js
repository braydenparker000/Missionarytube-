export const RELAY_TRANSFER_KEY = 'jarvis.relay.transfer.v2';
export const LEGACY_TRANSFER_KEY = 'jarvis.relay.transfer.v1';
const destinations = {owner: 'private', public: 'public'};
const isBody = value => typeof value === 'string' && !!value.trim() && value.length <= 4000;
const valid = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => ['version', 'id', 'destination', 'visibility', 'body'].includes(key))
  && value.version === 2 && typeof value.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id)
  && Object.hasOwn(destinations, value.destination) && value.visibility === destinations[value.destination] && isBody(value.body);
export function quickAITransfer(question, answer, destination, id = crypto.randomUUID()) {
  const text = 'Please continue this conversation.\n\nMy question: ' + question + '\n\nQuick AI answer:\n' + answer;
  const body = text.length > 3500 ? text.slice(0, 3500) + '\n\n[Text shortened for Relay. The full conversation remains in Quick AI.]' : text;
  const transfer = {version: 2, id, destination, visibility: destinations[destination], body};
  if (!valid(transfer)) throw Error('Choose a Relay destination.');
  return transfer;
}
export function createRelayTransferStore({storage = globalThis.sessionStorage} = {}) {
  const unreadable = () => Error('Could not retain the Relay draft. Keep this page open and try again.');
  function read() {
    let raw;
    try { raw = storage?.getItem(RELAY_TRANSFER_KEY); } catch { throw unreadable(); }
    if (!raw) return null;
    try {
      const record = JSON.parse(raw), application = record.application;
      if (record.version !== 2 || !valid(record.pending) || Object.keys(record).some(key => !['version', 'pending', 'application', 'legacyBody'].includes(key))
        || (record.legacyBody !== undefined && !isBody(record.legacyBody))
        || (application !== null && (!application || Object.keys(application).some(key => !['base', 'merged'].includes(key))
          || typeof application.base !== 'string' || application.base.length > 4000 || !isBody(application.merged)
          || application.merged !== (application.base ? application.base + '\n\n' : '') + record.pending.body))) throw unreadable();
      return record;
    } catch { throw unreadable(); }
  }
  function write(record) {
    try { if (!storage) throw unreadable(); storage.setItem(RELAY_TRANSFER_KEY, JSON.stringify(record)); }
    catch { throw unreadable(); }
  }
  function legacy() {
    try {
      const body = storage?.getItem(LEGACY_TRANSFER_KEY);
      if (!body) return null;
      if (!isBody(body)) throw unreadable();
      return {legacy: true, body};
    } catch { throw unreadable(); }
  }
  return {
    peek() { return read()?.pending || legacy(); },
    stage(transfer) {
      if (!valid(transfer)) throw Error('Invalid Relay draft destination.');
      if (read() || legacy()) throw Error('An unsent Relay transfer is already waiting. Open Relay to review it first.');
      write({version: 2, pending: transfer, application: null});
    },
    selectLegacy(destination, id = crypto.randomUUID()) {
      if (read()) return;
      const saved = legacy(); if (!saved) return;
      const pending = {version: 2, id, destination, visibility: destinations[destination], body: saved.body};
      if (!valid(pending)) throw Error('Choose a Relay destination.');
      write({version: 2, pending, application: null, legacyBody: saved.body});
    },
    prepareDismissal() {
      const record = read(), pending = record?.pending || legacy();
      if (!pending) throw Error('There is no saved Relay transfer to dismiss.');
      let raw, legacyRaw;
      try { raw = storage.getItem(RELAY_TRANSFER_KEY); legacyRaw = storage.getItem(LEGACY_TRANSFER_KEY); }
      catch { throw unreadable(); }
      // Bind the user's review to the entire saved journal, including any
      // interrupted adoption. Never dismiss a newer or changed transfer.
      return {pending, dismiss() {
        let current, currentLegacy;
        try { current = storage.getItem(RELAY_TRANSFER_KEY); currentLegacy = storage.getItem(LEGACY_TRANSFER_KEY); }
        catch { throw unreadable(); }
        if (current !== raw || currentLegacy !== legacyRaw) throw Error('The saved transfer changed. Review it again before dismissing it.');
        try {
          if (record) {
            if (record.legacyBody && legacyRaw === record.legacyBody) storage.removeItem(LEGACY_TRANSFER_KEY);
            storage.removeItem(RELAY_TRANSFER_KEY);
          } else storage.removeItem(LEGACY_TRANSFER_KEY);
        } catch { throw unreadable(); }
        return true;
      }};
    },
    apply({destination, draft, saveDraft}) {
      const record = read(); if (!record) return {status: legacy() ? 'choose_destination' : 'none'};
      if (record.pending.destination !== destination) return {status: 'different_destination'};
      if (typeof draft !== 'string' || draft.length > 4000) throw unreadable();
      // Persist the exact before/after values before changing a composer. A
      // navigation or failed acknowledgement can then retry without duplication.
      const application = record.application;
      if (application && draft !== application.base && draft !== application.merged) return {status: 'draft_changed'};
      const merged = application?.merged ?? (draft ? draft + '\n\n' : '') + record.pending.body;
      if (merged.length > 4000) return {status: 'too_long'};
      if (!application) { record.application = {base: draft, merged}; write(record); }
      if (saveDraft(merged) !== true) return {status: 'storage_unavailable'};
      try {
        if (record.legacyBody && storage.getItem(LEGACY_TRANSFER_KEY) === record.legacyBody) storage.removeItem(LEGACY_TRANSFER_KEY);
        storage.removeItem(RELAY_TRANSFER_KEY);
      } catch { throw unreadable(); }
      return {status: 'applied', draft: merged};
    }
  };
}
