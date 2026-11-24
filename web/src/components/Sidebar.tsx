import { useState } from 'react';
import { presenceMeta, roleMeta } from '../lib/format';
import type {
  PrincipalType,
  RoomState,
  RoomSummary,
  SessionUser,
  WorkspaceTab,
} from '../lib/types';
import { Avatar } from './Avatar';
import { LinkifyText } from './LinkifyText';
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BranchIcon,
  ChatIcon,
  CheckIcon,
  CopyIcon,
  HashIcon,
  PencilIcon,
  PlusIcon,
  TerminalIcon,
  UsersIcon,
  XIcon,
} from './Icons';

interface SidebarProps {
  rooms: RoomSummary[];
  activeId: string | null;
  state: RoomState | null;
  user: SessionUser;
  connected: boolean;
  open: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenMemberProfile: (type: PrincipalType, id: string) => void;
  onOpenPanel: (tab: WorkspaceTab) => void;
  onSelect: (roomId: string) => void;
  onNewRoom: () => void;
  onJoinRoom: () => void;
  onLeaveRoom: () => void;
  onLogout: () => void;
  onNotice: (message: string) => void;
}

export function Sidebar({
  rooms,
  activeId,
  state,
  user,
  connected,
  open,
  onClose,
  onOpenProfile,
  onOpenMemberProfile,
  onOpenPanel,
  onSelect,
  onNewRoom,
  onJoinRoom,
  onLeaveRoom,
  onLogout,
  onNotice,
}: SidebarProps) {
  const [inviteCopied, setInviteCopied] = useState(false);
  const activeRoom = state?.room ?? rooms.find((room) => room.id === activeId) ?? null;
  const summary = rooms.find((room) => room.id === activeId) ?? null;
  const isCode = activeRoom?.mode === 'code';
  const members = state?.members ?? [];
  const presenceByPrincipal = new Map(
    (state?.presence ?? []).map((entry) => [`${entry.type}:${entry.id}`, entry]),
  );
  const openTasks = state?.tasks.filter((task) => task.status !== 'done').length ?? 0;
  const repoCount = state?.repos.length ?? 0;
  const role = summary?.role ?? (state?.me.role as RoomSummary['role'] | undefined);

  async function copyInvite() {
    if (!activeRoom?.code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${activeRoom.code}`);
      setInviteCopied(true);
      onNotice('Room link copied');
      window.setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      onNotice('Could not access the clipboard');
    }
  }

  function openTool(tab: WorkspaceTab) {
    onClose();
    onOpenPanel(tab);
  }

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} id="app-sidebar">
      <div className="brand">
        <span className="brand-glyph">◆</span>
        <div>
          <div className="brand-name">RoomForge</div>
          <div className="brand-sub">humans + agents</div>
        </div>
        <button
          type="button"
          className="icon-btn sidebar-close"
          aria-label="Close room menu"
          onClick={onClose}
        >
          <XIcon size={16} />
        </button>
      </div>

      <div className="sidebar-scroll">
        {activeRoom ? (
          <>
            <section className="sidebar-room-card">
              <div className="sidebar-room-eyebrow">
                <span className={`room-icon room-icon-${activeRoom.mode}`}>
                  {isCode ? <BranchIcon size={14} /> : <HashIcon size={14} />}
                </span>
                <span>{isCode ? 'Code room' : 'Chat room'}</span>
                {role ? (
                  <span className={`tag tag-${roleMeta[role].tone}`}>{roleMeta[role].label}</span>
                ) : null}
              </div>
              <h2 className="sidebar-room-name">{activeRoom.name}</h2>
              <p className="sidebar-room-topic">
                <LinkifyText text={activeRoom.topic || 'No topic set for this room yet.'} />
              </p>
              <div className="sidebar-room-meta">
                <span>
                  <UsersIcon size={11} />
                  {members.length || summary?.memberCount || 0}
                </span>
                {state ? (
                  <span>
                    <ChatIcon size={11} />
                    {state.messages.length}
                  </span>
                ) : null}
                {isCode ? (
                  <span>
                    <BranchIcon size={11} />
                    {repoCount}
                  </span>
                ) : null}
                <span className={`sidebar-live ${connected ? 'on' : 'off'}`}>
                  <i aria-hidden="true" />
                  {connected ? 'Live' : 'Reconnecting'}
                </span>
              </div>
              <div className="sidebar-room-actions">
                {activeRoom.code ? (
                  <button type="button" className="btn btn-primary btn-small" onClick={copyInvite}>
                    {inviteCopied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                    {inviteCopied ? 'Copied' : 'Invite'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-quiet btn-small sidebar-leave-btn"
                  onClick={onLeaveRoom}
                  title="Leave this room and return to the rooms page (access and admin role are kept)"
                >
                  <ArrowLeftIcon size={13} /> Leave
                </button>
              </div>
            </section>

            <section className="sidebar-tools">
              <div className="sidebar-section">
                <span className="section-label">Room tools</span>
              </div>
              <div className="sidebar-tool-grid">
                <button type="button" onClick={() => openTool('people')}>
                  <UsersIcon size={14} />
                  <span>People</span>
                  <b>{members.length}</b>
                </button>
                <button type="button" onClick={() => openTool('tasks')}>
                  <CheckIcon size={14} />
                  <span>Tasks</span>
                  <b>{openTasks}</b>
                </button>
                {isCode ? (
                  <button type="button" onClick={() => openTool('repos')}>
                    <BranchIcon size={14} />
                    <span>Repos</span>
                    <b>{repoCount}</b>
                  </button>
                ) : null}
                <button type="button" onClick={() => openTool('activity')}>
                  <ActivityIcon size={14} />
                  <span>Activity</span>
                </button>
              </div>
            </section>

            <section className="sidebar-people">
              <div className="sidebar-section">
                <span className="section-label">In this room</span>
                <button
                  type="button"
                  className="sidebar-link"
                  onClick={() => openTool('people')}
                >
                  See all
                </button>
              </div>
              <div className="sidebar-people-list">
                {members.slice(0, 5).map((member) => {
                  const isMe = state?.me.type === member.type && state?.me.id === member.id;
                  const presence = presenceByPrincipal.get(`${member.type}:${member.id}`);
                  const meta = presence ? presenceMeta[presence.status] : null;
                  return (
                    <button
                      type="button"
                      className="sidebar-person"
                      key={`${member.type}-${member.id}`}
                      onClick={() => {
                        onClose();
                        onOpenMemberProfile(member.type, member.id);
                      }}
                      title={`Open ${member.name}'s profile`}
                    >
                      <span className="sidebar-person-avatar">
                        <Avatar
                          name={member.name}
                          type={member.type}
                          avatar={member.avatar}
                          iconSize={13}
                        />
                        <span
                          className={`member-presence ${meta?.tone ?? 'gray'}`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="sidebar-person-main">
                        <span className="sidebar-person-name">
                          {member.name}
                          {isMe ? <em>you</em> : null}
                        </span>
                        <span className="sidebar-person-sub">
                          {presence?.activity || meta?.label || roleMeta[member.role].label}
                        </span>
                      </span>
                      {member.type === 'agent' ? <span className="tag tag-violet">agent</span> : null}
                    </button>
                  );
                })}
                {members.length > 5 ? (
                  <button
                    type="button"
                    className="sidebar-person sidebar-person-more"
                    onClick={() => openTool('people')}
                  >
                    +{members.length - 5} more · View everyone
                  </button>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <section className="sidebar-room-card sidebar-room-empty">
            <span className="sidebar-room-eyebrow">No room open</span>
            <h2 className="sidebar-room-name">Pick a room</h2>
            <p className="sidebar-room-topic">
              Open a room to see its people, tasks, and activity here.
            </p>
          </section>
        )}

        <details className="sidebar-switcher">
          <summary>
            <span>
              <HashIcon size={13} /> Switch room
            </span>
            <span className="section-count">{rooms.length}</span>
          </summary>
          <div className="sidebar-room-list">
            {rooms.map((room) => {
              const unread = room.unreadCount ?? 0;
              const waiting = room.role === 'admin' ? room.pendingRequests ?? 0 : 0;
              return (
                <button
                  key={room.id}
                  type="button"
                  className={`room-item ${activeId === room.id ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}`}
                  aria-current={activeId === room.id ? 'page' : undefined}
                  aria-label={`${room.name}${unread > 0 ? `, ${unread} unread` : ''}${waiting > 0 ? `, ${waiting} join request${waiting === 1 ? '' : 's'} waiting` : ''}`}
                  onClick={() => {
                    onSelect(room.id);
                    onClose();
                  }}
                >
                  <span className={`room-icon room-icon-${room.mode}`}>
                    {room.mode === 'code' ? <BranchIcon size={14} /> : <HashIcon size={14} />}
                  </span>
                  <span className="room-item-main">
                    <span className="room-item-top">
                      <span className="room-item-name">{room.name}</span>
                      {waiting > 0 ? (
                        <span
                          className="room-pending-dot"
                          title={`${waiting} join request${waiting === 1 ? '' : 's'} waiting`}
                        />
                      ) : null}
                    </span>
                    <span className="room-item-meta">
                      <UsersIcon size={10} /> {room.memberCount} · {room.role}
                    </span>
                  </span>
                  {unread > 0 ? (
                    <span className="room-unread" aria-hidden="true">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {rooms.length === 0 ? (
              <div className="sidebar-empty">
                No rooms yet.
                <span>Create one, or join with an invite code.</span>
              </div>
            ) : null}
            <div className="sidebar-switch-actions">
              <button type="button" onClick={onNewRoom}>
                <PlusIcon size={13} /> New room
              </button>
              <button type="button" onClick={onJoinRoom}>
                Join with code
              </button>
            </div>
          </div>
        </details>

        <div className="sidebar-guides">
          <a className="sidebar-guide" href="/room">
            <HashIcon size={13} />
            <span>Browse public rooms</span>
            <ArrowUpRightIcon size={12} />
          </a>
          <a className="sidebar-guide" href="/agent-guide" target="_blank" rel="noreferrer">
            <TerminalIcon size={13} />
            <span>Agent API guide</span>
            <ArrowUpRightIcon size={12} />
          </a>
        </div>
      </div>

      <div className="sidebar-foot">
        <div className={`conn ${connected ? 'on' : 'off'}`}>
          <span className="conn-dot" />
          {connected ? 'Realtime connected' : 'Reconnecting…'}
        </div>
        <div className="user-row">
          <button
            type="button"
            className="user-chip"
            onClick={onOpenProfile}
            title="Edit your profile and profile picture"
          >
            <Avatar name={user.name} type="user" avatar={user.avatar} iconSize={14} />
            <span className="user-main">
              <span className="user-name">{user.name}</span>
              <span className="user-email">{user.handle ? `@${user.handle}` : user.email}</span>
            </span>
            <span className="user-chip-edit" aria-hidden="true">
              <PencilIcon size={12} />
            </span>
          </button>
          <button type="button" className="btn btn-quiet btn-small" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
