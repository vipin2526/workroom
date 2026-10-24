import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PrincipalType, RoomState, VoiceParticipant } from '../lib/types';
import type { VoiceController } from '../lib/useRoomVoice';
import { avatarSrc } from '../lib/avatars';
import { initial } from '../lib/format';
import {
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  SlidersIcon,
  XIcon,
} from './Icons';

interface VoiceStageProps {
  voice: VoiceController;
  participants: VoiceParticipant[];
  me: RoomState['me'];
  connected: boolean;
  onOpenProfile: (type: PrincipalType, id: string) => void;
  emptyContent?: ReactNode;
}

interface RemoteAudioProps {
  stream: MediaStream;
  deafened: boolean;
  sinkId: string;
}

function RemoteAudio({ stream, deafened, sinkId }: RemoteAudioProps) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    return () => {
      audio.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const audio = ref.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (!audio || !sinkId || typeof audio.setSinkId !== 'function') return;
    void audio.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId]);

  return <audio ref={ref} className="stage-audio" autoPlay playsInline muted={deafened} />;
}

function deviceName(device: MediaDeviceInfo, index: number, kind: 'mic' | 'speaker'): string {
  if (device.label) return device.label;
  return kind === 'mic' ? `Microphone ${index + 1}` : `Speaker ${index + 1}`;
}

function stageDetail(roster: VoiceParticipant[], connected: boolean, viewer: boolean): string {
  if (viewer) return 'Viewers can follow chat and activity, but cannot join the call.';
  if (!connected) return 'Reconnecting to the room before voice can start.';
  if (roster.length === 0) return 'Your mic opens only after you join. Everyone can hop in.';
  const names = roster.map((participant) => participant.name);
  if (names.length === 1) return `${names[0]} is on the stage. Jump in.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are on the stage.`;
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more are on the stage.`;
}

function StagePerson({
  participant,
  isSelf,
  speaking,
  onOpenProfile,
}: {
  participant: VoiceParticipant;
  isSelf: boolean;
  speaking: boolean;
  onOpenProfile: () => void;
}) {
  const silenced = participant.muted || participant.deafened;
  const avatar = avatarSrc(participant.avatar);
  return (
    <div
      className={`stage-person ${speaking ? 'speaking' : ''} ${isSelf ? 'self' : ''}`}
      role="listitem"
      title={`${participant.name}${isSelf ? ' (you)' : ''}${participant.deafened ? ' · deafened' : participant.muted ? ' · muted' : ''}`}
    >
      <button
        type="button"
        className="stage-avatar-wrap"
        title={`Open ${participant.name}'s profile`}
        aria-label={`Open ${participant.name}'s profile`}
        onClick={onOpenProfile}
      >
        <span className={`stage-avatar ${avatar ? 'has-image' : ''}`}>
          {avatar ? <img src={avatar} alt="" /> : initial(participant.name)}
        </span>
        {silenced ? (
          <span className="stage-mute-badge" aria-hidden="true">
            {participant.deafened ? <HeadphonesOffIcon size={10} /> : <MicOffIcon size={10} />}
          </span>
        ) : null}
      </button>
      <button type="button" className="stage-person-name" onClick={onOpenProfile}>
        {participant.name}
        {isSelf ? <em>you</em> : null}
      </button>
      <span className="visually-hidden">
        {speaking ? 'Speaking, ' : ''}
        {participant.deafened ? 'deafened' : participant.muted ? 'muted' : 'connected'}
      </span>
    </div>
  );
}

export function VoiceStage({
  voice,
  participants,
  me,
  connected,
  onOpenProfile,
  emptyContent,
}: VoiceStageProps) {
  const [devicesOpen, setDevicesOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const roster = [...participants].sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
  const selfInRoster = roster.some((participant) => participant.peerId === voice.selfPeerId);
  const displayRoster: VoiceParticipant[] =
    voice.joined && !selfInRoster
      ? [
          {
            peerId: voice.selfPeerId ?? 'self',
            type: me.type,
            id: me.id,
            name: me.name,
            role: me.role,
            ...(me.avatar ? { avatar: me.avatar } : {}),
            muted: voice.muted,
            deafened: voice.deafened,
            joinedAt: '0000',
          },
          ...roster,
        ]
      : roster;
  const participantCount = displayRoster.length;
  const speakingSet = new Set(voice.speaking);
  const anyoneSpeaking = voice.speaking.length > 0;
  const viewer = me.role === 'viewer';
  const empty = participantCount === 0;

  useEffect(() => {
    if (!voice.joined) setDevicesOpen(false);
  }, [voice.joined]);

  useEffect(() => {
    if (!devicesOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setDevicesOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDevicesOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [devicesOpen]);

  const joinDisabled = !connected || voice.connecting || viewer;
  const joinLabel = voice.connecting ? 'Connecting…' : !connected ? 'Reconnecting…' : 'Join voice';

  return (
    <section
      className={`stage ${voice.joined ? 'is-live' : 'is-idle'} ${empty ? 'is-empty' : 'is-occupied'}`}
      aria-label="Room voice"
    >
      <div className="stage-audio-sink" aria-hidden="true">
        {Object.entries(voice.remoteStreams).map(([peerId, stream]) => (
          <RemoteAudio
            key={peerId}
            stream={stream}
            deafened={voice.deafened}
            sinkId={voice.outputDeviceId}
          />
        ))}
      </div>

      <header className="stage-head">
        <div className="stage-title">
          <span className="stage-title-icon">
            <HeadphonesIcon size={14} />
          </span>
          <span className="stage-title-text">Voice stage</span>
          {voice.joined ? (
            <span className="stage-live-pill">
              <span className="stage-pulse" aria-hidden="true" />
              Live
            </span>
          ) : null}
        </div>
        <div className="stage-head-meta">
          {participantCount > 0 ? (
            <>
              <span className="stage-count">
                {participantCount} in the call
              </span>
              <span className="stage-signal" data-active={anyoneSpeaking} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </>
          ) : (
            <span className="stage-muted-label">Open stage</span>
          )}
        </div>
      </header>

      <div
        className={`stage-body ${empty ? 'is-empty' : ''} ${empty && emptyContent ? 'has-cockpit' : ''}`}
      >
        {empty && emptyContent ? (
          emptyContent
        ) : empty ? (
          <div className="stage-empty">
            <span className={`stage-orb ${viewer ? 'dim' : ''}`}>
              <HeadphonesIcon size={30} />
            </span>
            <h2>{viewer ? 'You are watching this room' : 'The stage is quiet'}</h2>
            <p>{stageDetail(roster, connected, viewer)}</p>
            {viewer ? null : (
              <button
                type="button"
                className="stage-join stage-join-hero"
                onClick={voice.join}
                disabled={joinDisabled}
                title={!connected ? 'Reconnecting to the room' : undefined}
              >
                {voice.connecting ? <span className="stage-join-spinner" aria-hidden="true" /> : <MicIcon size={16} />}
                {joinLabel}
              </button>
            )}
          </div>
        ) : (
          <div
            className={`stage-grid ${participantCount <= 4 ? 'few' : ''}`}
            role="list"
            aria-label="People on stage"
          >
            {displayRoster.map((participant) => {
              const isSelf = participant.peerId === voice.selfPeerId;
              return (
                <StagePerson
                  key={participant.peerId}
                  participant={{
                    ...participant,
                    muted: isSelf ? voice.muted : participant.muted,
                    deafened: isSelf ? voice.deafened : participant.deafened,
                  }}
                  isSelf={isSelf}
                  speaking={speakingSet.has(isSelf ? 'self' : participant.peerId)}
                  onOpenProfile={() => onOpenProfile(participant.type, participant.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {voice.error || voice.joined || (!empty && !viewer) ? (
        <footer className="stage-foot">
          {voice.error ? (
            <div className="stage-error" role="alert">
              <span>{voice.error}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Dismiss voice error"
                onClick={voice.clearError}
              >
                <XIcon size={13} />
              </button>
            </div>
          ) : null}

          {voice.joined ? (
            <div className="stage-controls">
              <button
                type="button"
                className={`stage-ctl ${voice.muted ? 'off' : ''}`}
                aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
                aria-pressed={voice.muted}
                title={`${voice.muted ? 'Unmute' : 'Mute'} (Ctrl+Shift+M)`}
                onClick={voice.toggleMute}
              >
                {voice.muted ? <MicOffIcon size={17} /> : <MicIcon size={17} />}
              </button>
              <button
                type="button"
                className={`stage-ctl ${voice.deafened ? 'off' : ''}`}
                aria-label={voice.deafened ? 'Undeafen audio' : 'Deafen audio'}
                aria-pressed={voice.deafened}
                title={voice.deafened ? 'Undeafen' : 'Deafen'}
                onClick={voice.toggleDeafen}
              >
                {voice.deafened ? <HeadphonesOffIcon size={17} /> : <HeadphonesIcon size={17} />}
              </button>
              <div className="stage-devices-wrap" ref={settingsRef}>
                <button
                  type="button"
                  className={`stage-ctl ${devicesOpen ? 'on' : ''}`}
                  aria-label="Voice device settings"
                  aria-expanded={devicesOpen}
                  title="Microphone and speaker"
                  onClick={() => setDevicesOpen((open) => !open)}
                >
                  <SlidersIcon size={17} />
                </button>
                {devicesOpen ? (
                  <div className="stage-devices">
                    <div className="stage-devices-head">
                      <span>Voice settings</span>
                      <span className="stage-devices-note">Mesh · encrypted</span>
                    </div>
                    <label className="stage-device">
                      <span>Microphone</span>
                      <select
                        className="stage-select"
                        value={voice.inputDeviceId}
                        onChange={(event) => voice.selectInputDevice(event.target.value)}
                      >
                        <option value="">Default microphone</option>
                        {voice.inputDevices.map((device, index) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {deviceName(device, index, 'mic')}
                          </option>
                        ))}
                      </select>
                    </label>
                    {voice.canSelectOutput ? (
                      <label className="stage-device">
                        <span>Speaker</span>
                        <select
                          className="stage-select"
                          value={voice.outputDeviceId}
                          onChange={(event) => voice.selectOutputDevice(event.target.value)}
                        >
                          <option value="">System default</option>
                          {voice.outputDevices.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {deviceName(device, index, 'speaker')}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p className="stage-device-note">
                        Speaker selection is available in Chrome and Edge. Audio uses your system
                        output here.
                      </p>
                    )}
                    <p className="stage-device-note">
                      Echo cancellation, noise suppression, and auto gain are on. Audio flows
                      directly between people.
                    </p>
                  </div>
                ) : null}
              </div>
              <span className="stage-ctl-sep" aria-hidden="true" />
              <button type="button" className="stage-leave" onClick={voice.leave} title="Leave voice">
                <PhoneOffIcon size={15} />
                <span>Leave</span>
              </button>
            </div>
          ) : (
            <div className="stage-cta">
              <div className="stage-cta-copy">
                <strong>Join the call</strong>
                <span>{stageDetail(roster, connected, viewer)}</span>
              </div>
              <button
                type="button"
                className="stage-join"
                onClick={voice.join}
                disabled={joinDisabled}
                title={!connected ? 'Reconnecting to the room' : undefined}
              >
                {voice.connecting ? (
                  <span className="stage-join-spinner" aria-hidden="true" />
                ) : (
                  <MicIcon size={16} />
                )}
                {joinLabel}
              </button>
            </div>
          )}
        </footer>
      ) : null}
    </section>
  );
}
