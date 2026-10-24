import type {
  PrincipalType,
  RoomState,
  Task,
  WorkspacePanelIntent,
  WorkspaceTab,
} from '../lib/types';
import type { VoiceController } from '../lib/useRoomVoice';
import { presenceMeta, roleMeta, taskMeta } from '../lib/format';
import { Avatar } from './Avatar';
import {
  BotIcon,
  ChatIcon,
  CheckIcon,
  CopyIcon,
  LightbulbIcon,
  MicIcon,
  PanelsIcon,
  PlusIcon,
  TerminalIcon,
  UsersIcon,
} from './Icons';

interface RoomCockpitProps {
  state: RoomState;
  connected: boolean;
  voice: VoiceController;
  onOpenPanel: (tab: WorkspaceTab, intent?: WorkspacePanelIntent) => void;
  onCopyInvite: () => void;
  onOpenMemberProfile: (type: PrincipalType, id: string) => void;
}

const LIVE_STATUSES = new Set(['online', 'working', 'reviewing', 'waking', 'idle']);

function isLiveEntry(status: string | undefined): boolean {
  return status ? LIVE_STATUSES.has(status) : false;
}

function taskOwner(task: Task): string {
  const assignee = task.assigneeName ?? 'Unassigned';
  return task.repoName ? `${assignee} · ${task.repoName}` : assignee;
}

export function RoomCockpit({
  state,
  connected,
  voice,
  onOpenPanel,
  onCopyInvite,
  onOpenMemberProfile,
}: RoomCockpitProps) {
  const presenceById = new Map(
    state.presence.map((entry) => [`${entry.type}:${entry.id}`, entry]),
  );
  const humans = state.members.filter((member) => member.type === 'user');
  const agents = state.members.filter((member) => member.type === 'agent');
  const liveAgents = agents.filter((agent) =>
    isLiveEntry(presenceById.get(`agent:${agent.id}`)?.status),
  ).length;
  const openTasks = state.tasks
    .filter((task) => task.status !== 'done')
    .sort((left, right) => taskMeta[left.status].order - taskMeta[right.status].order);
  const totalTasks = state.tasks.length;
  const doneTasks = totalTasks - openTasks.length;
  const doingTasks = state.tasks.filter((task) => task.status === 'doing').length;
  const reviewTasks = state.tasks.filter((task) => task.status === 'review').length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const isViewer = state.me.role === 'viewer';
  const isAdmin = state.me.role === 'admin';
  const setup = humans.length <= 1 && agents.length === 0 && totalTasks === 0;
  const allClear = totalTasks > 0 && openTasks.length === 0;
  const joinDisabled = !connected || voice.connecting;
  const joinLabel = voice.connecting ? 'Connecting…' : !connected ? 'Reconnecting…' : 'Join voice';

  const title = isViewer
    ? 'You are watching this room'
    : setup
      ? 'Set the room up in three moves'
      : allClear
        ? 'All clear. Plan the next move.'
        : 'Start with voice, or pick up the work.';
  const summaryParts = [
    `${humans.length} ${humans.length === 1 ? 'person' : 'people'}`,
    `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`,
    openTasks.length === 0
      ? 'no open tasks'
      : `${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}`,
  ];
  const summary = isViewer
    ? `${summaryParts.join(' · ')} · read-only access`
    : setup
      ? 'Invite your team, add an agent, and create the first task — this view updates live.'
      : summaryParts.join(' · ');

  return (
    <div className="cockpit">
      <header className="cockpit-head">
        <div className="cockpit-intro">
          <span className="cockpit-eyebrow">
            <i aria-hidden="true" />
            Room cockpit
          </span>
          <h2>{title}</h2>
          <p>{summary}</p>
        </div>
        <div className="cockpit-actions">
          {isViewer ? (
            <button
              type="button"
              className="btn btn-ghost cockpit-view-activity"
              onClick={() => onOpenPanel('activity')}
            >
              <PanelsIcon size={13} />
              View activity
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary cockpit-join"
              onClick={voice.join}
              disabled={joinDisabled}
              title={!connected ? 'Reconnecting to the room' : undefined}
            >
              {voice.connecting ? (
                <span className="stage-join-spinner" aria-hidden="true" />
              ) : (
                <MicIcon size={15} />
              )}
              {joinLabel}
            </button>
          )}
          {state.room.code ? (
            <button
              type="button"
              className="btn btn-ghost cockpit-invite"
              onClick={onCopyInvite}
              title="Copy the room link"
            >
              <CopyIcon size={13} />
              <span>Invite</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="cockpit-grid">
        <section className="cockpit-card cockpit-card-work" aria-label="Open work">
          <header className="cockpit-card-head">
            <span className="cockpit-card-icon green">
              <CheckIcon size={14} />
            </span>
            <div className="cockpit-card-title">
              <h3>Open work</h3>
              <p>
                {doingTasks > 0 || reviewTasks > 0
                  ? `${doingTasks} in progress · ${reviewTasks} in review`
                  : openTasks.length > 0
                    ? 'Waiting to be picked up'
                    : 'Nothing in flight'}
              </p>
            </div>
            <span className="cockpit-card-count">{openTasks.length}</span>
          </header>

          {totalTasks > 0 ? (
            <div className="cockpit-progress-row">
              <span
                className="cockpit-progress"
                role="progressbar"
                aria-label={`${doneTasks} of ${totalTasks} tasks done`}
                aria-valuenow={doneTasks}
                aria-valuemin={0}
                aria-valuemax={totalTasks}
              >
                <i style={{ width: `${progress}%` }} />
              </span>
              <span className="cockpit-progress-label">
                {doneTasks}/{totalTasks} done
              </span>
            </div>
          ) : null}

          {openTasks.length > 0 ? (
            <div className="cockpit-task-list">
              {openTasks.slice(0, 3).map((task) => {
                const meta = taskMeta[task.status];
                return (
                  <button
                    type="button"
                    className="cockpit-task"
                    key={task.id}
                    title={`Open ${task.title} in tasks`}
                    onClick={() => onOpenPanel('tasks')}
                  >
                    <span className={`tone-dot ${meta.tone}`} aria-hidden="true" />
                    <span className="cockpit-task-main">
                      <strong>{task.title}</strong>
                      <small>{taskOwner(task)}</small>
                    </span>
                    <span className={`cockpit-task-status ${meta.tone}`}>{meta.label}</span>
                  </button>
                );
              })}
              {openTasks.length > 3 ? (
                <button
                  type="button"
                  className="cockpit-more cockpit-more-link"
                  onClick={() => onOpenPanel('tasks')}
                >
                  +{openTasks.length - 3} more open task
                  {openTasks.length - 3 === 1 ? '' : 's'}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="cockpit-empty">
              {totalTasks > 0
                ? 'Everything is done. Start the next task when the room is ready.'
                : isViewer
                  ? 'No tasks are tracked in this room yet.'
                  : 'Nothing in flight. Create the first task and assign it to a person or an agent.'}
            </p>
          )}

          <footer className="cockpit-foot">
            {!isViewer ? (
              <button
                type="button"
                className="cockpit-link"
                onClick={() => onOpenPanel('tasks', 'new-task')}
              >
                <PlusIcon size={11} /> New task
              </button>
            ) : null}
            <button type="button" className="cockpit-link" onClick={() => onOpenPanel('tasks')}>
              All tasks <span aria-hidden="true">→</span>
            </button>
          </footer>
        </section>

        <section className="cockpit-card" aria-label="People">
          <header className="cockpit-card-head">
            <span className="cockpit-card-icon blue">
              <UsersIcon size={14} />
            </span>
            <div className="cockpit-card-title">
              <h3>People</h3>
              <p>{humans.length <= 1 ? 'Just you so far' : `${humans.length} in the room`}</p>
            </div>
            <span className="cockpit-card-count">{humans.length}</span>
          </header>

          {humans.length > 0 ? (
            <div className="cockpit-list">
              {humans.slice(0, 4).map((human) => {
                const entry = presenceById.get(`user:${human.id}`);
                const meta = presenceMeta[entry?.status ?? 'offline'];
                const isMe = human.type === state.me.type && human.id === state.me.id;
                return (
                  <button
                    type="button"
                    className="cockpit-row"
                    key={human.id}
                    title={`Open ${human.name}'s profile`}
                    onClick={() => onOpenMemberProfile('user', human.id)}
                  >
                    <span className="cockpit-avatar">
                      <Avatar name={human.name} type="user" avatar={human.avatar} iconSize={11} />
                      <i className={`tone-dot ${meta.tone}`} aria-hidden="true" />
                    </span>
                    <span className="cockpit-row-main">
                      <strong>
                        {human.name}
                        {isMe ? <em>you</em> : null}
                      </strong>
                      <small>
                        {entry?.activity || `${meta.label} · ${roleMeta[human.role].label}`}
                      </small>
                    </span>
                  </button>
                );
              })}
              {humans.length > 4 ? (
                <p className="cockpit-more">+{humans.length - 4} more people</p>
              ) : null}
            </div>
          ) : (
            <p className="cockpit-empty">
              No one has joined yet. Share the room link to bring the team in.
            </p>
          )}

          <footer className="cockpit-foot">
            <button type="button" className="cockpit-link" onClick={() => onOpenPanel('people')}>
              All people <span aria-hidden="true">→</span>
            </button>
            {humans.length <= 1 && state.room.code ? (
              <button type="button" className="cockpit-link accent" onClick={onCopyInvite}>
                <CopyIcon size={11} /> Copy invite
              </button>
            ) : null}
          </footer>
        </section>

        <section className="cockpit-card" aria-label="Agents">
          <header className="cockpit-card-head">
            <span className="cockpit-card-icon violet">
              <BotIcon size={14} />
            </span>
            <div className="cockpit-card-title">
              <h3>Agents</h3>
              <p>
                {agents.length === 0
                  ? 'No agents yet'
                  : liveAgents > 0
                    ? `${liveAgents} live now`
                    : 'All offline'}
              </p>
            </div>
            <span className="cockpit-card-count">{agents.length}</span>
          </header>

          {agents.length > 0 ? (
            <div className="cockpit-list">
              {agents.slice(0, 3).map((agent) => {
                const entry = presenceById.get(`agent:${agent.id}`);
                const status = entry?.status ?? 'offline';
                const meta = presenceMeta[status];
                return (
                  <button
                    type="button"
                    className="cockpit-row"
                    key={agent.id}
                    title={`Open ${agent.name}'s profile`}
                    onClick={() => onOpenMemberProfile('agent', agent.id)}
                  >
                    <span className="cockpit-avatar">
                      <Avatar
                        name={agent.name}
                        type="agent"
                        avatar={agent.avatar}
                        iconSize={11}
                      />
                      <i className={`tone-dot ${meta.tone}`} aria-hidden="true" />
                    </span>
                    <span className="cockpit-row-main">
                      <strong>{agent.name}</strong>
                      <small>
                        {entry?.activity ||
                          (isLiveEntry(status) ? meta.label : 'Not connected yet')}
                      </small>
                    </span>
                    {entry?.deliveryMode ? (
                      <span className="cockpit-mode">{entry.deliveryMode}</span>
                    ) : null}
                  </button>
                );
              })}
              {agents.length > 3 ? (
                <p className="cockpit-more">+{agents.length - 3} more agents</p>
              ) : null}
            </div>
          ) : (
            <p className="cockpit-empty">
              {isAdmin
                ? 'No agents yet. Add one with its own room identity and a clear job.'
                : 'No agents yet. Ask an admin to add one for async or repetitive work.'}
            </p>
          )}

          <footer className="cockpit-foot">
            {isAdmin ? (
              <button
                type="button"
                className="cockpit-link"
                onClick={() => onOpenPanel('people', 'new-agent')}
              >
                <PlusIcon size={11} /> Add agent
              </button>
            ) : null}
            {agents.length > 0 ? (
              <button type="button" className="cockpit-link" onClick={() => onOpenPanel('people')}>
                Agent roster <span aria-hidden="true">→</span>
              </button>
            ) : null}
          </footer>
        </section>
      </div>

      <div className="cockpit-tip">
        <span>
          <ChatIcon size={12} /> Chat is conversation
        </span>
        <span>
          <TerminalIcon size={12} /> Instruction directs agents
        </span>
        <span>
          <LightbulbIcon size={12} /> Suggestion floats an idea
        </span>
      </div>
    </div>
  );
}
