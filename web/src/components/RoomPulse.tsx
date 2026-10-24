import type { RoomState, WorkspacePanelIntent, WorkspaceTab } from '../lib/types';
import { BellIcon, BotIcon, CheckIcon, PlusIcon, UsersIcon } from './Icons';

interface RoomPulseProps {
  state: RoomState;
  connected: boolean;
  onOpenPanel: (tab: WorkspaceTab, intent?: WorkspacePanelIntent) => void;
}

const LIVE_STATUSES = new Set(['online', 'working', 'reviewing', 'waking', 'idle']);

export function RoomPulse({ state, connected, onOpenPanel }: RoomPulseProps) {
  const presenceById = new Map(
    state.presence.map((entry) => [`${entry.type}:${entry.id}`, entry]),
  );
  const people = state.members.filter((member) => member.type === 'user').length;
  const agents = state.members.filter((member) => member.type === 'agent');
  const liveAgents = agents.filter((agent) => {
    const status = presenceById.get(`agent:${agent.id}`)?.status;
    return status ? LIVE_STATUSES.has(status) : false;
  }).length;
  const openTasks = state.tasks.filter((task) => task.status !== 'done').length;
  const inProgress = state.tasks.filter((task) => task.status === 'doing').length;
  const isViewer = state.me.role === 'viewer';
  const isAdmin = state.me.role === 'admin';
  const pendingRequests = isAdmin ? state.joinRequests?.length ?? 0 : 0;

  return (
    <div className="room-pulse" aria-label="Room status and quick actions">
      <span
        className={`pulse-conn ${connected ? 'on' : 'off'}`}
        title={connected ? 'Realtime connection is live' : 'Reconnecting to the room'}
      >
        <i aria-hidden="true" />
        <span className="pulse-conn-label">{connected ? 'Live' : 'Reconnecting'}</span>
      </span>

      <div className="pulse-chips">
        <button
          type="button"
          className="pulse-chip"
          title="Open people and agents"
          onClick={() => onOpenPanel('people')}
        >
          <UsersIcon size={13} />
          <span className="pulse-chip-label">People</span>
          <b>{people}</b>
        </button>
        <button
          type="button"
          className="pulse-chip pulse-chip-agents"
          title={`Open agents · ${liveAgents} live now`}
          onClick={() => onOpenPanel('people')}
        >
          <BotIcon size={13} />
          <span className="pulse-chip-label">Agents</span>
          <b>{agents.length}</b>
          {agents.length > 0 ? <em>{liveAgents} live</em> : null}
        </button>
        <button
          type="button"
          className="pulse-chip pulse-chip-work"
          title="Open tasks"
          onClick={() => onOpenPanel('tasks')}
        >
          <CheckIcon size={13} />
          <span className="pulse-chip-label">Work</span>
          <b>{openTasks}</b>
          {openTasks > 0 ? <em>{inProgress} in progress</em> : null}
        </button>
        {pendingRequests > 0 ? (
          <button
            type="button"
            className="pulse-chip pulse-chip-alert"
            title="Review join requests"
            onClick={() => onOpenPanel('people')}
          >
            <BellIcon size={13} />
            <span className="pulse-chip-label">Requests</span>
            <b>{pendingRequests}</b>
          </button>
        ) : null}
      </div>

      <div className="pulse-actions">
        {!isViewer ? (
          <button
            type="button"
            className="pulse-action pulse-action-task"
            title="Create a task"
            onClick={() => onOpenPanel('tasks', 'new-task')}
          >
            <PlusIcon size={13} />
            <span>New task</span>
          </button>
        ) : null}
        {isAdmin ? (
          <button
            type="button"
            className="pulse-action pulse-action-agent"
            title="Add an agent to this room"
            onClick={() => onOpenPanel('people', 'new-agent')}
          >
            <BotIcon size={13} />
            <span>Add agent</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
