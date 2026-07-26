import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createPlansHandler, MemoryPlanStore } from '../api/_plans-core.js';

function invoke(handler, { method = 'POST', body = {}, cookie, origin } = {}) {
  const request = Readable.from([]);
  request.method = method;
  request.url = '/api/plans';
  request.body = body;
  request.socket = { remoteAddress: '127.0.0.2' };
  request.headers = {
    host: 'localhost:5173',
    ...(cookie ? { cookie } : {}),
    ...(origin ? { origin } : {}),
  };

  const headers = new Map();
  let raw = '';
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { raw += value; },
  };

  return handler(request, response).then(() => ({
    status: response.statusCode,
    headers,
    body: raw ? JSON.parse(raw) : null,
  }));
}

function cookie(response) {
  return String(response.headers.get('set-cookie')).split(';')[0];
}

const participant = {
  id: 'person_security_test',
  name: 'Owner',
  sameAsStart: true,
  start: { query: 'Eunos MRT', status: 'empty' },
  end: { query: 'Eunos MRT', status: 'empty' },
};

test('cross-site writes are rejected before authentication or storage changes', async () => {
  const handler = createPlansHandler({ store: new MemoryPlanStore() });
  const result = await invoke(handler, {
    origin: 'https://attacker.example',
    body: {
      action: 'create',
      title: 'Should not exist',
      displayName: 'Attacker',
      email: 'attacker@example.com',
      password: 'attacker password',
      participants: [participant],
      mode: 'rail',
    },
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'Cross-site request blocked.');
});

test('contributors cannot see the account list or owner email address', async () => {
  const handler = createPlansHandler({ store: new MemoryPlanStore() });
  const created = await invoke(handler, {
    body: {
      action: 'create',
      title: 'Private emails',
      displayName: 'Owner',
      email: 'owner-private@example.com',
      password: 'owner private password',
      participants: [participant],
      mode: 'rail',
    },
  });
  const planId = created.body.plan.id;
  const ownerCookie = cookie(created);

  await invoke(handler, {
    cookie: ownerCookie,
    body: {
      action: 'mutate',
      planId,
      mutation: {
        type: 'addMember',
        participantId: participant.id,
        temporaryPassword: 'friend6',
      },
    },
  });

  const loggedIn = await invoke(handler, {
    body: {
      action: 'login',
      planId,
      username: 'Owner',
      password: 'friend6',
    },
  });
  assert.equal(loggedIn.status, 200);
  assert.deepEqual(loggedIn.body.plan.members, []);
  assert.equal(loggedIn.body.plan.currentMember.email, undefined);
  assert.equal(loggedIn.body.plan.currentMember.participantId, participant.id);
});
