import type { ReactNode } from 'react';
import type {
  PrincipalType,
  RoomActions,
  RoomState,
  WorkspacePanelIntent,
  WorkspaceTab,
} from '../lib/types';
import { ActivityIcon, BranchIcon, CheckIcon, UsersIcon } from './Icons';
import { LiveFeed } from './LiveFeed';
import { TasksPanel } from './TasksPanel';
import { ReposPanel } from './ReposPanel';
import { PeoplePanel } from './PeoplePanel';

export type PanelTab = WorkspaceTab;

interface RightPanelProps {
  state: RoomState;
  actions: RoomActions;
  tab: PanelTab;
  intent: WorkspacePanelIntent | null;
  intentNonce: number;
  onTabChange: (tab: PanelTab) => void;
  onOpenProfile: (type: PrincipalType, id: string) => void;
}

export function RightPanel({
  state,
  actions,
  tab,
  intent,
  intentNonce,
  onTabChange,
  onOpenProfile,
}: RightPanelProps) {
  const openTasks = state.tasks.filter((task) => task.status !== 'done').length;
  const isCode = state.room.mode === 'code';
  const pendingRequests = state.me.role === 'admin' ? state.joinRequests?.length ?? 0 : 0;

  const tabs: { id: PanelTab; label: string; icon: ReactNode; count: number | null }[] = [
    { id: 'people', label: 'People', icon: <UsersIcon size={13} />, count: state.members.length },
    { id: 'tasks', label: 'Tasks', icon: <CheckIcon size={13} />, count: openTasks },
    ...(isCode
      ? [{ id: 'repos' as PanelTab, label: 'Repos', icon: <BranchIcon size={13} />, count: state.repos.length }]
      : []),
    { id: 'activity', label: 'Activity', icon: <ActivityIcon size={13} />, count: null },
  ];
  const activeTab = tabs.some((candidate) => candidate.id === tab) ? tab : 'people';

  return (
    <aside className="right-panel">
      <div className="tabs" role="tablist" aria-label="Workspace panels">
        {tabs.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={activeTab === candidate.id}
            aria-label={
              candidate.id === 'people' && pendingRequests > 0
                ? `People, ${pendingRequests} join request${pendingRequests === 1 ? '' : 's'} waiting`
                : undefined
            }
            className={`tab ${activeTab === candidate.id ? 'active' : ''}`}
            onClick={() => onTabChange(candidate.id)}
          >
            <span className="tab-icon">{candidate.icon}</span>
            {candidate.label}
            {candidate.count !== null && candidate.count > 0 ? (
              <span className="tab-count">{candidate.count}</span>
            ) : null}
            {candidate.id === 'people' && pendingRequests > 0 ? (
              <span className="tab-alert" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === 'people' ? (
        <PeoplePanel
          state={state}
          actions={actions}
          onOpenProfile={onOpenProfile}
          openFormNonce={intent === 'new-agent' ? intentNonce : undefined}
        />
      ) : null}
      {activeTab === 'tasks' ? (
        <TasksPanel
          state={state}
          actions={actions}
          onOpenProfile={onOpenProfile}
          openFormNonce={intent === 'new-task' ? intentNonce : undefined}
        />
      ) : null}
      {activeTab === 'repos' ? <ReposPanel state={state} actions={actions} /> : null}
      {activeTab === 'activity' ? (
        <LiveFeed state={state} actions={actions} onOpenProfile={onOpenProfile} />
      ) : null}
    </aside>
  );
}
