import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  clearSessionCookie,
  hashAgentToken,
  hashPassword,
  newAgentToken,
  requireAuth,
  resolveToken,
  setSessionCookie,
  signSessionToken,
  verifyPassword,
} from './auth.js';
import type { AuthedRequest } from './auth.js';
import { isAvatarValue, MAX_AVATAR_LENGTH } from './avatars.js';
import { HttpError } from './errors.js';
import { handleValidationError, normalizeHandle } from './handles.js';
import * as hub from './hub.js';
import * as store from './store.js';
import { decryptSecret, encryptSecret, newTriggerSecret, testTrigger, validateTriggerUrl } from './trigger.js';
import type { DeliveryMode, Member, MessageKind, PresenceEntry, Principal, Role, Room, TaskStatus } from './types.js';

const router = Router();

/* Express 4 does not forward rejected promises from async handlers. */
function wrap(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

const joinAttempts = new Map<string, number[]>();
function checkJoinRate(ip: string, code: string): void {
  const key = `${ip}:${code.toLowerCase()}`;
  const now = Date.now();
  const recent = (joinAttempts.get(key) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 5) throw new HttpError(429, 'Too many join requests for this room. Try again in a minute.');
  recent.push(now);
  joinAttempts.set(key, recent);
  if (joinAttempts.size > 5_000) {
    for (const [candidate, times] of joinAttempts) {
      if (!times.some((at) => now - at < 60_000)) joinAttempts.delete(candidate);
    }
  }
}

const authAttempts = new Map<string, number[]>();
function checkAuthRate(ip: string, action: 'login' | 'register', limit: number): void {
  const key = `${action}:${ip}`;
  const now = Date.now();
  const recent = (authAttempts.get(key) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= limit) throw new HttpError(429, 'Too many attempts. Try again in a minute.');
  recent.push(now);
  authAttempts.set(key, recent);
  if (authAttempts.size > 5_000) {
    for (const [candidate, times] of authAttempts) {
      if (!times.some((at) => now - at < 60_000)) authAttempts.delete(candidate);
    }
  }
}

/* Admin endpoints can target any agent in a room they administer; an agent
 * token only ever resolves to itself. */
function agentTarget(req: AuthedRequest, principal: Principal): string {
  if (principal.type === 'agent') return principal.id;
  const body = z.object({ agentId: z.string().min(1) }).parse(req.body ?? {});
  const roomId = store.getAgentRoom(body.agentId);
  if (!roomId) throw new HttpError(404, 'Agent not found');
  adminOrThrow(roomId, principal);
  return body.agentId;
}

function principalOf(req: AuthedRequest): Principal {
  if (!req.principal) throw new HttpError(401, 'Unauthorized');
  return req.principal;
}

/* Prefer the public host when a proxy or tunnel forwarded the request, so links
 * handed to an agent are reachable from wherever the admin opened them. */
function publicOrigin(req: Request): string {
  const host = req.get('x-forwarded-host')?.split(',')[0].trim() || req.get('host');
  const proto = req.get('x-forwarded-proto')?.split(',')[0].trim() || req.protocol;
  return `${proto}://${host}`;
}

function membershipOrThrow(roomId: string, principal: Principal): { role: Role; joinedAt: string } {
  const membership = store.getMembership(roomId, principal);
  if (!membership) throw new HttpError(404, 'Room not found or you are not a member of it');
  return membership;
}

function adminOrThrow(roomId: string, principal: Principal): void {
  if (membershipOrThrow(roomId, principal).role !== 'admin') {
    throw new HttpError(403, 'Only room admins can do that');
  }
}

function writerOrThrow(roomId: string, principal: Principal): void {
  if (membershipOrThrow(roomId, principal).role === 'viewer') {
    throw new HttpError(403, 'Viewers have read-only access');
  }
}

function roomOrThrow(roomId: string) {
  const room = store.getRoom(roomId);
  if (!room) throw new HttpError(404, 'Room not found');
  return room;
}

function userOnly(principal: Principal): void {
  if (principal.type !== 'user') throw new HttpError(403, 'Agents cannot perform this action');
}

function emitActivity(roomId: string, activity: ReturnType<typeof store.logActivity>): void {
  hub.broadcast(roomId, { type: 'activity.new', activity });
}

function emitTasks(roomId: string): void {
  hub.broadcast(roomId, { type: 'tasks.replaced', tasks: store.listTasks(roomId) });
}

function previewHeaders(res: Response): void {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

function publicRoomSummary(room: Room) {
  return {
    code: room.code ?? '',
    name: room.name,
    topic: room.topic,
    mode: room.mode,
    createdAt: room.createdAt,
    memberCount: store.listMembers(room.id).length,
  };
}

function publicMembers(roomId: string) {
  return store.listMembers(roomId).map((member) => ({
    name: member.name,
    type: member.type,
    role: member.role,
    description: member.description,
    handle: member.handle,
    avatar: member.avatar,
  }));
}

function profileHeaders(res: Response): void {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

/* Shared by the one-link briefing, approval responses, and the live join socket. */
function agentBriefing(
  origin: string,
  token: string,
  agent: { id: string; name: string; role: Role },
  room: Room,
) {
  const api = `${origin}/api`;
  const roomUrl = `${api}/rooms/${room.id}`;
  const socketUrl = `${origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
  const auth = `Bearer ${token}`;

  return {
    message: `You are "${agent.name}" in RoomForge room "${room.name}".`,
    agent,
    room: {
      id: room.id,
      code: room.code ?? '',
      name: room.name,
      topic: room.topic,
      mode: room.mode,
    },
    connect: {
      baseUrl: api,
      authorization: auth,
      roomId: room.id,
    },
    live: {
      websocket: socketUrl,
      autoJoinsRoom: true,
      send: [
        { type: 'message.send', kind: 'chat', content: 'On it.' },
        { type: 'presence.set', status: 'working', activity: 'Working' },
        { type: 'ping' },
      ],
      events: [
        'ready',
        'room.state',
        'message.new',
        'activity.new',
        'task.updated',
        'tasks.replaced',
        'presence.update',
        'members.updated',
      ],
      note: 'Open the socket once and keep it open. New messages and room events arrive instantly; the server pings every 30s.',
    },
    poll: {
      fallbackIfWebSocketIsUnavailable: true,
      everySeconds: 4,
      request: `GET ${roomUrl}`,
    },
    do: {
      say: {
        request: `POST ${roomUrl}/messages`,
        body: { content: 'On it.', kind: 'chat' },
      },
      presence: {
        request: `PATCH ${roomUrl}/presence`,
        body: { status: 'working', activity: 'Working' },
      },
      claimTask: {
        request: `PATCH ${roomUrl}/tasks/<taskId>`,
        body: { status: 'doing' },
      },
      listTasks: {
        request: `GET ${roomUrl}/tasks?status=todo,doing&assignee=me`,
        note: 'Filters: status, assignee (me, unassigned, user:ID, agent:ID), q, limit, offset.',
      },
      createTask: {
        request: `POST ${roomUrl}/tasks`,
        body: { title: 'Fix the login redirect', paths: 'web/src/App.tsx', clientTaskId: 'job-123' },
        note: 'Reuse clientTaskId when retrying so the original task is returned, not a duplicate.',
      },
    },
    firstStep: `Open ${socketUrl}, then send {"type":"message.send","content":"I'm connected."}. If you cannot hold a socket, use GET ${roomUrl} with Authorization: ${auth}.`,
    guide: `${origin}/agent-guide`,
  };
}

function attachRepo(roomId: string, repoId: string | null | undefined): string | null {
  if (repoId === undefined || repoId === null || repoId === '') return null;
  if (roomOrThrow(roomId).mode !== 'code') throw new HttpError(400, 'Chat-only rooms do not have shared repos');
  if (!store.getRepo(roomId, repoId)) throw new HttpError(400, 'That repository is not linked to this room');
  return repoId;
}

function verifyAssignee(roomId: string, type: string | null, id: string | null): void {
  if (!type && !id) return;
  if (!type || !id) throw new HttpError(400, 'Assignee requires both type and id');
  if (type !== 'user' && type !== 'agent') throw new HttpError(400, 'Invalid assignee type');
  if (!store.getMembership(roomId, { type, id, name: '' })) {
    throw new HttpError(400, 'Assignee is not a member of this room');
  }
}

/* ------------------------------- auth ----------------------------------- */

const registerSchema = z.object({
  name: z.string().trim().min(1).max(48),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(100),
});

router.post('/auth/register', (req, res) => {
  checkAuthRate(req.ip ?? req.socket.remoteAddress ?? 'unknown', 'register', 5);
  const body = registerSchema.parse(req.body);
  if (store.findUserByEmail(body.email)) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  const user = store.createUser(body.name, body.email, hashPassword(body.password));
  const token = signSessionToken(user.id, user.session_version);
  setSessionCookie(res, token);
  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      handle: user.handle ?? '',
      avatar: user.avatar ?? '',
    },
  });
});

router.post('/auth/login', (req, res) => {
  checkAuthRate(req.ip ?? req.socket.remoteAddress ?? 'unknown', 'login', 10);
  const body = z
    .object({ email: z.string().trim().email(), password: z.string().min(1) })
    .parse(req.body);
  const user = store.findUserByEmail(body.email);
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const token = signSessionToken(user.id, user.session_version);
  setSessionCookie(res, token);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      handle: user.handle ?? '',
      avatar: user.avatar ?? '',
    },
  });
});

router.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

/* One public link that gives an agent everything it needs. The token is the path
 * credential; no headers, discovery, or prior state required. */
router.get('/agent/connect/:token', (req, res) => {
  const token = req.params.token;
  const principal = token.startsWith('rf_') ? resolveToken(token) : null;
  if (!principal || principal.type !== 'agent') {
    throw new HttpError(401, 'This connection link is invalid or revoked');
  }
  const roomId = store.getAgentRoom(principal.id);
  const room = roomId ? store.getRoom(roomId) : undefined;
  if (!room) throw new HttpError(404, 'The room for this agent no longer exists');

  const membership = store.getMembership(room.id, principal);
  previewHeaders(res);
  res.json(
    agentBriefing(
      publicOrigin(req),
      token,
      { id: principal.id, name: principal.name, role: membership?.role ?? 'member' },
      room,
    ),
  );
});

/* Public rooms directory: returns all public rooms */
router.get(['/rooms/public', '/room', '/rooms/all'], (req, res) => {
  previewHeaders(res);
  const rooms = store.listPublicRooms().map((room) => ({
    ...room,
    memberPreviews: publicMembers(room.id)
      .slice(0, 4)
      .map((member) => ({ name: member.name, type: member.type, avatar: member.avatar })),
  }));
  res.json({ rooms });
});

/* Public room page: anyone holding the room code can see what
 * the room is and who is in it, but joining still needs an admin. */
router.get('/rooms/public/:code', (req, res) => {
  const code = req.params.code.trim();
  const room = store.getRoomByCode(code);
  if (!room) throw new HttpError(404, 'No room matches that code');

  const origin = publicOrigin(req);
  previewHeaders(res);
  res.json({
    room: publicRoomSummary(room),
    members: publicMembers(room.id),
    approvalRequired: true,
    join: {
      page: `${origin}/room/${room.code}`,
      human: `Sign in, then GET ${origin}/api/join/${room.code}`,
      agent: `GET ${origin}/api/agent/join/${room.code}?name=YOUR_NAME`,
    },
  });
});

const agentJoinSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(200).optional().default(''),
  deliveryMode: z.enum(['socket', 'trigger']).optional().default('socket'),
  triggerUrl: z.string().trim().max(400).optional(),
});

/* Agents can ask to join any room they can see. This returns a pending ticket
 * and a socket URL that waits for an admin; no account or token is needed yet.
 * POST carries the delivery mode and wake URL; GET stays as a deprecated alias. */
async function handleAgentJoin(req: Request, res: Response): Promise<void> {
  const code = req.params.code.trim();
  const room = store.getRoomByCode(code);
  if (!room) throw new HttpError(404, 'No room matches that code');

  const input = agentJoinSchema.parse(req.method === 'GET' ? req.query : req.body);
  const name = input.name ?? `Agent ${randomBytes(2).toString('hex').toUpperCase()}`;
  checkJoinRate(req.ip ?? req.socket.remoteAddress ?? 'unknown', room.code ?? code);

  let triggerUrl: string | null = null;
  if (input.deliveryMode === 'trigger') {
    if (!input.triggerUrl) {
      throw new HttpError(400, 'triggerUrl is required when deliveryMode is "trigger"');
    }
    triggerUrl = await validateTriggerUrl(input.triggerUrl);
  }

  let request = store.getPendingAgentJoinRequest(room.id, name);
  const already = Boolean(request);
  if (!request) {
    request = store.createJoinRequest(room.id, 'agent', name, input.description, null, {
      deliveryMode: input.deliveryMode as DeliveryMode,
      triggerUrl,
    });
    hub.broadcastJoinRequests(room.id);
  }

  const origin = publicOrigin(req);
  const api = `${origin}/api`;
  const pollUrl = `${api}/agent/join/requests/${request.request_key}`;
  const socketUrl = `${origin.replace(/^http/, 'ws')}/ws?join=${encodeURIComponent(request.request_key)}`;

  previewHeaders(res);
  res.status(202).json({
    status: 'pending',
    already,
    deliveryMode: request.delivery_mode ?? 'socket',
    triggerUrl: request.trigger_url ?? undefined,
    message: `Request sent to "${room.name}". An admin must approve it before you can chat.`,
    request: {
      key: request.request_key,
      name: request.name,
      status: 'pending',
      createdAt: request.created_at,
      poll: pollUrl,
      everySeconds: 2,
    },
    room: publicRoomSummary(room),
    live: {
      websocket: socketUrl,
      events: ['join.pending', 'join.approved', 'join.denied', 'ready', 'room.state'],
      note: 'Open this socket now and keep it open. On approval it becomes your room socket and you receive connect details plus the room state.',
    },
    poll: {
      fallbackIfWebSocketIsUnavailable: true,
      everySeconds: 2,
      request: `GET ${pollUrl}`,
    },
    next: `Open ${socketUrl}. If you cannot hold it, poll ${pollUrl} until status is "approved".`,
    guide: `${origin}/agent-guide`,
  });
}

router.get('/agent/join/:code', wrap(handleAgentJoin));
router.post('/agent/join/:code', wrap(handleAgentJoin));

/* Poll a pending agent request. A socket waiting on the same key receives the
 * same approval payload instantly; this route is the no-socket fallback. */
router.get('/agent/join/requests/:key', (req, res) => {
  const request = store.getJoinRequestByKey(req.params.key);
  if (!request) throw new HttpError(404, 'Unknown join request');
  const room = store.getRoom(request.room_id);
  if (!room) throw new HttpError(404, 'The room for this request no longer exists');

  const origin = publicOrigin(req);
  const api = `${origin}/api`;
  previewHeaders(res);

  if (request.status === 'pending') {
    res.json({
      status: 'pending',
      deliveryMode: request.delivery_mode ?? 'socket',
      triggerUrl: request.trigger_url ?? undefined,
      message: `Waiting for an admin to approve your request to join "${room.name}".`,
      request: {
        key: request.request_key,
        name: request.name,
        status: 'pending',
        createdAt: request.created_at,
        poll: `${api}/agent/join/requests/${request.request_key}`,
      },
      room: publicRoomSummary(room),
      live: {
        websocket: `${origin.replace(/^http/, 'ws')}/ws?join=${encodeURIComponent(request.request_key)}`,
        events: ['join.pending', 'join.approved', 'join.denied', 'ready', 'room.state'],
      },
      guide: `${origin}/agent-guide`,
    });
    return;
  }

  if (request.status === 'denied') {
    res.json({
      status: 'denied',
      message: `An admin declined the request to join "${room.name}".`,
      room: publicRoomSummary(room),
      retry: `GET ${api}/agent/join/${room.code}?name=${encodeURIComponent(request.name)}`,
      guide: `${origin}/agent-guide`,
    });
    return;
  }

  if (!request.agent_token || !request.agent_id) {
    throw new HttpError(401, 'This join request has no active connection');
  }
  const principal = resolveToken(request.agent_token);
  if (!principal || principal.type !== 'agent') {
    throw new HttpError(401, 'This agent has been removed from the room');
  }
  const membership = store.getMembership(room.id, principal);
  if (!membership) throw new HttpError(401, 'This agent is no longer a member of the room');

  const secretEnc = store.takeJoinRequestSecretEnc(request.id);
  const triggerSecret = secretEnc ? decryptSecret(secretEnc) : null;

  res.json({
    status: 'approved',
    ...agentBriefing(
      origin,
      request.agent_token,
      { id: principal.id, name: principal.name, role: membership.role },
      room,
    ),
    token: request.agent_token,
    ...(triggerSecret ? { triggerSecret } : {}),
    join: {
      status: 'approved',
      requestKey: request.request_key,
      roomUrl: `${origin}/room/${room.code}`,
    },
  });
});

/* Public identities. Email addresses and credentials never appear here. */
router.get('/profiles/users/:handle', (req, res) => {
  const handle = normalizeHandle(req.params.handle);
  if (handleValidationError(handle)) throw new HttpError(404, 'No profile matches that handle');
  const profile = store.getUserProfileByHandle(handle);
  if (!profile) throw new HttpError(404, 'No profile matches that handle');
  profileHeaders(res);
  res.json({ profile });
});

router.get('/profiles/agents/:handle', (req, res) => {
  const handle = normalizeHandle(req.params.handle);
  if (handleValidationError(handle)) throw new HttpError(404, 'No profile matches that handle');
  const profile = store.getAgentProfileByHandle(handle);
  if (!profile) throw new HttpError(404, 'No profile matches that handle');
  profileHeaders(res);
  res.json({ profile });
});

router.use(requireAuth);

router.get('/me', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  if (principal.type === 'agent') {
    const roomId = store.getAgentRoom(principal.id);
    const room = roomId ? store.getRoom(roomId) : undefined;
    if (room) {
      res.json({
        principal,
        room: {
          id: room.id,
          code: room.code ?? '',
          name: room.name,
          topic: room.topic,
          mode: room.mode,
        },
      });
      return;
    }
  }
  res.json({ principal });
});

/* -------------------------------- profiles ------------------------------- */

const profileHandleSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .transform(normalizeHandle)
  .refine((value) => handleValidationError(value) === null, {
    message: 'Use 3–30 lowercase letters, numbers, hyphens, or underscores',
  });

const profileWebsiteSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => !value || /^https?:\/\/[^\s]+$/i.test(value), {
    message: 'Use a full URL beginning with https://',
  });

const profileAvatarSchema = z
  .string()
  .trim()
  .max(MAX_AVATAR_LENGTH, { message: 'Profile images must be under 120 KB' })
  .refine(isAvatarValue, {
    message: 'Choose a preset profile picture or upload a PNG, JPEG, or WebP image',
  });

const userProfilePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(48).optional(),
    handle: profileHandleSchema.optional(),
    headline: z.string().trim().max(100).optional(),
    bio: z.string().trim().max(600).optional(),
    location: z.string().trim().max(80).optional(),
    website: profileWebsiteSchema.optional(),
    avatar: profileAvatarSchema.optional(),
    showRooms: z.boolean().optional(),
  })
  .strict();

const agentCapabilitiesSchema = z.union([
  z.array(z.string().trim().min(1).max(48)).max(12),
  z
    .string()
    .trim()
    .max(300)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12),
    ),
]);

const agentProfilePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    handle: profileHandleSchema.optional(),
    headline: z.string().trim().max(120).optional(),
    bio: z.string().trim().max(900).optional(),
    website: profileWebsiteSchema.optional(),
    avatar: profileAvatarSchema.optional(),
    capabilities: agentCapabilitiesSchema.optional(),
  })
  .strict();

function assertProfileHandle(handle: string, principal: { type: 'user' | 'agent'; id: string }): void {
  if (store.handleInUse(handle, principal)) {
    throw new HttpError(409, 'That handle is already taken');
  }
}

function syncUserProfileRooms(userId: string): void {
  for (const roomId of store.listPrincipalRoomIds('user', userId)) {
    hub.broadcastMembers(roomId);
  }
}

router.get('/me/profile', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const profile =
    principal.type === 'user'
      ? store.getUserProfile(principal.id)
      : store.getAgentProfile(principal.id);
  if (!profile) throw new HttpError(404, 'Profile not found');
  res.json({ profile });
});

router.patch('/me/profile', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  if (principal.type === 'user') {
    const body = userProfilePatchSchema.parse(req.body);
    if (body.handle) assertProfileHandle(body.handle, { type: 'user', id: principal.id });
    const profile = store.updateUserProfile(principal.id, body);
    if (!profile) throw new HttpError(404, 'Profile not found');
    hub.syncPrincipalProfile('user', principal.id, profile.name, profile.handle, profile.avatar);
    syncUserProfileRooms(principal.id);
    res.json({ profile });
    return;
  }

  const body = agentProfilePatchSchema.parse(req.body);
  if (body.handle) assertProfileHandle(body.handle, { type: 'agent', id: principal.id });
  const capabilities = body.capabilities ? body.capabilities.join(', ') : undefined;
  const profile = store.updateAgentProfile(principal.id, {
    name: body.name,
    handle: body.handle,
    headline: body.headline,
    bio: body.bio,
    website: body.website,
    avatar: body.avatar,
    ...(capabilities !== undefined ? { capabilities } : {}),
  });
  if (!profile) throw new HttpError(404, 'Profile not found');
  hub.syncPrincipalProfile('agent', principal.id, profile.name, profile.handle, profile.avatar);
  const roomId = store.getAgentRoom(principal.id);
  if (roomId) hub.broadcastMembers(roomId);
  res.json({ profile });
});

router.patch('/me/password', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  userOnly(principal);
  const body = z
    .object({
      currentPassword: z.string().min(1).max(100),
      newPassword: z.string().min(8).max(100),
    })
    .parse(req.body);
  const passwordHash = store.getUserPasswordHash(principal.id);
  if (!passwordHash || !verifyPassword(body.currentPassword, passwordHash)) {
    throw new HttpError(403, 'Current password is incorrect');
  }
  if (body.currentPassword === body.newPassword) {
    throw new HttpError(400, 'Choose a password different from the current one');
  }
  const sessionVersion = store.updateUserPassword(principal.id, hashPassword(body.newPassword));
  const token = signSessionToken(principal.id, sessionVersion);
  setSessionCookie(res, token);
  res.json({ ok: true, token });
});

function agentAdminRoom(agentId: string, principal: Principal): string {
  const roomId = store.getAgentRoom(agentId);
  if (!roomId) throw new HttpError(404, 'Agent not found');
  adminOrThrow(roomId, principal);
  return roomId;
}

router.get('/agents/:agentId/profile', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  agentAdminRoom(req.params.agentId, principal);
  const profile = store.getAgentProfile(req.params.agentId);
  if (!profile) throw new HttpError(404, 'Agent not found');
  res.json({ profile });
});

router.patch('/agents/:agentId/profile', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const roomId = agentAdminRoom(req.params.agentId, principal);
  const body = agentProfilePatchSchema.parse(req.body);
  if (body.handle) assertProfileHandle(body.handle, { type: 'agent', id: req.params.agentId });
  const capabilities = body.capabilities ? body.capabilities.join(', ') : undefined;
  const profile = store.updateAgentProfile(req.params.agentId, {
    name: body.name,
    handle: body.handle,
    headline: body.headline,
    bio: body.bio,
    website: body.website,
    avatar: body.avatar,
    ...(capabilities !== undefined ? { capabilities } : {}),
  });
  if (!profile) throw new HttpError(404, 'Agent not found');
  hub.syncPrincipalProfile('agent', req.params.agentId, profile.name, profile.handle, profile.avatar);
  hub.broadcastMembers(roomId);
  res.json({ profile });
});

/* --------------------------- agent wake config --------------------------- */

router.patch('/agent/me', wrap(async (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  if (principal.type !== 'agent') throw new HttpError(403, 'Only agents can update their delivery mode');
  const body = z
    .object({
      deliveryMode: z.enum(['socket', 'trigger']).optional(),
      triggerUrl: z.string().trim().max(400).nullable().optional(),
    })
    .parse(req.body);

  const runtime = store.getAgentRuntime(principal.id);
  if (!runtime) throw new HttpError(404, 'Agent not found');

  const deliveryMode: DeliveryMode = body.deliveryMode ?? runtime.deliveryMode;
  let triggerUrl = runtime.triggerUrl;
  if (body.triggerUrl !== undefined) {
    triggerUrl = body.triggerUrl ? await validateTriggerUrl(body.triggerUrl) : null;
  }
  if (deliveryMode === 'trigger' && !triggerUrl) {
    throw new HttpError(400, 'triggerUrl is required when deliveryMode is "trigger"');
  }

  let triggerSecret: string | null = null;
  let triggerSecretEnc: string | null = null;
  if (deliveryMode === 'trigger' && !runtime.hasSecret) {
    triggerSecret = newTriggerSecret();
    triggerSecretEnc = encryptSecret(triggerSecret);
  }

  store.setAgentTriggerConfig(principal.id, {
    deliveryMode,
    triggerUrl,
    ...(triggerSecretEnc ? { triggerSecretEnc } : {}),
  });
  hub.broadcastPresence(runtime.roomId);

  res.json({
    agent: {
      id: runtime.id,
      name: runtime.name,
      deliveryMode,
      triggerUrl,
      hasSecret: runtime.hasSecret || Boolean(triggerSecretEnc),
    },
    ...(triggerSecret ? { triggerSecret } : {}),
  });
}));

router.post('/agent/me/rotate-trigger-secret', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const agentId = agentTarget(req as AuthedRequest, principal);
  const runtime = store.getAgentRuntime(agentId);
  if (!runtime) throw new HttpError(404, 'Agent not found');

  const triggerSecret = newTriggerSecret();
  store.setAgentTriggerConfig(agentId, { triggerSecretEnc: encryptSecret(triggerSecret) });
  res.json({ agentId, triggerSecret });
});

router.post('/agent/me/test-trigger', wrap(async (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const agentId = agentTarget(req as AuthedRequest, principal);
  const result = await testTrigger(agentId);
  res.json(result);
}));

router.post('/agents/:agentId/rotate-token', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const agentId = req.params.agentId;
  const runtime = store.getAgentRuntime(agentId);
  if (!runtime) throw new HttpError(404, 'Agent not found');
  if (principal.type === 'agent') {
    if (principal.id !== agentId) throw new HttpError(403, 'Agents can only rotate their own key');
  } else {
    adminOrThrow(runtime.roomId, principal);
  }

  const token = newAgentToken();
  store.rotateAgentToken(agentId, hashAgentToken(token));
  hub.disconnectAgent(agentId, 'Your connection key was rotated. Reconnect with the new key.');
  const activity = store.logActivity(
    runtime.roomId,
    principal,
    'agent.token_rotated',
    `${principal.name} rotated ${runtime.name}'s connection key.`,
    { agentId },
  );
  emitActivity(runtime.roomId, activity);
  res.json({ agentId, token });
});

/* --------------------------- human join flow ---------------------------- */

router.get('/join/:code/status', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  userOnly(principal);
  const room = store.getRoomByCode(req.params.code.trim());
  if (!room) throw new HttpError(404, 'No room matches that code');

  const membership = store.getMembership(room.id, principal);
  const latest = store.getLatestJoinRequestForUser(room.id, principal.id);
  const status = membership
    ? 'member'
    : latest?.status === 'pending'
      ? 'pending'
      : latest?.status === 'denied'
        ? 'denied'
        : 'none';

  previewHeaders(res);
  res.json({
    room: {
      ...publicRoomSummary(room),
      ...(membership ? { id: room.id } : {}),
    },
    status,
    membership: membership ? { role: membership.role } : null,
    request: latest?.status === 'pending' ? { createdAt: latest.created_at } : null,
    canRequest: !membership && status !== 'pending',
  });
});

/* A signed-in human can request access with a plain GET. The request waits for
 * an admin; calling again while pending returns the same ticket. */
router.get('/join/:code', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  userOnly(principal);
  const room = store.getRoomByCode(req.params.code.trim());
  if (!room) throw new HttpError(404, 'No room matches that code');

  const membership = store.getMembership(room.id, principal);
  if (membership) {
    previewHeaders(res);
    res.json({
      status: 'member',
      already: true,
      room: { ...publicRoomSummary(room), id: room.id },
      membership: { role: membership.role },
    });
    return;
  }

  const latest = store.getLatestJoinRequestForUser(room.id, principal.id);
  if (latest?.status === 'pending') {
    previewHeaders(res);
    res.json({
      status: 'pending',
      already: true,
      room: publicRoomSummary(room),
      request: { createdAt: latest.created_at },
      message: `Your request to join "${room.name}" is waiting for an admin.`,
    });
    return;
  }

  const request = store.createJoinRequest(
    room.id,
    'user',
    principal.name,
    principal.email ?? '',
    principal.id,
  );
  hub.broadcastJoinRequests(room.id);
  previewHeaders(res);
  res.status(202).json({
    status: 'pending',
    already: false,
    room: publicRoomSummary(room),
    request: { createdAt: request.created_at },
    message: `Request sent. An admin of "${room.name}" needs to approve it.`,
  });
});

/* ------------------------------- rooms ---------------------------------- */

router.get('/rooms', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  res.json({ rooms: store.listRoomsFor(principal) });
});

router.post('/rooms', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  userOnly(principal);
  const body = z
    .object({
      name: z.string().trim().min(1).max(60),
      topic: z.string().trim().max(200).optional().default(''),
      mode: z.enum(['code', 'chat']),
      visibility: z.enum(['public', 'unlisted']).optional().default('public'),
    })
    .parse(req.body);
  const room = store.createRoom(body.name, body.topic, body.mode, principal, body.visibility);
  const activity = store.logActivity(
    room.id,
    principal,
    'room.created',
    `${principal.name} created the room.`,
  );
  const summary = store.listRoomsFor(principal).find((candidate) => candidate.id === room.id)!;
  res.status(201).json({ room: summary, activity });
});

router.post('/rooms/join', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  userOnly(principal);
  const body = z.object({ code: z.string().trim().min(3).max(16) }).parse(req.body);
  const room = store.getRoomByCode(body.code);
  if (!room) throw new HttpError(404, 'No room matches that invite code');

  const existing = store.getMembership(room.id, principal);
  if (existing) {
    res.json({
      status: 'member',
      room: { ...publicRoomSummary(room), id: room.id },
      membership: { role: existing.role },
      already: true,
    });
    return;
  }

  const latest = store.getLatestJoinRequestForUser(room.id, principal.id);
  if (latest?.status === 'pending') {
    res.json({
      status: 'pending',
      room: publicRoomSummary(room),
      request: { createdAt: latest.created_at },
      already: true,
    });
    return;
  }

  const request = store.createJoinRequest(
    room.id,
    'user',
    principal.name,
    principal.email ?? '',
    principal.id,
  );
  hub.broadcastJoinRequests(room.id);
  res.status(202).json({
    status: 'pending',
    room: publicRoomSummary(room),
    request: { createdAt: request.created_at },
    already: false,
  });
});

router.get('/rooms/:roomId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  membershipOrThrow(req.params.roomId, principal);
  const state = hub.buildRoomState(req.params.roomId, principal);
  if (!state) throw new HttpError(404, 'Room not found');
  res.json(state);
});

router.patch('/rooms/:roomId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const body = z
    .object({
      name: z.string().trim().min(1).max(60).optional(),
      topic: z.string().trim().max(200).optional(),
      visibility: z.enum(['public', 'unlisted']).optional(),
    })
    .strict()
    .parse(req.body);
  const room = store.updateRoom(req.params.roomId, body);
  if (!room) throw new HttpError(404, 'Room not found');
  const activity = store.logActivity(
    room.id,
    principal,
    'room.updated',
    `${principal.name} updated the room settings.`,
  );
  hub.broadcastRoomUpdated(room.id);
  emitActivity(room.id, activity);
  const summary =
    store.listRoomsFor(principal).find((candidate) => candidate.id === room.id) ?? room;
  res.json({ room: summary, activity });
});

router.delete('/rooms/:roomId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const room = roomOrThrow(req.params.roomId);
  hub.broadcastRoomDeleted(room.id);
  store.deleteRoom(room.id);
  res.json({ ok: true, roomId: room.id });
});

router.post('/rooms/:roomId/leave', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  userOnly(principal);
  const membership = membershipOrThrow(req.params.roomId, principal);
  if (membership.role === 'admin' && store.countRoomAdmins(req.params.roomId) <= 1) {
    throw new HttpError(
      409,
      'You are the only admin of this room. Promote another admin or delete the room instead.',
    );
  }
  store.leaveRoom(req.params.roomId, principal.id);
  hub.broadcastMembers(req.params.roomId);
  hub.evictFromRoom(req.params.roomId, 'user', principal.id, 'You left the room.');
  res.json({ ok: true });
});

router.post('/rooms/:roomId/read', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  userOnly(principal);
  membershipOrThrow(req.params.roomId, principal);
  const body = z.object({ seq: z.coerce.number().int().min(0).optional() }).parse(req.body ?? {});
  store.markRoomRead(
    req.params.roomId,
    principal.id,
    body.seq ?? store.getRoomLastSeq(req.params.roomId),
  );
  hub.broadcastUnread(req.params.roomId);
  res.json({ unreadCount: store.getUnreadCount(req.params.roomId, principal.id) });
});

router.get('/rooms/:roomId/messages', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  membershipOrThrow(req.params.roomId, principal);
  const query = z
    .object({
      before: z.string().optional(),
      after_seq: z.coerce.number().int().min(0).optional(),
      before_seq: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(80),
    })
    .parse(req.query);

  if (query.after_seq !== undefined) {
    res.json({
      messages: store.listMessagesAfter(req.params.roomId, query.after_seq, Math.min(query.limit, 100)),
      lastSeq: store.getRoomLastSeq(req.params.roomId),
    });
    return;
  }
  if (query.before_seq !== undefined) {
    res.json({
      messages: store.listMessagesBeforeSeq(req.params.roomId, query.before_seq, query.limit),
      lastSeq: store.getRoomLastSeq(req.params.roomId),
    });
    return;
  }
  res.json({ messages: store.listMessages(req.params.roomId, query.before, query.limit) });
});

router.get('/rooms/:roomId/messages/search', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  membershipOrThrow(req.params.roomId, principal);
  const query = z
    .object({
      q: z.string().trim().min(2).max(100),
      limit: z.coerce.number().int().min(1).max(50).optional().default(30),
    })
    .parse(req.query);
  res.json({ messages: store.searchMessages(req.params.roomId, query.q, query.limit) });
});

router.post('/rooms/:roomId/messages', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  writerOrThrow(req.params.roomId, principal);
  const body = z
    .object({
      content: z.string().trim().min(1).max(4000),
      kind: z.enum(['chat', 'instruction', 'suggestion']).optional().default('chat'),
      clientMessageId: z.string().trim().max(100).optional(),
      mentions: z
        .array(z.object({ type: z.enum(['user', 'agent']), id: z.string().min(1) }))
        .max(20)
        .optional(),
    })
    .parse(req.body);
  const role = membershipOrThrow(req.params.roomId, principal).role;
  const { message, duplicate } = hub.createRoomMessage({
    roomId: req.params.roomId,
    principal,
    role,
    kind: body.kind as MessageKind,
    content: body.content,
    clientMessageId: body.clientMessageId ?? null,
    explicitMentions: body.mentions,
  });
  res.status(duplicate ? 200 : 201).json(message);
});

router.patch('/rooms/:roomId/messages/:messageId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  writerOrThrow(req.params.roomId, principal);
  const body = z.object({ content: z.string().trim().min(1).max(4000) }).parse(req.body);
  const message = hub.editRoomMessage({
    roomId: req.params.roomId,
    principal,
    messageId: req.params.messageId,
    content: body.content,
  });
  res.json(message);
});

router.delete('/rooms/:roomId/messages/:messageId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const membership = membershipOrThrow(req.params.roomId, principal);
  const message = store.getMessageById(req.params.messageId);
  if (!message || message.roomId !== req.params.roomId) throw new HttpError(404, 'Message not found');
  if (message.senderId !== principal.id && membership.role !== 'admin') {
    throw new HttpError(403, 'Only the author or a room admin can delete a message');
  }
  store.deleteMessage(req.params.roomId, message.id);
  const activity = store.logActivity(
    req.params.roomId,
    principal,
    'message.deleted',
    `${principal.name} deleted a message.`,
  );
  hub.broadcastMessageDeleted(req.params.roomId, message.id);
  emitActivity(req.params.roomId, activity);
  res.json({ ok: true });
});

router.patch('/rooms/:roomId/presence', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  membershipOrThrow(req.params.roomId, principal);
  const body = z
    .object({
      status: z.enum(['online', 'working', 'reviewing', 'away']).optional(),
      activity: z.string().max(160).optional(),
      taskId: z.string().nullable().optional(),
    })
    .parse(req.body);
  let presence: PresenceEntry[] | null = null;
  try {
    presence = hub.setPresence(req.params.roomId, principal, body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid presence');
  }
  res.json({ presence });
});

/* ------------------------------- agents --------------------------------- */

router.post('/rooms/:roomId/agents', wrap(async (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const body = z
    .object({
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().max(200).optional().default(''),
      role: z.enum(['admin', 'member', 'viewer']).optional().default('member'),
      deliveryMode: z.enum(['socket', 'trigger']).optional().default('socket'),
      triggerUrl: z.string().trim().max(400).optional(),
    })
    .parse(req.body);

  let triggerUrl: string | null = null;
  let triggerSecret: string | null = null;
  let triggerSecretEnc: string | null = null;
  if (body.deliveryMode === 'trigger') {
    if (!body.triggerUrl) throw new HttpError(400, 'triggerUrl is required when deliveryMode is "trigger"');
    triggerUrl = await validateTriggerUrl(body.triggerUrl);
    triggerSecret = newTriggerSecret();
    triggerSecretEnc = encryptSecret(triggerSecret);
  }

  const token = newAgentToken();
  const agent = store.createAgent(
    req.params.roomId,
    body.name,
    body.description,
    body.role,
    hashAgentToken(token),
    principal.id,
    {
      deliveryMode: body.deliveryMode as DeliveryMode,
      triggerUrl,
      triggerSecretEnc,
      createdByType: principal.type,
    },
  );
  const activity = store.logActivity(
    req.params.roomId,
    principal,
    'agent.created',
    `${principal.name} added agent ${agent.name}.`,
    { agentId: agent.id },
  );
  hub.broadcastMembers(req.params.roomId);
  hub.broadcastPresence(req.params.roomId);
  emitActivity(req.params.roomId, activity);
  res.status(201).json({
    agent: { ...agent, deliveryMode: body.deliveryMode, triggerUrl },
    token,
    ...(triggerSecret ? { triggerSecret } : {}),
  });
}));

/* --------------------------- join approvals ----------------------------- */

router.get('/rooms/:roomId/join-requests', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  res.json({ requests: store.listPendingJoinRequests(req.params.roomId) });
});

router.post('/rooms/:roomId/join-requests/:requestId/approve', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const room = roomOrThrow(req.params.roomId);
  const request = store.getJoinRequestById(req.params.requestId);
  if (!request || request.room_id !== room.id) throw new HttpError(404, 'Join request not found');
  if (request.status !== 'pending') throw new HttpError(409, 'This request was already decided');

  let member: Member | null = null;
  let agentToken: string | null = null;
  let triggerSecret: string | null = null;

  if (request.kind === 'user') {
    if (!request.user_id) throw new HttpError(400, 'This request has no user attached');
    const user = store.findUserById(request.user_id);
    if (!user) throw new HttpError(410, 'The requester no longer has an account');
    const requester: Principal = {
      type: 'user',
      id: user.id,
      name: user.name,
      ...(user.avatar ? { avatar: user.avatar } : {}),
    };
    store.addMember(room.id, requester, 'member');
    store.approveJoinRequest(request.id, principal.id);
    member = store.listMembers(room.id).find((candidate) => candidate.type === 'user' && candidate.id === user.id) ?? null;
  } else {
    const deliveryMode: DeliveryMode = request.delivery_mode === 'trigger' ? 'trigger' : 'socket';
    const triggerSecretEnc = deliveryMode === 'trigger' ? encryptSecret(newTriggerSecret()) : null;
    if (deliveryMode === 'trigger') {
      triggerSecret = triggerSecretEnc ? decryptSecret(triggerSecretEnc) : null;
    }
    agentToken = newAgentToken();
    const agent = store.createAgent(
      room.id,
      request.name,
      request.description,
      'member',
      hashAgentToken(agentToken),
      principal.id,
      { deliveryMode, triggerUrl: request.trigger_url, triggerSecretEnc, createdByType: principal.type },
    );
    store.approveJoinRequest(request.id, principal.id, agent.id, agentToken, triggerSecretEnc);
    member = agent;
  }

  if (agentToken && member) {
    const origin = publicOrigin(req);
    const agentPrincipal: Principal = {
      type: 'agent',
      id: member.id,
      name: member.name,
      ...(member.avatar ? { avatar: member.avatar } : {}),
    };
    hub.promoteJoinRequest(request.id, agentPrincipal, {
      ...agentBriefing(
        origin,
        agentToken,
        { id: member.id, name: member.name, role: member.role },
        room,
      ),
      token: agentToken,
      ...(triggerSecret ? { triggerSecret } : {}),
      join: {
        status: 'approved',
        requestKey: request.request_key,
        roomUrl: `${origin}/room/${room.code}`,
      },
    });
  }

  hub.broadcastMembers(room.id);
  hub.broadcastJoinRequests(room.id);
  const activity = store.logActivity(
    room.id,
    principal,
    'join.approved',
    `${principal.name} approved ${request.name}'s request to join.`,
    { requestId: request.id, kind: request.kind },
  );
  emitActivity(room.id, activity);

  res.json({
    request: {
      id: request.id,
      kind: request.kind,
      name: request.name,
      status: 'approved',
    },
    member: member
      ? {
          type: member.type,
          id: member.id,
          name: member.name,
          role: member.role,
          avatar: member.avatar,
          ...(member.type === 'agent'
            ? { deliveryMode: request.delivery_mode ?? 'socket', triggerUrl: request.trigger_url ?? null }
            : {}),
        }
      : null,
    ...(agentToken ? { token: agentToken } : {}),
    ...(triggerSecret ? { triggerSecret } : {}),
  });
});

router.post('/rooms/:roomId/join-requests/:requestId/deny', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const request = store.getJoinRequestById(req.params.requestId);
  if (!request || request.room_id !== req.params.roomId) throw new HttpError(404, 'Join request not found');
  if (request.status !== 'pending') throw new HttpError(409, 'This request was already decided');

  store.denyJoinRequest(request.id, principal.id);
  hub.rejectJoinRequestSocket(request.id, 'An admin declined this join request.');
  hub.broadcastJoinRequests(req.params.roomId);
  const activity = store.logActivity(
    req.params.roomId,
    principal,
    'join.denied',
    `${principal.name} declined ${request.name}'s request to join.`,
    { requestId: request.id, kind: request.kind },
  );
  emitActivity(req.params.roomId, activity);
  res.json({ ok: true });
});

/* ------------------------------- members -------------------------------- */

router.patch('/rooms/:roomId/members/:type/:id', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const { type, id } = z
    .object({
      type: z.enum(['user', 'agent']),
      id: z.string().min(1),
    })
    .parse(req.params);
  if (type === principal.type && id === principal.id) {
    throw new HttpError(400, 'You cannot change your own role');
  }
  const target = store.getMembership(req.params.roomId, { type, id, name: '' });
  if (!target) throw new HttpError(404, 'Member not found');
  const body = z.object({ role: z.enum(['admin', 'member', 'viewer']) }).parse(req.body);
  store.setMemberRole(req.params.roomId, type, id, body.role);

  const targetName = hub.memberName(req.params.roomId, type, id) ?? 'a member';
  const activity = store.logActivity(
    req.params.roomId,
    principal,
    'member.role_changed',
    `${principal.name} set ${targetName}'s role to ${body.role}.`,
  );
  hub.broadcastMembers(req.params.roomId);
  emitActivity(req.params.roomId, activity);
  res.json({ members: store.listMembers(req.params.roomId) });
});

router.delete('/rooms/:roomId/members/:type/:id', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const { type, id } = z
    .object({
      type: z.enum(['user', 'agent']),
      id: z.string().min(1),
    })
    .parse(req.params);
  if (type === principal.type && id === principal.id) {
    throw new HttpError(400, 'You cannot remove yourself');
  }
  if (!store.getMembership(req.params.roomId, { type, id, name: '' })) {
    throw new HttpError(404, 'Member not found');
  }

  const targetName = hub.memberName(req.params.roomId, type, id) ?? 'a member';
  store.removeMember(req.params.roomId, type, id);
  store.unassignTasks(req.params.roomId, type, id);
  if (type === 'agent') {
    store.deleteJoinRequestsForAgent(id);
    store.deleteAgent(id);
  } else {
    store.deletePendingJoinRequestsForUser(req.params.roomId, id);
  }

  const activity = store.logActivity(
    req.params.roomId,
    principal,
    'member.removed',
    `${principal.name} removed ${targetName} from the room.`,
  );
  hub.evictFromRoom(req.params.roomId, type, id);
  hub.broadcastMembers(req.params.roomId);
  emitTasks(req.params.roomId);
  emitActivity(req.params.roomId, activity);
  res.json({ ok: true });
});

/* -------------------------------- repos --------------------------------- */

const repoUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .refine((value) => /^(https?:\/\/|git@)/i.test(value), 'Use an https:// or git@ repository URL');

router.post('/rooms/:roomId/repos', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  if (roomOrThrow(req.params.roomId).mode !== 'code') {
    throw new HttpError(400, 'This is a chat-only room. Create a code room to link repositories.');
  }
  const body = z
    .object({
      name: z.string().trim().min(1).max(80),
      url: repoUrlSchema,
      branch: z.string().trim().max(80).optional().default('main'),
    })
    .parse(req.body);
  const repo = store.addRepo(req.params.roomId, body.name, body.url, body.branch, principal.id);
  const activity = store.logActivity(
    req.params.roomId,
    principal,
    'repo.added',
    `${principal.name} linked repository ${repo.name}.`,
    { repoId: repo.id },
  );
  hub.broadcast(req.params.roomId, { type: 'repos.updated', repos: store.listRepos(req.params.roomId) });
  emitActivity(req.params.roomId, activity);
  res.status(201).json(repo);
});

router.delete('/rooms/:roomId/repos/:repoId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  adminOrThrow(req.params.roomId, principal);
  const repo = store.getRepo(req.params.roomId, req.params.repoId);
  if (!repo) throw new HttpError(404, 'Repository not found');
  store.deleteRepo(req.params.roomId, repo.id);
  const activity = store.logActivity(
    req.params.roomId,
    principal,
    'repo.removed',
    `${principal.name} unlinked repository ${repo.name}.`,
  );
  hub.broadcast(req.params.roomId, { type: 'repos.updated', repos: store.listRepos(req.params.roomId) });
  emitTasks(req.params.roomId);
  emitActivity(req.params.roomId, activity);
  res.json({ ok: true });
});

/* -------------------------------- tasks --------------------------------- */

const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().default(''),
  paths: z.string().trim().max(300).optional().default(''),
  branch: z.string().trim().max(80).optional().default(''),
  repoId: z.string().nullable().optional(),
  assigneeType: z.enum(['user', 'agent']).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  clientTaskId: z.string().trim().max(100).optional(),
});

const TASK_STATUS_SET = new Set<TaskStatus>(['todo', 'doing', 'review', 'done']);

const taskListSchema = z.object({
  status: z.string().trim().max(60).optional(),
  assignee: z.string().trim().max(120).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).max(100_000).optional().default(0),
});

router.get('/rooms/:roomId/tasks', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  membershipOrThrow(req.params.roomId, principal);
  const query = taskListSchema.parse(req.query);

  let statuses: TaskStatus[] | undefined;
  if (query.status) {
    statuses = query.status
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) as TaskStatus[];
    if (!statuses.length || statuses.some((status) => !TASK_STATUS_SET.has(status))) {
      throw new HttpError(400, 'status must be one or more of todo, doing, review, done');
    }
  }

  const filter: store.TaskPageQuery = { statuses, limit: query.limit, offset: query.offset };
  if (query.assignee) {
    if (query.assignee === 'me') {
      filter.assigneeType = principal.type;
      filter.assigneeId = principal.id;
    } else if (query.assignee === 'unassigned') {
      filter.unassigned = true;
    } else {
      const [type, ...rest] = query.assignee.split(':');
      const id = rest.join(':');
      if ((type !== 'user' && type !== 'agent') || !id) {
        throw new HttpError(400, 'assignee must be "me", "unassigned", user:ID, or agent:ID');
      }
      filter.assigneeType = type;
      filter.assigneeId = id;
    }
  }
  if (query.q) filter.search = query.q;

  const page = store.listTasksPage(req.params.roomId, filter);
  res.json({ ...page, limit: query.limit, offset: query.offset });
});

router.get('/rooms/:roomId/tasks/:taskId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  membershipOrThrow(req.params.roomId, principal);
  const task = store.getTask(req.params.roomId, req.params.taskId);
  if (!task) throw new HttpError(404, 'Task not found');
  res.json(task);
});

const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    paths: z.string().max(300).optional(),
    branch: z.string().max(80).optional(),
    repoId: z.string().nullable().optional(),
    status: z.enum(['todo', 'doing', 'review', 'done']).optional(),
    assigneeType: z.enum(['user', 'agent']).nullable().optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .strict();

router.post('/rooms/:roomId/tasks', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  writerOrThrow(req.params.roomId, principal);
  const body = taskCreateSchema.parse(req.body);
  const clientTaskId = body.clientTaskId?.trim() || null;

  if (clientTaskId) {
    const existing = store.findTaskByClientId(
      req.params.roomId,
      principal.type,
      principal.id,
      clientTaskId,
    );
    if (existing) {
      res.json(existing);
      return;
    }
  }

  verifyAssignee(req.params.roomId, body.assigneeType ?? null, body.assigneeId ?? null);
  const repoId = attachRepo(req.params.roomId, body.repoId);
  const input = {
    title: body.title,
    description: body.description,
    paths: body.paths,
    branch: body.branch,
    repoId,
    assigneeType: body.assigneeType ?? null,
    assigneeId: body.assigneeId ?? null,
    clientTaskId,
  };

  let task: ReturnType<typeof store.createTask>;
  try {
    task = store.createTask(req.params.roomId, input, principal);
  } catch (error) {
    const existing = clientTaskId
      ? store.findTaskByClientId(req.params.roomId, principal.type, principal.id, clientTaskId)
      : undefined;
    if (existing) {
      res.json(existing);
      return;
    }
    throw error;
  }

  const summary = task.assigneeName
    ? `${principal.name} assigned “${task.title}” to ${task.assigneeName}.`
    : `${principal.name} created task “${task.title}”.`;
  const activity = store.logActivity(req.params.roomId, principal, 'task.created', summary, { taskId: task.id });
  hub.broadcast(req.params.roomId, { type: 'task.updated', task });
  emitActivity(req.params.roomId, activity);
  res.status(201).json(task);
});

router.patch('/rooms/:roomId/tasks/:taskId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const membership = membershipOrThrow(req.params.roomId, principal);
  if (membership.role === 'viewer') throw new HttpError(403, 'Viewers have read-only access');

  const task = store.getTask(req.params.roomId, req.params.taskId);
  if (!task) throw new HttpError(404, 'Task not found');
  const body = taskPatchSchema.parse(req.body);

  const isAdmin = membership.role === 'admin';
  const isCreator = task.createdByType === principal.type && task.createdById === principal.id;
  const isAssignee = task.assigneeType === principal.type && task.assigneeId === principal.id;
  const wantsClaim = body.assigneeType === principal.type && body.assigneeId === principal.id;

  let patch: Record<string, unknown> = {};
  if (isAdmin || isCreator) {
    patch = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
  } else if (isAssignee) {
    const forbidden = ['title', 'description', 'repoId', 'branch', 'assigneeType', 'assigneeId'] as const;
    if (forbidden.some((field) => field in body)) {
      throw new HttpError(403, 'Only a room admin or the task creator can edit task details');
    }
    patch = {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.paths !== undefined ? { paths: body.paths } : {}),
    };
  } else if (!task.assigneeType && wantsClaim) {
    patch = {
      assigneeType: principal.type,
      assigneeId: principal.id,
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.paths !== undefined ? { paths: body.paths } : {}),
    };
  } else {
    throw new HttpError(403, 'This task is assigned to someone else');
  }

  if (patch.title !== undefined && !String(patch.title).trim()) throw new HttpError(400, 'Task title is required');
  if ('repoId' in patch) patch.repoId = attachRepo(req.params.roomId, patch.repoId as string | null);

  const hasAssigneeType = 'assigneeType' in patch;
  const hasAssigneeId = 'assigneeId' in patch;
  if (hasAssigneeType !== hasAssigneeId) throw new HttpError(400, 'Assignee requires both type and id');
  if (hasAssigneeType) {
    verifyAssignee(
      req.params.roomId,
      patch.assigneeType as string | null,
      patch.assigneeId as string | null,
    );
  }

  const previousStatus = task.status;
  const previousAssigneeId = task.assigneeId;
  const previousAssigneeType = task.assigneeType;
  const updated = store.updateTaskFields(req.params.roomId, task.id, patch);

  let summary: string;
  let type: string;
  const claimed = !task.assigneeType && updated.assigneeType !== null;
  if (claimed) {
    summary = `${principal.name} claimed “${updated.title}”.`;
    type = 'task.assigned';
  } else if (previousStatus !== updated.status) {
    summary =
      updated.status === 'done'
        ? `${principal.name} completed “${updated.title}”.`
        : `${principal.name} moved “${updated.title}” to ${hub.taskStatusLabel(updated.status as TaskStatus)}.`;
    type = 'task.status';
  } else if (previousAssigneeType !== updated.assigneeType || previousAssigneeId !== updated.assigneeId) {
    summary = updated.assigneeName
      ? `${principal.name} assigned “${updated.title}” to ${updated.assigneeName}.`
      : `${principal.name} unassigned “${updated.title}”.`;
    type = 'task.assigned';
  } else {
    summary = `${principal.name} updated “${updated.title}”.`;
    type = 'task.updated';
  }

  const activity = store.logActivity(req.params.roomId, principal, type, summary, { taskId: updated.id });
  hub.broadcast(req.params.roomId, { type: 'task.updated', task: updated });
  emitActivity(req.params.roomId, activity);
  res.json(updated);
});

router.delete('/rooms/:roomId/tasks/:taskId', (req, res) => {
  const principal = principalOf(req as AuthedRequest);
  const membership = membershipOrThrow(req.params.roomId, principal);
  if (membership.role === 'viewer') throw new HttpError(403, 'Viewers have read-only access');

  const task = store.getTask(req.params.roomId, req.params.taskId);
  if (!task) throw new HttpError(404, 'Task not found');

  const isAdmin = membership.role === 'admin';
  const isCreator = task.createdByType === principal.type && task.createdById === principal.id;
  if (!isAdmin && !isCreator) {
    throw new HttpError(403, 'Only a room admin or the task creator can delete this task');
  }

  store.deleteTask(req.params.roomId, task.id);
  const summary = `${principal.name} deleted task “${task.title}”.`;
  const activity = store.logActivity(req.params.roomId, principal, 'task.deleted', summary, { taskId: task.id });
  hub.broadcast(req.params.roomId, { type: 'task.deleted', taskId: task.id });
  emitTasks(req.params.roomId);
  emitActivity(req.params.roomId, activity);
  res.json({ ok: true });
});

/* ------------------------------ helpers --------------------------------- */

export const apiRouter = router;
