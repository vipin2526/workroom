import type {
  AgentProfile,
  AgentProfilePatch,
  CreateAgentResult,
  Decision,
  DecisionCloseInput,
  DecisionInput,
  DeliveryMode,
  JoinState,
  Member,
  Message,
  MessageKind,
  Mission,
  MissionPatch,
  MissionQuestion,
  PresenceEntry,
  PresenceStatus,
  Profile,
  QuestionInput,
  QuestionPatch,
  Repo,
  Role,
  PublicRoom,
  Room,
  RoomMode,
  RoomPreview,
  RoomState,
  RoomSummary,
  RoomVisibility,
  Session,
  SessionUser,
  Task,
  TaskInput,
  TaskPatch,
  TriggerTestResult,
  UserProfile,
  UserProfilePatch,
  WorkstreamSummary,
} from './types';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // non-JSON error response
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  register(input: { name: string; email: string; password: string }): Promise<Session> {
    return request<Session>('/auth/register', { method: 'POST', body: input });
  },

  login(input: { email: string; password: string }): Promise<Session> {
    return request<Session>('/auth/login', { method: 'POST', body: input });
  },

  logout(): Promise<void> {
    return request<void>('/auth/logout', { method: 'POST' });
  },

  me(): Promise<{
    principal: { type: string; id: string; name: string; email?: string; handle?: string; avatar?: string };
  }> {
    return request('/me');
  },

  userProfile(handle: string): Promise<{ profile: UserProfile }> {
    return request(`/profiles/users/${encodeURIComponent(handle)}`);
  },

  agentPublicProfile(handle: string): Promise<{ profile: AgentProfile }> {
    return request(`/profiles/agents/${encodeURIComponent(handle)}`);
  },

  myProfile(): Promise<{ profile: Profile }> {
    return request('/me/profile');
  },

  updateMyProfile(input: UserProfilePatch): Promise<{ profile: UserProfile }> {
    return request('/me/profile', { method: 'PATCH', body: input });
  },

  agentProfile(agentId: string): Promise<{ profile: AgentProfile }> {
    return request(`/agents/${encodeURIComponent(agentId)}/profile`);
  },

  updateAgentProfile(agentId: string, input: AgentProfilePatch): Promise<{ profile: AgentProfile }> {
    return request(`/agents/${encodeURIComponent(agentId)}/profile`, {
      method: 'PATCH',
      body: input,
    });
  },

  rooms(): Promise<{ rooms: RoomSummary[] }> {
    return request('/rooms');
  },

  publicRooms(): Promise<{ rooms: PublicRoom[] }> {
    return request('/rooms/public');
  },

  createRoom(input: {
    name: string;
    topic: string;
    mode: RoomMode;
    visibility?: RoomVisibility;
  }): Promise<{ room: RoomSummary }> {
    return request('/rooms', { method: 'POST', body: input });
  },

  updateRoom(
    roomId: string,
    patch: { name?: string; topic?: string; visibility?: RoomVisibility },
  ): Promise<{ room: RoomSummary }> {
    return request(`/rooms/${roomId}`, { method: 'PATCH', body: patch });
  },

  deleteRoom(roomId: string): Promise<{ ok: boolean }> {
    return request(`/rooms/${roomId}`, { method: 'DELETE' });
  },

  leaveRoom(roomId: string): Promise<{ ok: boolean }> {
    return request(`/rooms/${roomId}/leave`, { method: 'POST' });
  },

  markRead(roomId: string, seq?: number): Promise<{ unreadCount: number }> {
    return request(`/rooms/${roomId}/read`, {
      method: 'POST',
      body: seq === undefined ? {} : { seq },
    });
  },

  previewRoom(code: string): Promise<RoomPreview> {
    return request(`/rooms/public/${encodeURIComponent(code)}`);
  },

  requestJoin(code: string): Promise<JoinState> {
    return request(`/join/${encodeURIComponent(code)}`);
  },

  joinRoom(code: string): Promise<JoinState> {
    return request('/rooms/join', {
      method: 'POST',
      body: { code },
    });
  },

  joinStatus(code: string): Promise<JoinState> {
    return request(`/join/${encodeURIComponent(code)}/status`);
  },

  room(roomId: string): Promise<RoomState> {
    return request(`/rooms/${roomId}`);
  },

  messages(
    roomId: string,
    beforeSeq?: number,
    limit = 60,
  ): Promise<{ messages: Message[]; lastSeq: number }> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (beforeSeq !== undefined) params.set('before_seq', String(beforeSeq));
    return request(`/rooms/${roomId}/messages?${params.toString()}`);
  },

  sendMessage(roomId: string, content: string, kind: MessageKind): Promise<Message> {
    return request(`/rooms/${roomId}/messages`, { method: 'POST', body: { content, kind } });
  },

  searchMessages(roomId: string, query: string): Promise<{ messages: Message[] }> {
    const params = new URLSearchParams({ q: query, limit: '30' });
    return request(`/rooms/${roomId}/messages/search?${params.toString()}`);
  },

  messagesAround(
    roomId: string,
    seq: number,
    limit = 30,
  ): Promise<{ older: Message[]; newer: Message[] }> {
    return Promise.all([
      request<{ messages: Message[] }>(`/rooms/${roomId}/messages?before_seq=${seq}&limit=${limit}`),
      request<{ messages: Message[] }>(`/rooms/${roomId}/messages?after_seq=${seq}&limit=${limit}`),
    ]).then(([before, after]) => ({ older: before.messages, newer: after.messages }));
  },

  editMessage(roomId: string, messageId: string, content: string): Promise<Message> {
    return request(`/rooms/${roomId}/messages/${messageId}`, {
      method: 'PATCH',
      body: { content },
    });
  },

  deleteMessage(roomId: string, messageId: string): Promise<{ ok: boolean }> {
    return request(`/rooms/${roomId}/messages/${messageId}`, { method: 'DELETE' });
  },

  setPresence(
    roomId: string,
    input: { status?: PresenceStatus; activity?: string; taskId?: string | null },
  ): Promise<{ presence: PresenceEntry[] }> {
    return request(`/rooms/${roomId}/presence`, { method: 'PATCH', body: input });
  },

  createAgent(
    roomId: string,
    input: { name: string; description: string; role: Role; deliveryMode: DeliveryMode; triggerUrl?: string },
  ): Promise<CreateAgentResult> {
    return request(`/rooms/${roomId}/agents`, { method: 'POST', body: input });
  },

  testTrigger(agentId: string): Promise<TriggerTestResult> {
    return request('/agent/me/test-trigger', { method: 'POST', body: { agentId } });
  },

  rotateTriggerSecret(agentId: string): Promise<{ triggerSecret: string }> {
    return request('/agent/me/rotate-trigger-secret', { method: 'POST', body: { agentId } });
  },

  rotateAgentToken(agentId: string): Promise<{ agentId: string; token: string }> {
    return request(`/agents/${encodeURIComponent(agentId)}/rotate-token`, { method: 'POST' });
  },

  changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: true }> {
    return request('/me/password', { method: 'PATCH', body: input });
  },

  setRole(roomId: string, member: Member, role: Role): Promise<{ members: Member[] }> {
    return request(`/rooms/${roomId}/members/${member.type}/${member.id}`, {
      method: 'PATCH',
      body: { role },
    });
  },

  removeMember(roomId: string, member: Member): Promise<{ ok: boolean }> {
    return request(`/rooms/${roomId}/members/${member.type}/${member.id}`, { method: 'DELETE' });
  },

  approveJoinRequest(roomId: string, requestId: string): Promise<{ ok: true }> {
    return request(`/rooms/${roomId}/join-requests/${requestId}/approve`, { method: 'POST' });
  },

  denyJoinRequest(roomId: string, requestId: string): Promise<{ ok: true }> {
    return request(`/rooms/${roomId}/join-requests/${requestId}/deny`, { method: 'POST' });
  },

  addRepo(
    roomId: string,
    input: { name: string; url: string; branch: string },
  ): Promise<Repo> {
    return request(`/rooms/${roomId}/repos`, { method: 'POST', body: input });
  },

  deleteRepo(roomId: string, repoId: string): Promise<{ ok: boolean }> {
    return request(`/rooms/${roomId}/repos/${repoId}`, { method: 'DELETE' });
  },

  createTask(roomId: string, input: TaskInput): Promise<Task> {
    return request(`/rooms/${roomId}/tasks`, { method: 'POST', body: input });
  },

  updateTask(roomId: string, taskId: string, patch: TaskPatch): Promise<Task> {
    return request(`/rooms/${roomId}/tasks/${taskId}`, { method: 'PATCH', body: patch });
  },

  deleteTask(roomId: string, taskId: string): Promise<{ ok: boolean }> {
    return request(`/rooms/${roomId}/tasks/${taskId}`, { method: 'DELETE' });
  },

  updateMission(roomId: string, patch: MissionPatch): Promise<Mission> {
    return request(`/rooms/${roomId}/mission`, { method: 'PATCH', body: patch });
  },

  createQuestion(roomId: string, input: QuestionInput): Promise<MissionQuestion> {
    return request(`/rooms/${roomId}/questions`, { method: 'POST', body: input });
  },

  updateQuestion(
    roomId: string,
    questionId: string,
    patch: QuestionPatch,
  ): Promise<MissionQuestion> {
    return request(`/rooms/${roomId}/questions/${questionId}`, { method: 'PATCH', body: patch });
  },

  deleteQuestion(roomId: string, questionId: string): Promise<{ ok: boolean }> {
    return request(`/rooms/${roomId}/questions/${questionId}`, { method: 'DELETE' });
  },

  createDecision(roomId: string, input: DecisionInput): Promise<Decision> {
    return request(`/rooms/${roomId}/decisions`, { method: 'POST', body: input });
  },

  voteDecision(
    roomId: string,
    decisionId: string,
    choice: string,
    comment = '',
  ): Promise<Decision> {
    return request(`/rooms/${roomId}/decisions/${decisionId}/votes`, {
      method: 'POST',
      body: { choice, comment },
    });
  },

  closeDecision(roomId: string, decisionId: string, input: DecisionCloseInput): Promise<Decision> {
    return request(`/rooms/${roomId}/decisions/${decisionId}`, { method: 'PATCH', body: input });
  },

  createWorkstream(
    roomId: string,
    input: { name: string; topic: string; objective: string },
  ): Promise<{ room: Room; workstream: WorkstreamSummary }> {
    return request(`/rooms/${roomId}/workstreams`, { method: 'POST', body: input });
  },
};

export type { SessionUser };
