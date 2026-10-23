// Dormant agents: Lucy (ChatGPT) and Makima (Grok). The owner cancelled both
// subscriptions on 2026-10-23, so the private workspace no longer shows them.
// Their pages (private/lucy.html, the Makima view), Worker routes and tests
// stay in place and keep working.
// To bring one back, remove it from DORMANT. A browser where
// localStorage[SHOW_DORMANT_KEY] is '1' shows them again (used by the
// existing Lucy and Makima browser tests).
export const DORMANT = Object.freeze(['lucy', 'makima']);
export const SHOW_DORMANT_KEY = 'jarvis.private.show-dormant-agents.v1';

/** The agents the workspace hides: DORMANT, unless this browser shows them. */
export function hiddenAgents() {
  try { if (localStorage.getItem(SHOW_DORMANT_KEY) === '1') return new Set(); } catch { /* storage unavailable */ }
  return new Set(DORMANT);
}
