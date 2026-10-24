import { randomBytes, randomUUID } from 'node:crypto';
import { pickAvatar } from './avatars.js';
import { db } from './db.js';
import { handleFromName } from './handles.js';
import type {
  Activity,
  AgentProfile,
  AgentRuntime,
  AgentWakeState,
  DeliveryMode,
  JoinRequest,
  JoinRequestStatus,
  Member,
  Mention,
  Message,
  MessageKind,
  Principal,
  PrincipalType,
  ProfileAgentLink,
  ProfileOwner,
  ProfileRoom,
  Repo,
  Role,
  Room,
  RoomMode,
  RoomSummary,
  RoomVisibility,
  Task,
  TaskStatus,
  TriggerEventStatus,
  UserProfile,
} from './types.js';

type Row = Record<string, any>;

const nowIso = () => new Date().toISOString();
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function newRoomCode(): string {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/* ------------------------------- users ---------------------------------- */

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
  handle: string | null;
  headline: string;
  bio: string;
  location: string;
  website: string;
  show_rooms: number;
  avatar: string | null;
  session_version: number;
}

export function createUser(name: string, email: string, passwordHash: string): UserRow {
  const user: UserRow = {
    id: randomUUID(),
    email,
    name,
    password_hash: passwordHash,
    created_at: nowIso(),
    handle: allocateHandle(name, 'user'),
    headline: '',
    bio: '',
    location: '',
    website: '',
    show_rooms: 1,
    avatar: pickAvatar(),
    session_version: 0,
  };
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, created_at, handle, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(user.id, user.email, user.name, user.password_hash, user.created_at, user.handle, user.avatar);
  return user;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function findUserByHandle(handle: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE handle = ? COLLATE NOCASE').get(handle) as
    | UserRow
    | undefined;
}

export function handleInUse(handle: string, ignore?: { type: PrincipalType; id: string }): boolean {
  const normalized = handle.trim().toLowerCase();
  const user = db
    .prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE')
    .get(normalized) as { id: string } | undefined;
  if (user && !(ignore?.type === 'user' && ignore.id === user.id)) return true;
  const agent = db
    .prepare('SELECT id FROM agents WHERE handle = ? COLLATE NOCASE')
    .get(normalized) as { id: string } | undefined;
  if (agent && !(ignore?.type === 'agent' && ignore.id === agent.id)) return true;
  return false;
}

function allocateHandle(name: string, type: 'user' | 'agent'): string {
  const base = handleFromName(name, type);
  let candidate = base;
  let suffix = 2;
  while (handleInUse(candidate)) {
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, 30 - tail.length)}${tail}`;
    suffix += 1;
  }
  return candidate;
}

export function updateUserProfile(
  userId: string,
  patch: {
    name?: string;
    handle?: string;
    headline?: string;
    bio?: string;
    location?: string;
    website?: string;
    showRooms?: boolean;
    avatar?: string;
  },
): UserProfile | undefined {
  const columns: Record<string, string> = {
    name: 'name',
    handle: 'handle',
    headline: 'headline',
    bio: 'bio',
    location: 'location',
    website: 'website',
    avatar: 'avatar',
  };
  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key as keyof typeof patch] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(String(patch[key as keyof typeof patch] ?? ''));
    }
  }
  if (patch.showRooms !== undefined) {
    sets.push('show_rooms = ?');
    values.push(patch.showRooms ? 1 : 0);
  }
  if (sets.length) {
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, userId);
  }
  return getUserProfile(userId);
}

export function getUserPasswordHash(userId: string): string | undefined {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    | { password_hash: string }
    | undefined;
  return row?.password_hash;
}

export function updateUserPassword(userId: string, passwordHash: string): number {
  const row = db
    .prepare(
      'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? RETURNING session_version',
    )
    .get(passwordHash, userId) as { session_version: number } | undefined;
  return Number(row?.session_version ?? 0);
}

export function listPrincipalRoomIds(type: PrincipalType, id: string): string[] {
  return (
    db
      .prepare('SELECT room_id FROM room_members WHERE principal_type = ? AND principal_id = ?')
      .all(type, id) as { room_id: string }[]
  ).map((row) => row.room_id);
}

/* ------------------------------- rooms ---------------------------------- */

function mapRoom(row: Row): Room {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    mode: row.mode as RoomMode,
    createdAt: row.created_at,
    createdBy: row.created_by,
    code: row.code,
    visibility: (row.visibility as RoomVisibility) ?? 'public',
  };
}

export function getRoom(roomId: string): Room | undefined {
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Row | undefined;
  return row ? mapRoom(row) : undefined;
}

export function getRoomByCode(code: string): Room | undefined {
  const clean = code.trim();
  const row = db.prepare('SELECT * FROM rooms WHERE code = ? COLLATE NOCASE').get(clean) as Row | undefined;
  return row ? mapRoom(row) : undefined;
}

export function getRoomLastSeq(roomId: string): number {
  const row = db.prepare('SELECT last_seq FROM rooms WHERE id = ?').get(roomId) as
    | { last_seq: number }
    | undefined;
  return Number(row?.last_seq ?? 0);
}

export function createRoom(
  name: string,
  topic: string,
  mode: RoomMode,
  creator: Principal,
  visibility: RoomVisibility = 'public',
): Room {
  let code = newRoomCode();
  while (db.prepare('SELECT 1 FROM rooms WHERE code = ? COLLATE NOCASE').get(code)) {
    code = newRoomCode();
  }
  const id = randomUUID();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO rooms (id, name, topic, mode, code, created_by, created_at, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, topic, mode, code, creator.id, createdAt, visibility);
  addMember(id, creator, 'admin');
  return getRoom(id)!;
}

export function updateRoom(
  roomId: string,
  patch: { name?: string; topic?: string; visibility?: RoomVisibility },
): Room | undefined {
  const columns: Record<string, string> = {
    name: 'name',
    topic: 'topic',
    visibility: 'visibility',
  };
  const sets: string[] = [];
  const values: string[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${column} = ?`);
      values.push(String((patch as Record<string, unknown>)[key] ?? ''));
    }
  }
  if (sets.length) {
    db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`).run(...values, roomId);
  }
  return getRoom(roomId);
}

export function deleteRoom(roomId: string): void {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
}

export function countRoomAdmins(roomId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM room_members WHERE room_id = ? AND role = 'admin'")
    .get(roomId) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function leaveRoom(roomId: string, userId: string): void {
  removeMember(roomId, 'user', userId);
  db.prepare('DELETE FROM room_reads WHERE room_id = ? AND user_id = ?').run(roomId, userId);
  db.prepare("DELETE FROM room_join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'").run(
    roomId,
    userId,
  );
}

export function listRoomsFor(principal: Principal): RoomSummary[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.topic, r.mode, r.code, r.created_at, r.visibility, rm.role,
              (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS member_count,
              (SELECT COUNT(*) FROM messages msg
                 WHERE msg.room_id = r.id
                   AND msg.seq > COALESCE(
                     (SELECT rr.last_read_seq FROM room_reads rr
                       WHERE rr.room_id = r.id AND rr.user_id = ?), 0)
                   AND NOT (msg.sender_type = 'user' AND msg.sender_id = ?)) AS unread_count,
              (SELECT COUNT(*) FROM room_join_requests jr
                 WHERE jr.room_id = r.id AND jr.status = 'pending') AS pending_requests
       FROM room_members rm
       JOIN rooms r ON r.id = rm.room_id
       WHERE rm.principal_type = ? AND rm.principal_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(principal.id, principal.id, principal.type, principal.id) as Row[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    topic: row.topic,
    mode: row.mode as RoomMode,
    role: row.role as Role,
    code: row.code,
    memberCount: Number(row.member_count),
    unreadCount: principal.type === 'user' ? Number(row.unread_count) : 0,
    pendingRequests: row.role === 'admin' ? Number(row.pending_requests) : 0,
    visibility: (row.visibility as RoomVisibility) ?? 'public',
    createdAt: row.created_at,
  }));
}

export function listPublicRooms(): (RoomSummary & { code: string; createdAt: string })[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.topic, r.mode, r.code, r.created_at, r.visibility,
              (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS member_count
       FROM rooms r
       WHERE r.visibility = 'public'
       ORDER BY r.created_at DESC`,
    )
    .all() as Row[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    topic: row.topic,
    mode: row.mode as RoomMode,
    role: 'viewer' as Role,
    code: row.code,
    memberCount: Number(row.member_count),
    unreadCount: 0,
    pendingRequests: 0,
    visibility: (row.visibility as RoomVisibility) ?? 'public',
    createdAt: row.created_at,
  }));
}

/* ------------------------------ members --------------------------------- */

export function getMembership(roomId: string, principal: Principal): { role: Role; joinedAt: string } | undefined {
  const row = db
    .prepare('SELECT role, joined_at FROM room_members WHERE room_id = ? AND principal_type = ? AND principal_id = ?')
    .get(roomId, principal.type, principal.id) as Row | undefined;
  return row ? { role: row.role as Role, joinedAt: row.joined_at } : undefined;
}

export function addMember(roomId: string, principal: Principal, role: Role): void {
  db.prepare(
    'INSERT OR IGNORE INTO room_members (room_id, principal_type, principal_id, role, joined_at) VALUES (?, ?, ?, ?, ?)',
  ).run(roomId, principal.type, principal.id, role, nowIso());
}

export function setMemberRole(roomId: string, type: PrincipalType, id: string, role: Role): void {
  db.prepare('UPDATE room_members SET role = ? WHERE room_id = ? AND principal_type = ? AND principal_id = ?').run(
    role,
    roomId,
    type,
    id,
  );
  if (type === 'agent') {
    db.prepare('UPDATE agents SET role = ? WHERE id = ?').run(role, id);
  }
}

export function removeMember(roomId: string, type: PrincipalType, id: string): void {
  db.prepare('DELETE FROM room_members WHERE room_id = ? AND principal_type = ? AND principal_id = ?').run(
    roomId,
    type,
    id,
  );
}

export function unassignTasks(roomId: string, type: PrincipalType, id: string): void {
  db.prepare(
    'UPDATE tasks SET assignee_type = NULL, assignee_id = NULL, updated_at = ? WHERE room_id = ? AND assignee_type = ? AND assignee_id = ?',
  ).run(nowIso(), roomId, type, id);
}

export function listMembers(roomId: string): Member[] {
  const rows = db
    .prepare(
      `SELECT rm.principal_type, rm.principal_id, rm.role, rm.joined_at,
              COALESCE(u.name, a.name, 'Unknown') AS name,
              a.description AS description,
              COALESCE(u.handle, a.handle) AS handle,
              COALESCE(u.avatar, a.avatar) AS avatar,
              CASE WHEN rm.principal_type = 'agent'
                   THEN COALESCE(NULLIF(a.headline, ''), NULLIF(a.description, ''))
                   ELSE NULL END AS headline
       FROM room_members rm
       LEFT JOIN users u ON rm.principal_type = 'user' AND u.id = rm.principal_id
       LEFT JOIN agents a ON rm.principal_type = 'agent' AND a.id = rm.principal_id
       WHERE rm.room_id = ?
       ORDER BY rm.joined_at ASC`,
    )
    .all(roomId) as Row[];

  return rows.map((row) => ({
    type: row.principal_type as PrincipalType,
    id: row.principal_id,
    name: row.name,
    role: row.role as Role,
    joinedAt: row.joined_at,
    description: row.description ?? null,
    handle: row.handle ?? null,
    headline: row.headline ?? null,
    avatar: row.avatar ?? null,
  }));
}

/* ------------------------------- agents --------------------------------- */

export function createAgent(
  roomId: string,
  name: string,
  description: string,
  role: Role,
  tokenHash: string,
  createdBy: string,
  options: {
    deliveryMode?: DeliveryMode;
    triggerUrl?: string | null;
    triggerSecretEnc?: string | null;
    createdByType?: PrincipalType;
  } = {},
): Member {
  const id = randomUUID();
  const handle = allocateHandle(name, 'agent');
  const avatar = pickAvatar();
  db.prepare(
    `INSERT INTO agents (id, room_id, name, description, role, token_hash, created_by, created_by_type,
                         created_at, delivery_mode, trigger_url, trigger_secret_enc, handle, headline, avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    roomId,
    name,
    description,
    role,
    tokenHash,
    createdBy,
    options.createdByType ?? 'user',
    nowIso(),
    options.deliveryMode ?? 'socket',
    options.triggerUrl ?? null,
    options.triggerSecretEnc ?? null,
    handle,
    description,
    avatar,
  );
  addMember(roomId, { type: 'agent', id, name, avatar }, role);
  return listMembers(roomId).find((member) => member.type === 'agent' && member.id === id)!;
}

export function deleteAgent(agentId: string): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
}

export function rotateAgentToken(agentId: string, tokenHash: string): boolean {
  const result = db.prepare('UPDATE agents SET token_hash = ? WHERE id = ?').run(tokenHash, agentId);
  return Number(result.changes) > 0;
}

export function getAgentRoom(agentId: string): string | undefined {
  const row = db.prepare('SELECT room_id FROM agents WHERE id = ?').get(agentId) as
    | { room_id: string }
    | undefined;
  return row?.room_id;
}

export function getAgentRuntime(agentId: string): AgentRuntime | undefined {
  const row = db
    .prepare(
      'SELECT id, room_id, name, delivery_mode, trigger_url, trigger_secret_enc, wake_state, waking_since, last_socket_at FROM agents WHERE id = ?',
    )
    .get(agentId) as Row | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    deliveryMode: row.delivery_mode === 'trigger' ? 'trigger' : 'socket',
    triggerUrl: row.trigger_url ?? null,
    hasSecret: Boolean(row.trigger_secret_enc),
    wakeState: (row.wake_state as AgentWakeState) ?? null,
    wakingSince: row.waking_since ?? null,
    lastSocketAt: row.last_socket_at ?? null,
  };
}

export function getAgentTrigger(
  agentId: string,
): { deliveryMode: DeliveryMode; triggerUrl: string | null; triggerSecretEnc: string | null; name: string } | undefined {
  const row = db
    .prepare('SELECT name, delivery_mode, trigger_url, trigger_secret_enc FROM agents WHERE id = ?')
    .get(agentId) as Row | undefined;
  if (!row) return undefined;
  return {
    name: row.name,
    deliveryMode: row.delivery_mode === 'trigger' ? 'trigger' : 'socket',
    triggerUrl: row.trigger_url ?? null,
    triggerSecretEnc: row.trigger_secret_enc ?? null,
  };
}

export function setAgentTriggerConfig(
  agentId: string,
  input: { deliveryMode?: DeliveryMode; triggerUrl?: string | null; triggerSecretEnc?: string | null },
): void {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (input.deliveryMode !== undefined) {
    sets.push('delivery_mode = ?');
    values.push(input.deliveryMode);
  }
  if (input.triggerUrl !== undefined) {
    sets.push('trigger_url = ?');
    values.push(input.triggerUrl);
  }
  if (input.triggerSecretEnc !== undefined) {
    sets.push('trigger_secret_enc = ?');
    values.push(input.triggerSecretEnc);
  }
  if (!sets.length) return;
  db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...values, agentId);
}

export function markAgentSocket(agentId: string): void {
  db.prepare(
    'UPDATE agents SET last_socket_at = ?, wake_state = NULL, waking_since = NULL WHERE id = ?',
  ).run(nowIso(), agentId);
}

export function setAgentWakeState(
  agentId: string,
  state: AgentWakeState,
  options: { wakingSince?: string | null } = {},
): void {
  const wakingSince = state === 'waking' ? (options.wakingSince ?? nowIso()) : null;
  db.prepare('UPDATE agents SET wake_state = ?, waking_since = ? WHERE id = ?').run(
    state,
    wakingSince,
    agentId,
  );
}

export function listAgentsAwaitingSocket(olderThan: string): { id: string; room_id: string; name: string }[] {
  return db
    .prepare(
      "SELECT id, room_id, name FROM agents WHERE wake_state = 'waking' AND waking_since IS NOT NULL AND waking_since <= ?",
    )
    .all(olderThan) as { id: string; room_id: string; name: string }[];
}

/* ------------------------------- profiles ------------------------------- */

function profileRoom(row: Row): ProfileRoom {
  return {
    code: row.code,
    name: row.name,
    topic: row.topic,
    mode: row.mode as RoomMode,
    memberCount: Number(row.member_count),
    ...(row.role ? { role: row.role as Role } : {}),
  };
}

export function listUserProfileRooms(userId: string): ProfileRoom[] {
  const rows = db
    .prepare(
      `SELECT r.code, r.name, r.topic, r.mode, rm.role,
              (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS member_count
       FROM room_members rm
       JOIN rooms r ON r.id = rm.room_id
       WHERE rm.principal_type = 'user' AND rm.principal_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(userId) as Row[];
  return rows.map(profileRoom);
}

function listUserCreatedAgents(userId: string): ProfileAgentLink[] {
  const rows = db
    .prepare(
      `SELECT handle, name, avatar, COALESCE(NULLIF(headline, ''), NULLIF(description, ''), '') AS headline
       FROM agents
       WHERE created_by = ? AND created_by_type = 'user' AND handle IS NOT NULL AND handle <> ''
       ORDER BY created_at DESC`,
    )
    .all(userId) as Row[];
  return rows.map((row) => ({
    handle: row.handle,
    name: row.name,
    headline: row.headline,
    avatar: row.avatar ?? null,
  }));
}

function buildUserProfile(user: UserRow, publicView: boolean): UserProfile {
  const showRooms = Boolean(user.show_rooms);
  const includeRooms = !publicView || showRooms;
  return {
    type: 'user',
    id: user.id,
    handle: user.handle ?? '',
    name: user.name,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    website: user.website,
    avatar: user.avatar ?? null,
    joinedAt: user.created_at,
    rooms: includeRooms ? listUserProfileRooms(user.id) : [],
    agents: includeRooms ? listUserCreatedAgents(user.id) : [],
    roomsHidden: !showRooms,
    ...(publicView ? {} : { email: user.email, showRooms }),
  };
}

export function getUserProfile(userId: string): UserProfile | undefined {
  const user = findUserById(userId);
  return user ? buildUserProfile(user, false) : undefined;
}

export function getUserProfileByHandle(handle: string): UserProfile | undefined {
  const user = findUserByHandle(handle);
  return user ? buildUserProfile(user, true) : undefined;
}

interface AgentProfileRow {
  id: string;
  room_id: string;
  name: string;
  handle: string | null;
  headline: string;
  bio: string;
  website: string;
  capabilities: string;
  avatar: string | null;
  role: Role;
  delivery_mode: string;
  created_at: string;
  created_by: string;
  created_by_type: PrincipalType;
}

function parseCapabilities(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function agentOwner(row: AgentProfileRow): ProfileOwner | null {
  if (row.created_by_type === 'agent') {
    const owner = db.prepare('SELECT name, handle, avatar FROM agents WHERE id = ?').get(row.created_by) as
      | { name: string; handle: string | null; avatar: string | null }
      | undefined;
    return owner?.handle
      ? { type: 'agent', handle: owner.handle, name: owner.name, avatar: owner.avatar ?? null }
      : null;
  }
  const owner = db.prepare('SELECT name, handle, avatar FROM users WHERE id = ?').get(row.created_by) as
    | { name: string; handle: string | null; avatar: string | null }
    | undefined;
  return owner?.handle
    ? { type: 'user', handle: owner.handle, name: owner.name, avatar: owner.avatar ?? null }
    : null;
}

function buildAgentProfile(row: AgentProfileRow): AgentProfile {
  const room = getRoom(row.room_id);
  const membership = getMembership(row.room_id, { type: 'agent', id: row.id, name: row.name });
  const roomProfile = room
    ? {
        code: room.code ?? '',
        name: room.name,
        topic: room.topic,
        mode: room.mode,
        memberCount: listMembers(room.id).length,
        role: membership?.role ?? row.role,
      }
    : null;

  return {
    type: 'agent',
    id: row.id,
    handle: row.handle ?? '',
    name: row.name,
    headline: row.headline,
    bio: row.bio,
    website: row.website,
    avatar: row.avatar ?? null,
    capabilities: parseCapabilities(row.capabilities),
    createdAt: row.created_at,
    role: membership?.role ?? row.role,
    deliveryMode: row.delivery_mode === 'trigger' ? 'trigger' : 'socket',
    room: roomProfile,
    owner: agentOwner(row),
  };
}

const AGENT_PROFILE_SELECT = `
  SELECT id, room_id, name, handle, headline, bio, website, capabilities, avatar, role,
         delivery_mode, created_at, created_by, created_by_type
  FROM agents
`;

export function getAgentProfile(agentId: string): AgentProfile | undefined {
  const row = db.prepare(`${AGENT_PROFILE_SELECT} WHERE id = ?`).get(agentId) as
    | AgentProfileRow
    | undefined;
  return row ? buildAgentProfile(row) : undefined;
}

export function getAgentProfileByHandle(handle: string): AgentProfile | undefined {
  const row = db
    .prepare(`${AGENT_PROFILE_SELECT} WHERE handle = ? COLLATE NOCASE`)
    .get(handle) as AgentProfileRow | undefined;
  return row ? buildAgentProfile(row) : undefined;
}

export function updateAgentProfile(
  agentId: string,
  patch: {
    name?: string;
    handle?: string;
    headline?: string;
    bio?: string;
    website?: string;
    capabilities?: string;
    avatar?: string;
  },
): AgentProfile | undefined {
  const columns: Record<string, string> = {
    name: 'name',
    handle: 'handle',
    headline: 'headline',
    bio: 'bio',
    website: 'website',
    capabilities: 'capabilities',
    avatar: 'avatar',
  };
  const sets: string[] = [];
  const values: string[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key as keyof typeof patch] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(String(patch[key as keyof typeof patch] ?? ''));
    }
  }
  if (patch.headline !== undefined) {
    sets.push('description = ?');
    values.push(patch.headline);
  }
  if (sets.length) {
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...values, agentId);
  }
  return getAgentProfile(agentId);
}

/* ---------------------------- join requests ----------------------------- */

export interface JoinRequestRow {
  id: string;
  room_id: string;
  kind: PrincipalType;
  request_key: string;
  user_id: string | null;
  name: string;
  description: string;
  status: JoinRequestStatus;
  agent_id: string | null;
  agent_token: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  delivery_mode: DeliveryMode;
  trigger_url: string | null;
  trigger_secret_enc: string | null;
  trigger_secret_returned: number;
}

function mapJoinRequest(row: Row): JoinRequest {
  return {
    id: row.id,
    kind: row.kind as PrincipalType,
    name: row.name,
    description: row.description,
    status: row.status as JoinRequestStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
    deliveryMode: (row.delivery_mode as DeliveryMode) ?? 'socket',
    triggerUrl: row.trigger_url ?? null,
  };
}

export function getJoinRequestById(id: string): JoinRequestRow | undefined {
  return db.prepare('SELECT * FROM room_join_requests WHERE id = ?').get(id) as JoinRequestRow | undefined;
}

export function getJoinRequestByKey(key: string): JoinRequestRow | undefined {
  return db.prepare('SELECT * FROM room_join_requests WHERE request_key = ?').get(key) as
    | JoinRequestRow
    | undefined;
}

export function getLatestJoinRequestForUser(roomId: string, userId: string): JoinRequestRow | undefined {
  return db
    .prepare(
      'SELECT * FROM room_join_requests WHERE room_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    )
    .get(roomId, userId) as JoinRequestRow | undefined;
}

export function createJoinRequest(
  roomId: string,
  kind: PrincipalType,
  name: string,
  description: string,
  userId: string | null = null,
  options: { deliveryMode?: DeliveryMode; triggerUrl?: string | null } = {},
): JoinRequestRow {
  let key = `jr_${randomBytes(18).toString('base64url')}`;
  while (db.prepare('SELECT 1 FROM room_join_requests WHERE request_key = ?').get(key)) {
    key = `jr_${randomBytes(18).toString('base64url')}`;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO room_join_requests (id, room_id, kind, request_key, user_id, name, description, status, created_at,
                                     delivery_mode, trigger_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(
    id,
    roomId,
    kind,
    key,
    userId,
    name,
    description,
    nowIso(),
    options.deliveryMode ?? 'socket',
    options.triggerUrl ?? null,
  );
  return getJoinRequestById(id)!;
}

export function getPendingAgentJoinRequest(roomId: string, name: string): JoinRequestRow | undefined {
  return db
    .prepare(
      "SELECT * FROM room_join_requests WHERE room_id = ? AND kind = 'agent' AND status = 'pending' AND name = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1",
    )
    .get(roomId, name) as JoinRequestRow | undefined;
}

export function listPendingJoinRequests(roomId: string): JoinRequest[] {
  const rows = db
    .prepare("SELECT * FROM room_join_requests WHERE room_id = ? AND status = 'pending' ORDER BY created_at ASC")
    .all(roomId) as Row[];
  return rows.map(mapJoinRequest);
}

export function approveJoinRequest(
  id: string,
  decidedBy: string,
  agentId: string | null = null,
  agentToken: string | null = null,
  triggerSecretEnc: string | null = null,
): void {
  db.prepare(
    `UPDATE room_join_requests
     SET status = 'approved', decided_by = ?, decided_at = ?, agent_id = ?, agent_token = ?,
         trigger_secret_enc = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(decidedBy, nowIso(), agentId, agentToken, triggerSecretEnc, id);
}

export function takeJoinRequestSecretEnc(id: string): string | null {
  const row = db
    .prepare('SELECT trigger_secret_enc, trigger_secret_returned FROM room_join_requests WHERE id = ?')
    .get(id) as { trigger_secret_enc: string | null; trigger_secret_returned: number } | undefined;
  if (!row?.trigger_secret_enc || row.trigger_secret_returned) return null;
  db.prepare('UPDATE room_join_requests SET trigger_secret_returned = 1 WHERE id = ?').run(id);
  return row.trigger_secret_enc;
}

export function denyJoinRequest(id: string, decidedBy: string): void {
  db.prepare(
    "UPDATE room_join_requests SET status = 'denied', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
  ).run(decidedBy, nowIso(), id);
}

export function deleteJoinRequestsForAgent(agentId: string): void {
  db.prepare('DELETE FROM room_join_requests WHERE agent_id = ?').run(agentId);
}

export function deletePendingJoinRequestsForUser(roomId: string, userId: string): void {
  db.prepare("DELETE FROM room_join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'").run(
    roomId,
    userId,
  );
}

/* ------------------------------- repos ---------------------------------- */

function mapRepo(row: Row): Repo {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    url: row.url,
    branch: row.branch,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

export function listRepos(roomId: string): Repo[] {
  const rows = db.prepare('SELECT * FROM room_repos WHERE room_id = ? ORDER BY created_at ASC').all(roomId) as Row[];
  return rows.map(mapRepo);
}

export function getRepo(roomId: string, repoId: string): Repo | undefined {
  const row = db.prepare('SELECT * FROM room_repos WHERE id = ? AND room_id = ?').get(repoId, roomId) as
    | Row
    | undefined;
  return row ? mapRepo(row) : undefined;
}

export function addRepo(
  roomId: string,
  name: string,
  url: string,
  branch: string,
  addedBy: string,
): Repo {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO room_repos (id, room_id, name, url, branch, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, roomId, name, url, branch, addedBy, nowIso());
  return getRepo(roomId, id)!;
}

export function deleteRepo(roomId: string, repoId: string): void {
  db.prepare('DELETE FROM room_repos WHERE id = ? AND room_id = ?').run(repoId, roomId);
}

/* ------------------------------ messages -------------------------------- */

function mapMessage(row: Row): Message {
  return {
    id: row.id,
    roomId: row.room_id,
    senderType: row.sender_type as PrincipalType | 'system',
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderRole: row.sender_role as Role,
    kind: row.kind as MessageKind,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    seq: Number(row.seq ?? 0),
    mentions: row.mentions ? (JSON.parse(row.mentions) as Mention[]) : [],
    clientMessageId: row.client_message_id ?? null,
  };
}

export interface InsertMessageOptions {
  mentions?: Mention[];
  clientMessageId?: string | null;
  senderType?: PrincipalType | 'system';
}

/* The sequence bump and the insert share one transaction so seq stays gap-free
 * and strictly increasing per room. */
export function insertMessage(
  roomId: string,
  sender: Principal,
  senderRole: Role,
  kind: MessageKind,
  content: string,
  options: InsertMessageOptions = {},
): Message {
  const id = randomUUID();
  const createdAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare('UPDATE rooms SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq')
      .get(roomId) as { last_seq: number } | undefined;
    if (!row) throw new Error('Room not found');
    const seq = Number(row.last_seq);
    db.prepare(
      `INSERT INTO messages (id, room_id, sender_type, sender_id, sender_name, sender_role, kind, content,
                             created_at, seq, mentions, client_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      roomId,
      options.senderType ?? sender.type,
      sender.id,
      sender.name,
      senderRole,
      kind,
      content,
      createdAt,
      seq,
      JSON.stringify(options.mentions ?? []),
      options.clientMessageId ?? null,
    );
    db.exec('COMMIT');
    return {
      id,
      roomId,
      senderType: options.senderType ?? sender.type,
      senderId: sender.id,
      senderName: sender.name,
      senderRole,
      kind,
      content,
      createdAt,
      editedAt: null,
      seq,
      mentions: options.mentions ?? [],
      clientMessageId: options.clientMessageId ?? null,
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // the transaction may already be closed; keep the original error
    }
    throw error;
  }
}

export function insertSystemMessage(roomId: string, content: string): Message {
  return insertMessage(roomId, { type: 'agent', id: 'system', name: 'System' }, 'member', 'chat', content, {
    senderType: 'system',
  });
}

export function getMessageById(messageId: string): Message | undefined {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Row | undefined;
  return row ? mapMessage(row) : undefined;
}

export function findMessageByClientId(
  roomId: string,
  senderId: string,
  clientMessageId: string,
): Message | undefined {
  const row = db
    .prepare('SELECT * FROM messages WHERE room_id = ? AND sender_id = ? AND client_message_id = ?')
    .get(roomId, senderId, clientMessageId) as Row | undefined;
  return row ? mapMessage(row) : undefined;
}

export function listMessages(roomId: string, before?: string, limit = 80): Message[] {
  const rows = before
    ? (db
        .prepare('SELECT * FROM messages WHERE room_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
        .all(roomId, before, limit) as Row[])
    : (db
        .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(roomId, limit) as Row[]);
  return rows.map(mapMessage).reverse();
}

export function listMessagesBeforeSeq(roomId: string, beforeSeq: number, limit = 80): Message[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE room_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?')
    .all(roomId, beforeSeq, limit) as Row[];
  return rows.map(mapMessage).reverse();
}

export function getUnreadCount(roomId: string, userId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE room_id = ?
         AND seq > COALESCE(
           (SELECT last_read_seq FROM room_reads WHERE room_id = ? AND user_id = ?), 0)
         AND NOT (sender_type = 'user' AND sender_id = ?)`,
    )
    .get(roomId, roomId, userId, userId) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function markRoomRead(roomId: string, userId: string, seq: number): number {
  const lastSeq = getRoomLastSeq(roomId);
  const target = Math.min(Math.max(Math.floor(seq), 0), lastSeq);
  const existing = db
    .prepare('SELECT last_read_seq FROM room_reads WHERE room_id = ? AND user_id = ?')
    .get(roomId, userId) as { last_read_seq: number } | undefined;
  const next = Math.max(Number(existing?.last_read_seq ?? 0), target);
  db.prepare(
    `INSERT INTO room_reads (room_id, user_id, last_read_seq, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(room_id, user_id)
     DO UPDATE SET last_read_seq = excluded.last_read_seq, updated_at = excluded.updated_at`,
  ).run(roomId, userId, next, nowIso());
  return next;
}

export function deleteMessage(roomId: string, messageId: string): Message | undefined {
  const message = getMessageById(messageId);
  if (!message || message.roomId !== roomId) return undefined;
  db.prepare('DELETE FROM messages WHERE id = ? AND room_id = ?').run(messageId, roomId);
  return message;
}

export function updateMessage(
  roomId: string,
  messageId: string,
  content: string,
  mentions: Mention[],
): Message | undefined {
  const existing = getMessageById(messageId);
  if (!existing || existing.roomId !== roomId) return undefined;
  db.prepare('UPDATE messages SET content = ?, mentions = ?, edited_at = ? WHERE id = ? AND room_id = ?').run(
    content,
    JSON.stringify(mentions),
    nowIso(),
    messageId,
    roomId,
  );
  return getMessageById(messageId);
}

export function searchMessages(roomId: string, query: string, limit = 30): Message[] {
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE room_id = ? AND content LIKE ? ESCAPE '\\'
       ORDER BY seq DESC LIMIT ?`,
    )
    .all(roomId, pattern, limit) as Row[];
  return rows.map(mapMessage);
}

export function listMessagesAfter(roomId: string, afterSeq: number, limit = 100): Message[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
    .all(roomId, afterSeq, limit) as Row[];
  return rows.map(mapMessage);
}

export function latestMessages(roomId: string, limit: number): Message[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT ?')
    .all(roomId, limit) as Row[];
  return rows.map(mapMessage);
}

/* --------------------------- trigger events ----------------------------- */

export interface TriggerEventRow {
  id: string;
  agent_id: string;
  room_id: string;
  message_id: string;
  seq: number;
  status: TriggerEventStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

function mapTriggerEvent(row: Row): TriggerEventRow {
  return {
    id: row.id,
    agent_id: row.agent_id,
    room_id: row.room_id,
    message_id: row.message_id,
    seq: Number(row.seq),
    status: row.status as TriggerEventStatus,
    attempts: Number(row.attempts),
    next_attempt_at: row.next_attempt_at,
    last_error: row.last_error ?? null,
    created_at: row.created_at,
    delivered_at: row.delivered_at ?? null,
  };
}

export function createTriggerEvent(
  agentId: string,
  roomId: string,
  messageId: string,
  seq: number,
): TriggerEventRow {
  const id = `evt_${randomBytes(12).toString('hex')}`;
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO trigger_events (id, agent_id, room_id, message_id, seq, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  ).run(id, agentId, roomId, messageId, seq, createdAt, createdAt);
  return getTriggerEvent(id)!;
}

export function getTriggerEvent(id: string): TriggerEventRow | undefined {
  const row = db.prepare('SELECT * FROM trigger_events WHERE id = ?').get(id) as Row | undefined;
  return row ? mapTriggerEvent(row) : undefined;
}

export function hasPendingTriggerEvent(agentId: string, roomId: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM trigger_events WHERE agent_id = ? AND room_id = ? AND status = 'pending' LIMIT 1",
    )
    .get(agentId, roomId);
  return Boolean(row);
}

export function listDueTriggerEvents(now: string, limit = 20): TriggerEventRow[] {
  const rows = db
    .prepare(
      "SELECT * FROM trigger_events WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?",
    )
    .all(now, limit) as Row[];
  return rows.map(mapTriggerEvent);
}

export function markTriggerDelivered(id: string): void {
  db.prepare(
    "UPDATE trigger_events SET status = 'delivered', attempts = attempts + 1, delivered_at = ?, last_error = NULL WHERE id = ?",
  ).run(nowIso(), id);
}

export function markTriggerFailure(
  id: string,
  attempts: number,
  nextAttemptAt: string | null,
  error: string,
): void {
  if (nextAttemptAt) {
    db.prepare(
      "UPDATE trigger_events SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
    ).run(attempts, nextAttemptAt, error.slice(0, 500), id);
  } else {
    db.prepare(
      "UPDATE trigger_events SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?",
    ).run(attempts, error.slice(0, 500), id);
  }
}

/* -------------------------------- tasks --------------------------------- */

const TASK_SELECT = `
  SELECT t.*, r.name AS repo_name,
         COALESCE(au.name, aa.name) AS assignee_name,
         COALESCE(cu.name, ca.name, 'Unknown') AS created_by_name
  FROM tasks t
  LEFT JOIN room_repos r ON r.id = t.repo_id
  LEFT JOIN users au ON t.assignee_type = 'user' AND au.id = t.assignee_id
  LEFT JOIN agents aa ON t.assignee_type = 'agent' AND aa.id = t.assignee_id
  LEFT JOIN users cu ON t.created_by_type = 'user' AND cu.id = t.created_by_id
  LEFT JOIN agents ca ON t.created_by_type = 'agent' AND ca.id = t.created_by_id
`;

function mapTask(row: Row): Task {
  return {
    id: row.id,
    roomId: row.room_id,
    repoId: row.repo_id ?? null,
    repoName: row.repo_name ?? null,
    title: row.title,
    description: row.description,
    paths: row.paths,
    branch: row.branch,
    status: row.status as TaskStatus,
    assigneeType: (row.assignee_type as PrincipalType | null) ?? null,
    assigneeId: row.assignee_id ?? null,
    assigneeName: row.assignee_name ?? null,
    createdByType: row.created_by_type as PrincipalType,
    createdById: row.created_by_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientTaskId: row.client_task_id ?? null,
  };
}

export function listTasks(roomId: string): Task[] {
  const rows = db
    .prepare(
      `${TASK_SELECT}
       WHERE t.room_id = ?
       ORDER BY CASE t.status WHEN 'doing' THEN 0 WHEN 'review' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,
                t.created_at DESC`,
    )
    .all(roomId) as Row[];
  return rows.map(mapTask);
}

export function getTask(roomId: string, taskId: string): Task | undefined {
  const row = db.prepare(`${TASK_SELECT} WHERE t.room_id = ? AND t.id = ?`).get(roomId, taskId) as Row | undefined;
  return row ? mapTask(row) : undefined;
}

export interface NewTaskInput {
  title: string;
  description: string;
  paths: string;
  branch: string;
  repoId: string | null;
  assigneeType: PrincipalType | null;
  assigneeId: string | null;
  clientTaskId?: string | null;
}

export function createTask(roomId: string, input: NewTaskInput, creator: Principal): Task {
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO tasks (id, room_id, repo_id, title, description, paths, branch, status,
                        assignee_type, assignee_id, created_by_type, created_by_id, created_at, updated_at,
                        client_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    roomId,
    input.repoId,
    input.title,
    input.description,
    input.paths,
    input.branch,
    input.assigneeType,
    input.assigneeId,
    creator.type,
    creator.id,
    timestamp,
    timestamp,
    input.clientTaskId ?? null,
  );
  return getTask(roomId, id)!;
}

export function findTaskByClientId(
  roomId: string,
  creatorType: PrincipalType,
  creatorId: string,
  clientTaskId: string,
): Task | undefined {
  const row = db
    .prepare(
      `${TASK_SELECT}
       WHERE t.room_id = ? AND t.created_by_type = ? AND t.created_by_id = ? AND t.client_task_id = ?`,
    )
    .get(roomId, creatorType, creatorId, clientTaskId) as Row | undefined;
  return row ? mapTask(row) : undefined;
}

export interface TaskPageQuery {
  statuses?: TaskStatus[];
  assigneeType?: PrincipalType | null;
  assigneeId?: string | null;
  unassigned?: boolean;
  search?: string;
  limit: number;
  offset: number;
}

export function listTasksPage(
  roomId: string,
  query: TaskPageQuery,
): { tasks: Task[]; total: number } {
  const where = ['t.room_id = ?'];
  const values: (string | number)[] = [roomId];

  if (query.statuses?.length) {
    where.push(`t.status IN (${query.statuses.map(() => '?').join(', ')})`);
    values.push(...query.statuses);
  }
  if (query.unassigned) {
    where.push('t.assignee_id IS NULL');
  } else if (query.assigneeType && query.assigneeId) {
    where.push('t.assignee_type = ? AND t.assignee_id = ?');
    values.push(query.assigneeType, query.assigneeId);
  }
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
    values.push(pattern, pattern);
  }

  const clause = where.join(' AND ');
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${clause}`).get(...values) as
    | { count: number }
    | undefined;
  const rows = db
    .prepare(
      `${TASK_SELECT}
       WHERE ${clause}
       ORDER BY CASE t.status WHEN 'doing' THEN 0 WHEN 'review' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,
                t.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, query.limit, query.offset) as Row[];
  return { tasks: rows.map(mapTask), total: Number(countRow?.count ?? 0) };
}

export function updateTaskFields(
  roomId: string,
  taskId: string,
  patch: Partial<{
    title: string;
    description: string;
    paths: string;
    branch: string;
    repoId: string | null;
    status: TaskStatus;
    assigneeType: PrincipalType | null;
    assigneeId: string | null;
  }>,
): Task {
  const columns: Record<string, string> = {
    title: 'title',
    description: 'description',
    paths: 'paths',
    branch: 'branch',
    repoId: 'repo_id',
    status: 'status',
    assigneeType: 'assignee_type',
    assigneeId: 'assignee_id',
  };
  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${column} = ?`);
      const value = (patch as Record<string, unknown>)[key];
      values.push(value === undefined ? null : (value as string | null));
    }
  }
  sets.push('updated_at = ?');
  values.push(nowIso());
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND room_id = ?`).run(...values, taskId, roomId);
  return getTask(roomId, taskId)!;
}

export function deleteTask(roomId: string, taskId: string): boolean {
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND room_id = ?').run(taskId, roomId);
  return result.changes > 0;
}

/* ------------------------------ activity -------------------------------- */

function mapActivity(row: Row): Activity {
  return {
    id: row.id,
    roomId: row.room_id,
    type: row.type,
    summary: row.summary,
    actorType: row.actor_type as PrincipalType,
    actorId: row.actor_id,
    actorName: row.actor_name,
    data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

export function logActivity(
  roomId: string,
  actor: Principal,
  type: string,
  summary: string,
  data?: Record<string, unknown>,
): Activity {
  const activity: Activity = {
    id: randomUUID(),
    roomId,
    type,
    summary,
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    data: data ?? null,
    createdAt: nowIso(),
  };
  db.prepare(
    'INSERT INTO activity (id, room_id, type, summary, actor_type, actor_id, actor_name, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    activity.id,
    activity.roomId,
    activity.type,
    activity.summary,
    activity.actorType,
    activity.actorId,
    activity.actorName,
    activity.data ? JSON.stringify(activity.data) : null,
    activity.createdAt,
  );
  return activity;
}

export function listActivity(roomId: string, limit = 80): Activity[] {
  const rows = db
    .prepare('SELECT * FROM activity WHERE room_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(roomId, limit) as Row[];
  return rows.map(mapActivity);
}

export interface TriggerQueueStats {
  pending: number;
  failed: number;
  delivered24h: number;
  oldestPendingAt: string | null;
}

export function pruneTriggerEvents(beforeIso: string): number {
  const result = db
    .prepare("DELETE FROM trigger_events WHERE status IN ('delivered', 'failed') AND created_at < ?")
    .run(beforeIso);
  return Number(result.changes);
}

export function expireStaleJoinRequests(beforeIso: string, nowIsoValue = new Date().toISOString()): number {
  const result = db
    .prepare(
      "UPDATE room_join_requests SET status = 'denied', decided_at = ? WHERE status = 'pending' AND created_at < ?",
    )
    .run(nowIsoValue, beforeIso);
  return Number(result.changes);
}

export function triggerQueueStats(): TriggerQueueStats {
  const counts = db
    .prepare('SELECT status, COUNT(*) AS count FROM trigger_events GROUP BY status')
    .all() as { status: string; count: number }[];
  const byStatus = new Map(counts.map((row) => [row.status, Number(row.count)]));
  const oldest = db
    .prepare("SELECT MIN(created_at) AS at FROM trigger_events WHERE status = 'pending'")
    .get() as { at: string | null };
  const delivered = db
    .prepare("SELECT COUNT(*) AS count FROM trigger_events WHERE status = 'delivered' AND delivered_at >= ?")
    .get(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as { count: number };
  return {
    pending: byStatus.get('pending') ?? 0,
    failed: byStatus.get('failed') ?? 0,
    delivered24h: Number(delivered.count),
    oldestPendingAt: oldest.at ?? null,
  };
}
