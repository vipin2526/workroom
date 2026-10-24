export type PrincipalType = 'user' | 'agent';
export type Role = 'admin' | 'member' | 'viewer';
export type RoomMode = 'chat' | 'code';
export type RoomVisibility = 'public' | 'unlisted';
export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export type MessageKind = 'chat' | 'instruction' | 'suggestion';
export type PresenceStatus =
  | 'online'
  | 'working'
  | 'reviewing'
  | 'away'
  | 'offline'
  | 'idle'
  | 'waking'
  | 'unreachable';
export type DeliveryMode = 'socket' | 'trigger';
export type WorkspaceTab = 'people' | 'tasks' | 'repos' | 'activity';
export type WorkspacePanelIntent = 'new-task' | 'new-agent';

export interface ProfileTarget {
  type: PrincipalType;
  id: string;
}

export interface WorkspacePanelRequest {
  roomId: string;
  tab: WorkspaceTab;
  nonce: number;
}

export interface Mention {
  type: PrincipalType;
  id: string;
}
export type JoinRequestStatus = 'pending' | 'approved' | 'denied';
export type JoinStatus = 'member' | 'pending' | 'denied' | 'none';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  handle?: string;
  avatar?: string;
}

export interface Session {
  user: SessionUser;
}

export interface RoomSummary {
  id: string;
  name: string;
  topic: string;
  mode: RoomMode;
  role: Role;
  memberCount: number;
  code?: string;
  createdAt?: string;
  visibility: RoomVisibility;
  unreadCount: number;
  pendingRequests: number;
}

export interface Member {
  type: PrincipalType;
  id: string;
  name: string;
  role: Role;
  joinedAt: string;
  description: string | null;
  handle: string | null;
  headline: string | null;
  avatar: string | null;
}

export interface ProfileRoom {
  code: string;
  name: string;
  topic: string;
  mode: RoomMode;
  memberCount: number;
  role?: Role;
}

export interface ProfileAgentLink {
  handle: string;
  name: string;
  headline: string;
  avatar: string | null;
}

export interface ProfileOwner {
  type: PrincipalType;
  handle: string;
  name: string;
  avatar: string | null;
}

export interface UserProfile {
  type: 'user';
  id: string;
  handle: string;
  name: string;
  headline: string;
  bio: string;
  location: string;
  website: string;
  avatar: string | null;
  joinedAt: string;
  rooms: ProfileRoom[];
  agents: ProfileAgentLink[];
  roomsHidden: boolean;
  email?: string;
  showRooms?: boolean;
}

export interface AgentProfile {
  type: 'agent';
  id: string;
  handle: string;
  name: string;
  headline: string;
  bio: string;
  website: string;
  avatar: string | null;
  capabilities: string[];
  createdAt: string;
  role: Role;
  deliveryMode: DeliveryMode;
  room: ProfileRoom | null;
  owner: ProfileOwner | null;
}

export type Profile = UserProfile | AgentProfile;

export interface UserProfilePatch {
  name?: string;
  handle?: string;
  headline?: string;
  bio?: string;
  location?: string;
  website?: string;
  avatar?: string;
  showRooms?: boolean;
}

export interface AgentProfilePatch {
  name?: string;
  handle?: string;
  headline?: string;
  bio?: string;
  website?: string;
  avatar?: string;
  capabilities?: string[];
}

export interface Room {
  id: string;
  name: string;
  topic: string;
  mode: RoomMode;
  createdAt: string;
  createdBy: string;
  code?: string;
  visibility: RoomVisibility;
}

export interface Repo {
  id: string;
  roomId: string;
  name: string;
  url: string;
  branch: string;
  addedBy: string;
  createdAt: string;
}

export interface Message {
  id: string;
  roomId: string;
  senderType: PrincipalType | 'system';
  senderId: string;
  senderName: string;
  senderRole: Role;
  kind: MessageKind;
  content: string;
  createdAt: string;
  editedAt: string | null;
  seq: number;
  mentions: Mention[];
  clientMessageId: string | null;
}

export interface TypingEntry {
  type: PrincipalType;
  id: string;
  name: string;
  expiresAt: number;
}

export interface Task {
  id: string;
  roomId: string;
  repoId: string | null;
  repoName: string | null;
  title: string;
  description: string;
  paths: string;
  branch: string;
  status: TaskStatus;
  assigneeType: PrincipalType | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdByType: PrincipalType;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  roomId: string;
  type: string;
  summary: string;
  actorType: PrincipalType;
  actorId: string;
  actorName: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface PresenceEntry {
  type: PrincipalType;
  id: string;
  name: string;
  role: Role;
  status: PresenceStatus;
  activity: string;
  taskId: string | null;
  lastSeen: string | null;
  deliveryMode?: DeliveryMode;
}

export interface JoinRequest {
  id: string;
  kind: PrincipalType;
  name: string;
  description: string;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  deliveryMode?: DeliveryMode;
  triggerUrl?: string | null;
}

export interface VoiceParticipant {
  peerId: string;
  type: PrincipalType;
  id: string;
  name: string;
  role: Role;
  avatar?: string;
  muted: boolean;
  deafened: boolean;
  joinedAt: string;
}

export interface RoomState {
  room: Room;
  me: { type: PrincipalType; id: string; name: string; role: Role; avatar?: string };
  members: Member[];
  repos: Repo[];
  tasks: Task[];
  activity: Activity[];
  messages: Message[];
  presence: PresenceEntry[];
  voice: VoiceParticipant[];
  typing?: TypingEntry[];
  joinRequests?: JoinRequest[];
  unreadCount?: number;
}

export interface PublicRoomMemberPreview {
  name: string;
  type: PrincipalType;
  avatar: string | null;
}

export interface PublicRoom {
  code: string;
  name: string;
  topic: string;
  mode: RoomMode;
  createdAt?: string;
  memberCount: number;
  id?: string;
  memberPreviews?: PublicRoomMemberPreview[];
}

export interface PublicMember {
  name: string;
  type: PrincipalType;
  role: Role;
  description: string | null;
  handle: string | null;
  avatar: string | null;
}

export interface RoomPreview {
  room: PublicRoom;
  members: PublicMember[];
  approvalRequired: boolean;
  join: { page: string; human: string; agent: string };
}

export interface JoinState {
  room: PublicRoom;
  status: JoinStatus;
  membership: { role: Role } | null;
  request: { createdAt: string } | null;
  canRequest: boolean;
  already?: boolean;
  message?: string;
}

export interface TaskInput {
  title: string;
  description: string;
  paths: string;
  branch: string;
  repoId: string | null;
  assigneeType: PrincipalType | null;
  assigneeId: string | null;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  paths?: string;
  branch?: string;
  repoId?: string | null;
  status?: TaskStatus;
  assigneeType?: PrincipalType | null;
  assigneeId?: string | null;
}

export interface CreateAgentResult {
  agent: Member & { deliveryMode?: DeliveryMode; triggerUrl?: string | null };
  token: string;
  triggerSecret?: string;
}

export interface TriggerTestResult {
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
}

export interface RoomActions {
  sendMessage(content: string, kind: MessageKind): void;
  setPresence(input: {
    status?: PresenceStatus;
    activity?: string;
    taskId?: string | null;
  }): void;
  createTask(input: TaskInput): Promise<void>;
  updateTask(taskId: string, patch: TaskPatch): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  addRepo(input: { name: string; url: string; branch: string }): Promise<void>;
  deleteRepo(repoId: string): Promise<void>;
  createAgent(input: {
    name: string;
    description: string;
    role: Role;
    deliveryMode: DeliveryMode;
    triggerUrl?: string;
  }): Promise<CreateAgentResult>;
  testTrigger(agentId: string): Promise<TriggerTestResult>;
  rotateTriggerSecret(agentId: string): Promise<{ triggerSecret: string }>;
  rotateAgentToken(agentId: string): Promise<{ token: string }>;
  updateRoom(patch: {
    name?: string;
    topic?: string;
    visibility?: RoomVisibility;
  }): Promise<void>;
  deleteRoom(): Promise<void>;
  leaveRoom(): Promise<boolean>;
  deleteMessage(messageId: string): Promise<void>;
  editMessage(messageId: string, content: string): Promise<void>;
  searchMessages(query: string): Promise<Message[]>;
  jumpToMessage(message: Message): Promise<void>;
  setTyping(typing: boolean): void;
  loadOlder(beforeSeq: number): Promise<Message[]>;
  markRead(): void;
  setRole(member: Member, role: Role): Promise<void>;
  removeMember(member: Member): Promise<void>;
  approveJoinRequest(requestId: string): Promise<void>;
  denyJoinRequest(requestId: string): Promise<void>;
  refreshRoom(): Promise<void>;
  openMyProfile(): void;
  copy(text: string, label: string): void;
  notify(message: string): void;
}
