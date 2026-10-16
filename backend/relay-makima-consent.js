// Fixed, data-free script. Its exact bytes are authorized by the CSP hash below.
// Never disable named submit buttons: the first decision must remain a successful
// form control. The server remains authoritative for CSRF and one-time consent.
export const MAKIMA_CONSENT_SCRIPT = `(() => {
  const form = document.querySelector('form');
  const status = document.getElementById('makima-submit-status');
  let pending = false;
  const restore = () => {
    pending = false;
    form.removeAttribute('aria-busy');
    for (const button of form.querySelectorAll('button')) button.removeAttribute('aria-disabled');
    status.hidden = true;
  };
  form.addEventListener('submit', event => {
    if (pending) { event.preventDefault(); return; }
    pending = true;
    form.setAttribute('aria-busy', 'true');
    for (const button of form.querySelectorAll('button')) button.setAttribute('aria-disabled', 'true');
    status.hidden = false;
  });
  window.addEventListener('pageshow', restore);
})();`;
export const MAKIMA_CONSENT_SCRIPT_HASH = 'sha256-YOJG28Qfgz2SAP/wwyX1su96U7Mm+v21obxVkKeXp4Y=';
