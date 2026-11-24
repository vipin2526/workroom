import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api } from './lib/api';
import { clearSession, readSession, saveSession } from './lib/session';
import type {
  Activity,
  CreateAgentResult,
  Decision,
  DecisionCloseInput,
  DecisionInput,
  FamilyParent,
  Member,
  Message,
  MessageKind,
  JoinRequest,
  Mission,
  MissionPatch,
  MissionQuestion,
  PresenceEntry,
  PresenceStatus,
  PrincipalType,
  ProfileTarget,
  QuestionInput,
  QuestionPatch,
  RelatedDecision,
  Role,
  Room,
  RoomActions,
  RoomMode,
  RoomState,
  RoomSummary,
  RoomVisibility,
  Profile,
  Session,
  Task,
  TaskInput,
  TaskPatch,
  VoiceParticipant,
  WorkstreamSummary,
  WorkspacePanelRequest,
  WorkspaceTab,
  ConfirmOptions,
} from './lib/types';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { RoomView } from './components/RoomView';
import { Modal } from './components/Modal';
import { MemberProfileDialog } from './components/MemberProfileDialog';
import { ProfileDialog } from './components/ProfileDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { BranchIcon, GlobeIcon, HashIcon, MenuIcon, PlusIcon } from './components/Icons';
import { showMentionNotification } from './lib/notifications';

function roomTarget(): string | null {
  const pathMatch = window.location.pathname.match(/^\/rooms?\/([A-Za-z0-9]+)/i);
  if (pathMatch && pathMatch[1].toLowerCase() !== 'public' && pathMatch[1].toLowerCase() !== 'all') {
    return pathMatch[1];
  }
  const match = window.location.hash.match(/room=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function appendById<T extends { id: string }>(items: T[], next: T): T[] {
  if (items.some((item) => item.id === next.id)) return items;
  return [...items, next];
}

interface AppProps {
  initialCode?: string;
}

export default function App({ initialCode }: AppProps = {}) {
  const [session, setSession] = useState<Session | null>(readSession);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activeSocket, setActiveSocket] = useState<WebSocket | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(null);
  const [memberProfile, setMemberProfile] = useState<ProfileTarget | null>(null);
  const [panelRequest, setPanelRequest] = useState<WorkspacePanelRequest | null>(null);

  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [roomMode, setRoomMode] = useState<RoomMode>('code');
  const [roomVisibility, setRoomVisibility] = useState<RoomVisibility>('public');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const roomsRef = useRef<RoomSummary[]>([]);
  const roomStateRef = useRef<RoomState | null>(null);
  const lastMarkedRef = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSelected = useRef(false);
  const initialTarget = useRef<string | null>(initialCode ?? roomTarget());

  useEffect(() => {
    activeIdRef.current = activeId;
    lastMarkedRef.current = 0;
  }, [activeId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') !== '1') return;
    setNewRoomOpen(true);
    params.delete('create');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
  }, []);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  /* Sessions persist across profile edits; refresh the cached identity so the
   * sidebar shows the current name and handle after a rename or reload. */
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api
      .me()
      .then(({ principal }) => {
        if (cancelled || !session || principal.type !== 'user') return;
        if (
          principal.name === session.user.name &&
          principal.handle === session.user.handle &&
          principal.avatar === session.user.avatar
        ) {
          return;
        }
        const next: Session = {
          ...session,
          user: {
            ...session.user,
            name: principal.name,
            handle: principal.handle,
            email: principal.email ?? session.user.email,
            ...(principal.avatar ? { avatar: principal.avatar } : {}),
          },
        };
        saveSession(next);
        setSession(next);
      })
      .catch(() => {
        // an expired session is handled by the rooms request
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  /* Signing in from a shared room link returns the visitor to that room page. */
  useEffect(() => {
    if (!session) return;
    const next = new URLSearchParams(window.location.search).get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      window.location.assign(next);
    }
  }, [session?.user.id]);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('editProfile') !== '1') return;
    params.delete('editProfile');
    const query = params.toString();
    window.history.replaceState(null, '', `/${query ? `?${query}` : ''}`);
    setProfileOpen(true);
  }, [session?.user.id]);

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }

  function handleProfileSaved(profile: Profile) {
    if (profile.type === 'user' && session) {
      const next: Session = {
        ...session,
        user: {
          ...session.user,
          name: profile.name,
          handle: profile.handle,
          ...(profile.avatar ? { avatar: profile.avatar } : { avatar: undefined }),
        },
      };
      saveSession(next);
      setSession(next);
    }
    setRoomState((prev) => {
      if (!prev) return prev;
      const isMe = prev.me.type === profile.type && prev.me.id === profile.id;
      return {
        ...prev,
        me: isMe
          ? {
              ...prev.me,
              name: profile.name,
              ...(profile.avatar ? { avatar: profile.avatar } : { avatar: undefined }),
            }
          : prev.me,
        members: prev.members.map((member) =>
          member.type === profile.type && member.id === profile.id
            ? {
                ...member,
                name: profile.name,
                handle: profile.handle,
                headline: profile.headline,
                avatar: profile.avatar,
                description:
                  member.type === 'agent' ? profile.headline || null : member.description,
              }
            : member,
        ),
        voice: prev.voice.map((participant) =>
          participant.type === profile.type && participant.id === profile.id
            ? {
                ...participant,
                name: profile.name,
                ...(profile.avatar ? { avatar: profile.avatar } : {}),
              }
            : participant,
        ),
      };
    });
  }

  function openMemberProfile(type: PrincipalType, id: string) {
    setMemberProfile({ type, id });
  }

  function openWorkspace(tab: WorkspaceTab) {
    if (!roomStateRef.current) return;
    setPanelRequest({
      roomId: roomStateRef.current.room.id,
      tab,
      nonce: Date.now(),
    });
  }

  function handleAuth(next: Session) {
    saveSession(next);
    initialSelected.current = false;
    initialTarget.current = roomTarget();
    setSession(next);
    setRooms([]);
    setRoomsLoaded(false);
    setActiveId(null);
    setRoomState(null);
  }

  function handleLogout() {
    void api.logout().catch(() => {});
    clearSession();
    setSession(null);
    setRooms([]);
    setRoomsLoaded(false);
    setActiveId(null);
    setRoomState(null);
    setConnected(false);
    initialSelected.current = false;
  }

  useEffect(() => {
    if (!session) {
      setRooms([]);
      setRoomsLoaded(false);
      return;
    }
    let cancelled = false;
    setRoomsLoaded(false);
    api
      .rooms()
      .then(({ rooms: list }) => {
        if (!cancelled) setRooms(list);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          handleLogout();
          showNotice('Your session expired. Please sign in again.');
        } else {
          showNotice(error instanceof Error ? error.message : 'Could not load rooms');
        }
      })
      .finally(() => {
        if (!cancelled) setRoomsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session || !roomsLoaded) return;
    if (rooms.length === 0 || initialSelected.current) return;
    initialSelected.current = true;
    const preferred = initialTarget.current;
    if (preferred) {
      const match = rooms.find(
        (room) =>
          (room.code && room.code.toLowerCase() === preferred.toLowerCase()) ||
          room.id === preferred,
      );
      if (match) {
        setActiveId(match.id);
        return;
      }
    }
    setActiveId(rooms[0].id);
  }, [rooms, roomsLoaded, session]);

  useEffect(() => {
    if (activeId && rooms.length > 0) {
      const activeRoom = rooms.find((room) => room.id === activeId);
      const targetUrl = activeRoom?.code ? `/room/${activeRoom.code}` : `/room/${activeId}`;
      if (window.location.pathname !== targetUrl || window.location.hash) {
        window.history.replaceState(null, '', targetUrl);
      }
    }
  }, [activeId, rooms]);

  /* Anything visible in the open room counts as read. The server clamps the
   * sequence, so a stale tab can never mark newer messages as seen. */
  useEffect(() => {
    if (!session || !activeId || !roomState || roomState.room.id !== activeId) return;
    if (document.visibilityState !== 'visible') return;
    const lastSeq = roomState.messages[roomState.messages.length - 1]?.seq ?? 0;
    if (lastSeq <= lastMarkedRef.current) return;
    lastMarkedRef.current = lastSeq;
    api
      .markRead(activeId, lastSeq)
      .then(({ unreadCount }) => {
        setRooms((prev) =>
          prev.map((room) => (room.id === activeId ? { ...room, unreadCount } : room)),
        );
        setRoomState((prev) =>
          prev && prev.room.id === activeId ? { ...prev, unreadCount } : prev,
        );
      })
      .catch(() => {
        lastMarkedRef.current = 0;
      });
  }, [activeId, roomState?.messages, session?.user.id]);

  useEffect(() => {
    if (!session) return;
    const markVisibleRoomRead = () => {
      if (document.visibilityState !== 'visible') return;
      const id = activeIdRef.current;
      const state = roomStateRef.current;
      if (!id || !state || state.room.id !== id) return;
      const lastSeq = state.messages[state.messages.length - 1]?.seq ?? 0;
      if (lastSeq <= lastMarkedRef.current) return;
      lastMarkedRef.current = lastSeq;
      api
        .markRead(id, lastSeq)
        .then(({ unreadCount }) => {
          setRooms((prev) =>
            prev.map((room) => (room.id === id ? { ...room, unreadCount } : room)),
          );
        })
        .catch(() => {
          lastMarkedRef.current = 0;
        });
    };
    document.addEventListener('visibilitychange', markVisibleRoomRead);
    return () => document.removeEventListener('visibilitychange', markVisibleRoomRead);
  }, [session?.user.id]);

  useEffect(() => {
    if (!session) return;
    const unread = rooms.reduce((total, room) => total + (room.unreadCount ?? 0), 0);
    document.title = unread > 0 ? `(${unread}) RoomForge` : 'RoomForge';
  }, [rooms, session]);

  useEffect(() => {
    const handlePopState = () => {
      const target = roomTarget();
      if (!target || !rooms.length) return;
      const match = rooms.find(
        (room) =>
          (room.code && room.code.toLowerCase() === target.toLowerCase()) ||
          room.id === target,
      );
      if (match && match.id !== activeIdRef.current) {
        setActiveId(match.id);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [rooms]);

  useEffect(() => {
    if (!session) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const applyEvent = (payload: Record<string, any>) => {
      const active = activeIdRef.current;

      const notifyMention = (message: Message, roomId: string) => {
        if (document.visibilityState === 'visible' || message.senderType === 'system') return;
        const userId = session?.user.id;
        if (!userId) return;
        if (!message.mentions.some((mention) => mention.type === 'user' && mention.id === userId)) return;
        showMentionNotification({
          sender: message.senderName,
          room: roomsRef.current.find((room) => room.id === roomId)?.name ?? 'room',
          body: message.content,
          onClick: () => {
            if (roomId !== activeIdRef.current) setActiveId(roomId);
          },
        });
      };

      switch (payload.type) {
        case 'ready':
          break;
        case 'room.state':
          if (payload.state?.room?.id === active) {
            setRoomState(payload.state as RoomState);
            setLoadingRoom(false);
          }
          break;
        case 'message.new': {
          const message = payload.message as Message;
          notifyMention(message, String(payload.roomId));
          if (payload.roomId !== active) break;
          setRoomState((prev) => {
            if (!prev || prev.room.id !== payload.roomId) return prev;
            const messages = appendById(prev.messages, message);
            if (messages === prev.messages) return prev;
            messages.sort((left, right) => left.seq - right.seq);
            return { ...prev, messages };
          });
          break;
        }
        case 'message.updated': {
          const message = payload.message as Message;
          setRoomState((prev) =>
            prev && prev.room.id === payload.roomId
              ? {
                  ...prev,
                  messages: prev.messages.map((candidate) =>
                    candidate.id === message.id ? message : candidate,
                  ),
                }
              : prev,
          );
          break;
        }
        case 'message.deleted':
          setRoomState((prev) =>
            prev && prev.room.id === payload.roomId
              ? { ...prev, messages: prev.messages.filter((message) => message.id !== payload.messageId) }
              : prev,
          );
          break;
        case 'room.updated': {
          const room = payload.room as Room;
          if (!room?.id) break;
          setRooms((prev) =>
            prev.map((summary) =>
              summary.id === room.id
                ? {
                    ...summary,
                    name: room.name,
                    topic: room.topic,
                    visibility: room.visibility,
                  }
                : summary,
            ),
          );
          setRoomState((prev) =>
            prev && prev.room.id === room.id ? { ...prev, room: { ...prev.room, ...room } } : prev,
          );
          break;
        }
        case 'room.deleted':
          setRooms((prev) => prev.filter((summary) => summary.id !== payload.roomId));
          if (payload.roomId === activeIdRef.current) {
            setRoomState(null);
            setActiveId(roomsRef.current.find((summary) => summary.id !== payload.roomId)?.id ?? null);
          }
          showNotice(
            String(payload.message ?? `“${payload.name ?? 'This room'}” was deleted.`),
          );
          break;
        case 'room.unread': {
          const viewing =
            payload.roomId === activeIdRef.current && document.visibilityState === 'visible';
          setRooms((prev) =>
            prev.map((summary) =>
              summary.id === payload.roomId
                ? { ...summary, unreadCount: viewing ? 0 : Number(payload.unreadCount ?? 0) }
                : summary,
            ),
          );
          break;
        }
        case 'room.pending':
          setRooms((prev) =>
            prev.map((summary) =>
              summary.id === payload.roomId
                ? { ...summary, pendingRequests: Number(payload.pendingRequests ?? 0) }
                : summary,
            ),
          );
          break;
        case 'presence.update':
          if (payload.roomId !== active) break;
          setRoomState((prev) => (prev ? { ...prev, presence: payload.presence as PresenceEntry[] } : prev));
          break;
        case 'typing.update':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev ? { ...prev, typing: payload.typing as RoomState['typing'] } : prev,
          );
          break;
        case 'voice.participants':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev ? { ...prev, voice: payload.participants as VoiceParticipant[] } : prev,
          );
          break;
        case 'task.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) => {
            if (!prev) return prev;
            const task = payload.task as Task;
            const exists = prev.tasks.some((candidate) => candidate.id === task.id);
            return {
              ...prev,
              tasks: exists
                ? prev.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
                : [...prev.tasks, task],
            };
          });
          break;
        case 'tasks.replaced':
          if (payload.roomId !== active) break;
          setRoomState((prev) => (prev ? { ...prev, tasks: payload.tasks as Task[] } : prev));
          break;
        case 'mission.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev ? { ...prev, mission: payload.mission as Mission } : prev,
          );
          break;
        case 'questions.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev ? { ...prev, questions: payload.questions as MissionQuestion[] } : prev,
          );
          break;
        case 'decisions.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev ? { ...prev, decisions: payload.decisions as Decision[] } : prev,
          );
          break;
        case 'family.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev
              ? {
                  ...prev,
                  parent: payload.parent as FamilyParent | null,
                  workstreams: payload.workstreams as WorkstreamSummary[],
                  relatedDecisions: payload.relatedDecisions as RelatedDecision[],
                }
              : prev,
          );
          break;
        case 'task.deleted':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev
              ? {
                  ...prev,
                  tasks: prev.tasks.filter((t) => t.id !== (payload.taskId as string)),
                }
              : prev,
          );
          break;
        case 'members.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) => {
            if (!prev) return prev;
            const members = payload.members as Member[];
            const mine = members.find(
              (member) => member.type === prev.me.type && member.id === prev.me.id,
            );
            return {
              ...prev,
              members,
              me: mine
                ? {
                    ...prev.me,
                    role: mine.role,
                    name: mine.name,
                    avatar: mine.avatar ?? prev.me.avatar,
                  }
                : prev.me,
            };
          });
          break;
        case 'repos.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) => (prev ? { ...prev, repos: payload.repos } : prev));
          break;
        case 'join.requests.updated':
          if (payload.roomId !== active) break;
          setRoomState((prev) =>
            prev ? { ...prev, joinRequests: payload.requests as JoinRequest[] } : prev,
          );
          break;
        case 'activity.new':
          if (payload.roomId !== active) break;
          setRoomState((prev) => {
            if (!prev) return prev;
            const activity = payload.activity as Activity;
            if (prev.activity.some((event) => event.id === activity.id)) return prev;
            return { ...prev, activity: [activity, ...prev.activity].slice(0, 120) };
          });
          break;
        case 'removed':
          setRooms((prev) => prev.filter((room) => room.id !== payload.roomId));
          if (payload.roomId === activeIdRef.current) {
            setRoomState(null);
            setActiveId(roomsRef.current.find((room) => room.id !== payload.roomId)?.id ?? null);
          }
          showNotice(String(payload.message ?? 'You were removed from the room.'));
          break;
        case 'error':
          showNotice(String(payload.message ?? 'Realtime error'));
          break;
        default:
          break;
      }
    };

    const openSocket = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setActiveSocket(socket);
        const id = activeIdRef.current;
        if (id) socket?.send(JSON.stringify({ type: 'room.join', roomId: id }));
      };

      socket.onmessage = (event) => {
        try {
          applyEvent(JSON.parse(String(event.data)) as Record<string, any>);
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        setConnected(false);
        setActiveSocket(null);
        socketRef.current = null;
        if (!disposed) retryTimer = setTimeout(openSocket, 1600);
      };

      socket.onerror = () => {
        // close handler schedules a retry
      };
    };

    openSocket();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      socketRef.current = null;
      setConnected(false);
      setActiveSocket(null);
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session || !roomsLoaded) return;
    if (!activeId) {
      setRoomState(null);
      setLoadingRoom(false);
      return;
    }

    let cancelled = false;
    setLoadingRoom(true);

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'room.join', roomId: activeId }));
    } else {
      api
        .room(activeId)
        .then((state) => {
          if (!cancelled) {
            setRoomState(state);
            setLoadingRoom(false);
          }
        })
        .catch((error) => {
          if (cancelled) return;
          setLoadingRoom(false);
          showNotice(error instanceof Error ? error.message : 'Could not load the room');
        });
    }

    return () => {
      cancelled = true;
      const current = socketRef.current;
      if (current && current.readyState === WebSocket.OPEN) {
        current.send(JSON.stringify({ type: 'room.leave', roomId: activeId }));
      }
    };
  }, [activeId, session?.user.id, roomsLoaded]);

  async function refreshIfOffline(roomId: string) {
    if (socketRef.current?.readyState === WebSocket.OPEN) return;
    try {
      const state = await api.room(roomId);
      setRoomState(state);
    } catch {
      // the notice from the triggering action is enough
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice(`${label} copied`);
    } catch {
      showNotice('Could not access the clipboard');
    }
  }

  const actions: RoomActions = {
    sendMessage(content: string, kind: MessageKind) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'message.send', roomId, content, kind }));
        return;
      }
      api
        .sendMessage(roomId, content, kind)
        .then((message) => {
          setRoomState((prev) => {
            if (!prev || prev.room.id !== roomId) return prev;
            const messages = appendById(prev.messages, message);
            messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
            return { ...prev, messages };
          });
        })
        .catch((error) => showNotice(error instanceof Error ? error.message : 'Message failed'));
    },

    setPresence(input: {
      status?: PresenceStatus;
      activity?: string;
      taskId?: string | null;
    }) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'presence.set', roomId, ...input }));
        return;
      }
      api
        .setPresence(roomId, input)
        .then(({ presence }) => {
          setRoomState((prev) => (prev ? { ...prev, presence } : prev));
        })
        .catch((error) => showNotice(error instanceof Error ? error.message : 'Presence failed'));
    },

    async createTask(input: TaskInput) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.createTask(roomId, input);
      await refreshIfOffline(roomId);
    },

    async updateTask(taskId: string, patch: TaskPatch) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.updateTask(roomId, taskId, patch);
      await refreshIfOffline(roomId);
    },

    async deleteTask(taskId: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.deleteTask(roomId, taskId);
      await refreshIfOffline(roomId);
    },

    async updateMission(patch: MissionPatch) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.updateMission(roomId, patch);
      await refreshIfOffline(roomId);
    },

    async createQuestion(input: QuestionInput) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.createQuestion(roomId, input);
      await refreshIfOffline(roomId);
    },

    async updateQuestion(questionId: string, patch: QuestionPatch) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.updateQuestion(roomId, questionId, patch);
      await refreshIfOffline(roomId);
    },

    async deleteQuestion(questionId: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.deleteQuestion(roomId, questionId);
      await refreshIfOffline(roomId);
    },

    async createDecision(input: DecisionInput) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.createDecision(roomId, input);
      await refreshIfOffline(roomId);
    },

    async voteDecision(decisionId: string, choice: string, comment = '') {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.voteDecision(roomId, decisionId, choice, comment);
      await refreshIfOffline(roomId);
    },

    async closeDecision(decisionId: string, input: DecisionCloseInput) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.closeDecision(roomId, decisionId, input);
      await refreshIfOffline(roomId);
    },

    async createWorkstream(input) {
      const roomId = activeIdRef.current;
      if (!roomId) throw new Error('No room selected');
      const result = await api.createWorkstream(roomId, input);
      const { rooms: list } = await api.rooms();
      setRooms(list);
      await refreshIfOffline(roomId);
      return result.workstream;
    },

    openRoom(roomId: string) {
      setActiveId(roomId);
    },

    async addRepo(input) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.addRepo(roomId, input);
      await refreshIfOffline(roomId);
    },

    async deleteRepo(repoId: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.deleteRepo(roomId, repoId);
      await refreshIfOffline(roomId);
    },

    async createAgent(input): Promise<CreateAgentResult> {
      const roomId = activeIdRef.current;
      if (!roomId) throw new Error('No room selected');
      const result = await api.createAgent(roomId, input);
      await refreshIfOffline(roomId);
      return result;
    },

    testTrigger(agentId: string) {
      return api.testTrigger(agentId);
    },

    rotateTriggerSecret(agentId: string) {
      return api.rotateTriggerSecret(agentId);
    },

    rotateAgentToken(agentId: string) {
      return api.rotateAgentToken(agentId);
    },

    async updateRoom(patch) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      const { room } = await api.updateRoom(roomId, patch);
      const summary = { name: room.name, topic: room.topic, visibility: room.visibility };
      setRooms((prev) =>
        prev.map((candidate) =>
          candidate.id === roomId ? { ...candidate, ...summary } : candidate,
        ),
      );
      setRoomState((prev) =>
        prev && prev.room.id === roomId
          ? { ...prev, room: { ...prev.room, ...summary } }
          : prev,
      );
    },

    confirm(options: ConfirmOptions): Promise<boolean> {
      return new Promise((resolve) => {
        setConfirmState({ options, resolve });
      });
    },

    async deleteRoom() {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.deleteRoom(roomId);
      const remaining = roomsRef.current.filter((room) => room.id !== roomId);
      setRooms(remaining);
      setRoomState(null);
      setActiveId(remaining[0]?.id ?? null);
      showNotice('Room deleted');
    },

    async leaveRoom(): Promise<boolean> {
      const roomId = activeIdRef.current;
      const current = roomStateRef.current;
      if (!roomId) return false;
      const name = current?.room.name ?? 'this room';
      const confirmed = await actions.confirm({
        title: `Leave “${name}”?`,
        message: 'You will return to the rooms page. Your access and admin role are preserved so you can return anytime.',
        confirmText: 'Leave Room',
        cancelText: 'Stay in Room',
        tone: 'warning',
      });
      if (!confirmed) {
        return false;
      }
      try {
        await api.leaveRoom(roomId);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : 'Could not leave the room');
        return false;
      }
      setRoomState(null);
      setActiveId(null);
      setMemberProfile(null);
      window.location.assign('/rooms');
      return true;
    },

    async deleteMessage(messageId: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.deleteMessage(roomId, messageId);
      setRoomState((prev) =>
        prev && prev.room.id === roomId
          ? { ...prev, messages: prev.messages.filter((message) => message.id !== messageId) }
          : prev,
      );
    },

    async editMessage(messageId: string, content: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      const updated = await api.editMessage(roomId, messageId, content);
      setRoomState((prev) =>
        prev && prev.room.id === roomId
          ? {
              ...prev,
              messages: prev.messages.map((message) =>
                message.id === updated.id ? updated : message,
              ),
            }
          : prev,
      );
    },

    async searchMessages(query: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return [];
      const { messages } = await api.searchMessages(roomId, query);
      return messages;
    },

    async jumpToMessage(message: Message) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      const anchor =
        roomStateRef.current?.messages.find((candidate) => candidate.id === message.id) ?? message;
      const { older, newer } = await api.messagesAround(roomId, anchor.seq, 30);
      const byId = new Map<string, Message>();
      for (const candidate of [...older, anchor, ...newer]) byId.set(candidate.id, candidate);
      const messages = [...byId.values()].sort((left, right) => left.seq - right.seq);
      setRoomState((prev) =>
        prev && prev.room.id === roomId ? { ...prev, messages } : prev,
      );
    },

    setTyping(typing: boolean) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'typing.set', roomId, typing }));
      }
    },

    async loadOlder(beforeSeq: number) {
      const roomId = activeIdRef.current;
      if (!roomId) return [];
      const { messages } = await api.messages(roomId, beforeSeq, 60);
      setRoomState((prev) => {
        if (!prev || prev.room.id !== roomId) return prev;
        const known = new Set(prev.messages.map((message) => message.id));
        const older = messages.filter((message) => !known.has(message.id));
        if (older.length === 0) return prev;
        return {
          ...prev,
          messages: [...older, ...prev.messages].sort((left, right) => left.seq - right.seq),
        };
      });
      return messages;
    },

    markRead() {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      api
        .markRead(roomId)
        .then(({ unreadCount }) =>
          setRooms((prev) =>
            prev.map((room) => (room.id === roomId ? { ...room, unreadCount } : room)),
          ),
        )
        .catch(() => {
          // the next visible message will retry
        });
    },

    async setRole(member: Member, role: Role) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.setRole(roomId, member, role);
      await refreshIfOffline(roomId);
    },

    async removeMember(member: Member) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.removeMember(roomId, member);
      await refreshIfOffline(roomId);
    },

    async approveJoinRequest(requestId: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.approveJoinRequest(roomId, requestId);
      await refreshIfOffline(roomId);
    },

    async denyJoinRequest(requestId: string) {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      await api.denyJoinRequest(roomId, requestId);
      await refreshIfOffline(roomId);
    },

    async refreshRoom() {
      const roomId = activeIdRef.current;
      if (!roomId) return;
      try {
        const state = await api.room(roomId);
        setRoomState(state);
      } catch {
        // the triggering action already reports its own error
      }
    },

    copy(text: string, label: string) {
      void copy(text, label);
    },

    openMyProfile() {
      setProfileOpen(true);
    },

    notify(message: string) {
      showNotice(message);
    },
  };

  async function submitNewRoom(event: FormEvent) {
    event.preventDefault();
    setRoomError(null);
    setCreatingRoom(true);
    try {
      const { room } = await api.createRoom({
        name: roomName.trim(),
        topic: roomTopic.trim(),
        mode: roomMode,
        visibility: roomVisibility,
      });
      const { rooms: list } = await api.rooms();
      setRooms(list);
      setRoomsLoaded(true);
      initialSelected.current = true;
      setActiveId(room.id);
      setNewRoomOpen(false);
      setRoomName('');
      setRoomTopic('');
      setRoomMode('code');
      setRoomVisibility('public');
      showNotice('Room created');
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not create the room');
    } finally {
      setCreatingRoom(false);
    }
  }

  function submitJoinRoom(event: FormEvent) {
    event.preventDefault();
    setJoinError(null);
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(code)) {
      setJoinError('Enter the room code from the link an admin shared');
      return;
    }
    window.location.assign(`/room/${code}`);
  }

  if (!session) {
    return <AuthScreen onAuth={handleAuth} initialMode="login" />;
  }

  const profileMember =
    memberProfile && roomState
      ? roomState.members.find(
          (member) =>
            member.type === memberProfile.type && member.id === memberProfile.id,
        ) ?? null
      : null;
  const profilePresence = profileMember
    ? roomState?.presence.find(
        (entry) => entry.type === profileMember.type && entry.id === profileMember.id,
      )
    : undefined;
  const profileIsMe = Boolean(
    profileMember &&
      roomState &&
      profileMember.type === roomState.me.type &&
      profileMember.id === roomState.me.id,
  );
  const canEditProfile = Boolean(
    profileMember &&
      roomState &&
      (profileIsMe ||
        (profileMember.type === 'agent' && roomState.me.role === 'admin')),
  );

  function editProfileFromDialog() {
    if (!profileMember) return;
    setMemberProfile(null);
    if (profileMember.type === 'agent') setAgentProfileId(profileMember.id);
    else setProfileOpen(true);
  }

  return (
    <div className="app">
      <Sidebar
        rooms={rooms}
        activeId={activeId}
        state={roomState}
        user={session.user}
        connected={connected}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onOpenProfile={() => {
          setNavOpen(false);
          setProfileOpen(true);
        }}
        onOpenMemberProfile={(type, id) => {
          setNavOpen(false);
          openMemberProfile(type, id);
        }}
        onOpenPanel={openWorkspace}
        onSelect={(roomId) => {
          setActiveId(roomId);
          setNavOpen(false);
          setMemberProfile(null);
        }}
        onNewRoom={() => {
          setNavOpen(false);
          setRoomError(null);
          setNewRoomOpen(true);
        }}
        onJoinRoom={() => {
          setNavOpen(false);
          setJoinError(null);
          setJoinOpen(true);
        }}
        onLeaveRoom={() => {
          setNavOpen(false);
          void actions.leaveRoom();
        }}
        onLogout={() => {
          handleLogout();
          window.location.assign('/');
        }}
        onNotice={showNotice}
      />
      {navOpen ? (
        <button
          type="button"
          className="app-nav-backdrop"
          aria-label="Close rooms menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <main className="main">
        {!roomState ? (
          <header className="mobile-head">
            <button
              type="button"
              className="icon-btn"
              aria-label="Open rooms"
              aria-expanded={navOpen}
              aria-controls="app-sidebar"
              onClick={() => setNavOpen(true)}
            >
              <MenuIcon size={18} />
            </button>
            <a className="mobile-head-brand" href="/">
              <span className="brand-glyph">◆</span>
              RoomForge
            </a>
            <span
              className={`mobile-conn ${connected ? 'on' : 'off'}`}
              title={connected ? 'Realtime connected' : 'Reconnecting'}
            >
              <span className="conn-dot" />
            </span>
          </header>
        ) : null}
        {roomState ? (
          <RoomView
            key={roomState.room.id}
            state={roomState}
            actions={actions}
            connected={connected}
            socket={activeSocket}
            navOpen={navOpen}
            onOpenNav={() => setNavOpen(true)}
            onOpenMemberProfile={openMemberProfile}
            panelRequest={panelRequest}
          />
        ) : loadingRoom || !roomsLoaded ? (
          <div className="room-skeleton">
            <div className="skeleton-head" />
            <div className="skeleton-body">
              <div className="skeleton-chat" />
              <div className="skeleton-side" />
            </div>
          </div>
        ) : (
          <div className="empty-room">
            <div className="empty-card">
              <div className="empty-glyph">◆</div>
              <h2>{rooms.length === 0 ? 'Your first room is waiting' : 'Pick a room'}</h2>
              <p>
                {rooms.length === 0
                  ? 'Create a code room with shared repos and tasks, or start chat-only. Admins assign roles to people and agents.'
                  : 'Select a room from the sidebar to jump back into the work.'}
              </p>
              <div className="empty-actions">
                <button type="button" className="btn btn-primary" onClick={() => setNewRoomOpen(true)}>
                  <PlusIcon size={15} /> Create a room
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setJoinOpen(true)}>
                  Join with a code
                </button>
              </div>
              {rooms.length === 0 ? (
                <div className="empty-hints">
                  <div><span>1</span> Create a room and share the invite code.</div>
                  <div><span>2</span> Assign tasks to people and agents.</div>
                  <div><span>3</span> Watch progress and presence update live.</div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {newRoomOpen ? (
        <Modal
          title="New room"
          subtitle="Code rooms get shared repos and task scoping. Chat rooms keep it conversational."
          onClose={() => {
            setNewRoomOpen(false);
            setRoomError(null);
          }}
        >
          <form className="stack" onSubmit={submitNewRoom}>
            <label className="field">
              <span>Room name</span>
              <input
                className="input"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="Payments squad"
                required
              />
            </label>
            <label className="field">
              <span>Topic</span>
              <input
                className="input"
                value={roomTopic}
                onChange={(event) => setRoomTopic(event.target.value)}
                placeholder="Ship the checkout rewrite"
              />
            </label>
            <div className="mode-choice">
              <label className={`mode-option ${roomMode === 'code' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="mode"
                  value="code"
                  checked={roomMode === 'code'}
                  onChange={() => setRoomMode('code')}
                />
                <BranchIcon size={18} />
                <div>
                  <strong>Code room</strong>
                  <span>Shared repos, branches, and task scopes.</span>
                </div>
              </label>
              <label className={`mode-option ${roomMode === 'chat' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="mode"
                  value="chat"
                  checked={roomMode === 'chat'}
                  onChange={() => setRoomMode('chat')}
                />
                <HashIcon size={18} />
                <div>
                  <strong>Chat room</strong>
                  <span>Discussion, roles, presence, and tasks only.</span>
                </div>
              </label>
            </div>
            <div className="mode-choice">
              <label className={`mode-option ${roomVisibility === 'public' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={roomVisibility === 'public'}
                  onChange={() => setRoomVisibility('public')}
                />
                <GlobeIcon size={18} />
                <div>
                  <strong>Public listing</strong>
                  <span>Show in Discover so people can preview and request to join.</span>
                </div>
              </label>
              <label className={`mode-option ${roomVisibility === 'unlisted' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="unlisted"
                  checked={roomVisibility === 'unlisted'}
                  onChange={() => setRoomVisibility('unlisted')}
                />
                <HashIcon size={18} />
                <div>
                  <strong>Unlisted</strong>
                  <span>Hidden from Discover. Only people with the link can request access.</span>
                </div>
              </label>
            </div>
            {roomError ? <p className="form-error">{roomError}</p> : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={creatingRoom || !roomName.trim()}>
              {creatingRoom ? 'Creating…' : 'Create room'}
            </button>
          </form>
        </Modal>
      ) : null}

      {joinOpen ? (
        <Modal
          title="Join a room"
          subtitle="Enter the code from the room link. You can preview the room, then request access."
          onClose={() => {
            setJoinOpen(false);
            setJoinError(null);
          }}
        >
          <form className="stack" onSubmit={submitJoinRoom}>
            <label className="field">
              <span>Room code</span>
              <input
                className="input invite-input"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="A7K2Q"
                maxLength={16}
                required
              />
            </label>
            {joinError ? <p className="form-error">{joinError}</p> : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={joinCode.trim().length < 4}>
              Open room page
            </button>
          </form>
        </Modal>
      ) : null}

      {profileMember && roomState ? (
        <MemberProfileDialog
          member={profileMember}
          presence={profilePresence}
          isMe={profileIsMe}
          canEdit={canEditProfile}
          onClose={() => setMemberProfile(null)}
          onEdit={editProfileFromDialog}
        />
      ) : null}

      {profileOpen ? (
        <ProfileDialog
          mode="me"
          onClose={() => setProfileOpen(false)}
          onSaved={handleProfileSaved}
          onNotice={showNotice}
        />
      ) : null}

      {agentProfileId ? (
        <ProfileDialog
          mode="agent"
          agentId={agentProfileId}
          onClose={() => setAgentProfileId(null)}
          onSaved={handleProfileSaved}
          onNotice={showNotice}
        />
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          options={confirmState.options}
          onConfirm={() => {
            confirmState.resolve(true);
            setConfirmState(null);
          }}
          onCancel={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
        />
      ) : null}

      {notice ? <div className="toast">{notice}</div> : null}
    </div>
  );
}
