import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { PrincipalType, RoomActions, RoomState, Task, TaskStatus } from '../lib/types';
import { parsePaths, taskMeta, timeAgo } from '../lib/format';
import { Avatar } from './Avatar';
import { LinkifyText } from './LinkifyText';
import { BranchIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from './Icons';

interface TasksPanelProps {
  state: RoomState;
  actions: RoomActions;
  onOpenProfile: (type: PrincipalType, id: string) => void;
  openFormNonce?: number;
}

const GROUP_ORDER: TaskStatus[] = ['doing', 'review', 'todo', 'done'];

type TaskFilter = 'all' | 'open' | 'mine' | 'unassigned' | 'done';

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'done', label: 'Done' },
];

function splitPrincipal(value: string): { type: PrincipalType | null; id: string | null } {
  if (!value) return { type: null, id: null };
  const [type, id] = value.split(':');
  return { type: type as PrincipalType, id };
}

export function TasksPanel({
  state,
  actions,
  onOpenProfile,
  openFormNonce,
}: TasksPanelProps) {
  const me = state.me;
  const isAdmin = me.role === 'admin';
  const isViewer = me.role === 'viewer';
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [paths, setPaths] = useState('');
  const [branch, setBranch] = useState('');
  const [repoId, setRepoId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');

  useEffect(() => {
    if (openFormNonce === undefined || isViewer) return;
    setError(null);
    setShowForm(true);
  }, [openFormNonce, isViewer]);

  const needle = query.trim().toLowerCase();
  const visibleTasks = state.tasks.filter((task) => {
    if (filter === 'open' && task.status === 'done') return false;
    if (filter === 'done' && task.status !== 'done') return false;
    if (filter === 'mine' && !(task.assigneeType === me.type && task.assigneeId === me.id)) {
      return false;
    }
    if (filter === 'unassigned' && task.assigneeId) return false;
    if (!needle) return true;
    return [
      task.title,
      task.description,
      task.paths,
      task.branch,
      task.repoName ?? '',
      task.assigneeName ?? '',
      task.createdByName,
    ].some((value) => value.toLowerCase().includes(needle));
  });

  const doingTasks = state.tasks.filter((task) => task.status === 'doing');
  const pathOwners = new Map<string, Set<string>>();
  for (const task of doingTasks) {
    for (const path of parsePaths(task.paths)) {
      const key = path.toLowerCase();
      const owners = pathOwners.get(key) ?? new Set<string>();
      owners.add(task.id);
      pathOwners.set(key, owners);
    }
  }
  const collisions = new Set<string>();
  for (const task of doingTasks) {
    if (parsePaths(task.paths).some((path) => (pathOwners.get(path.toLowerCase())?.size ?? 0) > 1)) {
      collisions.add(task.id);
    }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const principal = splitPrincipal(assignee);
    try {
      await actions.createTask({
        title: title.trim(),
        description: description.trim(),
        paths: paths.trim(),
        branch: branch.trim(),
        repoId: repoId || null,
        assigneeType: principal.type,
        assigneeId: principal.id,
      });
      setTitle('');
      setDescription('');
      setPaths('');
      setBranch('');
      setRepoId('');
      setAssignee('');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the task');
    } finally {
      setBusy(false);
    }
  }

  async function changeTask(task: Task, patch: Parameters<RoomActions['updateTask']>[1]) {
    setError(null);
    try {
      await actions.updateTask(task.id, patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the task');
    }
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete task “${task.title}”?`)) return;
    setError(null);
    try {
      await actions.deleteTask(task.id);
      actions.notify(`Deleted task “${task.title}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the task');
    }
  }

  function reassign(task: Task, value: string) {
    if (!value) {
      changeTask(task, { assigneeType: null, assigneeId: null });
      return;
    }
    const principal = splitPrincipal(value);
    changeTask(task, { assigneeType: principal.type, assigneeId: principal.id });
  }

  return (
    <div className="panel-scroll">
      <div className="panel-heading">
        <span>Tasks</span>
        <div className="panel-heading-actions">
          <span className="section-count">{state.tasks.filter((task) => task.status !== 'done').length} open</span>
          {!isViewer ? (
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              onClick={() => setShowForm((value) => !value)}
            >
              {showForm ? <XIcon size={13} /> : <PlusIcon size={13} />}
              {showForm ? 'Close' : 'New task'}
            </button>
          ) : null}
        </div>
      </div>

      {state.tasks.length > 0 ? (
        <div className="task-toolbar">
          <div className="task-search">
            <SearchIcon size={13} />
            <input
              className="task-search-input"
              value={query}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <XIcon size={11} />
              </button>
            ) : null}
          </div>
          <div className="filter-chips" role="group" aria-label="Filter tasks">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`filter-chip ${filter === option.value ? 'active' : ''}`}
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {showForm ? (
        <form className="inline-form" onSubmit={createTask}>
          <div className="field">
            <span>Title</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ship the auth flow"
              required
            />
          </div>
          <div className="field">
            <span>Description</span>
            <textarea
              className="textarea"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What needs to happen, and how will we know it's done?"
            />
          </div>
          <div className="field-row">
            <label className="field">
              <span>Assignee</span>
              <select className="select" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">Unassigned</option>
                {state.members.map((member) => (
                  <option key={`${member.type}:${member.id}`} value={`${member.type}:${member.id}`}>
                    {member.name}{member.type === 'agent' ? ' (agent)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {state.room.mode === 'code' ? (
              <label className="field">
                <span>Repo</span>
                <select className="select" value={repoId} onChange={(event) => setRepoId(event.target.value)}>
                  <option value="">No repo</option>
                  {state.repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="field-row">
            <label className="field">
              <span>Branch</span>
              <input
                className="input"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="feat/auth"
              />
            </label>
            <label className="field">
              <span>Files / paths</span>
              <input
                className="input"
                value={paths}
                onChange={(event) => setPaths(event.target.value)}
                placeholder="src/auth.ts, src/api.ts"
              />
            </label>
          </div>
          <button type="submit" className="btn btn-primary btn-small" disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </form>
      ) : null}

      {state.tasks.length === 0 ? (
        <p className="panel-empty">
          No tasks yet. Create one and assign it to a person or an agent — the room sees status changes live.
        </p>
      ) : visibleTasks.length === 0 ? (
        <p className="panel-empty">
          No tasks match {needle ? `“${query.trim()}”` : 'this filter'}.{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Clear filters
          </button>
        </p>
      ) : (
        GROUP_ORDER.map((status) => {
          const tasks = visibleTasks.filter((task) => task.status === status);
          if (tasks.length === 0) return null;
          const meta = taskMeta[status];
          return (
            <section className="task-group" key={status}>
              <div className="task-group-head">
                <span className={`status-dot ${meta.tone}`} />
                <span>{meta.label}</span>
                <span className="section-count">{tasks.length}</span>
              </div>
              {tasks.map((task) => {
                const canManage =
                  isAdmin || (task.createdByType === me.type && task.createdById === me.id);
                const isAssignee = task.assigneeType === me.type && task.assigneeId === me.id;
                const canChangeStatus = canManage || isAssignee;
                const canClaim = !task.assigneeId && !isViewer && !canManage;
                const meta = taskMeta[task.status];
                const paths = parsePaths(task.paths);
                const repo = task.repoId
                  ? state.repos.find((entry) => entry.id === task.repoId)
                  : undefined;
                const assigneeMember = state.members.find(
                  (member) => member.type === task.assigneeType && member.id === task.assigneeId,
                );
                return (
                  <article className={`task-card tone-${meta.tone}`} key={task.id}>
                    <div className="task-card-head">
                      <span className={`task-dot ${meta.tone}`} />
                      <h4>{task.title}</h4>
                      {canManage ? (
                        <button
                          type="button"
                          className="task-delete-btn"
                          title="Delete task"
                          aria-label={`Delete task ${task.title}`}
                          onClick={() => deleteTask(task)}
                        >
                          <TrashIcon size={12} />
                        </button>
                      ) : null}
                    </div>
                    <div className="task-meta">
                      {task.repoName ? (
                        repo?.url ? (
                          <a
                            className="chip chip-link"
                            href={repo.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${task.repoName}`}
                          >
                            <BranchIcon size={11} />
                            {task.repoName}{task.branch ? ` @ ${task.branch}` : ''}
                          </a>
                        ) : (
                          <span className="chip">
                            <BranchIcon size={11} />
                            {task.repoName}{task.branch ? ` @ ${task.branch}` : ''}
                          </span>
                        )
                      ) : task.branch ? (
                        <span className="chip">{task.branch}</span>
                      ) : null}
                      <button
                        type="button"
                        className="task-by"
                        title={`Open ${task.createdByName}'s profile`}
                        onClick={() => onOpenProfile(task.createdByType, task.createdById)}
                      >
                        by {task.createdByName}
                      </button>
                      <span>{timeAgo(task.updatedAt)}</span>
                    </div>
                    {task.description ? (
                      <p className="task-desc">
                        <LinkifyText text={task.description} />
                      </p>
                    ) : null}
                    {paths.length > 0 ? (
                      <div className="path-chips">
                        {paths.map((path) => (
                          <span className="path-chip" key={path}>{path}</span>
                        ))}
                      </div>
                    ) : null}
                    {collisions.has(task.id) ? (
                      <div className="collision-note">Path overlap with another in-progress task</div>
                    ) : null}
                    <div className="task-foot">
                      <div className="task-assignee">
                        <span className="mini-label">Assignee</span>
                        {canManage ? (
                          <select
                            className="mini-select"
                            value={task.assigneeType && task.assigneeId ? `${task.assigneeType}:${task.assigneeId}` : ''}
                            onChange={(event) => reassign(task, event.target.value)}
                          >
                            <option value="">Unassigned</option>
                            {state.members.map((member) => (
                              <option key={`${member.type}:${member.id}`} value={`${member.type}:${member.id}`}>
                                {member.name}{member.type === 'agent' ? ' (agent)' : ''}
                              </option>
                            ))}
                          </select>
                        ) : task.assigneeType && task.assigneeId ? (
                          <button
                            type="button"
                            className="assignee-name assignee-name-btn"
                            title={`Open ${task.assigneeName ?? 'assignee'}'s profile`}
                            onClick={() => onOpenProfile(task.assigneeType!, task.assigneeId!)}
                          >
                            <Avatar
                              name={task.assigneeName ?? '?'}
                              type={task.assigneeType}
                              avatar={assigneeMember?.avatar}
                              iconSize={10}
                            />
                            {task.assigneeName}
                          </button>
                        ) : (
                          <span className="assignee-name muted">Unassigned</span>
                        )}
                      </div>
                      <div className="task-status-control">
                        {canChangeStatus ? (
                          <select
                            className={`mini-select status-select tone-${meta.tone}`}
                            value={task.status}
                            onChange={(event) => changeTask(task, { status: event.target.value as TaskStatus })}
                          >
                            {GROUP_ORDER.map((value) => (
                              <option key={value} value={value}>
                                {taskMeta[value].label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`tag tag-${meta.tone}`}>{meta.label}</span>
                        )}
                        {canClaim ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-tiny"
                            onClick={() => changeTask(task, { assigneeType: me.type, assigneeId: me.id, status: 'doing' })}
                          >
                            Claim
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })
      )}
    </div>
  );
}
