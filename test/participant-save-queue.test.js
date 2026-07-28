import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

globalThis.window = globalThis;

async function loadQueue() {
  const source = await readFile(new URL('../src/lib/participantSaveQueue.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'participantSaveQueue.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

const { ParticipantSaveQueue } = await loadQueue();
const participant = (id, name) => ({ id, name, query: name, location: null });
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

test('participant saves remain debounced and only persist the latest edit', async () => {
  const saves = [];
  const queue = new ParticipantSaveQueue(async (value, keepalive) => {
    saves.push({ value, keepalive });
  }, assert.fail, 10);

  queue.schedule(participant('one', 'First'));
  queue.schedule(participant('one', 'Latest'));
  await wait(25);

  assert.deepEqual(saves, [{ value: participant('one', 'Latest'), keepalive: true }]);
  assert.equal(queue.hasPending, false);
});

test('flush saves immediately with keepalive and cancels the debounce timer', async () => {
  const saves = [];
  const queue = new ParticipantSaveQueue(async (value, keepalive) => {
    saves.push({ value, keepalive });
  }, assert.fail, 30);

  queue.schedule(participant('one', 'Ready'));
  await queue.flush(true);
  await wait(40);

  assert.deepEqual(saves, [{ value: participant('one', 'Ready'), keepalive: true }]);
  assert.equal(queue.hasPending, false);
});

test('a failed save remains queued and can be retried on the next flush', async () => {
  let attempts = 0;
  const queue = new ParticipantSaveQueue(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
  }, () => undefined, 30);

  queue.schedule(participant('one', 'Do not lose me'));
  await assert.rejects(queue.flush(), /offline/);
  assert.equal(queue.hasPending, true);

  await queue.flush(true);
  assert.equal(attempts, 2);
  assert.equal(queue.hasPending, false);
});

test('flush waits for a participant save already in flight', async () => {
  let release;
  const saved = new Promise((resolve) => { release = resolve; });
  const queue = new ParticipantSaveQueue(() => saved, assert.fail, 0);

  queue.schedule(participant('one', 'Saving'));
  await wait(5);
  let flushed = false;
  const flush = queue.flush().then(() => { flushed = true; });
  await wait(5);
  assert.equal(flushed, false);

  release();
  await flush;
  assert.equal(flushed, true);
});

test('flush persists all pending participants before resolving', async () => {
  const saves = [];
  const queue = new ParticipantSaveQueue(async (value, keepalive) => {
    saves.push({ value, keepalive });
  }, assert.fail, 30);

  queue.schedule(participant('one', 'One'));
  queue.schedule(participant('two', 'Two'));
  await queue.flush(true);

  assert.deepEqual(saves, [
    { value: participant('one', 'One'), keepalive: true },
    { value: participant('two', 'Two'), keepalive: true },
  ]);
  assert.equal(queue.hasPending, false);
});

test('an edit made during an in-flight save is not discarded', async () => {
  let releaseFirst;
  const firstSave = new Promise((resolve) => { releaseFirst = resolve; });
  const saves = [];
  const queue = new ParticipantSaveQueue(async (value) => {
    saves.push(value);
    if (saves.length === 1) await firstSave;
  }, assert.fail, 0);

  queue.schedule(participant('one', 'First'));
  await wait(5);
  queue.schedule(participant('one', 'Latest'));
  const flush = queue.flush();
  releaseFirst();
  await flush;

  assert.deepEqual(saves, [
    participant('one', 'First'),
    participant('one', 'Latest'),
  ]);
  assert.equal(queue.hasPending, false);
});

test('cancel prevents a pending debounced save', async () => {
  const saves = [];
  const queue = new ParticipantSaveQueue(async (value) => {
    saves.push(value);
  }, assert.fail, 10);

  queue.schedule(participant('one', 'Cancelled'));
  queue.cancel();
  await wait(25);

  assert.deepEqual(saves, []);
  assert.equal(queue.hasPending, false);
});
