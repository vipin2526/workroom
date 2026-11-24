import { useEffect, useState } from 'react';
import { readSession } from '../lib/session';
import { Avatar } from './Avatar';
import { ArrowUpRightIcon, MenuIcon, XIcon } from './Icons';

export type SiteNavKey = 'features' | 'rooms' | 'agent' | 'about' | 'faq' | 'contact';

export interface RoomsHeaderProfile {
  name: string;
  avatar?: string | null;
  href: string | null;
}

const LINKS: { key: SiteNavKey; label: string; href: string }[] = [
  { key: 'features', label: 'Features', href: '/features' },
  { key: 'rooms', label: 'Rooms', href: '/room' },
  { key: 'agent', label: 'Agent API', href: '/agent-guide' },
  { key: 'about', label: 'About', href: '/about' },
  { key: 'faq', label: 'FAQ', href: '/faq' },
];

export function SiteHeader({
  active,
  roomsProfile,
}: {
  active?: SiteNavKey;
  roomsProfile?: RoomsHeaderProfile;
}) {
  const [session] = useState(readSession);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="site-head">
      <div className="site-head-inner">
        <a className="brand" href="/" aria-label="RoomForge home">
          <span className="brand-glyph">◆</span>
          <span className="brand-name">RoomForge</span>
        </a>

        <nav className="site-nav" aria-label="Primary">
          {LINKS.map((link) => (
            <a
              key={link.key}
              href={link.href}
              className={active === link.key ? 'active' : undefined}
              aria-current={active === link.key ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="site-head-actions">
          {roomsProfile ? (
            <>
              <a className="btn btn-primary btn-small" href="/?create=1">
                Create room
              </a>
              <a
                className="site-profile-chip"
                href={roomsProfile.href ?? '/'}
                title="Your profile"
                aria-label="Your profile"
              >
                <Avatar
                  name={roomsProfile.name}
                  type="user"
                  avatar={roomsProfile.avatar}
                  iconSize={13}
                  className="avatar-sm"
                />
              </a>
            </>
          ) : session ? (
            <a className="btn btn-ghost btn-small" href="/">
              Open app <ArrowUpRightIcon size={12} />
            </a>
          ) : (
            <>
              <a className="btn btn-quiet btn-small" href="/login">
                Sign in
              </a>
              <a className="btn btn-primary btn-small" href="/signup">
                Get started
              </a>
            </>
          )}
        </div>

        <button
          type="button"
          className="site-menu-btn"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <XIcon size={18} /> : <MenuIcon size={18} />}
        </button>
      </div>

      {open ? (
        <div className="site-mobile-panel">
          <nav aria-label="Primary mobile">
            {LINKS.map((link) => (
              <a
                key={link.key}
                href={link.href}
                className={active === link.key ? 'active' : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a href="/contact" className={active === 'contact' ? 'active' : undefined} onClick={() => setOpen(false)}>
              Contact
            </a>
          </nav>
          <div className="site-mobile-actions">
            {roomsProfile ? (
              <>
                <a className="btn btn-primary btn-block" href="/?create=1">
                  Create room
                </a>
                <a className="btn btn-ghost btn-block" href={roomsProfile.href ?? '/'}>
                  Your profile
                </a>
              </>
            ) : session ? (
              <a className="btn btn-primary btn-block" href="/">
                Open app
              </a>
            ) : (
              <>
                <a className="btn btn-primary btn-block" href="/signup">
                  Get started
                </a>
                <a className="btn btn-ghost btn-block" href="/login">
                  Sign in
                </a>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
