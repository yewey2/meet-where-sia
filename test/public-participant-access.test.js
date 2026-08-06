import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createPlansHandler, MemoryPlanStore } from '../api/_plans-core.js';

const baseParticipant = {
  id: 'person_public_owner',
  name: 'Owner route',
  sameAsStart: true,
  start: { query: 'Eunos MRT', status: 'empty' },
  end: { query: 'Eunos MRT', status: 'empty' },
};

async function invoke(handler, {
  method = 'POST',
  url = '/api/plans',
  body = {},
  cookie,
  ip = '127.0.0.20',
} = {}) {
  const request = Readable.from([]);
  request.method = method;
  request.url = url;
  request.body = body;
  request.socket = { remoteAddress: ip };
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

async function createPlan(handler, participants = [baseParticipant], password = 'owner6') {
  return invoke(handler, {
    body: {
      action: 'create',
      title: 'Public group plan',
      displayName: 'Plan owner',
      email: 'owner-public@example.com',
      password,
      participants,
      mode: 'rail',
    },
  });
}

test('a shared link is fully viewable without a login and leaks no account data', async () => {
  const handler = createPlansHandler({ store: new MemoryPlanStore() });
  const created = await createPlan(handler);
  const planId = created.body.plan.id;

  const viewed = await invoke(handler, {
    method: 'GET',
    url: `/api/plans?planId=${planId}`,
  });

  assert.equal(viewed.status, 200);
  assert.equal(viewed.body.plan.currentMember, null);
  assert.deepEqual(viewed.body.plan.members, []);
  assert.equal(viewed.body.plan.participants[0].start.query, 'Eunos MRT');
  assert.equal(viewed.body.plan.memberCount, 1);
  assert.equal(JSON.stringify(viewed.body).includes('owner-public@example.com'), false);
  assert.equal(JSON.stringify(viewed.body).includes('passwordHash'), false);
  assert.equal(JSON.stringify(viewed.body).includes('nameKey'), false);
});

test('a mistyped sign-in never creates a participant', async () => {
  const handler = createPlansHandler({ store: new MemoryPlanStore() });
  const created = await createPlan(handler);
  const planId = created.body.plan.id;

  const mistyped = await invoke(handler, {
    body: { action: 'login', planId, username: 'Typo friend', password: 'abcdef' },
  });
  assert.equal(mistyped.status, 401);

  const unchanged = await invoke(handler, { method: 'GET', url: `/api/plans?planId=${planId}` });
  assert.equal(unchanged.body.plan.participants.length, 1);
  assert.equal(unchanged.body.plan.memberCount, 1);

  const deliberateJoin = await invoke(handler, {
    body: { action: 'join', planId, username: 'Typo friend', password: 'abcdef' },
  });
  assert.equal(deliberateJoin.status, 201);
  assert.equal(deliberateJoin.body.plan.participants.length, 2);
});

test('five-character passwords fail while six-character owner and participant passwords work', async () => {
  const handler = createPlansHandler({ store: new MemoryPlanStore() });
  const rejected = await createPlan(handler, [baseParticipant], '12345');
  assert.equal(rejected.status, 400);

  const created = await createPlan(handler, [baseParticipant], '123456');
  assert.equal(created.status, 201);
  const joined = await invoke(handler, {
    body: { action: 'join', planId: created.body.plan.id, username: 'Friend', password: 'abcdef' },
  });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.plan.schemaVersion, 3);
  assert.equal(joined.body.plan.currentMember.username, 'Friend');
  const joinedParticipant = joined.body.plan.participants.find(
    (participant) => participant.id === joined.body.plan.currentMember.participantId,
  );
  assert.match(joinedParticipant.color, /^(coral|orange|amber|green|teal|cyan|blue|indigo|purple|pink)$/);
  assert.equal(JSON.stringify(joined.body).includes('abcdef'), false);
});

test('contributors can create and update only their own route', async () => {
  const reservedParticipant = { ...baseParticipant, id: 'person_reserved_ben', name: 'Ben' };
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const created = await createPlan(handler, [baseParticipant, reservedParticipant]);
  const planId = created.body.plan.id;
  const ownerCookie = cookie(created);

  const reserved = await invoke(handler, {
    body: { action: 'join', planId, username: '  BEN ', password: 'ben123' },
  });
  assert.equal(reserved.status, 409);
  assert.equal(reserved.body.code, 'USERNAME_RESERVED');

  const joined = await invoke(handler, {
    body: { action: 'join', planId, username: 'Charlie', password: 'charl6' },
  });
  assert.equal(joined.status, 201);
  const contributorCookie = cookie(joined);
  const ownId = joined.body.plan.currentMember.participantId;
  const ownParticipant = joined.body.plan.participants.find((item) => item.id === ownId);

  const forged = await invoke(handler, {
    cookie: contributorCookie,
    body: {
      action: 'mutate', planId,
      mutation: { type: 'updateParticipant', participant: { ...baseParticipant, start: { query: 'Hijacked', status: 'empty' } } },
    },
  });
  assert.equal(forged.status, 403);

  const edited = await invoke(handler, {
    cookie: contributorCookie,
    body: {
      action: 'mutate', planId,
      mutation: {
        type: 'updateParticipant',
        participant: { ...ownParticipant, name: 'Renamed login', start: { query: 'Bedok MRT', status: 'empty' } },
      },
    },
  });
  assert.equal(edited.status, 200);
  const editedOwn = edited.body.plan.participants.find((item) => item.id === ownId);
  assert.equal(editedOwn.name, 'Charlie');
  assert.equal(editedOwn.start.query, 'Bedok MRT');

  for (const mutation of [
    { type: 'addParticipant', participant: { ...baseParticipant, id: 'person_illegal_add' } },
    { type: 'removeParticipant', participantId: baseParticipant.id },
    { type: 'setMode', mode: 'distance' },
    { type: 'setRailObjective', railObjective: 'evenness' },
    { type: 'setDistanceObjective', distanceObjective: 'median' },
    { type: 'renamePlan', title: 'Hijacked' },
    { type: 'setJoining', enabled: false },
  ]) {
    const denied = await invoke(handler, {
      cookie: contributorCookie,
      body: { action: 'mutate', planId, mutation },
    });
    assert.equal(denied.status, 403, mutation.type);
  }

  const closed = await invoke(handler, {
    cookie: ownerCookie,
    body: { action: 'mutate', planId, mutation: { type: 'setJoining', enabled: false } },
  });
  assert.equal(closed.status, 200);
  const blockedJoin = await invoke(handler, {
    body: { action: 'join', planId, username: 'Dina', password: 'dina66' },
  });
  assert.equal(blockedJoin.status, 403);
});

test('fifty simultaneous duplicate joins create exactly one account and participant', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const created = await createPlan(handler);
  const planId = created.body.plan.id;
  const now = new Date().toISOString();

  const results = await Promise.all(Array.from({ length: 50 }, (_, index) => store.join(
    planId,
    {
      id: `member_${index}`,
      username: 'Duplicate',
      usernameKey: 'duplicate',
      displayName: 'Duplicate',
      participantId: `person_duplicate_${index}`,
      role: 'member',
      passwordHash: 'dummy-test-hash',
      authVersion: 1,
    },
    {
      id: `person_duplicate_${index}`,
      name: 'Duplicate',
      sameAsStart: true,
      start: { query: '', status: 'empty' },
      end: { query: '', status: 'empty' },
    },
    now,
  )));

  assert.equal(results.filter((result) => result.code === 'OK').length, 1);
  assert.equal(results.filter((result) => result.code === 'DUPLICATE_USERNAME').length, 49);
  const stored = await store.get(`mws:plan:${planId}`);
  assert.equal(stored.members.filter((member) => member.usernameKey === 'duplicate').length, 1);
  assert.equal(stored.participants.filter((item) => item.name === 'Duplicate').length, 1);
});

test('the datastore atomically rejects a username reserved by an existing participant', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const created = await createPlan(handler, [{ ...baseParticipant, name: 'Reserved Friend' }]);
  const planId = created.body.plan.id;

  const result = await store.join(
    planId,
    {
      id: 'member_reserved_race',
      username: 'reserved friend',
      usernameKey: 'reserved friend',
      displayName: 'reserved friend',
      participantId: 'person_reserved_race',
      role: 'member',
      passwordHash: 'dummy-test-hash',
      authVersion: 1,
    },
    {
      id: 'person_reserved_race',
      name: 'reserved friend',
      nameKey: 'reserved friend',
      sameAsStart: true,
      start: { query: '', status: 'empty' },
      end: { query: '', status: 'empty' },
    },
    new Date().toISOString(),
  );

  assert.equal(result.code, 'USERNAME_RESERVED');
  const stored = await store.get(`mws:plan:${planId}`);
  assert.equal(stored.participants.length, 1);
  assert.equal(stored.members.length, 1);
});

test('a personal invite lets a listed person choose credentials without creating another route', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const listedParticipant = { ...baseParticipant, id: 'person_invited_ben', name: 'Ben' };
  const created = await createPlan(handler, [baseParticipant, listedParticipant]);
  const planId = created.body.plan.id;

  const invite = await invoke(handler, {
    cookie: cookie(created),
    body: { action: 'mutate', planId, mutation: { type: 'createInvite', participantId: listedParticipant.id } },
  });
  assert.equal(invite.status, 200);
  assert.equal(invite.body.plan.schemaVersion, 3);
  assert.match(invite.body.inviteToken, /^[a-zA-Z0-9_-]{20,64}$/);
  assert.equal(JSON.stringify(invite.body.plan).includes(invite.body.inviteToken), false);
  assert.equal(JSON.stringify(invite.body.plan).includes('claimInvites'), false);
  assert.equal(JSON.stringify(invite.body.plan).includes('tokenHash'), false);

  await invoke(handler, {
    cookie: cookie(created),
    body: { action: 'mutate', planId, mutation: { type: 'setJoining', enabled: false } },
  });
  const claimed = await invoke(handler, {
    body: {
      action: 'claimInvite', planId, inviteToken: invite.body.inviteToken,
      username: 'Benny', password: 'benny6',
    },
  });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.plan.currentMember.username, 'Benny');
  assert.equal(claimed.body.plan.currentMember.participantId, listedParticipant.id);
  assert.equal(claimed.body.plan.participants.length, 2);

  const replayed = await invoke(handler, {
    body: {
      action: 'claimInvite', planId, inviteToken: invite.body.inviteToken,
      username: 'Someone else', password: 'other6',
    },
  });
  assert.equal(replayed.status, 404);
  assert.equal(replayed.body.code, 'INVALID_INVITE');
});

test('simultaneous uses of one personal invite create exactly one assigned account', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const listedParticipant = { ...baseParticipant, id: 'person_single_claim', name: 'Single claim' };
  const created = await createPlan(handler, [baseParticipant, listedParticipant]);
  const planId = created.body.plan.id;
  const invite = await invoke(handler, {
    cookie: cookie(created),
    body: { action: 'mutate', planId, mutation: { type: 'createInvite', participantId: listedParticipant.id } },
  });

  const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => invoke(handler, {
    ip: `127.0.2.${index + 1}`,
    body: {
      action: 'claimInvite', planId, inviteToken: invite.body.inviteToken,
      username: `Claimant ${index}`, password: 'claim66',
    },
  })));

  assert.equal(attempts.filter((attempt) => attempt.status === 201).length, 1);
  const stored = await store.get(`mws:plan:${planId}`);
  assert.equal(stored.members.filter((member) => member.participantId === listedParticipant.id).length, 1);
  assert.equal(stored.participants.filter((participant) => participant.id === listedParticipant.id).length, 1);
  assert.equal(stored.claimInvites.length, 0);
});

test('a personal invite cannot claim another listed participant name', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const invited = { ...baseParticipant, id: 'person_invited_reserved', name: 'Ben' };
  const other = { ...baseParticipant, id: 'person_other_reserved', name: 'Alice' };
  const created = await createPlan(handler, [baseParticipant, invited, other]);
  const planId = created.body.plan.id;
  const invite = await invoke(handler, {
    cookie: cookie(created),
    body: { action: 'mutate', planId, mutation: { type: 'createInvite', participantId: invited.id } },
  });

  const rejected = await invoke(handler, {
    body: {
      action: 'claimInvite', planId, inviteToken: invite.body.inviteToken,
      username: 'Alice', password: 'claim66',
    },
  });

  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'USERNAME_RESERVED');
  const stored = await store.get(`mws:plan:${planId}`);
  assert.equal(stored.members.length, 1);
  assert.equal(stored.claimInvites.length, 1);
});

test('an owner can attach a login to a legacy participant with a normalized Unicode name', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const legacyParticipant = { ...baseParticipant, name: 'Élodie  Tan' };
  const created = await createPlan(handler, [legacyParticipant]);
  const planId = created.body.plan.id;
  const planKey = `mws:plan:${planId}`;
  const legacyPlan = await store.get(planKey);
  delete legacyPlan.participants[0].nameKey;
  await store.set(planKey, legacyPlan);

  const attached = await invoke(handler, {
    cookie: cookie(created),
    body: {
      action: 'mutate',
      planId,
      mutation: {
        type: 'addMember',
        participantId: legacyParticipant.id,
        temporaryPassword: 'friend6',
      },
    },
  });

  assert.equal(attached.status, 200);
  assert.equal(attached.body.plan.members[1].username, 'Élodie Tan');
  const stored = await store.get(planKey);
  assert.equal(stored.participants[0].nameKey, 'élodie tan');
});

test('six friends can repeatedly update only their own routes without cross-writes', async () => {
  const store = new MemoryPlanStore();
  const handler = createPlansHandler({ store });
  const created = await createPlan(handler);
  const planId = created.body.plan.id;

  const friends = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const username = `Friend ${index + 1}`;
    const joined = await invoke(handler, {
      ip: `127.0.1.${index + 1}`,
      body: { action: 'join', planId, username, password: `pass0${index}` },
    });
    assert.equal(joined.status, 201);
    return {
      username,
      cookie: cookie(joined),
      participant: joined.body.plan.participants.find((item) => item.id === joined.body.plan.currentMember.participantId),
    };
  }));

  await Promise.all(friends.map(async (friend, friendIndex) => {
    for (let update = 0; update < 100; update += 1) {
      const changed = await invoke(handler, {
        cookie: friend.cookie,
        ip: `127.0.1.${friendIndex + 1}`,
        body: {
          action: 'mutate', planId,
          mutation: {
            type: 'updateParticipant',
            participant: {
              ...friend.participant,
              start: { query: `${friend.username} update ${update}`, status: 'empty' },
            },
          },
        },
      });
      assert.equal(changed.status, 200);
    }
  }));

  const final = await invoke(handler, { method: 'GET', url: `/api/plans?planId=${planId}` });
  for (const friend of friends) {
    const participant = final.body.plan.participants.find((item) => item.id === friend.participant.id);
    assert.equal(participant.name, friend.username);
    assert.equal(participant.start.query, `${friend.username} update 99`);
  }
});
