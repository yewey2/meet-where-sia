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
const PARTICIPANT_COLORS = new Set([
  'coral', 'orange', 'amber', 'green', 'teal',
  'cyan', 'blue', 'indigo', 'purple', 'pink',
]);
const PASSWORD_MIN_LENGTH = 6;
const CLAIM_INVITE_SECONDS = 60 * 60 * 24 * 7;

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

function normalizedName(value) {
  return cleanText(value, 80).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function normalizeUsername(value) {
  const username = cleanText(value, 80).normalize('NFKC').replace(/\s+/g, ' ');
  if (!username) {
    throw new ClientError(400, 'Enter a username.');
  }
  return {
    username,
    usernameKey: normalizedName(username),
  };
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
  const name = cleanText(value.name, 80);
  const participant = {
    id,
    name,
    nameKey: normalizedName(name),
    sameAsStart: Boolean(value.sameAsStart),
    start: validateLocation(value.start),
    end: validateLocation(value.end),
  };
  if (value.color !== undefined) {
    if (!PARTICIPANT_COLORS.has(value.color)) {
      throw new ClientError(400, 'A participant colour is invalid.');
    }
    participant.color = value.color;
  }
  return participant;
}

function validateParticipants(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PARTICIPANTS) {
    throw new ClientError(400, `A plan needs 1 to ${MAX_PARTICIPANTS} participants.`);
  }
  const participants = value.map(validateParticipant);
  if (new Set(participants.map((participant) => participant.id)).size !== participants.length) {
    throw new ClientError(400, 'Participant identifiers must be unique.');
  }
  return ensureParticipantColors(participants);
}

function pickParticipantColor(participants) {
  const counts = new Map([...PARTICIPANT_COLORS].map((color) => [color, 0]));
  for (const participant of participants) {
    if (PARTICIPANT_COLORS.has(participant.color)) {
      counts.set(participant.color, counts.get(participant.color) + 1);
    }
  }
  const lowestUsage = Math.min(...counts.values());
  const choices = [...PARTICIPANT_COLORS].filter(
    (color) => counts.get(color) === lowestUsage,
  );
  return choices[randomBytes(4).readUInt32BE(0) % choices.length];
}

function ensureParticipantColors(participants) {
  const counts = new Map([...PARTICIPANT_COLORS].map((color) => [color, 0]));
  for (const participant of participants) {
    if (PARTICIPANT_COLORS.has(participant.color)) {
      counts.set(participant.color, counts.get(participant.color) + 1);
    }
  }
  for (const participant of participants) {
    if (PARTICIPANT_COLORS.has(participant.color)) continue;
    const lowestUsage = Math.min(...counts.values());
    const choices = [...PARTICIPANT_COLORS].filter(
      (color) => counts.get(color) === lowestUsage,
    );
    const stableIndex = Number.parseInt(digest(participant.id).slice(0, 8), 16);
    participant.color = choices[stableIndex % choices.length];
    counts.set(participant.color, counts.get(participant.color) + 1);
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
if (actor.authVersion or 1) ~= tonumber(ARGV[3]) then return {'STALE_SESSION'} end
local ownerOnly = mutation.type ~= 'updateParticipant' and mutation.type ~= 'changePassword'
if actor.role ~= 'owner' and ownerOnly then return {'FORBIDDEN'} end

if mutation.type == 'updateParticipant' then
  local found = false
  for index, participant in ipairs(plan.participants) do
    if participant.id == mutation.participant.id then
      if actor.role ~= 'owner' then
        if actor.participantId ~= participant.id then return {'FORBIDDEN'} end
        mutation.participant.name = participant.name
        mutation.participant.nameKey = participant.nameKey
      end
      plan.participants[index] = mutation.participant
      found = true
      break
    end
  end
  if not found then return {'PARTICIPANT_NOT_FOUND'} end
elseif mutation.type == 'addParticipant' then
  if actor.role ~= 'owner' then return {'FORBIDDEN'} end
  if #plan.participants >= 24 then return {'PARTICIPANT_LIMIT'} end
  for _, participant in ipairs(plan.participants) do
    if participant.id == mutation.participant.id then return {'DUPLICATE_PARTICIPANT'} end
  end
  table.insert(plan.participants, mutation.participant)
elseif mutation.type == 'removeParticipant' then
  if actor.role ~= 'owner' then return {'FORBIDDEN'} end
  if #plan.participants <= 1 then return {'LAST_PARTICIPANT'} end
  local nextParticipants = {}
  local found = false
  for _, participant in ipairs(plan.participants) do
    if participant.id == mutation.participantId then found = true else table.insert(nextParticipants, participant) end
  end
  if not found then return {'PARTICIPANT_NOT_FOUND'} end
  plan.participants = nextParticipants
  local nextMembers = {}
  for _, member in ipairs(plan.members) do
    if member.participantId ~= mutation.participantId then table.insert(nextMembers, member) end
  end
  plan.members = nextMembers
  local nextInvites = {}
  for _, invite in ipairs(plan.claimInvites or {}) do
    if invite.participantId ~= mutation.participantId then table.insert(nextInvites, invite) end
  end
  plan.claimInvites = nextInvites
elseif mutation.type == 'setMode' then
  plan.mode = mutation.mode
elseif mutation.type == 'setRailObjective' then
  plan.railObjective = mutation.railObjective
elseif mutation.type == 'resetPlan' then
  plan.participants = mutation.participants
  plan.mode = mutation.mode
  plan.railObjective = mutation.railObjective
  local owners = {}
  for _, member in ipairs(plan.members) do
    if member.role == 'owner' then table.insert(owners, member) end
  end
  plan.members = owners
  plan.claimInvites = {}
elseif mutation.type == 'renamePlan' then
  plan.title = mutation.title
elseif mutation.type == 'setJoining' then
  plan.joiningEnabled = mutation.enabled
elseif mutation.type == 'createInvite' then
  for _, member in ipairs(plan.members) do
    if member.participantId == mutation.invite.participantId then return {'PARTICIPANT_ASSIGNED'} end
  end
  local participantFound = false
  for _, participant in ipairs(plan.participants) do
    if participant.id == mutation.invite.participantId then participantFound = true break end
  end
  if not participantFound then return {'PARTICIPANT_NOT_FOUND'} end
  local nextInvites = {}
  for _, invite in ipairs(plan.claimInvites or {}) do
    if invite.participantId ~= mutation.invite.participantId then table.insert(nextInvites, invite) end
  end
  table.insert(nextInvites, mutation.invite)
  plan.claimInvites = nextInvites
  plan.schemaVersion = math.max(plan.schemaVersion or 1, 3)
elseif mutation.type == 'addMember' then
  if #plan.members >= 12 then return {'MEMBER_LIMIT'} end
  for _, member in ipairs(plan.members) do
    if member.usernameKey == mutation.member.usernameKey then return {'DUPLICATE_USERNAME'} end
    if member.participantId == mutation.member.participantId then return {'PARTICIPANT_ASSIGNED'} end
  end
  local participantFound = false
  local participantNameMatches = false
  for _, participant in ipairs(plan.participants) do
    if participant.id == mutation.member.participantId then
      participantFound = true
      participantNameMatches = participant.name == mutation.expectedParticipantName
      if participantNameMatches then participant.nameKey = mutation.member.usernameKey end
      break
    end
  end
  if not participantFound then return {'PARTICIPANT_NOT_FOUND'} end
  if not participantNameMatches then return {'USERNAME_MISMATCH'} end
  table.insert(plan.members, mutation.member)
  local nextInvites = {}
  for _, invite in ipairs(plan.claimInvites or {}) do
    if invite.participantId ~= mutation.member.participantId then table.insert(nextInvites, invite) end
  end
  plan.claimInvites = nextInvites
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

const JOIN_SCRIPT = String.raw`
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NOT_FOUND'} end
local plan = cjson.decode(raw)
local member = cjson.decode(ARGV[1])
local participant = cjson.decode(ARGV[2])
local updatedAt = ARGV[3]
if plan.joiningEnabled == false then return {'JOINING_CLOSED'} end
if #plan.members >= 12 then return {'MEMBER_LIMIT'} end
if #plan.participants >= 24 then return {'PARTICIPANT_LIMIT'} end
for _, existing in ipairs(plan.members) do
  if existing.usernameKey == member.usernameKey then return {'DUPLICATE_USERNAME'} end
  if existing.participantId == participant.id then return {'PARTICIPANT_ASSIGNED'} end
end
for _, existing in ipairs(plan.participants) do
  if existing.id == participant.id then return {'DUPLICATE_PARTICIPANT'} end
  local existingNameKey = existing.nameKey or string.lower(existing.name or '')
  if existingNameKey == member.usernameKey then return {'USERNAME_RESERVED'} end
end
table.insert(plan.members, member)
table.insert(plan.participants, participant)
plan.schemaVersion = math.max(plan.schemaVersion or 1, 3)
plan.version = (plan.version or 0) + 1
plan.updatedAt = updatedAt
local encoded = cjson.encode(plan)
redis.call('SET', KEYS[1], encoded)
return {'OK', encoded}
`;

const CLAIM_INVITE_SCRIPT = String.raw`
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NOT_FOUND'} end
local plan = cjson.decode(raw)
local tokenHash = ARGV[1]
local member = cjson.decode(ARGV[2])
local now = ARGV[3]
local inviteIndex = nil
local participantId = nil
for index, invite in ipairs(plan.claimInvites or {}) do
  if invite.tokenHash == tokenHash then
    inviteIndex = index
    participantId = invite.participantId
    if invite.expiresAt <= now then return {'INVITE_EXPIRED'} end
    break
  end
end
if not inviteIndex then return {'INVALID_INVITE'} end
if #plan.members >= 12 then return {'MEMBER_LIMIT'} end
for _, existing in ipairs(plan.members) do
  if existing.usernameKey == member.usernameKey then return {'DUPLICATE_USERNAME'} end
  if existing.participantId == participantId then return {'PARTICIPANT_ASSIGNED'} end
end
local participantFound = false
for _, participant in ipairs(plan.participants) do
  if participant.id == participantId then
    participantFound = true
  else
    local participantNameKey = participant.nameKey or string.lower(participant.name or '')
    if participantNameKey == member.usernameKey then return {'USERNAME_RESERVED'} end
  end
end
if not participantFound then return {'PARTICIPANT_NOT_FOUND'} end
member.participantId = participantId
table.insert(plan.members, member)
local nextInvites = {}
for index, invite in ipairs(plan.claimInvites or {}) do
  if index ~= inviteIndex then table.insert(nextInvites, invite) end
end
plan.claimInvites = nextInvites
plan.schemaVersion = 3
plan.version = (plan.version or 0) + 1
plan.updatedAt = now
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

  async mutate(planId, actorId, authVersion, mutation) {
    const result = await this.command([
      'EVAL', MUTATE_SCRIPT, '1', `${PLAN_PREFIX}${planId}`, actorId, JSON.stringify(mutation), String(authVersion),
    ]);
    return decodeMutationResult(result);
  }

  async join(planId, member, participant, updatedAt) {
    const result = await this.command([
      'EVAL', JOIN_SCRIPT, '1', `${PLAN_PREFIX}${planId}`, JSON.stringify(member), JSON.stringify(participant), updatedAt,
    ]);
    return decodeMutationResult(result);
  }

  async claimInvite(planId, tokenHash, member, updatedAt) {
    const result = await this.command([
      'EVAL', CLAIM_INVITE_SCRIPT, '1', `${PLAN_PREFIX}${planId}`, tokenHash, JSON.stringify(member), updatedAt,
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

  async mutate(planId, actorId, authVersion, mutation) {
    const previous = this.mutationQueues.get(planId) || Promise.resolve();
    const operation = previous.then(() => this.applyMutation(planId, actorId, authVersion, mutation));
    this.mutationQueues.set(planId, operation.catch(() => undefined));
    return operation;
  }

  async applyMutation(planId, actorId, authVersion, mutation) {
    const key = `${PLAN_PREFIX}${planId}`;
    const plan = await this.get(key);
    if (!plan) return { code: 'NOT_FOUND' };
    const actor = plan.members.find((member) => member.id === actorId);
    if (!actor) return { code: 'FORBIDDEN' };
    if ((actor.authVersion || 1) !== (authVersion || 1)) return { code: 'STALE_SESSION' };
    const ownerOnly = !['updateParticipant', 'changePassword'].includes(mutation.type);
    if (ownerOnly && actor.role !== 'owner') return { code: 'FORBIDDEN' };

    const failure = applyMemoryMutation(plan, actor, mutation);
    if (failure) return { code: failure };
    plan.version += 1;
    plan.updatedAt = mutation.updatedAt;
    await this.set(key, plan);
    return { code: 'OK', plan };
  }

  async join(planId, member, participant, updatedAt) {
    const previous = this.mutationQueues.get(planId) || Promise.resolve();
    const operation = previous.then(async () => {
      const key = `${PLAN_PREFIX}${planId}`;
      const plan = await this.get(key);
      if (!plan) return { code: 'NOT_FOUND' };
      if (plan.joiningEnabled === false) return { code: 'JOINING_CLOSED' };
      if (plan.members.length >= MAX_MEMBERS) return { code: 'MEMBER_LIMIT' };
      if (plan.participants.length >= MAX_PARTICIPANTS) return { code: 'PARTICIPANT_LIMIT' };
      if (plan.members.some((item) => item.usernameKey === member.usernameKey)) return { code: 'DUPLICATE_USERNAME' };
      if (plan.members.some((item) => item.participantId === participant.id)) return { code: 'PARTICIPANT_ASSIGNED' };
      if (plan.participants.some((item) => item.id === participant.id)) return { code: 'DUPLICATE_PARTICIPANT' };
      if (plan.participants.some((item) => (item.nameKey || normalizedName(item.name)) === member.usernameKey)) return { code: 'USERNAME_RESERVED' };
      plan.members.push(member);
      plan.participants.push(participant);
      plan.schemaVersion = Math.max(plan.schemaVersion || 1, 3);
      plan.version = (plan.version || 0) + 1;
      plan.updatedAt = updatedAt;
      await this.set(key, plan);
      return { code: 'OK', plan };
    });
    this.mutationQueues.set(planId, operation.catch(() => undefined));
    return operation;
  }

  async claimInvite(planId, tokenHash, member, updatedAt) {
    const previous = this.mutationQueues.get(planId) || Promise.resolve();
    const operation = previous.then(async () => {
      const key = `${PLAN_PREFIX}${planId}`;
      const plan = await this.get(key);
      if (!plan) return { code: 'NOT_FOUND' };
      const invite = (plan.claimInvites || []).find((item) => item.tokenHash === tokenHash);
      if (!invite) return { code: 'INVALID_INVITE' };
      if (invite.expiresAt <= updatedAt) return { code: 'INVITE_EXPIRED' };
      if (plan.members.length >= MAX_MEMBERS) return { code: 'MEMBER_LIMIT' };
      if (plan.members.some((item) => item.usernameKey === member.usernameKey)) return { code: 'DUPLICATE_USERNAME' };
      if (plan.members.some((item) => item.participantId === invite.participantId)) return { code: 'PARTICIPANT_ASSIGNED' };
      if (!plan.participants.some((item) => item.id === invite.participantId)) return { code: 'PARTICIPANT_NOT_FOUND' };
      if (plan.participants.some((item) => item.id !== invite.participantId && (item.nameKey || normalizedName(item.name)) === member.usernameKey)) {
        return { code: 'USERNAME_RESERVED' };
      }
      member.participantId = invite.participantId;
      plan.members.push(member);
      plan.claimInvites = (plan.claimInvites || []).filter((item) => item.id !== invite.id);
      plan.schemaVersion = 3;
      plan.version = (plan.version || 0) + 1;
      plan.updatedAt = updatedAt;
      await this.set(key, plan);
      return { code: 'OK', plan };
    });
    this.mutationQueues.set(planId, operation.catch(() => undefined));
    return operation;
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
    if (actor.role !== 'owner' && actor.participantId !== mutation.participant.id) return 'FORBIDDEN';
    if (actor.role !== 'owner') Object.assign(mutation.participant, { name: plan.participants[index].name, nameKey: plan.participants[index].nameKey });
    plan.participants[index] = mutation.participant;
  } else if (mutation.type === 'addParticipant') {
    if (actor.role !== 'owner') return 'FORBIDDEN';
    if (plan.participants.length >= MAX_PARTICIPANTS) return 'PARTICIPANT_LIMIT';
    if (plan.participants.some((item) => item.id === mutation.participant.id)) return 'DUPLICATE_PARTICIPANT';
    plan.participants.push(mutation.participant);
  } else if (mutation.type === 'removeParticipant') {
    if (actor.role !== 'owner') return 'FORBIDDEN';
    if (plan.participants.length <= 1) return 'LAST_PARTICIPANT';
    const length = plan.participants.length;
    plan.participants = plan.participants.filter((item) => item.id !== mutation.participantId);
    if (length === plan.participants.length) return 'PARTICIPANT_NOT_FOUND';
    plan.members = plan.members.filter((item) => item.participantId !== mutation.participantId);
    plan.claimInvites = (plan.claimInvites || []).filter((item) => item.participantId !== mutation.participantId);
  } else if (mutation.type === 'setMode') {
    plan.mode = mutation.mode;
  } else if (mutation.type === 'setRailObjective') {
    plan.railObjective = mutation.railObjective;
  } else if (mutation.type === 'resetPlan') {
    plan.participants = mutation.participants;
    plan.mode = mutation.mode;
    plan.railObjective = mutation.railObjective;
    plan.members = plan.members.filter((item) => item.role === 'owner');
    plan.claimInvites = [];
  } else if (mutation.type === 'renamePlan') {
    plan.title = mutation.title;
  } else if (mutation.type === 'setJoining') {
    plan.joiningEnabled = mutation.enabled;
  } else if (mutation.type === 'createInvite') {
    if (!plan.participants.some((item) => item.id === mutation.invite.participantId)) return 'PARTICIPANT_NOT_FOUND';
    if (plan.members.some((item) => item.participantId === mutation.invite.participantId)) return 'PARTICIPANT_ASSIGNED';
    plan.claimInvites = (plan.claimInvites || []).filter((item) => item.participantId !== mutation.invite.participantId);
    plan.claimInvites.push(mutation.invite);
    plan.schemaVersion = Math.max(plan.schemaVersion || 1, 3);
  } else if (mutation.type === 'addMember') {
    const participant = plan.participants.find((item) => item.id === mutation.member.participantId);
    if (plan.members.length >= MAX_MEMBERS) return 'MEMBER_LIMIT';
    if (plan.members.some((item) => item.usernameKey === mutation.member.usernameKey)) return 'DUPLICATE_USERNAME';
    if (plan.members.some((item) => item.participantId === mutation.member.participantId)) return 'PARTICIPANT_ASSIGNED';
    if (!participant) return 'PARTICIPANT_NOT_FOUND';
    if (participant.name !== mutation.expectedParticipantName) return 'USERNAME_MISMATCH';
    participant.nameKey = mutation.member.usernameKey;
    plan.members.push(mutation.member);
    plan.claimInvites = (plan.claimInvites || []).filter((item) => item.participantId !== mutation.member.participantId);
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
  const cookies = {};
  for (const part of String(request.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (!name || value.length === 0) continue;
    try {
      cookies[name] = decodeURIComponent(value.join('='));
    } catch {
      // Ignore malformed, attacker-controlled cookie values.
    }
  }
  return cookies;
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
  if (!token) throw new ClientError(401, 'Sign in to edit this shared plan.', 'AUTH_REQUIRED');
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

async function loadViewer(store, request, planId) {
  const token = parseCookies(request)[cookieName(planId)];
  if (!token) {
    const plan = await store.get(`${PLAN_PREFIX}${planId}`);
    if (!plan) throw new ClientError(404, 'This shared plan no longer exists.', 'NOT_FOUND');
    return { plan, member: null };
  }

  const [session, plan] = await store.getMany([
    `${SESSION_PREFIX}${digest(token)}`,
    `${PLAN_PREFIX}${planId}`,
  ]);
  if (!plan) throw new ClientError(404, 'This shared plan no longer exists.', 'NOT_FOUND');
  if (!session || session.planId !== planId) return { plan, member: null };
  const member = plan.members.find((item) => item.id === session.memberId);
  if (!member || (member.authVersion || 1) !== (session.authVersion || 1)) {
    return { plan, member: null };
  }
  return { plan, member };
}

function publicPlan(plan, currentMember) {
  ensureParticipantColors(plan.participants);
  const ownerView = currentMember?.role === 'owner';
  return {
    schemaVersion: plan.schemaVersion || 1,
    id: plan.id,
    title: plan.title,
    mode: plan.mode,
    railObjective: plan.railObjective === 'minimax' || plan.railObjective === 'weighted' || plan.railObjective === 'evenness'
      ? plan.railObjective
      : 'average',
    participants: plan.participants.map((participant) => {
      const { nameKey: _nameKey, ...visible } = participant;
      return visible;
    }),
    joiningEnabled: plan.joiningEnabled !== false,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    version: plan.version,
    memberCount: plan.members.length,
    currentMember: currentMember ? {
      id: currentMember.id,
      displayName: currentMember.displayName,
      role: currentMember.role,
      ...(currentMember.role === 'owner' ? { email: currentMember.email } : {}),
      ...(currentMember.username ? { username: currentMember.username } : {}),
      ...(currentMember.participantId ? { participantId: currentMember.participantId } : {}),
    } : null,
    members: ownerView ? plan.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      role: member.role,
      ...(member.role === 'owner' ? { email: member.email } : {}),
      ...(member.username ? { username: member.username } : {}),
      ...(member.participantId ? { participantId: member.participantId } : {}),
    })) : [],
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
    DUPLICATE_USERNAME: [409, 'That username is already in this plan.'],
    USERNAME_RESERVED: [409, 'That name is already in the plan. Ask the owner to create your login.'],
    USERNAME_MISMATCH: [409, 'The participant name changed. Refresh and try again.'],
    PARTICIPANT_ASSIGNED: [409, 'That participant already has a username.'],
    MEMBER_NOT_FOUND: [404, 'That member was not found.'],
    JOINING_CLOSED: [403, 'The owner has closed this plan to new people.'],
    INVALID_INVITE: [404, 'This personal invite is invalid or has already been used.'],
    INVITE_EXPIRED: [410, 'This personal invite has expired. Ask the owner for a new one.'],
    STALE_SESSION: [401, 'Your session is no longer valid. Sign in again.'],
    INVALID_MUTATION: [400, 'That plan change is not supported.'],
  };
  const [status, message] = errors[code] || [503, 'The plan could not be updated.'];
  return new ClientError(status, message, code);
}

async function validateMutation(input, plan) {
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
    case 'setRailObjective':
      return {
        type: input.type,
        railObjective: input.railObjective === 'minimax' || input.railObjective === 'weighted' || input.railObjective === 'evenness'
          ? input.railObjective
          : 'average',
        updatedAt,
      };
    case 'resetPlan':
      return {
        type: input.type,
        participants: validateParticipants(input.participants),
        mode: input.mode === 'distance' ? 'distance' : 'rail',
        railObjective: input.railObjective === 'minimax' || input.railObjective === 'weighted' || input.railObjective === 'evenness'
          ? input.railObjective
          : 'average',
        updatedAt,
      };
    case 'renamePlan': {
      const title = cleanText(input.title, 100);
      if (!title) throw new ClientError(400, 'Plan name is required.');
      return { type: input.type, title, updatedAt };
    }
    case 'setJoining':
      return { type: input.type, enabled: Boolean(input.enabled), updatedAt };
    case 'createInvite': {
      const participantId = cleanText(input.participantId, 80);
      if (!plan.participants.some((item) => item.id === participantId)) {
        throw new ClientError(404, 'That participant was not found.');
      }
      const inviteToken = id(24);
      return {
        mutation: {
          type: input.type,
          invite: {
            id: id(10),
            participantId,
            tokenHash: digest(inviteToken),
            createdAt: updatedAt,
            expiresAt: new Date(Date.now() + CLAIM_INVITE_SECONDS * 1000).toISOString(),
          },
          updatedAt,
        },
        inviteToken,
      };
    }
    case 'addMember': {
      const participantId = cleanText(input.participantId, 80);
      const participant = plan.participants.find((item) => item.id === participantId);
      if (!participant) throw new ClientError(404, 'That participant was not found.');
      const { username, usernameKey } = normalizeUsername(participant.name);
      const passwordHash = await hashPassword(validatePassword(input.temporaryPassword, 'Temporary password'));
      return {
        type: input.type,
        member: {
          id: id(10), username, usernameKey, displayName: username,
          participantId, role: 'member', passwordHash, authVersion: 1,
        },
        updatedAt,
        expectedParticipantName: participant.name,
      };
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
        const { plan, member } = await loadViewer(store, request, planId);
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
            schemaVersion: 3,
            id: planId,
            title,
            mode: body.mode === 'distance' ? 'distance' : 'rail',
            railObjective: body.railObjective === 'minimax' || body.railObjective === 'weighted' || body.railObjective === 'evenness'
              ? body.railObjective
              : 'average',
            joiningEnabled: true,
            participants,
            members: [owner],
            claimInvites: [],
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

      if (body.action === 'ownerLogin') {
        const planId = planIdFrom(body.planId);
        const email = normalizeEmail(body.email);
        const limited = await store.hitRateLimit(
          digest(`owner-login:${clientIp(request)}:${planId}:${email}`),
          15 * 60,
          8,
        );
        if (limited) throw new ClientError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
        const plan = await store.get(`${PLAN_PREFIX}${planId}`);
        const member = plan?.members.find((item) => item.role === 'owner' && item.email === email);
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

      if (body.action === 'join' || body.action === 'login') {
        const planId = planIdFrom(body.planId);
        const { username, usernameKey } = normalizeUsername(body.username);
        const ip = clientIp(request);
        const [identityLimited, ipLimited] = await Promise.all([
          store.hitRateLimit(digest(`participant-login:${planId}:${usernameKey}`), 15 * 60, 20),
          store.hitRateLimit(digest(`participant-access:${ip}:${planId}`), 15 * 60, 30),
        ]);
        if (identityLimited || ipLimited) {
          throw new ClientError(429, 'Too many attempts. Try again in 15 minutes.');
        }

        const plan = await store.get(`${PLAN_PREFIX}${planId}`);
        if (!plan) throw new ClientError(404, 'This shared plan no longer exists.', 'NOT_FOUND');
        const existing = plan.members.find((item) => item.role !== 'owner' && item.usernameKey === usernameKey);

        if (body.action === 'login') {
          let passwordValid = false;
          if (existing) {
            passwordValid = await verifyPassword(String(body.password || ''), existing.passwordHash);
          } else {
            await hashPassword(String(body.password || '').padEnd(PASSWORD_MIN_LENGTH, ' '));
          }
          if (!passwordValid) throw new ClientError(401, 'Username or password is incorrect.');
          await createSession(store, request, response, planId, existing.id, existing.authVersion || 1);
          return json(response, 200, { plan: publicPlan(plan, existing) });
        }

        if (existing) {
          throw new ClientError(409, 'That username already exists. Sign in instead.', 'DUPLICATE_USERNAME');
        }

        if (plan.joiningEnabled === false) throw mutationError('JOINING_CLOSED');
        const reserved = plan.participants.some((participant) => {
          const name = cleanText(participant.name, 80).normalize('NFKC').replace(/\s+/g, ' ');
          return name && name.toLocaleLowerCase('en') === usernameKey;
        });
        if (reserved) {
          throw new ClientError(409, 'That name is already in the plan. Ask the owner to create your login.', 'USERNAME_RESERVED');
        }

        const passwordHash = await hashPassword(validatePassword(body.password));
        const now = new Date().toISOString();
        const participant = {
          id: `person_${id(12)}`,
          name: username,
          nameKey: usernameKey,
          color: pickParticipantColor(plan.participants),
          sameAsStart: true,
          start: { query: '', status: 'empty' },
          end: { query: '', status: 'empty' },
        };
        const member = {
          id: id(10), username, usernameKey, displayName: username,
          participantId: participant.id, role: 'member', passwordHash, authVersion: 1,
        };
        const result = await store.join(planId, member, participant, now);
        if (result.code !== 'OK') throw mutationError(result.code);
        await createSession(store, request, response, planId, member.id, member.authVersion);
        return json(response, 201, { plan: publicPlan(result.plan, member) });
      }

      if (body.action === 'claimInvite') {
        const planId = planIdFrom(body.planId);
        const inviteToken = cleanText(body.inviteToken, 64);
        if (!/^[a-zA-Z0-9_-]{20,64}$/.test(inviteToken)) throw mutationError('INVALID_INVITE');
        const { username, usernameKey } = normalizeUsername(body.username);
        const ip = clientIp(request);
        const [inviteLimited, ipLimited] = await Promise.all([
          store.hitRateLimit(digest(`claim-invite:${planId}:${inviteToken}`), 15 * 60, 12),
          store.hitRateLimit(digest(`participant-access:${ip}:${planId}`), 15 * 60, 30),
        ]);
        if (inviteLimited || ipLimited) throw new ClientError(429, 'Too many attempts. Try again in 15 minutes.');
        const passwordHash = await hashPassword(validatePassword(body.password));
        const member = {
          id: id(10), username, usernameKey, displayName: username,
          role: 'member', passwordHash, authVersion: 1,
        };
        const now = new Date().toISOString();
        const result = await store.claimInvite(planId, digest(inviteToken), member, now);
        if (result.code !== 'OK') throw mutationError(result.code);
        const claimedMember = result.plan.members.find((item) => item.id === member.id);
        await createSession(store, request, response, planId, member.id, member.authVersion);
        return json(response, 201, { plan: publicPlan(result.plan, claimedMember) });
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

      const mutationType = cleanText(body.mutation?.type, 40);
      if (member.role !== 'owner' && !['updateParticipant', 'changePassword'].includes(mutationType)) {
        throw mutationError('FORBIDDEN');
      }
      const validated = await validateMutation(body.mutation, plan);
      const mutation = validated.mutation || validated;
      const result = await store.mutate(planId, session.memberId, session.authVersion || 1, mutation);
      if (result.code !== 'OK') throw mutationError(result.code);
      const currentMember = result.plan.members.find((item) => item.id === member.id);
      if (mutation.type === 'changePassword') {
        await createSession(store, request, response, planId, currentMember.id, currentMember.authVersion);
      }
      return json(response, 200, {
        plan: publicPlan(result.plan, currentMember),
        ...(validated.inviteToken ? { inviteToken: validated.inviteToken } : {}),
      });
    } catch (error) {
      if (error instanceof ClientError) {
        return json(response, error.status, { error: error.message, code: error.code });
      }
      console.error('Shared plan request failed.', error);
      return json(response, 503, { error: 'Shared plans are temporarily unavailable.' });
    }
  };
}

