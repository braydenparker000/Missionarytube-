import assert from 'node:assert/strict';
import {MAKIMA_CALLBACK} from '../../relay-makima-policy.js';

// Synthetic-response helper only. Parse the exact ordinary-link contract;
// never treat Location or a hidden redirect as equivalent to a committed page.
export async function makimaContinuationURL(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Location'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const html = await response.clone().text();
  assert.doesNotMatch(html, /<script|<form|<iframe|<img|<link|<style|http-equiv|\bon[a-z]+=/i);
  const matches = [...html.matchAll(/<a id="makima-oauth-continue" href="([^"]+)" rel="noreferrer" referrerpolicy="no-referrer">Continue to Makima<\/a>/g)];
  assert.equal(matches.length, 1);
  assert.equal((html.match(/<a\b/g) || []).length, 1);
  const target = new URL(matches[0][1].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
  assert.equal(target.origin + target.pathname, MAKIMA_CALLBACK);
  assert.equal(target.username, ''); assert.equal(target.password, ''); assert.equal(target.hash, '');
  return target;
}
