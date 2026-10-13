import test from 'node:test';
import assert from 'node:assert/strict';
import ko from '../src/i18n/voice.ko.mjs';
import en from '../src/i18n/voice.en.mjs';
import { catalogs } from '../src/i18n/index.mjs';

test('voice catalogs have identical keys and interpolation variables', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  const variables = text => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
  for (const key of Object.keys(ko)) {
    assert.equal(typeof ko[key], 'string', key);
    assert.equal(typeof en[key], 'string', key);
    assert.ok(ko[key].trim(), key);
    assert.ok(en[key].trim(), key);
    assert.doesNotMatch(en[key], /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/, key);
    assert.deepEqual(variables(en[key]), variables(ko[key]), key);
    assert.equal(catalogs.ko[key], ko[key], key);
    assert.equal(catalogs.en[key], en[key], key);
  }
});
