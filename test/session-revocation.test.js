import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createPlansHandler, MemoryPlanStore } from '../api/_plans-core.js';

async function invoke(handler, { method = 'POST', url = '/api/plans', body = {}, cookie } = {}) {
  const request = Readable.from([]);
  request.method = method;
  request.url = url;
  request.body = body;
  request.socket = { remoteAddress: '127.0.0.3' };
  request.headers = { host: 'localhost:5173', ...(cookie ? { cookie } : {}) };
  const headers = new Map();
  let raw = '';
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { raw += value; },
  };
  await handler(request, response);
  return { status: response.statusCode, headers, body: raw ? JSON.parse(raw) : null };
}

function cookie(response) {
  return String(response.headers.get('set-cookie')).split(';')[0];
}

test('an owner password reset immediately revokes the member session', async () => {
  const handler = createPlansHandler({ store: new MemoryPlanStore() });
  const participant = {
    id: 'person_session_test',
    name: 'Friend',
    sameAsStart: true,
    start: { query: 'Eunos MRT', status: 'empty' },
    end: { query: 'Eunos MRT', status: 'empty' },
  };
  const created = await invoke(handler, {
    body: {
      action: 'create', title: 'Session reset', displayName: 'Owner',
      email: 'owner-reset@example.com', password: 'owner reset password',
      participants: [participant], mode: 'rail',
    },
  });
  const planId = created.body.plan.id;
  const ownerCookie = cookie(created);
  const added = await invoke(handler, {
    cookie: ownerCookie,
    body: {
      action: 'mutate', planId,
      mutation: {
        type: 'addMember', participantId: participant.id, temporaryPassword: 'friend6',
      },
    },
  });
  const memberId = added.body.plan.members.find((member) => member.role === 'member').id;
  const login = await invoke(handler, {
    body: {
      action: 'login', planId, username: 'Friend', password: 'friend6',
    },
  });
  const oldCookie = cookie(login);

  const reset = await invoke(handler, {
    cookie: ownerCookie,
    body: {
      action: 'mutate', planId,
      mutation: {
        type: 'resetMemberPassword', memberId,
        temporaryPassword: 'newpass6',
      },
    },
  });
  assert.equal(reset.status, 200);

  const stale = await invoke(handler, {
    method: 'GET',
    url: `/api/plans?planId=${planId}`,
    cookie: oldCookie,
  });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.plan.currentMember, null);

  const denied = await invoke(handler, {
    cookie: oldCookie,
    body: {
      action: 'mutate', planId,
      mutation: {
        type: 'updateParticipant',
        participant: { ...participant, start: { query: 'Bedok MRT', status: 'empty' } },
      },
    },
  });
  assert.equal(denied.status, 401);

  const relogin = await invoke(handler, {
    body: {
      action: 'login', planId, username: 'Friend', password: 'newpass6',
    },
  });
  assert.equal(relogin.status, 200);
});

test('an atomic mutation rejects a session revoked after the initial authentication check', async () => {
  class RevokingStore extends MemoryPlanStore {
    revokeNextMutation = false;

    async mutate(planId, actorId, authVersion, mutation) {
      if (this.revokeNextMutation) {
        this.revokeNextMutation = false;
        const key = `mws:plan:${planId}`;
        const plan = await this.get(key);
        const actor = plan.members.find((member) => member.id === actorId);
        actor.authVersion = (actor.authVersion || 1) + 1;
        await this.set(key, plan);
      }
      return super.mutate(planId, actorId, authVersion, mutation);
    }
  }

  const store = new RevokingStore();
  const handler = createPlansHandler({ store });
  const participant = {
    id: 'person_atomic_revocation', name: 'Atomic friend', sameAsStart: true,
    start: { query: 'Eunos MRT', status: 'empty' },
    end: { query: 'Eunos MRT', status: 'empty' },
  };
  const created = await invoke(handler, {
    body: {
      action: 'create', title: 'Atomic revocation', displayName: 'Owner',
      email: 'owner-atomic@example.com', password: 'owner66', participants: [participant], mode: 'rail',
    },
  });
  const planId = created.body.plan.id;
  await invoke(handler, {
    cookie: cookie(created),
    body: {
      action: 'mutate', planId,
      mutation: { type: 'addMember', participantId: participant.id, temporaryPassword: 'friend6' },
    },
  });
  const login = await invoke(handler, {
    body: { action: 'login', planId, username: 'Atomic friend', password: 'friend6' },
  });

  store.revokeNextMutation = true;
  const denied = await invoke(handler, {
    cookie: cookie(login),
    body: {
      action: 'mutate', planId,
      mutation: {
        type: 'updateParticipant',
        participant: { ...participant, start: { query: 'Hijack after revoke', status: 'empty' } },
      },
    },
  });

  assert.equal(denied.status, 401);
  assert.equal(denied.body.code, 'STALE_SESSION');
  const stored = await store.get(`mws:plan:${planId}`);
  assert.equal(stored.participants[0].start.query, 'Eunos MRT');
});
