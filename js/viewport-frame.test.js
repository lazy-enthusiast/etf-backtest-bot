import test from 'node:test';
import assert from 'node:assert/strict';
import { visualViewportFrame } from './viewport-frame.js';

test('visual viewport frame clears when the keyboard is gone', () => {
  assert.equal(visualViewportFrame(844, { height: 844, offsetTop: 0 }, true), null);
  assert.equal(visualViewportFrame(844, { height: 844.4, offsetTop: 0 }, true), null);
  assert.equal(visualViewportFrame(800, { height: 500, offsetTop: 120 }, false), null);
});

test('visual viewport frame follows a shortened or panned viewport', () => {
  assert.deepEqual(visualViewportFrame(844, { height: 420, offsetTop: 0 }, true), { height: 420, offset: 0 });
  assert.deepEqual(visualViewportFrame(844, { height: 844, offsetTop: 180 }, true), { height: 844, offset: 180 });
  assert.deepEqual(visualViewportFrame(844, { height: 390.2, offsetTop: 40.6 }, true), { height: 390, offset: 41 });
});
