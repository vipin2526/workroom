import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { readSessionToken, resolveToken } from './auth.js';
import { HttpError } from './errors.js';
import { SlidingWindowLimiter } from './rate-limit.js';
import * as store from './store.js';
import type {
  Member,
  Mention,
  Message,
  MessageKind,
  PresenceEntry,
  PresenceStatus,
  Principal,
  PrincipalType,
  Role,
  RoomState,
  TypingEntry,
  VoiceParticipant,
} from './types.js';

interface Client {
  ws: WebSocket;
  principal: Principal;
  rooms: Set<string>;
  alive: boolean;
}

interface PendingClient {
  ws: WebSocket;
  requestId: string;
  roomId: string;
  alive: boolean;
}

interface LivePresence {
  status: PresenceStatus;
  activity: string;
  taskId: string | null;
  lastSeen: string;
}

interface VoiceSession {
  ws: WebSocket;
  participant: VoiceParticipant;
}

const clients = new Map<WebSocket, Client>();
const pendingClients = new Map<WebSocket, PendingClient>();
const presence = new Map<string, Map<string, LivePresence>>();
const voiceRooms = new Map<string, Map<string, VoiceSession>>();
const agentSockets = new Map<string, WebSocket>();
const pausedRooms = new Set<string>();
const typingRooms = new Map<
  string,
  Map<string, { entry: TypingEntry; timer: ReturnType<typeof setTimeout> }>
>();
const TYPING_TTL_MS = 4_500;

const PRESENCE_STATUSES = new Set<PresenceStatus>(['online', 'working', 'reviewing', 'away', 'offline']);
const MESSAGE_KINDS = new Set<MessageKind>(['chat', 'instruction', 'suggestion']);
const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  doing: 'In progress',
  review: 'Review',
  done: 'Done',
};

const principalKey = (type: string, id: string) => `${type}:${id}`;
const nowIso = () => new Date().toISOString();

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    try {
      ws.terminate();
    } catch {
      // socket already gone
    }
  }
}

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function presenceEntry(roomId: string, type: string, id: string): LivePresence | undefined {
  return presence.get(roomId)?.get(principalKey(type, id));
}

function ensurePresence(roomId: string, principal: Principal): LivePresence {
  let roomPresence = presence.get(roomId);
  if (!roomPresence) {
    roomPresence = new Map();
    presence.set(roomId, roomPresence);
  }
  const key = principalKey(principal.type, principal.id);
  const existing = roomPresence.get(key);
  if (existing) {
    if (existing.status === 'offline') existing.status = 'online';
    existing.lastSeen = nowIso();
    return existing;
  }
  const entry: LivePresence = {
    status: 'online',
    activity: '',
    taskId: null,
    lastSeen: nowIso(),
  };
  roomPresence.set(key, entry);
  return entry;
}

export function isAgentConnected(agentId: string): boolean {
  const socket = agentSockets.get(agentId);
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

/* Agent state is derived, never stored as presence: a live socket wins, then a
 * delivered trigger (waking) or a failed one (unreachable), then sleep mode. */
function agentPresenceStatus(agentId: string, entry: LivePresence | undefined): PresenceStatus {
  if (isAgentConnected(agentId)) {
    const status = entry?.status;
    if (status && status !== 'offline' && status !== 'idle' && status !== 'waking' && status !== 'unreachable') {
      return status;
    }
    return 'online';
  }
  const runtime = store.getAgentRuntime(agentId);
  if (!runtime) return 'offline';
  if (runtime.wakeState === 'waking') return 'waking';
  if (runtime.wakeState === 'unreachable') return 'unreachable';
  return runtime.deliveryMode === 'trigger' ? 'idle' : 'offline';
}

export function presenceList(roomId: string): PresenceEntry[] {
  const members = store.listMembers(roomId);
  const live = presence.get(roomId);
  const rank: Record<PresenceStatus, number> = {
    working: 0,
    reviewing: 1,
    online: 2,
    away: 3,
    idle: 4,
    waking: 5,
    unreachable: 6,
    offline: 7,
  };
  return members
    .map((member) => {
      const entry = live?.get(principalKey(member.type, member.id));
      const runtime = member.type === 'agent' ? store.getAgentRuntime(member.id) : undefined;
      return {
        type: member.type,
        id: member.id,
        name: member.name,
        role: member.role,
        status:
          member.type === 'agent'
            ? agentPresenceStatus(member.id, entry)
            : ((entry?.status ?? 'offline') as PresenceStatus),
        activity: entry?.activity ?? '',
        taskId: entry?.taskId ?? null,
        lastSeen: entry?.lastSeen ?? runtime?.lastSocketAt ?? null,
        ...(member.type === 'agent' ? { deliveryMode: runtime?.deliveryMode ?? 'socket' } : {}),
      };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}

export function broadcast(roomId: string, payload: Record<string, unknown>): void {
  const body = JSON.stringify({ roomId, ...payload });
  for (const client of clients.values()) {
    if (client.rooms.has(roomId) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(body);
    }
  }
}

export function broadcastPresence(roomId: string): void {
  broadcast(roomId, { type: 'presence.update', presence: presenceList(roomId) });
}

/* Typing state is deliberately ephemeral and per-socket: an entry expires on
 * its own after a few seconds so a dropped tab never leaves a phantom typer. */
function typingList(roomId: string): TypingEntry[] {
  const room = typingRooms.get(roomId);
  if (!room) return [];
  const now = Date.now();
  return [...room.values()]
    .filter((session) => session.entry.expiresAt > now)
    .map((session) => session.entry)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function broadcastTyping(roomId: string): void {
  broadcast(roomId, { type: 'typing.update', typing: typingList(roomId) });
}

export function setTyping(roomId: string, principal: Principal, active: boolean): void {
  const key = principalKey(principal.type, principal.id);
  const existing = typingRooms.get(roomId)?.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    const room = typingRooms.get(roomId);
    room?.delete(key);
    if (room && room.size === 0) typingRooms.delete(roomId);
  }
  if (!active) {
    if (existing) broadcastTyping(roomId);
    return;
  }

  let room = typingRooms.get(roomId);
  if (!room) {
    room = new Map();
    typingRooms.set(roomId, room);
  }
  const timer = setTimeout(() => {
    const current = typingRooms.get(roomId);
    const session = current?.get(key);
    if (!current || !session || session.timer !== timer) return;
    current.delete(key);
    if (current.size === 0) typingRooms.delete(roomId);
    broadcastTyping(roomId);
  }, TYPING_TTL_MS);
  timer.unref();
  room.set(key, {
    entry: { type: principal.type, id: principal.id, name: principal.name, expiresAt: Date.now() + TYPING_TTL_MS },
    timer,
  });
  if (!existing) broadcastTyping(roomId);
}

export function clearTyping(roomId: string, principal: Principal): void {
  const room = typingRooms.get(roomId);
  const session = room?.get(principalKey(principal.type, principal.id));
  if (!room || !session) return;
  clearTimeout(session.timer);
  room.delete(principalKey(principal.type, principal.id));
  if (room.size === 0) typingRooms.delete(roomId);
  broadcastTyping(roomId);
}

function clearRoomTyping(roomId: string): void {
  const room = typingRooms.get(roomId);
  if (!room) return;
  for (const session of room.values()) clearTimeout(session.timer);
  typingRooms.delete(roomId);
}

export function broadcastMembers(roomId: string): void {
  broadcast(roomId, { type: 'members.updated', members: store.listMembers(roomId) });
  broadcastPresence(roomId);
}

/* Keep already-open sockets and voice tiles in sync when a profile name
 * changes; tokens resolve fresh on the next request, sockets do not. */
export function syncPrincipalProfile(
  type: PrincipalType,
  id: string,
  name: string,
  handle: string | null,
  avatar?: string | null,
): void {
  for (const client of clients.values()) {
    if (client.principal.type !== type || client.principal.id !== id) continue;
    client.principal = {
      ...client.principal,
      name,
      ...(handle ? { handle } : { handle: undefined }),
      ...(avatar ? { avatar } : {}),
    };
  }
  const changedRooms = new Set<string>();
  for (const [roomId, room] of voiceRooms) {
    for (const session of room.values()) {
      if (session.participant.type !== type || session.participant.id !== id) continue;
      session.participant = {
        ...session.participant,
        name,
        ...(avatar ? { avatar } : {}),
      };
      changedRooms.add(roomId);
    }
  }
  for (const roomId of changedRooms) broadcastVoice(roomId);
}

/* Pending requests are admin-only, so this does not use the room-wide broadcast. */
export function broadcastJoinRequests(roomId: string): void {
  const requests = store.listPendingJoinRequests(roomId);
  const body = JSON.stringify({ roomId, type: 'join.requests.updated', requests });
  for (const client of clients.values()) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (store.getMembership(roomId, client.principal)?.role !== 'admin') continue;
    if (client.rooms.has(roomId)) client.ws.send(body);
    send(client.ws, { type: 'room.pending', roomId, pendingRequests: requests.length });
  }
}

export function broadcastRoomUpdated(roomId: string): void {
  const room = store.getRoom(roomId);
  if (!room) return;
  for (const client of clients.values()) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (!client.rooms.has(roomId) && !store.getMembership(roomId, client.principal)) continue;
    send(client.ws, { type: 'room.updated', roomId, room });
  }
}

export function broadcastRoomDeleted(roomId: string): void {
  const name = store.getRoom(roomId)?.name ?? 'This room';
  const voice = voiceRooms.get(roomId);
  if (voice) {
    for (const session of voice.values()) {
      send(session.ws, { type: 'voice.replaced', roomId, message: 'This room was deleted.' });
    }
    voiceRooms.delete(roomId);
  }
  presence.delete(roomId);
  pausedRooms.delete(roomId);
  clearRoomTyping(roomId);
  for (const client of clients.values()) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const member =
      client.rooms.has(roomId) || Boolean(store.getMembership(roomId, client.principal));
    if (!member) continue;
    send(client.ws, { type: 'room.deleted', roomId, name, message: `“${name}” was deleted.` });
    client.rooms.delete(roomId);
    if (client.principal.type === 'agent') {
      setTimeout(() => {
        try {
          client.ws.close(4004, 'room deleted');
        } catch {
          // already closing
        }
      }, 50);
    }
  }
}

/* Unread counts are per user, so fan out a small update to every socket the
 * member has open, whether or not that socket is currently in the room. */
export function broadcastUnread(roomId: string): void {
  for (const client of clients.values()) {
    if (client.ws.readyState !== WebSocket.OPEN || client.principal.type !== 'user') continue;
    if (!store.getMembership(roomId, client.principal)) continue;
    send(client.ws, {
      type: 'room.unread',
      roomId,
      unreadCount: store.getUnreadCount(roomId, client.principal.id),
    });
  }
}

export function broadcastMessageDeleted(roomId: string, messageId: string): void {
  broadcast(roomId, { type: 'message.deleted', roomId, messageId });
  broadcastUnread(roomId);
}

export function disconnectAgent(agentId: string, message: string): void {
  for (const client of clients.values()) {
    if (client.principal.type !== 'agent' || client.principal.id !== agentId) continue;
    send(client.ws, { type: 'error', message });
    setTimeout(() => {
      try {
        client.ws.close(4008, 'token rotated');
      } catch {
        // already closing
      }
    }, 50);
  }
}

/* Voice is an ephemeral mesh: the server keeps the roster and relays SDP/ICE,
 * while audio itself flows peer to peer. Nothing here touches the database. */
export function voiceParticipants(roomId: string): VoiceParticipant[] {
  const room = voiceRooms.get(roomId);
  if (!room) return [];
  return [...room.values()]
    .map((session) => session.participant)
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
}

function broadcastVoice(roomId: string): void {
  broadcast(roomId, { type: 'voice.participants', participants: voiceParticipants(roomId) });
}

function removeVoiceForSocket(ws: WebSocket, onlyRoomId?: string): void {
  const roomIds = onlyRoomId ? [onlyRoomId] : [...voiceRooms.keys()];
  const changed = new Set<string>();
  for (const roomId of roomIds) {
    const room = voiceRooms.get(roomId);
    if (!room) continue;
    for (const [peerId, session] of [...room]) {
      if (session.ws !== ws) continue;
      room.delete(peerId);
      changed.add(roomId);
    }
    if (room.size === 0) voiceRooms.delete(roomId);
  }
  for (const roomId of changed) broadcastVoice(roomId);
}

function removeVoiceForPrincipal(roomId: string, type: string, id: string): void {
  const room = voiceRooms.get(roomId);
  if (!room) return;
  let changed = false;
  for (const [peerId, session] of [...room]) {
    if (session.participant.type !== type || session.participant.id !== id) continue;
    room.delete(peerId);
    changed = true;
    send(session.ws, {
      type: 'voice.replaced',
      roomId,
      message: 'You no longer have access to this room’s voice channel.',
    });
  }
  if (room.size === 0) voiceRooms.delete(roomId);
  if (changed) broadcastVoice(roomId);
}

export function buildRoomState(roomId: string, principal: Principal): RoomState | null {
  const membership = store.getMembership(roomId, principal);
  const room = store.getRoom(roomId);
  if (!membership || !room) return null;

  return {
    room,
    me: {
      type: principal.type,
      id: principal.id,
      name: principal.name,
      role: membership.role,
      ...(principal.avatar ? { avatar: principal.avatar } : {}),
    },
    members: store.listMembers(roomId),
    repos: store.listRepos(roomId),
    tasks: store.listTasks(roomId),
    activity: store.listActivity(roomId, 80),
    messages: store.listMessages(roomId, undefined, 80),
    presence: presenceList(roomId),
    voice: voiceParticipants(roomId),
    typing: typingList(roomId),
    ...(membership.role === 'admin'
      ? { joinRequests: store.listPendingJoinRequests(roomId) }
      : {}),
    ...(principal.type === 'user' ? { unreadCount: store.getUnreadCount(roomId, principal.id) } : {}),
  };
}

export function setPresence(
  roomId: string,
  principal: Principal,
  input: { status?: string; activity?: string; taskId?: string | null },
): PresenceEntry[] | null {
  const membership = store.getMembership(roomId, principal);
  if (!membership) return null;

  const entry = ensurePresence(roomId, principal);
  if (input.status !== undefined) {
    if (!PRESENCE_STATUSES.has(input.status as PresenceStatus) || input.status === 'offline') {
      throw new Error('Invalid presence status');
    }
    entry.status = input.status as PresenceStatus;
  }
  if (input.activity !== undefined) {
    entry.activity = String(input.activity).slice(0, 160);
  }
  if (input.taskId !== undefined) {
    if (input.taskId && !store.getTask(roomId, input.taskId)) {
      throw new Error('Task does not belong to this room');
    }
    entry.taskId = input.taskId;
  }
  entry.lastSeen = nowIso();
  broadcastPresence(roomId);
  return presenceList(roomId);
}

export function evictFromRoom(
  roomId: string,
  type: string,
  id: string,
  message = 'You were removed from the room.',
): void {
  presence.get(roomId)?.delete(principalKey(type, id));
  clearTyping(roomId, { type: type as PrincipalType, id, name: '' });
  removeVoiceForPrincipal(roomId, type, id);
  for (const client of clients.values()) {
    if (client.rooms.has(roomId) && client.principal.type === type && client.principal.id === id) {
      client.rooms.delete(roomId);
      send(client.ws, { type: 'removed', roomId, message });
    }
  }
  broadcastPresence(roomId);
}

function markOfflineIfGone(roomId: string, principal: Principal): void {
  const stillConnected = [...clients.values()].some(
    (client) =>
      client.rooms.has(roomId) &&
      client.principal.type === principal.type &&
      client.principal.id === principal.id,
  );
  if (stillConnected) return;

  const entry = presenceEntry(roomId, principal.type, principal.id);
  if (entry) {
    entry.status = 'offline';
    entry.lastSeen = nowIso();
  }
  broadcastPresence(roomId);
}

/* --------------------------- message pipeline ---------------------------- */

const AGENT_MESSAGES_PER_MINUTE = 20;
const USER_MESSAGES_PER_MINUTE = 60;
const MESSAGE_RATE_WINDOW_MS = 60_000;
const LOOP_WINDOW = 4;
const agentMessageLimiter = new SlidingWindowLimiter(AGENT_MESSAGES_PER_MINUTE, MESSAGE_RATE_WINDOW_MS);
const userMessageLimiter = new SlidingWindowLimiter(USER_MESSAGES_PER_MINUTE, MESSAGE_RATE_WINDOW_MS);

function collectMentions(roomId: string, content: string, explicit: Mention[]): Mention[] {
  const members = store.listMembers(roomId);
  const found = new Map<string, Mention>();

  for (const member of members) {
    const escaped = member.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    if (pattern.test(content)) found.set(principalKey(member.type, member.id), { type: member.type, id: member.id });
  }

  for (const mention of explicit) {
    const member = members.find((candidate) => candidate.type === mention.type && candidate.id === mention.id);
    if (member) found.set(principalKey(member.type, member.id), { type: member.type, id: member.id });
  }

  return [...found.values()];
}

function enforceMessageRate(roomId: string, principal: Principal): void {
  const limiter = principal.type === 'agent' ? agentMessageLimiter : userMessageLimiter;
  const retryAfterSeconds = limiter.take(`${roomId}:${principal.type}:${principal.id}`);
  if (!retryAfterSeconds) return;
  throw new HttpError(
    429,
    principal.type === 'agent'
      ? 'rate_limited'
      : 'You are sending messages too quickly. Try again in a moment.',
    { retryAfterSeconds },
  );
}

function enforceAgentSend(roomId: string): void {
  if (pausedRooms.has(roomId)) throw new HttpError(429, 'loop_guard');

  const last = store.latestMessages(roomId, LOOP_WINDOW);
  if (last.length === LOOP_WINDOW && last.every((message) => message.senderType === 'agent')) {
    pausedRooms.add(roomId);
    const notice = store.insertSystemMessage(roomId, 'Agents paused until a human replies.');
    broadcast(roomId, { type: 'message.new', message: notice });
    broadcastUnread(roomId);
    throw new HttpError(429, 'loop_guard');
  }
}

/* A live socket wins and never receives a trigger. A sleeping trigger-mode agent
 * gets one wake per room; a wake already queued or in flight catches up over
 * after_seq, so new mentions coalesce into it until that wake settles. */
function routeMentions(roomId: string, message: Message): void {
  for (const mention of message.mentions) {
    if (mention.type !== 'agent') continue;
    if (mention.id === message.senderId) continue;
    if (isAgentConnected(mention.id)) continue;
    const agent = store.getAgentRuntime(mention.id);
    if (!agent || agent.deliveryMode !== 'trigger' || !agent.triggerUrl || !agent.hasSecret) continue;
    if (agent.wakeState === 'waking') continue;
    if (store.hasPendingTriggerEvent(mention.id, roomId)) continue;
    store.createTriggerEvent(mention.id, roomId, message.id, message.seq);
  }
}

export interface CreateRoomMessageInput {
  roomId: string;
  principal: Principal;
  role: Role;
  kind: MessageKind;
  content: string;
  clientMessageId?: string | null;
  explicitMentions?: Mention[];
}

export function createRoomMessage(input: CreateRoomMessageInput): { message: Message; duplicate: boolean } {
  const clientMessageId = input.clientMessageId?.trim() || null;
  if (clientMessageId) {
    const existing = store.findMessageByClientId(input.roomId, input.principal.id, clientMessageId);
    if (existing) return { message: existing, duplicate: true };
  }

  if (input.principal.type === 'agent') enforceAgentSend(input.roomId);
  enforceMessageRate(input.roomId, input.principal);

  const mentions = collectMentions(input.roomId, input.content, input.explicitMentions ?? []);
  const message = store.insertMessage(
    input.roomId,
    input.principal,
    input.role,
    input.kind,
    input.content,
    { mentions, clientMessageId },
  );

  if (input.principal.type === 'user') pausedRooms.delete(input.roomId);
  clearTyping(input.roomId, input.principal);
  broadcast(input.roomId, { type: 'message.new', message });
  broadcastUnread(input.roomId);

  if (input.kind !== 'chat') {
    const label = input.kind === 'instruction' ? 'instruction' : 'suggestion';
    const activity = store.logActivity(
      input.roomId,
      input.principal,
      input.kind,
      `${input.principal.name} shared ${input.kind === 'instruction' ? 'an' : 'a'} ${label}: “${truncate(input.content)}”`,
      { messageId: message.id },
    );
    broadcast(input.roomId, { type: 'activity.new', activity });
  }

  routeMentions(input.roomId, message);
  return { message, duplicate: false };
}

export interface EditRoomMessageInput {
  roomId: string;
  principal: Principal;
  messageId: string;
  content: string;
}

export function editRoomMessage(input: EditRoomMessageInput): Message {
  const existing = store.getMessageById(input.messageId);
  if (!existing || existing.roomId !== input.roomId) throw new HttpError(404, 'Message not found');
  if (existing.senderType !== input.principal.type || existing.senderId !== input.principal.id) {
    throw new HttpError(403, 'Only the author can edit a message');
  }
  const content = input.content.trim();
  if (!content) throw new HttpError(400, 'Message cannot be empty');
  if (content.length > 4000) throw new HttpError(400, 'Messages are limited to 4000 characters');

  const mentions = collectMentions(input.roomId, content, []);
  const message = store.updateMessage(input.roomId, existing.id, content, mentions);
  if (!message) throw new HttpError(404, 'Message not found');
  broadcast(input.roomId, { type: 'message.updated', message });
  broadcastUnread(input.roomId);
  routeMentions(input.roomId, message);
  return message;
}

function handleJoin(client: Client, roomId: string): void {
  const membership = store.getMembership(roomId, client.principal);
  if (!membership) {
    send(client.ws, { type: 'error', message: 'You are not a member of that room.' });
    return;
  }
  client.rooms.add(roomId);
  ensurePresence(roomId, client.principal);
  const state = buildRoomState(roomId, client.principal);
  if (state) send(client.ws, { type: 'room.state', roomId, state });
  broadcastPresence(roomId);
}

function handleLeave(client: Client, roomId: string): void {
  if (!client.rooms.has(roomId)) return;
  client.rooms.delete(roomId);
  clearTyping(roomId, client.principal);
  removeVoiceForSocket(client.ws, roomId);
  markOfflineIfGone(roomId, client.principal);
}

function roomIdFor(client: Client, payload: Record<string, unknown>): string {
  const explicit = String(payload.roomId ?? '');
  if (explicit) return explicit;
  if (client.principal.type === 'agent') return store.getAgentRoom(client.principal.id) ?? '';
  return '';
}

function handleMessageSend(client: Client, payload: Record<string, unknown>): void {
  const roomId = roomIdFor(client, payload);
  const membership = store.getMembership(roomId, client.principal);
  if (!membership) return;
  if (membership.role === 'viewer') {
    send(client.ws, { type: 'error', message: 'Viewers cannot post messages.' });
    return;
  }
  const content = String(payload.content ?? '').trim();
  if (!content) return;
  if (content.length > 4000) {
    send(client.ws, { type: 'error', message: 'Messages are limited to 4000 characters.' });
    return;
  }
  const kind = MESSAGE_KINDS.has(payload.kind as MessageKind) ? (payload.kind as MessageKind) : 'chat';
  const clientMessageId =
    typeof payload.clientMessageId === 'string' && payload.clientMessageId.trim()
      ? payload.clientMessageId.trim()
      : null;
  if (clientMessageId && clientMessageId.length > 100) {
    send(client.ws, { type: 'error', message: 'clientMessageId is limited to 100 characters.' });
    return;
  }
  const explicitMentions = Array.isArray(payload.mentions)
    ? (payload.mentions as Record<string, unknown>[])
        .filter((item) => item && (item.type === 'agent' || item.type === 'user') && typeof item.id === 'string')
        .slice(0, 20)
        .map((item) => ({ type: item.type as 'agent' | 'user', id: item.id as string }))
    : [];

  try {
    createRoomMessage({
      roomId,
      principal: client.principal,
      role: membership.role,
      kind,
      content,
      clientMessageId,
      explicitMentions,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      send(client.ws, {
        type: 'error',
        error: error.message,
        message:
          error.message === 'loop_guard'
            ? 'Agents are paused until a human replies.'
            : client.principal.type === 'agent'
              ? 'Agent message rate limit reached (20 per minute).'
              : 'You are sending messages too quickly. Try again in a moment.',
      });
      return;
    }
    send(client.ws, { type: 'error', message: 'Could not send the message.' });
  }
}

function handlePresenceSet(client: Client, payload: Record<string, unknown>): void {
  const roomId = roomIdFor(client, payload);
  const membership = store.getMembership(roomId, client.principal);
  if (!membership) return;
  try {
    setPresence(roomId, client.principal, {
      status: payload.status === undefined ? undefined : String(payload.status),
      activity: payload.activity === undefined ? undefined : String(payload.activity),
      taskId:
        payload.taskId === undefined
          ? undefined
          : payload.taskId === null
            ? null
            : String(payload.taskId),
    });
  } catch {
    send(client.ws, { type: 'error', message: 'Could not update presence.' });
  }
}

function handleTypingSet(client: Client, payload: Record<string, unknown>): void {
  const roomId = roomIdFor(client, payload);
  const membership = store.getMembership(roomId, client.principal);
  if (!membership || membership.role === 'viewer') return;
  setTyping(roomId, client.principal, payload.typing === true);
}

/* ------------------------------ voice mesh ------------------------------- */

const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;
const MAX_SIGNAL_BYTES = 60_000;

function voiceError(client: Client, roomId: string, message: string): void {
  send(client.ws, { type: 'voice.error', roomId, message });
}

function handleVoiceJoin(client: Client, payload: Record<string, unknown>): void {
  const roomId = roomIdFor(client, payload);
  const membership = store.getMembership(roomId, client.principal);
  if (!membership) return voiceError(client, roomId, 'You are not a member of this room.');
  if (client.principal.type !== 'user') {
    return voiceError(client, roomId, 'Only people can join a voice channel.');
  }
  if (membership.role === 'viewer') {
    return voiceError(client, roomId, 'Viewers can follow the room but cannot join voice.');
  }

  const peerId = String(payload.peerId ?? '').trim();
  if (!PEER_ID_PATTERN.test(peerId)) {
    return voiceError(client, roomId, 'Could not start voice. Try again.');
  }

  let room = voiceRooms.get(roomId);
  if (!room) {
    room = new Map();
    voiceRooms.set(roomId, room);
  }

  for (const [otherId, session] of [...room]) {
    if (session.ws === client.ws) room.delete(otherId);
  }
  const collision = room.get(peerId);
  if (collision && collision.ws !== client.ws) {
    send(collision.ws, {
      type: 'voice.replaced',
      roomId,
      message: 'Voice moved to another tab or device.',
    });
    room.delete(peerId);
  }

  const existing = [...room.values()]
    .map((session) => session.participant)
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));

  room.set(peerId, {
    ws: client.ws,
    participant: {
      peerId,
      type: client.principal.type,
      id: client.principal.id,
      name: client.principal.name,
      role: membership.role,
      ...(client.principal.avatar ? { avatar: client.principal.avatar } : {}),
      muted: payload.muted === true,
      deafened: payload.deafened === true,
      joinedAt: nowIso(),
    },
  });

  send(client.ws, { type: 'voice.joined', roomId, self: peerId, participants: existing });
  broadcastVoice(roomId);
}

function handleVoiceUpdate(client: Client, payload: Record<string, unknown>): void {
  const roomId = roomIdFor(client, payload);
  const peerId = String(payload.peerId ?? '');
  const session = voiceRooms.get(roomId)?.get(peerId);
  if (!session || session.ws !== client.ws) return;

  const wasMuted = session.participant.muted;
  const wasDeafened = session.participant.deafened;
  if (typeof payload.muted === 'boolean') session.participant.muted = payload.muted;
  if (typeof payload.deafened === 'boolean') session.participant.deafened = payload.deafened;

  if (wasMuted !== session.participant.muted || wasDeafened !== session.participant.deafened) {
    broadcastVoice(roomId);
  }
}

function handleVoiceSignal(client: Client, payload: Record<string, unknown>): void {
  const roomId = roomIdFor(client, payload);
  const room = voiceRooms.get(roomId);
  if (!room) return;

  const from = String(payload.from ?? '');
  const to = String(payload.to ?? '');
  if (!from || !to || from === to) return;

  const sender = room.get(from);
  const target = room.get(to);
  if (!sender || sender.ws !== client.ws || !target) return;

  const raw = payload.data;
  if (!raw || typeof raw !== 'object') return;
  const data = raw as Record<string, unknown>;
  const signal: Record<string, unknown> = {};
  if (data.description && typeof data.description === 'object') signal.description = data.description;
  if (data.candidate && typeof data.candidate === 'object') signal.candidate = data.candidate;
  if (!signal.description && !signal.candidate) return;
  if (JSON.stringify(signal).length > MAX_SIGNAL_BYTES) return;

  send(target.ws, { type: 'voice.signal', roomId, from, data: signal });
}

function handleVoiceLeave(client: Client, payload: Record<string, unknown>): void {
  const roomId = roomIdFor(client, payload);
  const room = voiceRooms.get(roomId);
  if (!room) return;
  const peerId = String(payload.peerId ?? '');
  const session = room.get(peerId);
  if (!session || session.ws !== client.ws) return;
  room.delete(peerId);
  if (room.size === 0) voiceRooms.delete(roomId);
  broadcastVoice(roomId);
}

function handleClientMessage(client: Client, raw: RawData): void {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw.toString()) as Record<string, unknown>;
  } catch {
    return;
  }

  switch (payload.type) {
    case 'room.join':
      handleJoin(client, String(payload.roomId ?? ''));
      break;
    case 'room.leave':
      handleLeave(client, String(payload.roomId ?? ''));
      break;
    case 'message.send':
      handleMessageSend(client, payload);
      break;
    case 'presence.set':
      handlePresenceSet(client, payload);
      break;
    case 'typing.set':
      handleTypingSet(client, payload);
      break;
    case 'voice.join':
      handleVoiceJoin(client, payload);
      break;
    case 'voice.update':
      handleVoiceUpdate(client, payload);
      break;
    case 'voice.signal':
      handleVoiceSignal(client, payload);
      break;
    case 'voice.leave':
      handleVoiceLeave(client, payload);
      break;
    case 'ping':
      send(client.ws, { type: 'pong' });
      break;
    default:
      break;
  }
}

function registerClient(ws: WebSocket, principal: Principal): Client {
  const client: Client = { ws, principal, rooms: new Set(), alive: true };
  clients.set(ws, client);

  const agentRoomId = principal.type === 'agent' ? store.getAgentRoom(principal.id) : undefined;

  if (principal.type === 'agent') {
    const existing = agentSockets.get(principal.id);
    if (existing && existing !== ws) {
      try {
        existing.close(4008, 'replaced');
      } catch {
        // already closing
      }
    }
    agentSockets.set(principal.id, ws);
    store.markAgentSocket(principal.id);
  }

  send(ws, {
    type: 'ready',
    principal: { type: principal.type, id: principal.id, name: principal.name },
    roomId: agentRoomId ?? null,
    lastSeq: agentRoomId ? store.getRoomLastSeq(agentRoomId) : null,
  });

  if (agentRoomId) {
    handleJoin(client, agentRoomId);
    broadcastPresence(agentRoomId);
  }
  return client;
}

/* An agent can wait on ws?join=<request key> before it has a token. The socket
 * stays in pendingClients until an admin approves the request. */
function attachPendingJoin(ws: WebSocket, requestKey: string): void {
  const request = store.getJoinRequestByKey(requestKey);
  if (!request) {
    ws.close(4001, 'unknown join request');
    return;
  }
  const room = store.getRoom(request.room_id);
  if (!room) {
    ws.close(4001, 'unknown join request');
    return;
  }

  if (request.status === 'denied') {
    send(ws, { type: 'join.denied', message: 'An admin declined this join request.' });
    setTimeout(() => ws.close(4003, 'denied'), 100);
    return;
  }

  if (request.status === 'approved') {
    const principal = request.agent_token ? resolveToken(request.agent_token) : null;
    if (!principal) {
      ws.close(4001, 'join request is no longer active');
      return;
    }
    registerClient(ws, principal);
    return;
  }

  pendingClients.set(ws, { ws, requestId: request.id, roomId: request.room_id, alive: true });
  send(ws, {
    type: 'join.pending',
    message: 'Request received. Keep this socket open; an admin must approve it.',
    room: { code: room.code, name: room.name, topic: room.topic, mode: room.mode },
    request: { name: request.name, status: request.status, createdAt: request.created_at },
  });
}

/* Called after an admin approves an agent request. Sockets already waiting on
 * that request receive the credentials and become normal room members. */
export function promoteJoinRequest(
  requestId: string,
  principal: Principal,
  briefing: Record<string, unknown>,
): void {
  for (const [ws, pending] of [...pendingClients]) {
    if (pending.requestId !== requestId) continue;
    pendingClients.delete(ws);
    send(ws, { type: 'join.approved', ...briefing });
    registerClient(ws, principal);
  }
}

export function rejectJoinRequestSocket(requestId: string, message: string): void {
  for (const [ws, pending] of [...pendingClients]) {
    if (pending.requestId !== requestId) continue;
    pendingClients.delete(ws);
    send(ws, { type: 'join.denied', message });
    setTimeout(() => ws.close(4003, 'denied'), 100);
  }
}

export function attachHub(server: HttpServer): () => void {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 128 * 1024 });

  wss.on('error', (error) => {
    console.error('WebSocket server error', error);
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const explicitToken = url.searchParams.get('token') ?? '';
    const principal = resolveToken(explicitToken) ?? resolveToken(readSessionToken(req));
    const joinKey = url.searchParams.get('join') ?? '';

    if (principal) {
      registerClient(ws, principal);
    } else if (joinKey) {
      attachPendingJoin(ws, joinKey);
    } else {
      ws.close(4001, 'unauthorized');
      return;
    }

    ws.on('message', (raw) => {
      const client = clients.get(ws);
      if (client) {
        try {
          handleClientMessage(client, raw);
        } catch (error) {
          console.error('WebSocket message failed', error);
          send(ws, { type: 'error', message: 'Something went wrong. Try again.' });
        }
        return;
      }
      if (!pendingClients.has(ws)) return;
      try {
        const payload = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (payload.type === 'ping') send(ws, { type: 'pong' });
      } catch {
        // ignore malformed frames from pending sockets
      }
    });

    ws.on('pong', () => {
      const client = clients.get(ws);
      if (client) client.alive = true;
      const pending = pendingClients.get(ws);
      if (pending) pending.alive = true;
    });

    ws.on('close', () => {
      pendingClients.delete(ws);
      removeVoiceForSocket(ws);
      const client = clients.get(ws);
      if (!client) return;
      clients.delete(ws);
      if (client.principal.type === 'agent' && agentSockets.get(client.principal.id) === ws) {
        agentSockets.delete(client.principal.id);
        store.markAgentSocket(client.principal.id);
      }
      for (const roomId of client.rooms) {
        clearTyping(roomId, client.principal);
        markOfflineIfGone(roomId, client.principal);
      }
    });

    ws.on('error', () => {
      // close handler takes care of cleanup
    });
  });

  /* Idle sockets through proxies or cloud firewalls often get dropped silently.
   * Ping every 30s and terminate clients that missed the previous ping. */
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
    for (const pending of pendingClients.values()) {
      if (!pending.alive) {
        pending.ws.terminate();
        continue;
      }
      pending.alive = false;
      pending.ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return () => {
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch {
        // socket already gone
      }
    }
    wss.close();
  };
}

export function memberName(roomId: string, type: string, id: string): string | null {
  const member: Member | undefined = store
    .listMembers(roomId)
    .find((candidate) => candidate.type === type && candidate.id === id);
  return member?.name ?? null;
}

export const taskStatusLabel = (status: string): string => STATUS_LABEL[status] ?? status;
