import { useEffect, useRef, useState } from 'react';
import type {
  PrincipalType,
  RoomActions,
  RoomState,
  WorkspacePanelIntent,
  WorkspacePanelRequest,
} from '../lib/types';
import { useRoomVoice } from '../lib/useRoomVoice';
import { presenceMeta } from '../lib/format';
import { Avatar } from './Avatar';
import { ChatPanel } from './ChatPanel';
import { LinkifyText } from './LinkifyText';
import { RightPanel } from './RightPanel';
import type { PanelTab } from './RightPanel';
import { RoomCockpit } from './RoomCockpit';
import { RoomPulse } from './RoomPulse';
import { RoomSettingsDialog } from './RoomSettingsDialog';
import { VoiceStage } from './VoiceStage';
import {
  BranchIcon,
  CopyIcon,
  HashIcon,
  MenuIcon,
  PanelsIcon,
  SlidersIcon,
  UsersIcon,
  XIcon,
} from './Icons';

interface RoomViewProps {
  state: RoomState;
  actions: RoomActions;
  connected: boolean;
  socket: WebSocket | null;
  navOpen: boolean;
  onOpenNav: () => void;
  onOpenMemberProfile: (type: PrincipalType, id: string) => void;
  panelRequest: WorkspacePanelRequest | null;
}

export function RoomView({
  state,
  actions,
  connected,
  socket,
  navOpen,
  onOpenNav,
  onOpenMemberProfile,
  panelRequest,
}: RoomViewProps) {
  const isCode = state.room.mode === 'code';
  const voice = useRoomVoice({
    socket,
    roomId: state.room.id,
    participants: state.voice ?? [],
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('people');
  const [panelIntent, setPanelIntent] = useState<WorkspacePanelIntent | null>(null);
  const [panelIntentNonce, setPanelIntentNonce] = useState(0);
  const pendingRequests = state.me.role === 'admin' ? state.joinRequests ?? [] : [];
  const pendingCount = pendingRequests.length;
  const [alertDismissed, setAlertDismissed] = useState(false);
  const previousPending = useRef(pendingCount);
  const requestNames = pendingRequests.slice(0, 2).map((request) => request.name).join(', ');
  const extraRequests = pendingCount > 2 ? ` +${pendingCount - 2}` : '';
  const presenceByPrincipal = new Map(
    state.presence.map((entry) => [`${entry.type}:${entry.id}`, entry]),
  );
  const headerPeople = state.members.slice(0, 4);
  const extraPeople = Math.max(0, state.members.length - headerPeople.length);

  useEffect(() => {
    setDetailsOpen(false);
    setSettingsOpen(false);
    setPanelIntent(null);
  }, [state.room.id]);

  useEffect(() => {
    if (!panelRequest || panelRequest.roomId !== state.room.id) return;
    setPanelTab(panelRequest.tab);
    setPanelIntent(null);
    setDetailsOpen(true);
  }, [panelRequest, state.room.id]);

  useEffect(() => {
    if (pendingCount > previousPending.current) setAlertDismissed(false);
    previousPending.current = pendingCount;
  }, [pendingCount]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailsOpen(false);
        setPanelIntent(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailsOpen]);

  function openPanel(tab: PanelTab, intent?: WorkspacePanelIntent) {
    setPanelTab(tab);
    setPanelIntent(intent ?? null);
    if (intent) setPanelIntentNonce((nonce) => nonce + 1);
    setDetailsOpen(true);
  }

  function openWorkspace() {
    setPanelIntent(null);
    setDetailsOpen(true);
  }

  function closeWorkspace() {
    setDetailsOpen(false);
    setPanelIntent(null);
  }

  return (
    <div className="room">
      <header className="room-head">
        <button
          type="button"
          className="icon-btn room-nav-btn"
          aria-label="Open rooms menu"
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          onClick={onOpenNav}
        >
          <MenuIcon size={18} />
        </button>
        <div className="room-head-main">
          <div className="room-title-line">
            <span
              className={`room-mark room-mark-${state.room.mode}`}
              title={isCode ? 'Code room' : 'Chat room'}
            >
              {isCode ? <BranchIcon size={14} /> : <HashIcon size={14} />}
              <span className="visually-hidden">{isCode ? 'Code room' : 'Chat room'}</span>
            </span>
            <h1>{state.room.name}</h1>
            {state.room.visibility === 'unlisted' ? (
              <span className="tag tag-gray" title="Hidden from the public room directory">
                unlisted
              </span>
            ) : null}
          </div>
          <p className="room-topic">
            <LinkifyText text={state.room.topic || 'No topic set for this room.'} />
          </p>
        </div>
        <div className="room-head-actions">
          <div className="room-people" role="group" aria-label="People in this room">
            {headerPeople.map((member) => {
              const presence = presenceByPrincipal.get(`${member.type}:${member.id}`);
              const tone = presence ? presenceMeta[presence.status].tone : 'gray';
              return (
                <button
                  type="button"
                  className={`room-person ${member.type === 'agent' ? 'agent' : ''}`}
                  key={`${member.type}-${member.id}`}
                  title={`Open ${member.name}'s profile`}
                  aria-label={`Open ${member.name}'s profile`}
                  onClick={() => onOpenMemberProfile(member.type, member.id)}
                >
                  <Avatar
                    name={member.name}
                    type={member.type}
                    avatar={member.avatar}
                    iconSize={12}
                    className="room-person-avatar"
                  />
                  <span className={`room-person-dot ${tone}`} aria-hidden="true" />
                </button>
              );
            })}
            {extraPeople > 0 ? (
              <button
                type="button"
                className="room-people-more"
                title={`View all ${state.members.length} people`}
                onClick={() => openPanel('people')}
              >
                +{extraPeople}
              </button>
            ) : null}
          </div>
          {state.room.code ? (
            <button
              type="button"
              className="btn btn-ghost btn-small invite-btn"
              aria-label="Copy room link"
              onClick={() =>
                actions.copy(`${window.location.origin}/room/${state.room.code}`, 'Room link')
              }
              title="Copy room link"
            >
              <CopyIcon size={13} />
              <span className="invite-code-small">{state.room.code}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn room-settings-btn"
            aria-label="Room settings"
            title="Room settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SlidersIcon size={16} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small workspace-btn"
            aria-label={
              pendingCount > 0
                ? `Open workspace, ${pendingCount} join request${pendingCount === 1 ? '' : 's'} waiting`
                : 'Open workspace'
            }
            aria-expanded={detailsOpen}
            aria-controls="room-details-panel"
            onClick={openWorkspace}
          >
            <PanelsIcon size={14} />
            <span className="workspace-label">Workspace</span>
            {pendingCount > 0 ? <span className="info-alert-dot" aria-hidden="true" /> : null}
          </button>
        </div>
      </header>

      <RoomPulse state={state} connected={connected} onOpenPanel={openPanel} />

      {pendingCount > 0 && !alertDismissed ? (
        <div className="join-alert" role="status" aria-live="polite">
          <span className="join-alert-icon">
            <UsersIcon size={15} />
          </span>
          <div className="join-alert-text">
            <strong>
              {pendingCount === 1 ? '1 join request waiting' : `${pendingCount} join requests waiting`}
            </strong>
            <span>
              {requestNames}
              {extraRequests} · approve or decline in People
            </span>
          </div>
          <button type="button" className="btn btn-alert btn-tiny" onClick={() => openPanel('people')}>
            Review
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Dismiss join request alert"
            onClick={() => setAlertDismissed(true)}
          >
            <XIcon size={14} />
          </button>
        </div>
      ) : null}

      <div className="room-body">
        <div className="room-main">
          <VoiceStage
            voice={voice}
            participants={state.voice ?? []}
            me={state.me}
            connected={connected}
            onOpenProfile={onOpenMemberProfile}
            emptyContent={
              <RoomCockpit
                state={state}
                connected={connected}
                voice={voice}
                onOpenPanel={openPanel}
                onCopyInvite={() => {
                  if (!state.room.code) return;
                  actions.copy(`${window.location.origin}/room/${state.room.code}`, 'Room link');
                }}
                onOpenMemberProfile={onOpenMemberProfile}
              />
            }
          />
        </div>
        <ChatPanel
          state={state}
          actions={actions}
          key={state.room.id}
          onOpenProfile={onOpenMemberProfile}
        />
      </div>

      {detailsOpen ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close workspace"
          onClick={closeWorkspace}
        />
      ) : null}

      <div className={`room-aside ${detailsOpen ? 'open' : ''}`} id="room-details-panel">
        <div className="room-aside-head">
          <span>Workspace</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close workspace"
            onClick={closeWorkspace}
          >
            <XIcon size={16} />
          </button>
        </div>
        <RightPanel
          state={state}
          actions={actions}
          tab={panelTab}
          intent={panelIntent}
          intentNonce={panelIntentNonce}
          onTabChange={(tab) => {
            setPanelTab(tab);
            setPanelIntent(null);
          }}
          onOpenProfile={onOpenMemberProfile}
        />
      </div>

      {settingsOpen ? (
        <RoomSettingsDialog
          state={state}
          actions={actions}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
