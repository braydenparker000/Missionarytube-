// Fixed, data-free script. Its exact bytes are authorized by the CSP hash below.
// Never disable named submit buttons: the first decision must remain a successful
// form control. The server remains authoritative for CSRF and one-time consent.
export const MAKIMA_CONSENT_SCRIPT = `(() => {
  const form = document.querySelector('form');
  const status = document.getElementById('makima-submit-status');
  const navigationStatus = document.getElementById('makima-navigation-status');
  let pending = false;
  const restore = () => {
    pending = false;
    form.removeAttribute('aria-busy');
    for (const button of form.querySelectorAll('button')) button.removeAttribute('aria-disabled');
    status.hidden = true;
    navigationStatus.hidden = true;
  };
  form.addEventListener('submit', event => {
    if (pending) { event.preventDefault(); return; }
    pending = true;
    form.setAttribute('aria-busy', 'true');
    for (const button of form.querySelectorAll('button')) button.setAttribute('aria-disabled', 'true');
    status.hidden = false;
  });
  window.addEventListener('securitypolicyviolation', event => {
    if (event.effectiveDirective === 'form-action') navigationStatus.hidden = false;
  });
  window.addEventListener('pageshow', restore);
})();`;
export const MAKIMA_CONSENT_SCRIPT_HASH = 'sha256-7pQWv7SlsLCtd5EUqNduxNLQ2AVRYZEURfbAUd7n88Q=';
