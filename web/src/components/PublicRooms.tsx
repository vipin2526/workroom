import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { profilePath } from '../lib/profile';
import { usePageMeta } from '../lib/meta';
import { readSession } from '../lib/session';
import type { PublicRoom, RoomMode } from '../lib/types';
import { Avatar } from './Avatar';
import { LinkifyText } from './LinkifyText';
import { SitePage } from './SitePage';
import {
  ArrowUpRightIcon,
  BranchIcon,
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  HashIcon,
  SearchIcon,
  ShieldIcon,
  UsersIcon,
} from './Icons';

export function PublicRoomsPage() {
  usePageMeta(
    'Rooms Directory — RoomForge',
    'Browse public and private rooms, preview members, or jump straight to a room with its code.',
  );

  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | RoomMode>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');

  const [session] = useState(readSession);
  const [profileHref, setProfileHref] = useState<string | null>(() =>
    session?.user.handle ? profilePath('user', session.user.handle) : null,
  );

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRooms = () => {
    setLoading(true);
    setError(null);
    api
      .publicRooms()
      .then((data) => {
        setRooms(data.rooms);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load rooms');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadRooms();
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api
      .myProfile()
      .then(({ profile }) => {
        if (!cancelled && profile.type === 'user') {
          setProfileHref(profilePath('user', profile.handle));
        }
      })
      .catch(() => {
        // The cached session handle is a fine fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  const publicCount = useMemo(() => rooms.filter((r) => (r.visibility ?? 'public') === 'public').length, [rooms]);
  const privateCount = useMemo(() => rooms.filter((r) => r.visibility === 'unlisted').length, [rooms]);
  const codeCount = useMemo(() => rooms.filter((r) => r.mode === 'code').length, [rooms]);
  const chatCount = useMemo(() => rooms.filter((r) => r.mode === 'chat').length, [rooms]);

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms.filter((r) => {
      const isPriv = r.visibility === 'unlisted';
      if (visibilityFilter === 'public' && isPriv) return false;
      if (visibilityFilter === 'private' && !isPriv) return false;
      const matchesMode = modeFilter === 'all' || r.mode === modeFilter;
      if (!matchesMode) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.topic && r.topic.toLowerCase().includes(q))
      );
    });
  }, [rooms, search, modeFilter, visibilityFilter]);

  function copyCode(code: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedCode(null), 1800);
    });
  }

  return (
    <SitePage
      active="rooms"
      roomsProfile={
        session
          ? {
              name: session.user.name,
              avatar: session.user.avatar,
              href: profileHref,
            }
          : undefined
      }
    >
      <main className="site-main">
        <div className="directory-main">
          <div className="directory-hero directory-hero-row">
            <h1>Rooms Directory</h1>
            <p className="directory-hero-note">Browse all public and private rooms.</p>
          </div>

        {/* Filters & Search Toolbar */}
        <div className="directory-toolbar">
          <div className="directory-search-box">
            <SearchIcon size={16} />
            <input
              type="text"
              placeholder="Search rooms by name, topic, or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button
                type="button"
                className="btn-clear-search"
                onClick={() => setSearch('')}
                title="Clear search"
                aria-label="Clear search"
              >
                ✕
              </button>
            ) : null}
          </div>

          <div className="directory-filter-tabs">
            <button
              type="button"
              className={`filter-tab ${modeFilter === 'all' && visibilityFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setModeFilter('all');
                setVisibilityFilter('all');
              }}
            >
              All ({rooms.length})
            </button>
            <button
              type="button"
              className={`filter-tab ${visibilityFilter === 'public' ? 'active' : ''}`}
              onClick={() => {
                setVisibilityFilter(visibilityFilter === 'public' ? 'all' : 'public');
              }}
            >
              <GlobeIcon size={13} /> Public ({publicCount})
            </button>
            <button
              type="button"
              className={`filter-tab ${visibilityFilter === 'private' ? 'active' : ''}`}
              onClick={() => {
                setVisibilityFilter(visibilityFilter === 'private' ? 'all' : 'private');
              }}
            >
              <ShieldIcon size={13} /> Private ({privateCount})
            </button>
            <button
              type="button"
              className={`filter-tab ${modeFilter === 'code' ? 'active' : ''}`}
              onClick={() => {
                setModeFilter(modeFilter === 'code' ? 'all' : 'code');
              }}
            >
              <BranchIcon size={13} /> Code ({codeCount})
            </button>
            <button
              type="button"
              className={`filter-tab ${modeFilter === 'chat' ? 'active' : ''}`}
              onClick={() => {
                setModeFilter(modeFilter === 'chat' ? 'all' : 'chat');
              }}
            >
              <HashIcon size={13} /> Chat ({chatCount})
            </button>
          </div>
        </div>

        {/* Content State: Loading, Error, Empty, or List */}
        {loading ? (
          <div className="directory-grid-loading">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
        ) : error ? (
          <div className="landing-card landing-notfound directory-error-card">
            <h2>Could not load rooms</h2>
            <p>{error}</p>
            <button type="button" className="btn btn-primary" onClick={loadRooms}>
              Retry
            </button>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="directory-empty-card">
            <div className="empty-glyph">◆</div>
            <h3>{search ? 'No matching rooms found' : 'No public rooms yet'}</h3>
            <p>
              {search
                ? `No room matches "${search}". Try searching by another keyword or code.`
                : 'Create the first room and share its 5-digit code with collaborators and agents.'}
            </p>
            {search ? (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  setSearch('');
                  setModeFilter('all');
                }}
              >
                Reset filters
              </button>
            ) : (
              <a className="btn btn-primary btn-small" href="/">
                Create a room
              </a>
            )}
          </div>
        ) : (
          <div className="directory-grid">
            {filteredRooms.map((room) => {
              const isCodeMode = room.mode === 'code';
              const roomUrl = `/room/${room.code}`;
              const previews = room.memberPreviews ?? [];
              const hiddenMembers = Math.max(room.memberCount - previews.length, 0);
              return (
                <div
                  key={room.code}
                  className="directory-card"
                  onClick={() => window.location.assign(roomUrl)}
                >
                  <div className="directory-card-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`mode-badge mode-${room.mode}`}>
                        {isCodeMode ? <BranchIcon size={12} /> : <HashIcon size={12} />}
                        {isCodeMode ? 'Code room' : 'Chat room'}
                      </span>
                      {room.visibility === 'unlisted' ? (
                        <span className="tag tag-gray" title="Private room">
                          <ShieldIcon size={11} /> Private
                        </span>
                      ) : (
                        <span className="tag tag-teal" title="Public room">
                          <GlobeIcon size={11} /> Public
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="room-code-tag"
                      title="Click to copy code"
                      aria-label={`Copy room code ${room.code}`}
                      onClick={(e) => copyCode(room.code, e)}
                    >
                      <span className="code-text">{room.code}</span>
                      {copiedCode === room.code ? (
                        <CheckIcon size={12} />
                      ) : (
                        <CopyIcon size={12} />
                      )}
                    </button>
                  </div>

                  <h2 className="directory-card-title">
                    <a href={roomUrl} onClick={(e) => e.stopPropagation()}>
                      {room.name}
                    </a>
                  </h2>

                  <p className="directory-card-topic">
                    <LinkifyText
                      text={room.topic || 'No topic description provided.'}
                      stopPropagation
                    />
                  </p>

                  <div className="directory-card-foot">
                    <div className="directory-card-members">
                      {previews.length > 0 ? (
                        <div className="directory-avatar-stack" aria-hidden="true">
                          {previews.map((member, index) => (
                            <Avatar
                              key={`${member.type}-${member.name}-${index}`}
                              name={member.name}
                              type={member.type}
                              avatar={member.avatar}
                              iconSize={11}
                              className="avatar-sm"
                            />
                          ))}
                          {hiddenMembers > 0 ? (
                            <span className="directory-avatar-more">+{hiddenMembers}</span>
                          ) : null}
                        </div>
                      ) : (
                        <UsersIcon size={13} />
                      )}
                      <span>
                        {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
                      </span>
                    </div>

                    <a
                      href={roomUrl}
                      className="btn btn-ghost btn-tiny directory-enter-btn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Enter <ArrowUpRightIcon size={12} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Routing & Integration Info Box */}
        <div className="directory-info-box">
          <div className="info-item">
            <span className="info-num">1</span>
            <div>
              <strong>Instant five-character routes</strong>
              <p>
                Every room is reachable directly at <code>/room/:code</code> (for example,{' '}
                <code>/room/A7K2Q</code>).
              </p>
            </div>
          </div>
          <div className="info-item">
            <span className="info-num">2</span>
            <div>
              <strong>People &amp; Teams</strong>
              <p>
                Sign in, preview member rosters, and request membership. Admins approve requests in
                real-time.
              </p>
            </div>
          </div>
          <div className="info-item">
            <span className="info-num">3</span>
            <div>
              <strong>Autonomous Agents</strong>
              <p>
                Agents join with zero setup using <code>/api/agent/join/:code?name=AgentName</code>.
              </p>
            </div>
          </div>
        </div>
        </div>
      </main>
    </SitePage>
  );
}
