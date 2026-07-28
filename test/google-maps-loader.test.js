import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadGoogleMaps(apiKey = 'test-key') {
  const source = await readFile(new URL('../src/lib/googleMaps.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'googleMaps.ts');
  const locationStub = `data:text/javascript,${encodeURIComponent(`
    export const appendSingapore = (value) => value;
    export const SINGAPORE_BOUNDS = {};
  `)}`;
  const code = compiled.code
    .replace('"./location"', JSON.stringify(locationStub))
    .replace('import.meta.env.VITE_GOOGLE_MAPS_API_KEY', JSON.stringify(apiKey));
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('a missing Google Maps API key reports configuration and does not inject a script', async () => {
  let createdScripts = 0;
  globalThis.window = globalThis;
  delete globalThis.google;
  globalThis.document = {
    createElement() {
      createdScripts += 1;
      return new FakeScript();
    },
    querySelector() {
      return null;
    },
    head: { appendChild() {} },
  };

  const { getGoogleMapsApiKey, loadGoogleMaps: load } = await loadGoogleMaps('');

  assert.equal(getGoogleMapsApiKey(), '');
  await assert.rejects(load(), /VITE_GOOGLE_MAPS_API_KEY is not configured/);
  assert.equal(createdScripts, 0);
});

class FakeScript {
  dataset = {};
  listeners = new Map();
  removed = false;

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    this.listeners.get(type)?.();
  }

  remove() {
    this.removed = true;
  }
}

test('a failed Google Maps load is removed and a later call creates a fresh retry', async () => {
  const scripts = [];
  globalThis.window = globalThis;
  delete globalThis.google;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'script');
      return new FakeScript();
    },
    querySelector() {
      return scripts.find((script) => !script.removed) ?? null;
    },
    head: {
      appendChild(script) {
        scripts.push(script);
      },
    },
  };

  const { loadGoogleMaps: load } = await loadGoogleMaps();
  const firstAttempt = load();
  assert.equal(scripts.length, 1);
  scripts[0].dispatch('error');
  await assert.rejects(firstAttempt, /Could not load Google Maps/);
  assert.equal(scripts[0].removed, true);

  const secondAttempt = load();
  assert.equal(scripts.length, 2);
  assert.notEqual(scripts[1], scripts[0]);
  globalThis.google = { maps: {} };
  scripts[1].dispatch('load');

  assert.equal(await secondAttempt, globalThis.google);
});
