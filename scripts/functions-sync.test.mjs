import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Cloud Function ships a committed copy of the quote proxy because a
// Firebase functions deploy can only package files inside functions/. This
// keeps the copy honest: edit scripts/quotes-proxy.mjs, then re-run
// `cp scripts/quotes-proxy.mjs functions/quotes-proxy.mjs`.
test('the deployed quotes function uses the same proxy module as the dev server', () => {
  assert.equal(
    readFileSync('functions/quotes-proxy.mjs', 'utf8'),
    readFileSync('scripts/quotes-proxy.mjs', 'utf8'),
  );
});

// The files function ships its own committed copy of the proxy module for the
// same reason: edit scripts/files-proxy.mjs, then re-run
// `cp scripts/files-proxy.mjs functions/files-proxy.mjs`.
test('the deployed files function uses the same proxy module as the dev server', () => {
  assert.equal(
    readFileSync('functions/files-proxy.mjs', 'utf8'),
    readFileSync('scripts/files-proxy.mjs', 'utf8'),
  );
});

// functions/index.js imports the applet config, so the packaged copy must match
// the repo root one: re-run `cp firebase-applet-config.json functions/`.
test('the deployed files function bundles the same applet config as the repo root', () => {
  assert.equal(
    readFileSync('functions/firebase-applet-config.json', 'utf8'),
    readFileSync('firebase-applet-config.json', 'utf8'),
  );
});
