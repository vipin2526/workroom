import { useState } from 'react';
import type { FormEvent } from 'react';
import type { RoomActions, RoomState, RoomVisibility } from '../lib/types';
import { Modal } from './Modal';
import { CopyIcon, GlobeIcon, HashIcon, TrashIcon } from './Icons';

interface RoomSettingsDialogProps {
  state: RoomState;
  actions: RoomActions;
  onClose: () => void;
}

export function RoomSettingsDialog({ state, actions, onClose }: RoomSettingsDialogProps) {
  const isAdmin = state.me.role === 'admin';
  const [name, setName] = useState(state.room.name);
  const [topic, setTopic] = useState(state.room.topic);
  const [visibility, setVisibility] = useState<RoomVisibility>(state.room.visibility ?? 'public');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<'leave' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roomUrl = state.room.code ? `${window.location.origin}/room/${state.room.code}` : '';
  const canLeave = true;
  const dirty =
    name.trim() !== state.room.name ||
    topic.trim() !== state.room.topic ||
    visibility !== (state.room.visibility ?? 'public');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Add a room name');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await actions.updateRoom({ name: name.trim(), topic: topic.trim(), visibility });
      actions.notify('Room settings saved');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the room settings');
    } finally {
      setSaving(false);
    }
  }

  async function leaveRoom() {
    setBusy('leave');
    setError(null);
    try {
      const left = await actions.leaveRoom();
      if (left) onClose();
      else setBusy(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave the room');
      setBusy(null);
    }
  }

  async function deleteRoom() {
    const ok = await actions.confirm({
      title: `Delete “${state.room.name}”?`,
      message: 'This will permanently remove messages, tasks, repos, and agent keys for everyone. This cannot be undone.',
      confirmText: 'Delete Room Forever',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('delete');
    setError(null);
    try {
      await actions.deleteRoom();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the room');
      setBusy(null);
    }
  }

  return (
    <Modal
      title="Room settings"
      subtitle={
        isAdmin
          ? 'Control how this room appears and what happens to it.'
          : 'Room details, sharing link, and your membership.'
      }
      onClose={onClose}
    >
      <div className="settings">
        {isAdmin ? (
          <form className="settings-form" onSubmit={save}>
            <label className="field">
              <span>Room name</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                required
              />
            </label>
            <label className="field">
              <span>Topic</span>
              <input
                className="input"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="What is this room working on?"
                maxLength={200}
              />
            </label>
            <div className="settings-visibility">
              <span className="section-label">Visibility</span>
              <label className={`settings-option ${visibility === 'public' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="room-visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                <GlobeIcon size={16} />
                <div>
                  <strong>Public</strong>
                  <span>Listed in Discover. Anyone can preview it and request to join.</span>
                </div>
              </label>
              <label className={`settings-option ${visibility === 'unlisted' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="room-visibility"
                  value="unlisted"
                  checked={visibility === 'unlisted'}
                  onChange={() => setVisibility('unlisted')}
                />
                <HashIcon size={16} />
                <div>
                  <strong>Unlisted</strong>
                  <span>Hidden from Discover. Only people with the link or code can find it.</span>
                </div>
              </label>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !dirty || !name.trim()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : (
          <p className="settings-note">
            Only room admins can change the name, topic, or visibility. You can still share the
            room link below.
          </p>
        )}

        {roomUrl ? (
          <div className="settings-share">
            <span className="section-label">Invite link</span>
            <div className="settings-share-row">
              <a className="share-link" href={roomUrl} target="_blank" rel="noreferrer">
                <code>{roomUrl}</code>
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => actions.copy(roomUrl, 'Room link')}
              >
                <CopyIcon size={13} /> Copy
              </button>
            </div>
            <span className="settings-hint">
              {state.room.visibility === 'unlisted'
                ? 'This room is unlisted — the link is the only way in.'
                : 'This room is public, so it also appears in Discover.'}
            </span>
          </div>
        ) : null}

        <div className="settings-danger">
          <span className="section-label">Membership</span>
          <p className="settings-hint">
            Leaving removes this room from your sidebar and returns you to the rooms page.
          </p>
          <div className="settings-danger-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!canLeave || busy !== null}
              onClick={leaveRoom}
            >
              {busy === 'leave' ? 'Leaving…' : 'Leave room'}
            </button>
            {isAdmin ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy !== null}
                onClick={deleteRoom}
              >
                <TrashIcon size={14} /> {busy === 'delete' ? 'Deleting…' : 'Delete room'}
              </button>
            ) : null}
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
