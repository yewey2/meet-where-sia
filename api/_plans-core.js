import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const PLAN_PREFIX = 'mws:plan:';
const SESSION_PREFIX = 'mws:session:';
const RATE_PREFIX = 'mws:rate:';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MEMBERS = 12;
const MAX_PARTICIPANTS = 24;
const PASSWORD_MIN_LENGTH = 10;

function json(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.end(JSON.stringify(payload));
}

function cleanText(value, maximum, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maximum);
}

function normalizeEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ClientError(400, 'Enter a valid email address.');
  }
  return email;
}

function validatePassword(value, label = 'Password') {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) {
    throw new ClientError(400, `${label} must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (value.length > 200) {
    throw new ClientError(400, `${label} is too long.`);
  }
  return value;
}

function validateLocation(value) {
  if (!value || typeof value !== 'object') {
    throw new ClientError(400, 'A participant location is invalid.');
  }

  const location = {
    query: cleanText(value.query, 300),
    status: ['empty', 'resolving', 'resolved', 'error'].includes(value.status)
      ? value.status
      : 'empty',
  };

  if (typeof value.label === 'string') location.label = cleanText(value.label, 300);
  if (typeof value.placeId === 'string') location.placeId = cleanText(value.placeId, 300);
  if (Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90) location.lat = value.lat;
  if (Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180) location.lng = value.lng;
  return location;
}

function validateParticipant(value) {
  if (!value || typeof value !== 'object') {
    throw new ClientError(400, 'A participant is invalid.');
  }
  const id = cleanText(value.id, 80);
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(id)) {
    throw new ClientError(400, 'A participant identifier is invalid.');
  }
  return {
    id,
    name: cleanText(value.name, 80),
    sameAsStart: Boolean(value.sameAsStart),
    start: validateLocation(value.start),
    end: validateLocation(value.end),
  };
}

function validateParticipants(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PARTICIPANTS) {
    throw new ClientError(400, `A plan needs 1 to ${MAX_PARTICIPANTS} participants.`);
  }
  const participants = value.map(validateParticipant);
  if (new Set(participants.map((participant) => participant.id)).size !== participants.length) {
    throw new ClientError(400, 'Participant identifiers must be unique.');
  }
  return participants;
}

function id(bytes = 12) {
  return randomBytes(bytes).toString('base64url');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltText, hashText] = encoded.split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hashText, 'base64url');
    const derived = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

class ClientError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const REDIS_CREDENTIAL_PAIRS = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['UPSTASH_REDIS_KV_REST_API_URL', 'UPSTASH_REDIS_KV_REST_API_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
];

export function envCredentials(environment = process.env) {
  for (const [urlName, tokenName] of REDIS_CREDENTIAL_PAIRS) {
    const url = environment[urlName];
    const token = environment[tokenName];
    if (url && token) return { url, token };
  }

  return { url: undefined, token: undefined };
}

const MUTATE_SCRIPT = String.raw`
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NOT_FOUND'} end
local plan = cjson.decode(raw)
local actorId = ARGV[1]
local mutation = cjson.decode(ARGV[2])
local actor = nil
for _, member in ipairs(plan.members) do
  if member.id == actorId then actor = member break end
end
if not actor then return {'FORBIDDEN'} end
local ownerOnly = mutation.type == 'renamePlan' or mutation.type == 'addMember' or mutation.type == 'resetMemberPassword' or mutation.type == 'removeMember'
if ownerOnly and actor.role ~= 'owner' then return {'FORBIDDEN'} end

if mutation.type == 'updateParticipant' then
  local found = false
  for index, participant in ipairs(plan.participants) do
    if participant.id == mutation.participant.id then
      plan.participants[index] = mutation.participant
      found = true
      break
    end
  end
  if not found then return {'PARTICIPANT_NOT_FOUND'} end
elseif mutation.type == 'addParticipant' then
  if #plan.participants >= 24 then return {'PARTICIPANT_LIMIT'} end
  for _, participant in ipairs(plan.participants) do
    if participant.id == mutation.participant.id then return {'DUPLICATE_PARTICIPANT'} end
  end
  table.insert(plan.participants, mutation.participant)
elseif mutation.type == 'removeParticipant' then
  if #plan.participants <= 1 then return {'LAST_PARTICIPANT'} end
  local nextParticipants = {}
  local found = false
  for _, participant in ipairs(plan.participants) do
    if participant.id == mutation.participantId then found = true else table.insert(nextParticipants, participant) end
  end
  if not found then return {'PARTICIPANT_NOT_FOUND'} end
  plan.participants = nextParticipants
elseif mutation.type == 'setMode' then
  plan.mode = mutation.mode
elseif mutation.type == 'resetPlan' then
  plan.participants = mutation.participants
  plan.mode = mutation.mode
elseif mutation.type == 'renamePlan' then
  plan.title = mutation.title
elseif mutation.type == 'addMember' then
  if #plan.members >= 12 then return {'MEMBER_LIMIT'} end
  for _, member in ipairs(plan.members) do
    if member.email == mutation.member.email then return {'DUPLICATE_MEMBER'} end
  end
  table.insert(plan.members, mutation.member)
elseif mutation.type == 'resetMemberPassword' then
  local changed = false
  for _, member in ipairs(plan.members) do
    if member.id == mutation.memberId and member.role ~= 'owner' then
      member.passwordHash = mutation.passwordHash
      member.authVersion = (member.authVersion or 1) + 1
      changed = true
      break
    end
  end
  if not changed then return {'MEMBER_NOT_FOUND'} end
elseif mutation.type == 'removeMember' then
  local nextMembers = {}
  local found = false
  for _, member in ipairs(plan.members) do
    if member.id == mutation.memberId and member.role ~= 'owner' then found = true else table.insert(nextMembers, member) end
  end
  if not found then return {'MEMBER_NOT_FOUND'} end
  plan.members = nextMembers
elseif mutation.type == 'changePassword' then
  actor.passwordHash = mutation.passwordHash
  actor.authVersion = (actor.authVersion or 1) + 1
else
  return {'INVALID_MUTATION'}
end

plan.version = (plan.version or 0) + 1
plan.updatedAt = mutation.updatedAt
local encoded = cjson.encode(plan)
redis.call('SET', KEYS[1], encoded)
return {'OK', encoded}
`;

const DELETE_SCRIPT = String.raw`
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NOT_FOUND'} end
local plan = cjson.decode(raw)
for _, member in ipairs(plan.members) do
  if member.id == ARGV[1] and member.role == 'owner' then
    redis.call('DEL', KEYS[1])
    return {'OK'}
  end
end
return {'FORBIDDEN'}
`;

export class UpstashPlanStore {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async command(args) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      throw new Error(`Storage request failed: ${payload.error || response.status}.`);
    }
    return payload.result;
  }

  async get(key) {
    const result = await this.command(['GET', key]);
    return result ? JSON.parse(result) : null;
  }

  async getMany(keys) {
    const result = await this.command(['MGET', ...keys]);
    return result.map((value) => value ? JSON.parse(value) : null);
  }

  set(key, value, options = []) {
    return this.command(['SET', key, JSON.stringify(value), ...options]);
  }

  del(key) {
    return this.command(['DEL', key]);
  }

  async mutate(planId, actorId, mutation) {
    const result = await this.command([
      'EVAL', MUTATE_SCRIPT, '1', `${PLAN_PREFIX}${planId}`, actorId, JSON.stringify(mutation),
    ]);
    return decodeMutationResult(result);
  }

  async deletePlan(planId, actorId) {
    const result = await this.command([
      'EVAL', DELETE_SCRIPT, '1', `${PLAN_PREFIX}${planId}`, actorId,
    ]);
    return { code: result?.[0] || 'STORAGE_ERROR' };
  }

  async hitRateLimit(key, seconds, maximum) {
    const count = await this.command(['INCR', `${RATE_PREFIX}${key}`]);
    if (count === 1) await this.command(['EXPIRE', `${RATE_PREFIX}${key}`, seconds]);
    return count > maximum;
  }
}

function decodeMutationResult(result) {
  const code = result?.[0] || 'STORAGE_ERROR';
  return { code, plan: result?.[1] ? JSON.parse(result[1]) : null };
}

export class MemoryPlanStore {
  constructor() {
    this.values = new Map();
    this.rates = new Map();
    this.mutationQueues = new Map();
  }

  async get(key) {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  getMany(keys) {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  async set(key, value, options = []) {
    const nx = options.includes('NX');
    if (nx && this.values.has(key)) return null;
    const exIndex = options.indexOf('EX');
    const expiresAt = exIndex >= 0 ? Date.now() + Number(options[exIndex + 1]) * 1000 : null;
    this.values.set(key, { value: structuredClone(value), expiresAt });
    return 'OK';
  }

  async del(key) {
    return this.values.delete(key) ? 1 : 0;
  }

  async mutate(planId, actorId, mutation) {
    const previous = this.mutationQueues.get(planId) || Promise.resolve();
    const operation = previous.then(() => this.applyMutation(planId, actorId, mutation));
    this.mutationQueues.set(planId, operation.catch(() => undefined));
    return operation;
  }

  async applyMutation(planId, actorId, mutation) {
    const key = `${PLAN_PREFIX}${planId}`;
    const plan = await this.get(key);
    if (!plan) return { code: 'NOT_FOUND' };
    const actor = plan.members.find((member) => member.id === actorId);
    if (!actor) return { code: 'FORBIDDEN' };
    const ownerOnly = ['renamePlan', 'addMember', 'resetMemberPassword', 'removeMember'].includes(mutation.type);
    if (ownerOnly && actor.role !== 'owner') return { code: 'FORBIDDEN' };

    const failure = applyMemoryMutation(plan, actor, mutation);
    if (failure) return { code: failure };
    plan.version += 1;
    plan.updatedAt = mutation.updatedAt;
    await this.set(key, plan);
    return { code: 'OK', plan };
  }

  async deletePlan(planId, actorId) {
    const key = `${PLAN_PREFIX}${planId}`;
    const plan = await this.get(key);
    if (!plan) return { code: 'NOT_FOUND' };
    const owner = plan.members.find((member) => member.id === actorId && member.role === 'owner');
    if (!owner) return { code: 'FORBIDDEN' };
    await this.del(key);
    return { code: 'OK' };
  }

  async hitRateLimit(key, seconds, maximum) {
    const now = Date.now();
    const current = this.rates.get(key);
    const next = !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + seconds * 1000 }
      : { ...current, count: current.count + 1 };
    this.rates.set(key, next);
    return next.count > maximum;
  }
}

function applyMemoryMutation(plan, actor, mutation) {
  if (mutation.type === 'updateParticipant') {
    const index = plan.participants.findIndex((item) => item.id === mutation.participant.id);
    if (index < 0) return 'PARTICIPANT_NOT_FOUND';
    plan.participants[index] = mutation.participant;
  } else if (mutation.type === 'addParticipant') {
    if (plan.participants.length >= MAX_PARTICIPANTS) return 'PARTICIPANT_LIMIT';
    if (plan.participants.some((item) => item.id === mutation.participant.id)) return 'DUPLICATE_PARTICIPANT';
    plan.participants.push(mutation.participant);
  } else if (mutation.type === 'removeParticipant') {
    if (plan.participants.length <= 1) return 'LAST_PARTICIPANT';
    const length = plan.participants.length;
    plan.participants = plan.participants.filter((item) => item.id !== mutation.participantId);
    if (length === plan.participants.length) return 'PARTICIPANT_NOT_FOUND';
  } else if (mutation.type === 'setMode') {
    plan.mode = mutation.mode;
  } else if (mutation.type === 'resetPlan') {
    plan.participants = mutation.participants;
    plan.mode = mutation.mode;
  } else if (mutation.type === 'renamePlan') {
    plan.title = mutation.title;
  } else if (mutation.type === 'addMember') {
    if (plan.members.length >= MAX_MEMBERS) return 'MEMBER_LIMIT';
    if (plan.members.some((item) => item.email === mutation.member.email)) return 'DUPLICATE_MEMBER';
    plan.members.push(mutation.member);
  } else if (mutation.type === 'resetMemberPassword') {
    const member = plan.members.find((item) => item.id === mutation.memberId && item.role !== 'owner');
    if (!member) return 'MEMBER_NOT_FOUND';
    member.passwordHash = mutation.passwordHash;
    member.authVersion = (member.authVersion || 1) + 1;
  } else if (mutation.type === 'removeMember') {
    const length = plan.members.length;
    plan.members = plan.members.filter((item) => item.id !== mutation.memberId || item.role === 'owner');
    if (length === plan.members.length) return 'MEMBER_NOT_FOUND';
  } else if (mutation.type === 'changePassword') {
    actor.passwordHash = mutation.passwordHash;
    actor.authVersion = (actor.authVersion || 1) + 1;
  } else {
    return 'INVALID_MUTATION';
  }
  return null;
}

function getStore() {
  const credentials = envCredentials();
  if (!credentials.url || !credentials.token) {
    throw new ClientError(
      503,
      'Shared plans are not configured yet. Connect an Upstash Redis store in Vercel, then redeploy.',
      'STORAGE_NOT_CONFIGURED',
    );
  }
  return new UpstashPlanStore(credentials.url, credentials.token);
}

function cookieName(planId) {
  return `mws_${planId}`;
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join('='))]),
  );
}

function sessionCookie(request, planId, token, maxAge = SESSION_SECONDS) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '');
  const secure = process.env.VERCEL === '1' || forwardedProto === 'https';
  return `${cookieName(planId)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function readBody(request) {
  const declared = Number(request.headers['content-length'] || 0);
  if (declared > MAX_BODY_BYTES) throw new ClientError(413, 'Request is too large.');
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') {
    if (Buffer.byteLength(request.body) > MAX_BODY_BYTES) throw new ClientError(413, 'Request is too large.');
    try { return JSON.parse(request.body); } catch { throw new ClientError(400, 'Request body must be valid JSON.'); }
  }
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new ClientError(413, 'Request is too large.');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new ClientError(400, 'Request body must be valid JSON.'); }
}

function checkOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  try {
    if (new URL(origin).host !== host) throw new Error('mismatch');
  } catch {
    throw new ClientError(403, 'Cross-site request blocked.');
  }
}

function planIdFrom(value) {
  const planId = cleanText(value, 32);
  if (!/^[a-zA-Z0-9_-]{12,32}$/.test(planId)) {
    throw new ClientError(400, 'The shared-plan link is invalid.');
  }
  return planId;
}

async function createSession(store, request, response, planId, memberId, authVersion = 1) {
  const token = id(32);
  await store.set(`${SESSION_PREFIX}${digest(token)}`, { planId, memberId, authVersion }, ['EX', SESSION_SECONDS]);
  response.setHeader('Set-Cookie', sessionCookie(request, planId, token));
}

async function authenticate(store, request, planId) {
  const token = parseCookies(request)[cookieName(planId)];
  if (!token) throw new ClientError(401, 'Sign in to open this shared plan.', 'AUTH_REQUIRED');
  const [session, plan] = await store.getMany([
    `${SESSION_PREFIX}${digest(token)}`,
    `${PLAN_PREFIX}${planId}`,
  ]);
  if (!session || session.planId !== planId) {
    throw new ClientError(401, 'Your session expired. Sign in again.', 'AUTH_REQUIRED');
  }
  if (!plan) throw new ClientError(404, 'This shared plan no longer exists.', 'NOT_FOUND');
  const member = plan.members.find((item) => item.id === session.memberId);
  if (!member) throw new ClientError(403, 'You no longer have access to this plan.', 'ACCESS_REMOVED');
  if ((member.authVersion || 1) !== (session.authVersion || 1)) {
    throw new ClientError(401, 'Your password changed. Sign in again.', 'AUTH_REQUIRED');
  }
  return { session, plan, member };
}

function publicPlan(plan, currentMember) {
  const ownerView = currentMember.role === 'owner';
  return {
    id: plan.id,
    title: plan.title,
    mode: plan.mode,
    participants: plan.participants,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    version: plan.version,
    currentMember: {
      id: currentMember.id,
      email: currentMember.email,
      displayName: currentMember.displayName,
      role: currentMember.role,
    },
    members: plan.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      role: member.role,
      ...(ownerView || member.id === currentMember.id ? { email: member.email } : {}),
    })),
  };
}

function mutationError(code) {
  const errors = {
    NOT_FOUND: [404, 'This shared plan no longer exists.'],
    FORBIDDEN: [403, 'You do not have permission to make that change.'],
    PARTICIPANT_NOT_FOUND: [409, 'That participant was removed by someone else. Refresh the plan.'],
    PARTICIPANT_LIMIT: [400, `A plan can have at most ${MAX_PARTICIPANTS} participants.`],
    DUPLICATE_PARTICIPANT: [409, 'That participant is already in the plan.'],
    LAST_PARTICIPANT: [400, 'A plan must keep at least one participant.'],
    MEMBER_LIMIT: [400, `A plan can have at most ${MAX_MEMBERS} members.`],
    DUPLICATE_MEMBER: [409, 'That email already has access.'],
    MEMBER_NOT_FOUND: [404, 'That member was not found.'],
    INVALID_MUTATION: [400, 'That plan change is not supported.'],
  };
  const [status, message] = errors[code] || [503, 'The plan could not be updated.'];
  return new ClientError(status, message, code);
}

async function validateMutation(input) {
  if (!input || typeof input !== 'object') throw new ClientError(400, 'A plan change is required.');
  const updatedAt = new Date().toISOString();
  switch (input.type) {
    case 'updateParticipant':
    case 'addParticipant':
      return { type: input.type, participant: validateParticipant(input.participant), updatedAt };
    case 'removeParticipant':
      return { type: input.type, participantId: cleanText(input.participantId, 80), updatedAt };
    case 'setMode':
      return { type: input.type, mode: input.mode === 'distance' ? 'distance' : 'rail', updatedAt };
    case 'resetPlan':
      return { type: input.type, participants: validateParticipants(input.participants), mode: input.mode === 'distance' ? 'distance' : 'rail', updatedAt };
    case 'renamePlan': {
      const title = cleanText(input.title, 100);
      if (!title) throw new ClientError(400, 'Plan name is required.');
      return { type: input.type, title, updatedAt };
    }
    case 'addMember': {
      const email = normalizeEmail(input.email);
      const displayName = cleanText(input.displayName, 80);
      if (!displayName) throw new ClientError(400, 'Member name is required.');
      const passwordHash = await hashPassword(validatePassword(input.temporaryPassword, 'Temporary password'));
      return { type: input.type, member: { id: id(10), email, displayName, role: 'member', passwordHash, authVersion: 1 }, updatedAt };
    }
    case 'resetMemberPassword':
      return {
        type: input.type,
        memberId: cleanText(input.memberId, 40),
        passwordHash: await hashPassword(validatePassword(input.temporaryPassword, 'Temporary password')),
        updatedAt,
      };
    case 'removeMember':
      return { type: input.type, memberId: cleanText(input.memberId, 40), updatedAt };
    case 'changePassword':
      return { type: input.type, passwordHash: await hashPassword(validatePassword(input.password, 'New password')), updatedAt };
    default:
      throw new ClientError(400, 'That plan change is not supported.');
  }
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 80);
}

export function createPlansHandler({ store: injectedStore } = {}) {
  return async function plansHandler(request, response) {
    try {
      const store = injectedStore || getStore();
      if (request.method === 'GET') {
        const url = new URL(request.url || '/api/plans', `http://${request.headers.host || 'localhost'}`);
        const planId = planIdFrom(url.searchParams.get('planId'));
        const { plan, member } = await authenticate(store, request, planId);
        return json(response, 200, { plan: publicPlan(plan, member) });
      }

      if (request.method !== 'POST') {
        return json(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
      }

      checkOrigin(request);
      const body = await readBody(request);
      if (body.action === 'create') {
        const limited = await store.hitRateLimit(
          digest(`create:${clientIp(request)}`),
          60 * 60,
          20,
        );
        if (limited) throw new ClientError(429, 'Too many plans were created from this connection. Try again later.');
        const email = normalizeEmail(body.email);
        const displayName = cleanText(body.displayName, 80);
        const title = cleanText(body.title, 100);
        if (!displayName) throw new ClientError(400, 'Your name is required.');
        if (!title) throw new ClientError(400, 'Plan name is required.');
        const passwordHash = await hashPassword(validatePassword(body.password));
        const now = new Date().toISOString();
        const owner = { id: id(10), email, displayName, role: 'owner', passwordHash, authVersion: 1 };
        const participants = validateParticipants(body.participants);
        let plan;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const planId = id(12);
          plan = {
            id: planId,
            title,
            mode: body.mode === 'distance' ? 'distance' : 'rail',
            participants,
            members: [owner],
            createdAt: now,
            updatedAt: now,
            version: 1,
          };
          const stored = await store.set(`${PLAN_PREFIX}${planId}`, plan, ['NX']);
          if (stored) break;
          plan = null;
        }
        if (!plan) throw new ClientError(503, 'Could not reserve a shared-plan link. Try again.');
        await createSession(store, request, response, plan.id, owner.id, owner.authVersion);
        return json(response, 201, { plan: publicPlan(plan, owner) });
      }

      if (body.action === 'login') {
        const planId = planIdFrom(body.planId);
        const email = normalizeEmail(body.email);
        const limited = await store.hitRateLimit(
          digest(`${clientIp(request)}:${planId}:${email}`),
          15 * 60,
          8,
        );
        if (limited) throw new ClientError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
        const plan = await store.get(`${PLAN_PREFIX}${planId}`);
        const member = plan?.members.find((item) => item.email === email);
        let passwordValid = false;
        if (member) {
          passwordValid = await verifyPassword(String(body.password || ''), member.passwordHash);
        } else {
          await hashPassword(String(body.password || '').padEnd(PASSWORD_MIN_LENGTH, ' '));
        }
        if (!passwordValid) throw new ClientError(401, 'Email or password is incorrect.');
        await createSession(store, request, response, planId, member.id, member.authVersion || 1);
        return json(response, 200, { plan: publicPlan(plan, member) });
      }

      const planId = planIdFrom(body.planId);
      const { session, plan, member } = await authenticate(store, request, planId);
      if (body.action === 'logout') {
        const token = parseCookies(request)[cookieName(planId)];
        if (token) await store.del(`${SESSION_PREFIX}${digest(token)}`);
        response.setHeader('Set-Cookie', sessionCookie(request, planId, '', 0));
        return json(response, 200, { ok: true });
      }
      if (body.action === 'delete') {
        const result = await store.deletePlan(planId, session.memberId);
        if (result.code !== 'OK') throw mutationError(result.code);
        response.setHeader('Set-Cookie', sessionCookie(request, planId, '', 0));
        return json(response, 200, { ok: true });
      }
      if (body.action !== 'mutate') throw new ClientError(400, 'Unknown action.');

      const mutation = await validateMutation(body.mutation);
      const result = await store.mutate(planId, session.memberId, mutation);
      if (result.code !== 'OK') throw mutationError(result.code);
      const currentMember = result.plan.members.find((item) => item.id === member.id);
      if (mutation.type === 'changePassword') {
        await createSession(store, request, response, planId, currentMember.id, currentMember.authVersion);
      }
      return json(response, 200, { plan: publicPlan(result.plan, currentMember) });
    } catch (error) {
      if (error instanceof ClientError) {
        return json(response, error.status, { error: error.message, code: error.code });
      }
      console.error('Shared plan request failed.', error);
      return json(response, 503, { error: 'Shared plans are temporarily unavailable.' });
    }
  };
}

