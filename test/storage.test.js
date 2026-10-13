import test from 'node:test';
import assert from 'node:assert/strict';
import { canStoreLocally } from '../frontend/storage.js';

test('detecta un WebView sense localStorage', () => {
  assert.equal(canStoreLocally(() => null), false);
  assert.equal(canStoreLocally(() => { throw new Error('Storage blocked'); }), false);
});

test('un objecte storage que rebutja escriptures no compta com a disponible', () => {
  assert.equal(canStoreLocally(() => ({ setItem() { throw new Error('QuotaExceededError'); } })), false);
});

test('l’emmagatzematge ha de conservar una escriptura de prova', () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
  };
  assert.equal(canStoreLocally(() => storage), true);
  assert.equal(values.size, 0);
  assert.equal(canStoreLocally(() => ({ ...storage, getItem: () => null })), false);
});
