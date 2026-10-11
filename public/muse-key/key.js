/* Owner-only browser interaction. No storage, request, telemetry or shared shell. */
(() => {
  'use strict';
  const generate = document.getElementById('generate');
  const clear = document.getElementById('clear');
  const keyField = document.getElementById('private-key');
  const fingerprintField = document.getElementById('fingerprint');
  const copyKey = document.getElementById('copy-key');
  const copyFingerprint = document.getElementById('copy-fingerprint');
  const status = document.getElementById('status');
  const available = window.isSecureContext && window.top === window &&
    typeof crypto?.getRandomValues === 'function' && typeof crypto?.subtle?.digest === 'function' &&
    typeof TextEncoder === 'function' && !navigator.serviceWorker?.controller;
  let epoch = 0;
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  function reset(message) {
    epoch++;
    keyField.value = '';
    fingerprintField.value = '';
    copyKey.disabled = copyFingerprint.disabled = true;
    generate.disabled = !available;
    status.textContent = message;
  }
  reset(available ? 'Ready. Only your tap creates a key.' : 'Secure browser support is unavailable. No key can be generated here.');
  generate.addEventListener('click', async event => {
    if (!event.isTrusted || generate.disabled || !available) return;
    const generation = ++epoch;
    generate.disabled = true;
    status.textContent = 'Generating privately on this phone…';
    const bytes = new Uint8Array(32);
    let key = '';
    try {
      crypto.getRandomValues(bytes);
      key = hex(bytes);
      // Match the server: SHA-256 of the UTF-8 hex string, not the raw random bytes.
      const fingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))));
      if (generation !== epoch) return;
      keyField.value = key;
      fingerprintField.value = fingerprint;
      copyKey.disabled = copyFingerprint.disabled = false;
      status.textContent = 'Ready. Copy the private key into the secure form first.';
    } catch {
      if (generation === epoch) reset('Generation failed. No key was retained. Try again in a supported secure browser.');
    } finally {
      bytes.fill(0);
      key = '';
    }
  });
  async function copy(event, field, message) {
    if (!event.isTrusted || !field.value) return;
    const generation = epoch;
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(field.value);
      if (generation === epoch) status.textContent = message;
    } catch {
      if (generation !== epoch) return;
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
      status.textContent = 'Copy was blocked. Press and hold the selected '+(field === keyField ? 'private key; paste it only into the secure form.' : 'fingerprint to copy it for Lucy.');
    }
  }
  copyKey.addEventListener('click', event => copy(event, keyField, 'Private key copied. Paste it only into the Lucy–Muse secure form.'));
  copyFingerprint.addEventListener('click', event => copy(event, fingerprintField, 'Fingerprint copied. This is the value to send to Lucy.'));
  clear.addEventListener('click', () => reset('Cleared from this page. Your clipboard is unchanged.'));
  window.addEventListener('pagehide', () => reset('Values cleared when this page was left.'));
})();
