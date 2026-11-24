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
export type MissionPhase = 'frame' | 'explore' | 'decide' | 'build' | 'review' | 'shipped';
export type DecisionMethod = 'admin' | 'consent' | 'majority' | 'quorum';
export type DecisionStatus = 'open' | 'decided' | 'withdrawn';
export type QuestionStatus = 'open' | 'resolved' | 'parked';
export type WorkspaceTab = 'mission' | 'people' | 'tasks' | 'repos' | 'activity';
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
  parentRoomId: string | null;
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
  capabilities: string[];
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
  parentRoomId: string | null;
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

export interface Mission {
  roomId: string;
  objective: string;
  successCriteria: string;
  constraints: string;
  phase: MissionPhase;
  decisionMode: DecisionMethod;
  quorum: number;
  createdByType: PrincipalType;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface MissionQuestion {
  id: string;
  roomId: string;
  title: string;
  detail: string;
  status: QuestionStatus;
  ownerType: PrincipalType | null;
  ownerId: string | null;
  ownerName: string | null;
  createdByType: PrincipalType;
  createdById: string;
  createdByName: string;
  resolution: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface DecisionOption {
  id: string;
  label: string;
}

export interface DecisionVote {
  voterType: PrincipalType;
  voterId: string;
  voterName: string;
  choice: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionTally {
  votes: number;
  support: number;
  consent: number;
  objection: number;
  abstain: number;
  byOption: Record<string, number>;
  leadingOptionId: string | null;
  quorumMet: boolean;
  ready: boolean;
}

export interface Decision {
  id: string;
  roomId: string;
  title: string;
  context: string;
  method: DecisionMethod;
  quorum: number;
  status: DecisionStatus;
  options: DecisionOption[];
  votes: DecisionVote[];
  tally: DecisionTally;
  dependencies: DecisionDependency[];
  dueAt: string | null;
  createdByType: PrincipalType;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  decidedOptionId: string | null;
  decidedOptionLabel: string | null;
  rationale: string;
  decidedByType: PrincipalType | null;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface DecisionDependency {
  decisionId: string;
  roomId: string;
  roomName: string;
  roomCode?: string;
  title: string;
  status: DecisionStatus;
  decidedOptionLabel: string | null;
}

export interface RelatedDecision {
  id: string;
  roomId: string;
  roomName: string;
  roomCode?: string;
  title: string;
  method: DecisionMethod;
  status: DecisionStatus;
  decidedOptionLabel: string | null;
  dueAt: string | null;
}

export interface FamilyParent {
  id: string;
  name: string;
  topic: string;
  code?: string;
  phase: MissionPhase;
  objective: string;
  decisionMode: DecisionMethod;
  quorum: number;
}

export interface WorkstreamSummary {
  id: string;
  name: string;
  topic: string;
  code?: string;
  phase: MissionPhase;
  objective: string;
  openQuestions: number;
  openDecisions: number;
  blockedDecisions: number;
  memberCount: number;
  updatedAt: string;
}

export interface MissionPatch {
  objective?: string;
  successCriteria?: string;
  constraints?: string;
  phase?: MissionPhase;
  decisionMode?: DecisionMethod;
  quorum?: number;
}

export interface QuestionInput {
  title: string;
  detail: string;
  ownerType?: PrincipalType | null;
  ownerId?: string | null;
}

export interface QuestionPatch {
  title?: string;
  detail?: string;
  status?: QuestionStatus;
  ownerType?: PrincipalType | null;
  ownerId?: string | null;
  resolution?: string;
}

export interface DecisionInput {
  title: string;
  context: string;
  method?: DecisionMethod;
  quorum?: number;
  options: string[];
  dueAt?: string | null;
  notifyAgents?: boolean;
  dependsOn?: { roomId: string; decisionId: string }[];
}

export interface DecisionCloseInput {
  status: 'decided' | 'withdrawn';
  optionId?: string | null;
  rationale?: string;
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
  mission: Mission;
  questions: MissionQuestion[];
  decisions: Decision[];
  parent: FamilyParent | null;
  workstreams: WorkstreamSummary[];
  relatedDecisions: RelatedDecision[];
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
  visibility?: RoomVisibility;
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

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'warning' | 'info';
}

export interface RoomActions {
  confirm(options: ConfirmOptions): Promise<boolean>;
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
  updateMission(patch: MissionPatch): Promise<void>;
  createQuestion(input: QuestionInput): Promise<void>;
  updateQuestion(questionId: string, patch: QuestionPatch): Promise<void>;
  deleteQuestion(questionId: string): Promise<void>;
  createDecision(input: DecisionInput): Promise<void>;
  voteDecision(decisionId: string, choice: string, comment?: string): Promise<void>;
  closeDecision(decisionId: string, input: DecisionCloseInput): Promise<void>;
  createWorkstream(input: {
    name: string;
    topic: string;
    objective: string;
  }): Promise<WorkstreamSummary>;
  openRoom(roomId: string): void;
  refreshRoom(): Promise<void>;
  openMyProfile(): void;
  copy(text: string, label: string): void;
  notify(message: string): void;
}
