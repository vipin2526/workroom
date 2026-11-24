import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { profilePath } from '../lib/profile';
import { clearSession, readSession } from '../lib/session';
import type { JoinState, RoomPreview, Session } from '../lib/types';
import {
  ArrowUpRightIcon,
  BranchIcon,
  CheckIcon,
  CopyIcon,
  HashIcon,
  ShieldIcon,
  TerminalIcon,
  UsersIcon,
} from './Icons';
import { Avatar } from './Avatar';
import { LinkifyText } from './LinkifyText';
import App from '../App';

interface RoomLandingProps {
  code: string;
}

function LandingFooter() {
  return (
    <footer className="landing-foot">
      <a className="landing-foot-brand" href="/">
        <span className="brand-glyph">◆</span> RoomForge
      </a>
      <nav aria-label="RoomForge pages">
        <a href="/room">Public rooms</a>
        <a href="/agent-guide">Agent guide</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </nav>
    </footer>
  );
}

export function RoomLanding({ code }: RoomLandingProps) {
  const [session, setSession] = useState<Session | null>(readSession);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [join, setJoin] = useState<JoinState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = `Room ${code} — RoomForge`;
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    api
      .previewRoom(code)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof Error ? err.message : 'Could not load this room');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!session) {
      setJoin(null);
      return;
    }
    let cancelled = false;
    api
      .joinStatus(code)
      .then((data) => {
        if (!cancelled) setJoin(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          setSession(null);
          setError('Your session expired. Sign in again to request access.');
        } else if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, code]);

  useEffect(() => {
    if (!session || !preview || join?.status === 'member') return;
    let cancelled = false;
    api
      .joinRoom(code)
      .then((data: JoinState) => {
        if (!cancelled && data.status === 'member') {
          setJoin(data);
        }
      })
      .catch(() => {
        // ignore error
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, join?.status, code]);

  /* Once approved, refresh the preview so the member list includes the new member. */
  const prevJoinStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = join?.status ?? null;
    const justApproved = status === 'member' && prevJoinStatus.current !== 'member';
    prevJoinStatus.current = status;
    if (!justApproved) return;
    let cancelled = false;
    api
      .previewRoom(code)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        // the old preview is still usable
      });
    return () => {
      cancelled = true;
    };
  }, [join?.status, code]);

  /* While a request is pending the page polls until an admin decides. */
  useEffect(() => {
    if (!session || join?.status !== 'pending') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      api
        .joinStatus(code)
        .then((data: JoinState) => {
          if (!cancelled) setJoin(data);
        })
        .catch(() => {
          // keep waiting; a transient poll failure is not a status change
        });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.user.id, join?.status, code]);

  async function requestAccess() {
    setRequesting(true);
    setError(null);
    try {
      const data = await api.requestJoin(code);
      setJoin(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        setSession(null);
        setError('Your session expired. Sign in again to request access.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not send the request');
      }
    } finally {
      setRequesting(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      const data = await api.joinStatus(code);
      setJoin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the request');
    } finally {
      setChecking(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('Could not access the clipboard');
    }
  }

  const nextPath = encodeURIComponent(`/room/${code}`);
  const signInHref = `/login?next=${nextPath}`;
  const signUpHref = `/signup?next=${nextPath}`;
  const agentCommand = `${window.location.origin}/api/agent/join/${code}?name=YOUR_NAME`;
  const isMember = join?.status === 'member';
  const openRoomHref = `/room/${code}`;
  const modeIsCode = preview?.room.mode === 'code';

  if (isMember) {
    return <App initialCode={code} />;
  }

  if (notFound) {
    return (
      <div className="landing">
        <header className="landing-head">
          <a className="brand" href="/">
            <span className="brand-glyph">◆</span>
            <span className="brand-name">RoomForge</span>
          </a>
          <a className="btn btn-ghost btn-small" href="/">
            Go home
          </a>
        </header>
        <div className="landing-center">
          <div className="landing-card landing-notfound">
            <h1>Room not found</h1>
            <p>
              No room matches <code>{code}</code>. Check the link or ask an admin for a fresh one.
            </p>
            <a className="btn btn-primary" href="/">
              Back to RoomForge
            </a>
          </div>
        </div>
        <LandingFooter />
      </div>
    );
  }

  return (
    <div className="landing">
      <header className="landing-head">
        <a className="brand" href="/">
          <span className="brand-glyph">◆</span>
          <span className="brand-name">RoomForge</span>
        </a>
        <div className="landing-head-actions">
          <a className="btn btn-quiet btn-small" href="/room">
            All rooms
          </a>
          <a className="btn btn-quiet btn-small" href="/agent-guide">
            <TerminalIcon size={13} /> Agent guide
          </a>
          {session ? (
            <a className="btn btn-ghost btn-small" href="/">
              Open app
            </a>
          ) : (
            <a className="btn btn-ghost btn-small" href={signInHref}>
              Sign in <ArrowUpRightIcon size={12} />
            </a>
          )}
        </div>
      </header>

      {preview ? (
        <main className="landing-main">
          <section className="landing-room">
            <div className="landing-room-head">
              <span className="landing-eyebrow">
                <ShieldIcon size={13} /> Public room preview
              </span>
              <h1>{preview.room.name}</h1>
              <p className="landing-topic">
                <LinkifyText text={preview.room.topic || 'No topic set for this room.'} />
              </p>
              <div className="landing-meta">
                <span className={`mode-badge mode-${preview.room.mode}`}>
                  {modeIsCode ? <BranchIcon size={12} /> : <HashIcon size={12} />}
                  {modeIsCode ? 'Code room' : 'Chat room'}
                </span>
                <span className="landing-meta-item">
                  <UsersIcon size={13} /> {preview.room.memberCount}{' '}
                  {preview.room.memberCount === 1 ? 'member' : 'members'}
                </span>
                <span className="landing-code">ROOM {preview.room.code}</span>
              </div>
            </div>

            <div className="landing-members">
              <span className="section-label">People in the room</span>
              <div className="landing-member-grid">
                {preview.members.map((member) => {
                  const href = profilePath(member.type, member.handle);
                  const card = (
                    <>
                      <Avatar
                        name={member.name}
                        type={member.type}
                        avatar={member.avatar}
                        iconSize={15}
                      />
                      <div>
                        <strong>{member.name}</strong>
                        <span>
                          {member.type === 'agent' ? 'Agent' : 'Human'} · {member.role}
                        </span>
                      </div>
                      {href ? <ArrowUpRightIcon size={12} /> : null}
                    </>
                  );
                  return href ? (
                    <a
                      className="landing-member landing-member-link"
                      href={href}
                      key={`${member.type}-${member.name}`}
                      title={`Open ${member.name}'s public profile`}
                    >
                      {card}
                    </a>
                  ) : (
                    <div className="landing-member" key={`${member.type}-${member.name}`}>
                      {card}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="landing-agents">
              <div className="landing-agents-head">
                <TerminalIcon size={15} />
                <strong>Joining as an agent?</strong>
              </div>
              <p>
                Agents skip accounts entirely. One GET opens a pending socket; when an admin
                approves it, the same socket becomes the live room connection and returns the
                credentials.
              </p>
              <div className="landing-command">
                <code>{agentCommand}</code>
                <button
                  type="button"
                  className="icon-btn"
                  title="Copy agent join link"
                  aria-label="Copy agent join link"
                  onClick={() => copy(agentCommand, 'agent')}
                >
                  {copied === 'agent' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>
              <a className="landing-inline-link" href="/agent-guide">
                Full agent guide <ArrowUpRightIcon size={12} />
              </a>
            </div>
          </section>

          <aside className="landing-side">
            <div className="landing-card">
              {isMember ? (
                <>
                  <span className="landing-card-icon ok">
                    <CheckIcon size={20} />
                  </span>
                  <h2>You&apos;re in this room</h2>
                  <p>
                    Your membership is active as <strong>{join?.membership?.role}</strong>. The
                    room opens with live chat, tasks, and presence.
                  </p>
                  <a className="btn btn-primary btn-block" href={openRoomHref}>
                    Open room <ArrowUpRightIcon size={13} />
                  </a>
                </>
              ) : join?.status === 'pending' ? (
                <>
                  <span className="landing-card-icon pending">
                    <span className="landing-pulse" />
                  </span>
                  <h2>Waiting for an admin</h2>
                  <p>
                    Your request to join <strong>{preview.room.name}</strong> is in. This page
                    checks every few seconds; it unlocks the moment an admin approves.
                  </p>
                  <div className="landing-status-row">
                    <span className="tag tag-amber">Pending approval</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-tiny"
                      onClick={checkNow}
                      disabled={checking}
                    >
                      {checking ? 'Checking…' : 'Check now'}
                    </button>
                  </div>
                  {join.request ? (
                    <p className="landing-stamp">
                      Requested {new Date(join.request.createdAt).toLocaleString()}
                    </p>
                  ) : null}
                </>
              ) : session ? (
                <>
                  <span className="landing-card-icon">
                    <UsersIcon size={20} />
                  </span>
                  <h2>{preview.approvalRequired ? 'Request to join' : 'Enter room'}</h2>
                  <p>
                    {preview.approvalRequired
                      ? join?.status === 'denied'
                        ? 'Your last request was declined. You can ask the admins again.'
                        : 'This room is approval-only. Send a request and an admin will let you in.'
                      : 'This is a public room. You can enter to view messages, tasks, and live activity.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={async () => {
                      if (!preview.approvalRequired) {
                        try {
                          const res = await api.joinRoom(code);
                          if (res.status === 'member') setJoin(res);
                        } catch {
                          void requestAccess();
                        }
                      } else {
                        void requestAccess();
                      }
                    }}
                    disabled={requesting}
                  >
                    {requesting ? 'Connecting…' : preview.approvalRequired ? 'Request access' : 'Enter room'}
                  </button>
                  <p className="landing-stamp">Signed in as {session.user.name}</p>
                </>
              ) : (
                <>
                  <span className="landing-card-icon">
                    <ShieldIcon size={20} />
                  </span>
                  <h2>{preview.approvalRequired ? 'Sign in to join' : 'Sign in to enter'}</h2>
                  <p>
                    {preview.approvalRequired
                      ? 'Anyone with this link can preview the room. To chat and collaborate, sign in and request access.'
                      : 'Anyone can join and view this public room. Sign in to enter and follow the room live.'}
                  </p>
                  <a className="btn btn-primary btn-block" href={signInHref}>
                    {preview.approvalRequired ? 'Sign in and request access' : 'Sign in to enter room'}
                  </a>
                  <a className="btn btn-quiet btn-block" href={signUpHref}>
                    Create an account
                  </a>
                </>
              )}

              {error ? <p className="form-error">{error}</p> : null}
            </div>

            <div className="landing-note">
              <ShieldIcon size={14} />
              <p>
                {preview.approvalRequired
                  ? 'Messages stay private until an admin admits you. The preview shows only the room name, topic, and member list.'
                  : 'This room is public. Anyone can join and see what is going on, but access is required for chat.'}
              </p>
            </div>
          </aside>
        </main>
      ) : (
        <div className="landing-center">
          {error ? (
            <div className="landing-card landing-notfound">
              <h1>Could not load the room</h1>
              <p>{error}</p>
              <a className="btn btn-primary" href="/">
                Back to RoomForge
              </a>
            </div>
          ) : (
            <div className="landing-loading">Loading room preview…</div>
          )}
        </div>
      )}
      <LandingFooter />
    </div>
  );
}
