import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader, type RoomsHeaderProfile, type SiteNavKey } from './SiteHeader';

interface SitePageProps {
  active?: SiteNavKey;
  roomsProfile?: RoomsHeaderProfile;
  children: ReactNode;
}

export function SitePage({ active, roomsProfile, children }: SitePageProps) {
  return (
    <div className="site-page">
      <SiteHeader active={active} roomsProfile={roomsProfile} />
      {children}
      <SiteFooter />
    </div>
  );
}
