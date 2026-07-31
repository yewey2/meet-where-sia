import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  createPlansHandler,
  envCredentials,
  hashPassword,
  MemoryPlanStore,
  verifyPassword,
} from '../api/_plans-core.js';

const participant = {
  id: 'person_test_1',
  name: 'Aisha',
  sameAsStart: true,
  start: { query: 'Aljunied MRT', status: 'empty' },
  end: { query: 'Aljunied MRT', status: 'empty' },
};

function cookiePair(setCookie) {
  return String(setCookie).split(';')[0];
}

async function request(handler, { method = 'GET', url = '/api/plans', body, cookie } = {}) {
  const stream = Readable.from([]);
  stream.method = method;
  stream.url = url;
  stream.body = body;
  stream.socket = { remoteAddress: '127.0.0.1' };
  stream.headers = {
    host: 'localhost:5173',
    ...(cookie ? { cookie } : {}),
  };

  const headers = new Map();
  let responseBody = '';
  const response = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end(value = '') {
      responseBody += value;
    },
  };

  await handler(stream, response);
  return {
    status: response.statusCode,
    headers,
    body: responseBody ? JSON.parse(responseBody) : null,
  };
}

test('passwords are salted and verify without storing plaintext', async () => {
  const first = await hashPassword('correct horse battery');
  const second = await hashPassword('correct horse battery');
  assert.notEqual(first, second);
  assert.equal(first.includes('correct horse battery'), false);
  assert.equal(await verifyPassword('correct horse battery', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
});

test('Vercel resource-prefixed Upstash REST credentials are recognized', () => {
  assert.deepEqual(envCredentials({
    UPSTASH_REDIS_KV_REST_API_URL: 'https://dummy-redis.example',
    UPSTASH_REDIS_KV_REST_API_TOKEN: 'dummy-write-token',
    UPSTASH_REDIS_KV_REST_API_READ_ONLY_TOKEN: 'dummy-read-only-token',
  }), {
    url: 'https://dummy-redis.example',
    token: 'dummy-write-token',
  });
});

test('Upstash credentials must be a matched writable pair', () => {
  assert.deepEqual(envCredentials({
    UPSTASH_REDIS_KV_REST_API_URL: 'https://dummy-redis.example',
    UPSTASH_REDIS_KV_REST_API_READ_ONLY_TOKEN: 'dummy-read-only-token',
  }), {
    url: undefined,
    token: undefined,
  });
});

test('an owner can create, manage, share, edit, and delete a plan', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const friendParticipant = { ...participant, id: 'person_test_2', name: 'Ben' };

  const created = await request(handler, {
    method: 'POST',
    body: {
      action: 'create',
      title: 'Saturday dinner',
      displayName: 'Aisha',
      email: 'aisha@example.com',
      password: 'owner password 123',
      participants: [participant, friendParticipant],
      mode: 'rail',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.plan.title, 'Saturday dinner');
  assert.equal(created.body.plan.currentMember.role, 'owner');
  assert.equal(created.body.plan.members[0].passwordHash, undefined);
  const planId = created.body.plan.id;
  const ownerCookie = cookiePair(created.headers.get('set-cookie'));

  const addedMember = await request(handler, {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      action: 'mutate',
      planId,
      mutation: {
        type: 'addMember',
        participantId: friendParticipant.id,
        temporaryPassword: 'ben123',
      },
    },
  });
  assert.equal(addedMember.status, 200);
  assert.equal(addedMember.body.plan.members.length, 2);
  assert.equal(addedMember.body.plan.members[1].username, 'Ben');

  const login = await request(handler, {
    method: 'POST',
    body: {
      action: 'login',
      planId,
      username: '  ben ',
      password: 'ben123',
    },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.plan.currentMember.displayName, 'Ben');
  const memberCookie = cookiePair(login.headers.get('set-cookie'));

  const updatedParticipant = {
    ...friendParticipant,
    name: 'Attempted rename',
    start: { query: 'Tampines MRT', status: 'empty' },
    end: { query: 'Tampines MRT', status: 'empty' },
  };
  const edited = await request(handler, {
    method: 'POST',
    cookie: memberCookie,
    body: {
      action: 'mutate',
      planId,
      mutation: { type: 'updateParticipant', participant: updatedParticipant },
    },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.plan.participants[1].name, 'Ben');
  assert.equal(edited.body.plan.participants[1].start.query, 'Tampines MRT');

  const forbidden = await request(handler, {
    method: 'POST',
    cookie: memberCookie,
    body: {
      action: 'mutate',
      planId,
      mutation: { type: 'renamePlan', title: 'Hijacked title' },
    },
  });
  assert.equal(forbidden.status, 403);

  const removed = await request(handler, {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      action: 'mutate',
      planId,
      mutation: {
        type: 'removeMember',
        memberId: addedMember.body.plan.members[1].id,
      },
    },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.plan.members.length, 1);

  const staleSession = await request(handler, {
    cookie: memberCookie,
    url: `/api/plans?planId=${planId}`,
  });
  assert.equal(staleSession.status, 200);
  assert.equal(staleSession.body.plan.currentMember, null);

  const deleted = await request(handler, {
    method: 'POST',
    cookie: ownerCookie,
    body: { action: 'delete', planId },
  });
  assert.equal(deleted.status, 200);

  const missing = await request(handler, {
    cookie: ownerCookie,
    url: `/api/plans?planId=${planId}`,
  });
  assert.equal(missing.status, 404);
});

test('different participant mutations combine instead of replacing the full plan', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const secondParticipant = { ...participant, id: 'person_test_2', name: 'Ben' };
  const created = await request(handler, {
    method: 'POST',
    body: {
      action: 'create',
      title: 'Concurrent edits',
      displayName: 'Owner',
      email: 'owner@example.com',
      password: 'owner password 123',
      participants: [participant, secondParticipant],
      mode: 'rail',
    },
  });
  const planId = created.body.plan.id;
  const cookie = cookiePair(created.headers.get('set-cookie'));

  await Promise.all([
    request(handler, {
      method: 'POST', cookie,
      body: { action: 'mutate', planId, mutation: { type: 'updateParticipant', participant: { ...participant, name: 'Aisha updated' } } },
    }),
    request(handler, {
      method: 'POST', cookie,
      body: { action: 'mutate', planId, mutation: { type: 'updateParticipant', participant: { ...secondParticipant, name: 'Ben updated' } } },
    }),
  ]);

  const loaded = await request(handler, { cookie, url: `/api/plans?planId=${planId}` });
  assert.deepEqual(loaded.body.plan.participants.map((item) => item.name), ['Aisha updated', 'Ben updated']);
});

test('sign-in attempts are rate limited', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const created = await request(handler, {
    method: 'POST',
    body: {
      action: 'create', title: 'Private plan', displayName: 'Owner',
      email: 'owner@example.com', password: 'owner password 123',
      participants: [participant], mode: 'rail',
    },
  });
  const planId = created.body.plan.id;
  let result;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    result = await request(handler, {
      method: 'POST',
      body: { action: 'ownerLogin', planId, email: 'owner@example.com', password: 'not the password' },
    });
  }
  assert.equal(result.status, 429);
});

test('calculation objectives are created, mutated, reset, and exposed with old-plan defaults', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const created = await request(handler, {
    method: 'POST',
    body: {
      action: 'create', title: 'Objective plan', displayName: 'Owner',
      email: 'objective@example.com', password: 'owner password 123',
      participants: [participant], mode: 'rail', railObjective: 'average', distanceObjective: 'centroid',
    },
  });
  assert.equal(created.body.plan.railObjective, 'average');
  assert.equal(created.body.plan.distanceObjective, 'centroid');
  const planId = created.body.plan.id;
  const cookie = cookiePair(created.headers.get('set-cookie'));

  const changed = await request(handler, {
    method: 'POST', cookie,
    body: { action: 'mutate', planId, mutation: { type: 'setRailObjective', railObjective: 'evenness' } },
  });
  assert.equal(changed.body.plan.railObjective, 'evenness');

  const fairnessFirst = await request(handler, {
    method: 'POST', cookie,
    body: { action: 'mutate', planId, mutation: { type: 'setRailObjective', railObjective: 'minimax' } },
  });
  assert.equal(fairnessFirst.body.plan.railObjective, 'minimax');

  const weighted = await request(handler, {
    method: 'POST', cookie,
    body: { action: 'mutate', planId, mutation: { type: 'setRailObjective', railObjective: 'weighted' } },
  });
  assert.equal(weighted.body.plan.railObjective, 'weighted');

  const distanceMedian = await request(handler, {
    method: 'POST', cookie,
    body: { action: 'mutate', planId, mutation: { type: 'setDistanceObjective', distanceObjective: 'median' } },
  });
  assert.equal(distanceMedian.body.plan.distanceObjective, 'median');

  const reset = await request(handler, {
    method: 'POST', cookie,
    body: { action: 'mutate', planId, mutation: { type: 'resetPlan', participants: [participant], mode: 'rail' } },
  });
  assert.equal(reset.body.plan.railObjective, 'average');
  assert.equal(reset.body.plan.distanceObjective, 'centroid');

  const stored = await store.get(`mws:plan:${planId}`);
  delete stored.railObjective;
  delete stored.distanceObjective;
  await store.set(`mws:plan:${planId}`, stored);
  const oldPlan = await request(handler, { url: `/api/plans?planId=${planId}` });
  assert.equal(oldPlan.body.plan.railObjective, 'average');
  assert.equal(oldPlan.body.plan.distanceObjective, 'centroid');
});
