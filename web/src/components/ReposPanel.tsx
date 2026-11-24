import { useState } from 'react';
import type { FormEvent } from 'react';
import type { RoomActions, RoomState } from '../lib/types';
import { BranchIcon, CopyIcon, PlusIcon, TrashIcon, XIcon } from './Icons';

interface ReposPanelProps {
  state: RoomState;
  actions: RoomActions;
}

export function ReposPanel({ state, actions }: ReposPanelProps) {
  const isAdmin = state.me.role === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addRepo(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await actions.addRepo({ name: name.trim(), url: url.trim(), branch: branch.trim() || 'main' });
      setName('');
      setUrl('');
      setBranch('main');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link the repository');
    } finally {
      setBusy(false);
    }
  }

  async function removeRepo(repoId: string, repoName: string) {
    const ok = await actions.confirm({
      title: `Unlink ${repoName}?`,
      message: 'Tasks will keep their history but will lose the repository link.',
      confirmText: 'Unlink Repository',
      tone: 'warning',
    });
    if (!ok) return;
    setError(null);
    try {
      await actions.deleteRepo(repoId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlink the repository');
    }
  }

  return (
    <div className="panel-scroll">
      <div className="panel-heading">
        <span>Shared repositories</span>
        <div className="panel-heading-actions">
          <span className="section-count">{state.repos.length}</span>
          {isAdmin && state.room.mode === 'code' ? (
            <button type="button" className="btn btn-quiet btn-tiny" onClick={() => setShowForm((value) => !value)}>
              {showForm ? <XIcon size={13} /> : <PlusIcon size={13} />}
              {showForm ? 'Close' : 'Link repo'}
            </button>
          ) : null}
        </div>
      </div>

      {state.room.mode === 'chat' ? (
        <p className="panel-empty">
          This is a chat-only room. It has no shared repositories — tasks and discussion still work normally.
        </p>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {showForm && isAdmin ? (
        <form className="inline-form" onSubmit={addRepo}>
          <div className="field">
            <span>Name</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="web-app"
              required
            />
          </div>
          <div className="field">
            <span>Repository URL</span>
            <input
              className="input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/acme/web-app"
              required
            />
          </div>
          <div className="field">
            <span>Default branch</span>
            <input
              className="input"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-small" disabled={busy || !name.trim() || !url.trim()}>
            {busy ? 'Linking…' : 'Link repository'}
          </button>
        </form>
      ) : null}

      {state.room.mode === 'code' && state.repos.length === 0 ? (
        <p className="panel-empty">
          No repos linked yet.{isAdmin ? ' Link one so task scopes and branch names mean something to the room.' : ' Ask an admin to link one.'}
        </p>
      ) : null}

      <div className="repo-list">
        {state.repos.map((repo) => (
          <article className="repo-card" key={repo.id}>
            <div className="repo-head">
              <span className="repo-icon"><BranchIcon size={14} /></span>
              <div className="repo-main">
                <a className="repo-name" href={repo.url} target="_blank" rel="noreferrer">
                  {repo.name}
                </a>
                <a className="repo-url text-link" href={repo.url} target="_blank" rel="noreferrer">
                  {repo.url}
                </a>
              </div>
            </div>
            <div className="repo-foot">
              <span className="chip">{repo.branch}</span>
              <div className="repo-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Copy repository URL"
                  aria-label={`Copy ${repo.name} URL`}
                  onClick={() => actions.copy(repo.url, 'Repository URL')}
                >
                  <CopyIcon size={14} />
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Unlink repository"
                    aria-label={`Unlink ${repo.name}`}
                    onClick={() => removeRepo(repo.id, repo.name)}
                  >
                    <TrashIcon size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
