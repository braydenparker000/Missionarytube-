// Error inbox: sends this page's uncaught errors and unhandled promise
// rejections to the Jarvis Worker, where Claude reads them, so a bug on the
// owner's phone is seen without anyone having to report it.
//
// Load it as the first module of a page:
//   <script type="module" src="/assets/error-report.js" data-app="guitar"></script>
// What travels: the app name, the error message, a short stack, the page path
// (no query string or hash) and the browser's user agent. Nothing the owner
// typed or saved. Each distinct error is sent at most 3 times per page load and
// 20 reports at most in all; reports go in small batches, and the last batch
// goes out when the page is hidden. Only on the live site.

import {API_ORIGIN} from './config.js';

const SITE = 'https://missionarytube.z13.web.core.windows.net';
const ENDPOINT = API_ORIGIN + '/claude-chat/errors';
const PER_ERROR = 3, PER_PAGE = 20, BATCH_MS = 2000;

const script = document.currentScript || document.querySelector('script[src*="/assets/error-report.js"]');
const app = script?.dataset.app || location.pathname.split('/')[1] || 'home';
const seen = new Map();
let queue = [], sent = 0, timer = 0;

/** A report for one error, or null when it is not worth sending. */
export function reportOf(kind, error, message, now = Date.now()) {
  // The Error itself says it best ("TypeError: x is undefined"); event messages add an "Uncaught " prefix.
  const text = String(error instanceof Error ? `${error.name}: ${error.message}` : message || error || '').slice(0, 300);
  if (!text || /^Script error\.?$/i.test(text)) return null; // cross-origin noise carries nothing
  return {app, kind, message: text, stack: String(error?.stack || '').slice(0, 1600), path: location.pathname, ua: navigator.userAgent.slice(0, 160), at: now};
}

function add(report) {
  if (!report || sent + queue.length >= PER_PAGE) return;
  const key = report.kind + '|' + report.message;
  const count = seen.get(key) || 0;
  if (count >= PER_ERROR) return;
  seen.set(key, count + 1);
  queue.push(report);
  clearTimeout(timer);
  timer = setTimeout(flush, BATCH_MS);
}

function flush() {
  clearTimeout(timer);
  if (!queue.length) return;
  const reports = queue.splice(0, 10);
  sent += reports.length;
  try {
    fetch(ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({reports}), keepalive: true, credentials: 'omit', mode: 'cors'}).catch(() => {});
  } catch {}
  if (queue.length) timer = setTimeout(flush, BATCH_MS);
}

if (location.origin === SITE) {
  addEventListener('error', event => {
    // A failed <img> or <script> load also fires "error", without an Error; those are not code bugs.
    if (event.target && event.target !== window) return;
    add(reportOf('error', event.error, event.message));
  });
  addEventListener('unhandledrejection', event => add(reportOf('rejection', event.reason, event.reason?.message)));
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
}
