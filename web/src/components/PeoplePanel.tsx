import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateAgentResult,
  DeliveryMode,
  JoinRequest,
  Member,
  PrincipalType,
  Role,
  RoomActions,
  RoomState,
  TriggerTestResult,
} from '../lib/types';
import { initial, presenceMeta, roleMeta } from '../lib/format';
import { profilePath } from '../lib/profile';
import { Avatar } from './Avatar';
import { LinkifyText } from './LinkifyText';
import { Modal } from './Modal';
import { ProfileDialog } from './ProfileDialog';
import {
  ArrowUpRightIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from './Icons';

interface PeoplePanelProps {
  state: RoomState;
  actions: RoomActions;
  onOpenProfile: (type: PrincipalType, id: string) => void;
  openFormNonce?: number;
}

function requestedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PeoplePanel({
  state,
  actions,
  onOpenProfile,
  openFormNonce,
}: PeoplePanelProps) {
  const isAdmin = state.me.role === 'admin';
  const [error, setError] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [agentRole, setAgentRole] = useState<Role>('member');
  const [agentMode, setAgentMode] = useState<DeliveryMode>('socket');
  const [agentTriggerUrl, setAgentTriggerUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateAgentResult | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TriggerTestResult>>({});
  const [rotated, setRotated] = useState<{ agentId: string; secret: string } | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotatedKey, setRotatedKey] = useState<{ agentId: string; token: string } | null>(null);
  const [rotatingKey, setRotatingKey] = useState<string | null>(null);
  const [profileAgent, setProfileAgent] = useState<Member | null>(null);

  useEffect(() => {
    if (openFormNonce === undefined || !isAdmin) return;
    setError(null);
    setAgentOpen(true);
  }, [openFormNonce, isAdmin]);

  const pendingRequests = state.joinRequests ?? [];
  const presenceById = new Map(state.presence.map((entry) => [`${entry.type}:${entry.id}`, entry]));
  const roomUrl = state.room.code
    ? `${window.location.origin}/room/${state.room.code}`
    : '';
  const guideUrl = `${window.location.origin}/agent-guide`;
  const connectUrl = created
    ? `${window.location.origin}/api/agent/connect/${created.token}`
    : '';
  const agentPrompt = created
    ? created.agent.deliveryMode === 'trigger'
      ? `You are the RoomForge agent "${created.agent.name}", a sleeping trigger-mode agent. Start the wake connector with these values (secret shown once):\n\nROOMFORGE_BASE=${window.location.origin}/api\nROOMFORGE_TOKEN=${created.token}\nTRIGGER_SECRET=${created.triggerSecret ?? '<rotate to get one>'}\nAGENT_COMMAND="your-agent-command"\nPORT=8787\n\nYour wake URL is ${created.agent.triggerUrl ?? '<set one with PATCH /agent/me>'}. When someone mentions @${created.agent.name}, RoomForge POSTs a signed wake event; the connector opens the room socket, catches up, replies, then sleeps after IDLE_MS.`
      : `You are the RoomForge agent "${created.agent.name}". Read ${connectUrl} and follow the briefing — open its live WebSocket so messages arrive instantly, then post "I'm connected." to the room.`
    : '';

  function closeAgentModal() {
    setAgentOpen(false);
    setCreated(null);
    setAgentName('');
    setAgentDescription('');
    setAgentRole('member');
    setAgentMode('socket');
    setAgentTriggerUrl('');
    setError(null);
  }

  async function testTrigger(agentId: string) {
    setError(null);
    setTesting(agentId);
    try {
      const result = await actions.testTrigger(agentId);
      setTestResults((prev) => ({ ...prev, [agentId]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not test the trigger');
    } finally {
      setTesting(null);
    }
  }

  async function rotateSecret(agent: Member) {
    if (!window.confirm(`Rotate ${agent.name}'s trigger secret? The old secret stops working immediately.`)) {
      return;
    }
    setError(null);
    setRotating(agent.id);
    try {
      const { triggerSecret } = await actions.rotateTriggerSecret(agent.id);
      setRotated({ agentId: agent.id, secret: triggerSecret });
      setRotatedKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rotate the secret');
    } finally {
      setRotating(null);
    }
  }

  async function rotateKey(agent: Member) {
    if (
      !window.confirm(
        `Rotate ${agent.name}'s connection key? The agent is disconnected immediately and the old key stops working.`,
      )
    ) {
      return;
    }
    setError(null);
    setRotatingKey(agent.id);
    try {
      const { token } = await actions.rotateAgentToken(agent.id);
      setRotatedKey({ agentId: agent.id, token });
      setRotated(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rotate the connection key');
    } finally {
      setRotatingKey(null);
    }
  }

  async function changeRole(member: Member, role: Role) {
    setError(null);
    try {
      await actions.setRole(member, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the role');
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(`Remove ${member.name} from the room?`)) return;
    setError(null);
    try {
      await actions.removeMember(member);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the member');
    }
  }

  async function decide(request: JoinRequest, approve: boolean) {
    setError(null);
    setDeciding(request.id);
    try {
      if (approve) await actions.approveJoinRequest(request.id);
      else await actions.denyJoinRequest(request.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not ${approve ? 'approve' : 'decline'} the request`,
      );
    } finally {
      setDeciding(null);
    }
  }

  async function createAgent(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const result = await actions.createAgent({
        name: agentName.trim(),
        description: agentDescription.trim(),
        role: agentRole,
        deliveryMode: agentMode,
        ...(agentMode === 'trigger' ? { triggerUrl: agentTriggerUrl.trim() } : {}),
      });
      setCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the agent');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="panel-scroll">
      {isAdmin && pendingRequests.length > 0 ? (
        <section className="requests-block">
          <div className="panel-heading">
            <span>Join requests</span>
            <span className="section-count">{pendingRequests.length}</span>
          </div>
          {pendingRequests.map((request) => (
            <div className="request-row" key={request.id}>
              <span className={`avatar ${request.kind === 'agent' ? 'avatar-agent' : ''}`}>
                {request.kind === 'agent' ? <BotIcon size={15} /> : initial(request.name)}
              </span>
              <div className="request-main">
                <div className="member-name">
                  {request.name}
                  <span className={`tag ${request.kind === 'agent' ? 'tag-violet' : 'tag-blue'}`}>
                    {request.kind === 'agent' ? 'agent' : 'human'}
                  </span>
                </div>
                <div className="member-sub">
                  <LinkifyText
                    text={
                      request.description ||
                      (request.kind === 'agent'
                        ? request.deliveryMode === 'trigger'
                          ? 'Wakes when mentioned'
                          : 'Wants a live agent connection'
                        : 'Wants to join this room')
                    }
                  />
                </div>
                {request.kind === 'agent' ? (
                  <div className="request-time">
                    {request.deliveryMode === 'trigger' ? (
                      <>
                        Trigger mode ·{' '}
                        {request.triggerUrl ? (
                          <a
                            className="text-link"
                            href={request.triggerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {request.triggerUrl}
                          </a>
                        ) : (
                          'no URL'
                        )}
                      </>
                    ) : (
                      'Socket mode · holds a live connection'
                    )}
                  </div>
                ) : null}
                <div className="request-time">
                  {request.kind === 'agent'
                    ? 'Socket waiting · connects on approval'
                    : `Requested ${requestedAt(request.createdAt)}`}
                </div>
              </div>
              <div className="request-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-tiny"
                  disabled={deciding === request.id}
                  onClick={() => decide(request, true)}
                >
                  <CheckIcon size={12} /> Approve
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  title={`Decline ${request.name}`}
                  aria-label={`Decline ${request.name}`}
                  disabled={deciding === request.id}
                  onClick={() => decide(request, false)}
                >
                  <XIcon size={14} />
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {state.room.code ? (
        <section className="invite-block">
          <div className="invite-main">
            <span className="section-label">Room link</span>
            <span className="invite-code">{state.room.code}</span>
          </div>
          <p className="invite-hint">
            Share this link. Anyone can preview the room; {isAdmin ? 'you approve' : 'an admin approves'} who joins.
          </p>
          <div className="invite-link-row">
            <a className="share-link" href={roomUrl} target="_blank" rel="noreferrer">
              <code>{roomUrl}</code>
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => actions.copy(roomUrl, 'Room link')}
            >
              <CopyIcon size={13} /> Copy link
            </button>
          </div>
          <div className="room-id-row">
            <span>Room ID</span>
            <code>{state.room.id.slice(0, 8)}…</code>
            <button
              type="button"
              className="icon-btn"
              title="Copy full room ID (for agent scripts)"
              aria-label="Copy full room ID"
              onClick={() => actions.copy(state.room.id, 'Room ID')}
            >
              <CopyIcon size={13} />
            </button>
          </div>
        </section>
      ) : null}

      <div className="panel-heading">
        <span>People &amp; agents</span>
        <div className="panel-heading-actions">
          <span className="section-count">{state.members.length}</span>
          {isAdmin ? (
            <button type="button" className="btn btn-quiet btn-tiny" onClick={() => setAgentOpen(true)}>
              <PlusIcon size={13} /> Add agent
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="member-list">
        {state.members.map((member) => {
          const isMe = member.type === state.me.type && member.id === state.me.id;
          const presence = presenceById.get(`${member.type}:${member.id}`);
          const mode = presence?.deliveryMode ?? 'socket';
          const meta = presence ? presenceMeta[presence.status] : null;
          const testResult = testResults[member.id];
          return (
            <div className="member-block" key={`${member.type}-${member.id}`}>
              <div className="member-row">
                <span className="member-avatar-wrap">
                  <button
                    type="button"
                    className="member-avatar-btn"
                    title={`Open ${member.name}'s profile`}
                    aria-label={`Open ${member.name}'s profile`}
                    onClick={() => onOpenProfile(member.type, member.id)}
                  >
                    <Avatar name={member.name} type={member.type} avatar={member.avatar} />
                  </button>
                  <span
                    className={`member-presence ${meta?.tone ?? 'gray'}`}
                    title={meta?.label ?? 'Offline'}
                    aria-hidden="true"
                  />
                </span>
                <div className="member-main">
                  <div className="member-name">
                    <button
                      type="button"
                      className="member-name-btn"
                      onClick={() => onOpenProfile(member.type, member.id)}
                    >
                      {member.name}
                    </button>
                    {member.handle ? (
                      <a
                        className="member-name-link"
                        href={profilePath(member.type, member.handle) ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open ${member.name}'s public profile page`}
                        aria-label={`Open ${member.name}'s public profile page`}
                      >
                        <ArrowUpRightIcon size={10} />
                      </a>
                    ) : null}
                    {isMe ? <span className="tag tag-gray">you</span> : null}
                    {member.type === 'agent' ? <span className="tag tag-violet">agent</span> : null}
                    {member.type === 'agent' ? <span className="tag tag-gray">{mode}</span> : null}
                  </div>
                  <div className="member-sub">
                    <LinkifyText
                      text={
                        member.description ||
                        (member.type === 'agent'
                          ? 'Connected over the agent API'
                          : `Joined as ${member.role}`)
                      }
                    />
                    {meta ? ` · ${meta.label}` : ''}
                  </div>
                </div>
                {isAdmin && !isMe ? (
                  <div className="member-actions">
                    <select
                      className="mini-select"
                      value={member.role}
                      onChange={(event) => changeRole(member, event.target.value as Role)}
                      aria-label={`Role for ${member.name}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title={`Remove ${member.name}`}
                      aria-label={`Remove ${member.name}`}
                      onClick={() => remove(member)}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                ) : (
                  <span className={`tag tag-${roleMeta[member.role].tone}`}>{roleMeta[member.role].label}</span>
                )}
              </div>

              {isMe && member.type === 'user' ? (
                <div className="agent-wake member-self-edit">
                  <div className="agent-wake-actions">
                    <button
                      type="button"
                      className="btn btn-quiet btn-tiny"
                      onClick={() => actions.openMyProfile()}
                    >
                      <PencilIcon size={12} /> Edit profile &amp; photo
                    </button>
                  </div>
                </div>
              ) : null}

              {isAdmin && member.type === 'agent' ? (
                <div className="agent-wake">
                  <div className="agent-wake-actions">
                    <button
                      type="button"
                      className="btn btn-quiet btn-tiny"
                      onClick={() => setProfileAgent(member)}
                    >
                      <PencilIcon size={12} /> Edit profile
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-tiny"
                      disabled={mode !== 'trigger' || testing === member.id}
                      title={
                        mode === 'trigger'
                          ? `Send a signed ping to ${presence?.name ?? member.name}`
                          : 'This agent uses a permanent socket'
                      }
                      onClick={() => testTrigger(member.id)}
                    >
                      {testing === member.id ? 'Testing…' : 'Test trigger'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-tiny"
                      disabled={rotating === member.id}
                      onClick={() => rotateSecret(member)}
                    >
                      {rotating === member.id ? 'Rotating…' : 'Rotate secret'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-tiny"
                      disabled={rotatingKey === member.id}
                      title="Issue a new API key for this agent"
                      onClick={() => rotateKey(member)}
                    >
                      {rotatingKey === member.id ? 'Rotating…' : 'Rotate key'}
                    </button>
                  </div>
                  {testResult ? (
                    <span className={`agent-wake-result ${testResult.ok ? 'ok' : 'fail'}`}>
                      {testResult.ok
                        ? `Wake OK · ${testResult.status} · ${testResult.ms}ms`
                        : `Failed${testResult.status ? ` · HTTP ${testResult.status}` : ''} · ${testResult.ms}ms${testResult.error ? ` · ${testResult.error}` : ''}`}
                    </span>
                  ) : null}
                  {rotated?.agentId === member.id ? (
                    <div className="token-box agent-wake-secret">
                      <code>{rotated.secret}</code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => actions.copy(rotated.secret, 'Trigger secret')}
                      >
                        <CopyIcon size={14} /> Copy
                      </button>
                    </div>
                  ) : null}
                  {rotatedKey?.agentId === member.id ? (
                    <div className="agent-key-rotated">
                      <span className="agent-wake-result ok">
                        New connection key — shown once. Reconnect {member.name} now.
                      </span>
                      <div className="token-box">
                        <code>{rotatedKey.token}</code>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => actions.copy(rotatedKey.token, 'Connection key')}
                        >
                          <CopyIcon size={14} /> Copy
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {!isAdmin ? (
        <p className="panel-empty">
          Admins assign roles, create agents, and manage repositories. Ask an admin if something needs to change.
        </p>
      ) : null}

      {agentOpen ? (
        <Modal
          title={created ? 'Send this to your agent' : 'Add an agent'}
          subtitle={
            created
              ? 'One line. The agent gets its room, key, and live WebSocket from the link.'
              : 'The agent gets its own room identity, role, and API token.'
          }
          onClose={closeAgentModal}
        >
          {created ? (
            <>
              <div className="agent-created">
                <div className="agent-created-head">
                  <Avatar
                    name={created.agent.name}
                    type="agent"
                    avatar={created.agent.avatar}
                    iconSize={16}
                  />
                  <div>
                    <strong>{created.agent.name}</strong>
                    <span>joined as {created.agent.role}</span>
                  </div>
                </div>

                <div className="connect-prompt">
                  <p>{agentPrompt}</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() => actions.copy(agentPrompt, 'Agent prompt')}
                  >
                    <CopyIcon size={14} /> Copy prompt
                  </button>
                </div>
                <p className="connect-note">
                  Paste it into your agent chat. The link carries the room, key, and live socket,
                  so treat it like a password — removing the agent revokes it instantly.
                </p>

                <div className="handoff-actions">
                  <a className="btn btn-ghost" href={guideUrl} target="_blank" rel="noreferrer">
                    Open guide <ArrowUpRightIcon size={12} />
                  </a>
                </div>

                <details className="agent-more">
                  <summary>Manual connection details</summary>
                  <div className="agent-run">
                    <span className="section-label">Connect link (returns everything)</span>
                    <div className="token-box">
                      <code>{connectUrl}</code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => actions.copy(connectUrl, 'Connect link')}
                      >
                        <CopyIcon size={14} /> Copy link
                      </button>
                    </div>
                  </div>
                  <div className="agent-run">
                    <span className="section-label">Connection key</span>
                    <div className="token-box">
                      <code>{created.token}</code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => actions.copy(created.token, 'Connection key')}
                      >
                        <CopyIcon size={14} /> Copy key
                      </button>
                    </div>
                  </div>
                  {created.triggerSecret ? (
                    <div className="agent-run">
                      <span className="section-label">Trigger secret — shown once</span>
                      <div className="token-box">
                        <code>{created.triggerSecret}</code>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => actions.copy(created.triggerSecret ?? '', 'Trigger secret')}
                        >
                          <CopyIcon size={14} /> Copy
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <p className="hint">
                    If your agent cannot open links, send{' '}
                    <code>Authorization: Bearer &lt;key&gt;</code> to{' '}
                    <code>GET {window.location.origin}/api/me</code> instead.
                  </p>
                </details>
              </div>
              <button type="button" className="btn btn-primary btn-block" onClick={closeAgentModal}>
                Done
              </button>
            </>
          ) : (
            <form className="stack" onSubmit={createAgent}>
              <label className="field">
                <span>Agent name</span>
                <input
                  className="input"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  placeholder="refactor-bot"
                  required
                />
              </label>
              <label className="field">
                <span>Description</span>
                <input
                  className="input"
                  value={agentDescription}
                  onChange={(event) => setAgentDescription(event.target.value)}
                  placeholder="Keeps the API layer tidy"
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select
                  className="select"
                  value={agentRole}
                  onChange={(event) => setAgentRole(event.target.value as Role)}
                >
                  <option value="member">Member — can chat, claim tasks, update presence</option>
                  <option value="viewer">Viewer — read-only</option>
                  <option value="admin">Admin — full room control</option>
                </select>
              </label>
              <label className="field">
                <span>Delivery mode</span>
                <select
                  className="select"
                  value={agentMode}
                  onChange={(event) => setAgentMode(event.target.value as DeliveryMode)}
                >
                  <option value="socket">Socket — agent stays connected 24/7</option>
                  <option value="trigger">Trigger — agent sleeps and wakes on @mention</option>
                </select>
              </label>
              {agentMode === 'trigger' ? (
                <label className="field">
                  <span>Wake URL</span>
                  <input
                    className="input"
                    value={agentTriggerUrl}
                    onChange={(event) => setAgentTriggerUrl(event.target.value)}
                    placeholder="https://your-agent.example.com/wake"
                    required
                  />
                </label>
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={
                  creating || !agentName.trim() || (agentMode === 'trigger' && !agentTriggerUrl.trim())
                }
              >
                {creating ? 'Creating…' : 'Create agent'}
              </button>
            </form>
          )}
        </Modal>
      ) : null}

      {profileAgent ? (
        <ProfileDialog
          mode="agent"
          agentId={profileAgent.id}
          onClose={() => setProfileAgent(null)}
          onSaved={() => {
            void actions.refreshRoom();
          }}
          onNotice={actions.notify}
        />
      ) : null}
    </div>
  );
}
