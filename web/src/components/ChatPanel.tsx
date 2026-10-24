import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Message, PrincipalType, RoomActions, RoomState } from '../lib/types';
import { clockTime } from '../lib/format';
import { Avatar } from './Avatar';
import {
  BellIcon,
  BellOffIcon,
  ChatIcon,
  CheckIcon,
  CopyIcon,
  LightbulbIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  TrashIcon,
  XIcon,
} from './Icons';
import { FormattedMessage } from './FormattedMessage';
import {
  desktopAlertsEnabled,
  notificationsSupported,
  setDesktopAlerts,
} from '../lib/notifications';

interface ChatPanelProps {
  state: RoomState;
  actions: RoomActions;
  onOpenProfile: (type: PrincipalType, id: string) => void;
}

const KIND_OPTIONS = [
  {
    value: 'chat',
    label: 'Chat',
    icon: ChatIcon,
    placeholder: 'Message the room…',
    hint: 'Conversation for everyone in the room.',
  },
  {
    value: 'instruction',
    label: 'Instruction',
    icon: TerminalIcon,
    placeholder: 'Give the room a clear instruction…',
    hint: 'A direct job for agents and people to act on.',
  },
  {
    value: 'suggestion',
    label: 'Suggestion',
    icon: LightbulbIcon,
    placeholder: 'Share a suggestion for the team…',
    hint: 'An idea or proposal the room can discuss.',
  },
] as const;

const drafts = new Map<string, string>();
const PAGE_SIZE = 60;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMentions(content: string, name: string): ReactNode {
  if (!name) return content;
  const pattern = new RegExp(`(@${escapeRegExp(name)})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(content.slice(cursor, index));
    nodes.push(
      <mark className="mention" key={`${index}-${match[0]}`}>
        {match[0]}
      </mark>,
    );
    cursor = index + match[0].length;
  }
  if (nodes.length === 0) return content;
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

function highlightQuery(content: string, query: string): ReactNode {
  if (!query) return content;
  const pattern = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return content.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark className="search-hit" key={index}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChatPanel({ state, actions, onOpenProfile }: ChatPanelProps) {
  const [text, setText] = useState(() => drafts.get(state.room.id) ?? '');
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]['value']>('chat');
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const stickToBottom = useRef(true);
  const preserveScroll = useRef<{ height: number; count: number } | null>(null);
  const typingHeartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingActive = useRef(false);
  const [hasOlder, setHasOlder] = useState(state.messages.length >= 80);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [alertsOn, setAlertsOn] = useState(desktopAlertsEnabled);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const readOnly = state.me.role === 'viewer';
  const activeOption = KIND_OPTIONS.find((option) => option.value === kind) ?? KIND_OPTIONS[0];
  const membersByPrincipal = new Map(
    state.members.map((member) => [`${member.type}:${member.id}`, member]),
  );
  const typers = (state.typing ?? []).filter(
    (entry) =>
      entry.expiresAt > Date.now() &&
      !(entry.type === state.me.type && entry.id === state.me.id),
  );

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    return () => {
      if (typingHeartbeat.current) clearInterval(typingHeartbeat.current);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      actions
        .searchMessages(query)
        .then((messages) => {
          if (cancelled) return;
          setSearchResults(messages);
          setSearching(false);
        })
        .catch((error) => {
          if (cancelled) return;
          setSearchResults([]);
          setSearching(false);
          actions.notify(error instanceof Error ? error.message : 'Search failed');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchQuery, state.room.id]);

  useEffect(() => {
    stickToBottom.current = true;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.room.id]);

  useEffect(() => {
    if (preserveScroll.current) {
      const el = listRef.current;
      const saved = preserveScroll.current;
      if (el && state.messages.length > saved.count) {
        el.scrollTop += el.scrollHeight - saved.height;
        preserveScroll.current = null;
        return;
      }
      if (state.messages.length <= saved.count) return;
    }
    if (!stickToBottom.current) return;
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [state.messages.length]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 26), 160)}px`;
    if (stickToBottom.current) {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    }
  }, [text]);

  function startTyping() {
    if (readOnly || typingActive.current) return;
    typingActive.current = true;
    actions.setTyping(true);
    typingHeartbeat.current = setInterval(() => actions.setTyping(true), 2500);
  }

  function stopTyping() {
    if (!typingActive.current) return;
    typingActive.current = false;
    if (typingHeartbeat.current) {
      clearInterval(typingHeartbeat.current);
      typingHeartbeat.current = null;
    }
    actions.setTyping(false);
  }

  function updateText(next: string) {
    setText(next);
    drafts.set(state.room.id, next);
    if (next.trim()) startTyping();
    else stopTyping();
  }

  function send() {
    const content = text.trim();
    if (!content || readOnly) return;
    stopTyping();
    actions.sendMessage(content, kind);
    drafts.delete(state.room.id);
    setText('');
    inputRef.current?.focus();
  }

  function toggleSearch() {
    stopTyping();
    setSearchOpen((open) => {
      if (open) {
        setSearchQuery('');
        setSearchResults(null);
        setSearching(false);
      }
      return !open;
    });
  }

  async function openSearchResult(message: Message) {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults(null);
    stickToBottom.current = false;
    setHighlightId(message.id);
    try {
      await actions.jumpToMessage(message);
    } catch (error) {
      setHighlightId(null);
      actions.notify(error instanceof Error ? error.message : 'Could not open that message');
      return;
    }
    window.setTimeout(() => {
      const target = listRef.current?.querySelector(`[data-message-id="${message.id}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
    window.setTimeout(() => {
      setHighlightId((current) => (current === message.id ? null : current));
    }, 2800);
  }

  async function toggleAlerts() {
    if (!notificationsSupported()) {
      actions.notify('This browser does not support desktop alerts');
      return;
    }
    if (alertsOn) {
      setDesktopAlerts(false);
      setAlertsOn(false);
      actions.notify('Desktop alerts off');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      actions.notify('Desktop notifications are blocked for this site');
      return;
    }
    setDesktopAlerts(true);
    setAlertsOn(true);
    actions.notify('Desktop alerts on — mentions notify you while this tab is hidden');
  }

  function startEdit(message: Message) {
    stopTyping();
    setEditingId(message.id);
    setEditText(message.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function saveEdit(message: Message) {
    const content = editText.trim();
    if (!content || content === message.content) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    try {
      await actions.editMessage(message.id, content);
      setEditingId(null);
      setEditText('');
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Could not edit the message');
    } finally {
      setSavingEdit(false);
    }
  }

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }

  async function loadOlder() {
    const list = listRef.current;
    const oldestSeq = state.messages[0]?.seq;
    if (!list || oldestSeq === undefined || loadingOlder || !hasOlder) return;
    preserveScroll.current = { height: list.scrollHeight, count: state.messages.length };
    setLoadingOlder(true);
    try {
      const older = await actions.loadOlder(oldestSeq);
      if (older.length < PAGE_SIZE) setHasOlder(false);
      if (older.length === 0) preserveScroll.current = null;
    } catch (error) {
      preserveScroll.current = null;
      actions.notify(error instanceof Error ? error.message : 'Could not load older messages');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function removeMessage(message: Message) {
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      await actions.deleteMessage(message.id);
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Could not delete the message');
    }
  }

  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  function handleCopyMessage(message: Message) {
    actions.copy(message.content, 'Message text copied');
    setCopiedMsgId(message.id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  }

  async function handleCreateTaskFromMessage(message: Message) {
    try {
      const firstLine = message.content.split('\n')[0].replace(/^#+\s*/, '').trim();
      const taskTitle = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || 'New Task';
      await actions.createTask({
        title: taskTitle,
        description: `Origin: message from ${message.senderName}\n\n${message.content}`,
        paths: '',
        branch: '',
        repoId: null,
        assigneeType: null,
        assigneeId: null,
      });
      actions.notify(`Created task “${taskTitle}”`);
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Could not create task from message');
    }
  }

  return (
    <section className="chat">
      <div className="chat-head">
        <span className="chat-head-title">
          <ChatIcon size={14} />
          Chat
        </span>
        <div className="chat-head-actions">
          <span className="chat-head-meta">
            {state.messages.length === 0 ? 'No messages yet' : `${state.messages.length} messages`}
          </span>
          <button
            type="button"
            className={`icon-btn ${searchOpen ? 'active' : ''}`}
            aria-label="Search this room"
            aria-pressed={searchOpen}
            title="Search messages"
            onClick={toggleSearch}
          >
            <SearchIcon size={14} />
          </button>
          <button
            type="button"
            className={`icon-btn ${alertsOn ? 'active' : ''}`}
            aria-label="Desktop mention alerts"
            aria-pressed={alertsOn}
            title={
              alertsOn
                ? 'Desktop alerts are on for mentions while this tab is hidden'
                : 'Enable desktop alerts for mentions'
            }
            onClick={toggleAlerts}
          >
            {alertsOn ? <BellIcon size={14} /> : <BellOffIcon size={14} />}
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="chat-search" role="search">
          <div className="chat-search-bar">
            <SearchIcon size={14} />
            <input
              ref={searchInputRef}
              className="chat-search-input"
              value={searchQuery}
              maxLength={100}
              placeholder="Search this room…"
              aria-label="Search messages in this room"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  toggleSearch();
                }
              }}
            />
            {searching ? <span className="chat-search-status">Searching…</span> : null}
            <button
              type="button"
              className="icon-btn"
              aria-label="Close search"
              onClick={toggleSearch}
            >
              <XIcon size={13} />
            </button>
          </div>
          <div className="chat-search-results">
            {searchQuery.trim().length < 2 ? (
              <p className="chat-search-hint">Type at least 2 characters to search this room.</p>
            ) : searchResults === null || searching ? (
              <p className="chat-search-hint">Looking through the history…</p>
            ) : searchResults.length === 0 ? (
              <p className="chat-search-hint">No messages match “{searchQuery.trim()}”.</p>
            ) : (
              searchResults.map((result) => (
                <button
                  type="button"
                  className="chat-search-result"
                  key={result.id}
                  onClick={() => openSearchResult(result)}
                >
                  <span className="chat-search-result-head">
                    <strong>{result.senderName}</strong>
                    <span>
                      {dayLabel(result.createdAt)} · {clockTime(result.createdAt)}
                    </span>
                  </span>
                  <span className="chat-search-result-text">
                    {highlightQuery(result.content, searchQuery.trim())}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {state.messages.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-empty-icon">
              <ChatIcon size={18} />
            </span>
            <h3>Start the conversation</h3>
            <p>Say hello, drop an instruction, or share a suggestion. Everyone here sees it live.</p>
          </div>
        ) : null}

        {state.messages.length > 0 && hasOlder ? (
          <div className="history-bar">
            <button
              type="button"
              className="btn btn-quiet btn-small"
              disabled={loadingOlder}
              onClick={loadOlder}
            >
              {loadingOlder ? 'Loading older messages…' : 'Load earlier messages'}
            </button>
          </div>
        ) : null}

        {state.messages.length > 0 ? (
          <div className="messages-spacer" aria-hidden="true" />
        ) : null}

        {state.messages.map((message, index) => {
          const previous = state.messages[index - 1];
          const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
          const sameSender =
            previous &&
            previous.senderType === message.senderType &&
            previous.senderId === message.senderId &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000;
          const isAgent = message.senderType === 'agent';
          const senderAvatar = membersByPrincipal.get(`${message.senderType}:${message.senderId}`)?.avatar;
          const profileSender =
            message.senderType === 'user' || message.senderType === 'agent'
              ? message.senderType
              : null;
          const mentionsMe =
            message.senderType !== 'system' &&
            message.mentions.some((mention) => mention.type === state.me.type && mention.id === state.me.id);
          const canDelete =
            message.senderType !== 'system' &&
            (state.me.role === 'admin' ||
              (message.senderType === state.me.type && message.senderId === state.me.id));
          const canEdit =
            !readOnly &&
            message.senderType === state.me.type &&
            message.senderId === state.me.id;

          return (
            <div key={message.id}>
              {newDay ? <div className="day-divider"><span>{dayLabel(message.createdAt)}</span></div> : null}
              <article
                className={`msg ${isAgent ? 'agent' : ''} kind-${message.kind} ${sameSender ? 'grouped' : ''} ${mentionsMe ? 'mentions-me' : ''} ${highlightId === message.id ? 'flash' : ''}`}
                data-message-id={message.id}
              >
                <div className="msg-avatar-wrap">
                  {!sameSender && profileSender ? (
                    <button
                      type="button"
                      className="msg-avatar-btn"
                      title={`Open ${message.senderName}'s profile`}
                      aria-label={`Open ${message.senderName}'s profile`}
                      onClick={() => onOpenProfile(profileSender, message.senderId)}
                    >
                      <Avatar
                        name={message.senderName}
                        type={isAgent ? 'agent' : 'user'}
                        avatar={senderAvatar}
                      />
                    </button>
                  ) : !sameSender ? (
                    <Avatar name={message.senderName} type="user" avatar={senderAvatar} />
                  ) : null}
                </div>
                <div className="msg-body">
                  {!sameSender ? (
                    <div className="msg-head">
                      {profileSender ? (
                        <button
                          type="button"
                          className="msg-author msg-author-btn"
                          title={`Open ${message.senderName}'s profile`}
                          onClick={() => onOpenProfile(profileSender, message.senderId)}
                        >
                          {message.senderName}
                        </button>
                      ) : (
                        <span className="msg-author">{message.senderName}</span>
                      )}
                      {isAgent ? <span className="tag tag-agent">agent</span> : null}
                      {message.senderRole === 'admin' ? <span className="tag tag-amber">admin</span> : null}
                      {message.kind !== 'chat' ? (
                        <span className={`tag ${message.kind === 'instruction' ? 'tag-amber' : 'tag-violet'}`}>
                          {message.kind}
                        </span>
                      ) : null}
                      {mentionsMe ? <span className="tag tag-green">mentions you</span> : null}
                      <span className="msg-time">{clockTime(message.createdAt)}</span>
                    </div>
                  ) : null}
                  {editingId === message.id ? (
                    <div className="msg-edit">
                      <textarea
                        className="msg-edit-input"
                        value={editText}
                        rows={Math.min(6, Math.max(2, editText.split('\n').length))}
                        autoFocus
                        maxLength={4000}
                        aria-label="Edit message"
                        onChange={(event) => setEditText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelEdit();
                          }
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            void saveEdit(message);
                          }
                        }}
                      />
                      <div className="msg-edit-actions">
                        <span className="msg-edit-hint">Enter to save · Esc to cancel</span>
                        <button type="button" className="btn btn-quiet btn-tiny" onClick={cancelEdit}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-tiny"
                          disabled={
                            savingEdit || !editText.trim() || editText.trim() === message.content
                          }
                          onClick={() => void saveEdit(message)}
                        >
                          {savingEdit ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="msg-text-wrap">
                      <FormattedMessage
                        content={message.content}
                        meName={state.me.name}
                        onCopy={actions.copy}
                        mentionTargets={state.members.map((member) => ({
                          name: member.name,
                          type: member.type,
                          id: member.id,
                        }))}
                        onMentionClick={onOpenProfile}
                      />
                      {message.editedAt ? (
                        <span
                          className="msg-edited"
                          title={`Edited ${new Date(message.editedAt).toLocaleString()}`}
                        >
                          {' '}(edited)
                        </span>
                      ) : null}
                    </div>
                  )}
                  {editingId !== message.id ? (
                    <div className="msg-actions">
                      <button
                        type="button"
                        className={`msg-action ${copiedMsgId === message.id ? 'copied' : ''}`}
                        title={copiedMsgId === message.id ? 'Copied' : 'Copy message'}
                        aria-label="Copy message text"
                        onClick={() => handleCopyMessage(message)}
                      >
                        {copiedMsgId === message.id ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                      </button>
                      {state.me.role !== 'viewer' && message.senderType !== 'system' ? (
                        <button
                          type="button"
                          className="msg-action"
                          title="Create task from message"
                          aria-label="Create task from message"
                          onClick={() => handleCreateTaskFromMessage(message)}
                        >
                          <PlusIcon size={12} />
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          className="msg-action"
                          title="Edit message"
                          aria-label={`Edit message from ${message.senderName}`}
                          onClick={() => startEdit(message)}
                        >
                          <PencilIcon size={12} />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          className="msg-action danger"
                          title="Delete message"
                          aria-label={`Delete message from ${message.senderName}`}
                          onClick={() => removeMessage(message)}
                        >
                          <TrashIcon size={12} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            </div>
          );
        })}
      </div>

      <div className="composer">
        {!readOnly ? (
          <div className={`typing-line ${typers.length > 0 ? 'visible' : ''}`} aria-live="polite">
            {typers.length > 0 ? (
              <>
                <span className="typing-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{typingLabel(typers.map((entry) => entry.name))}</span>
              </>
            ) : null}
          </div>
        ) : null}
        {readOnly ? (
          <div className="readonly-banner">You are a viewer in this room. Chat, tasks, and presence updates are read-only.</div>
        ) : (
          <div className="composer-box">
            <textarea
              ref={inputRef}
              className="composer-input"
              placeholder={activeOption.placeholder}
              aria-label="Message the room"
              rows={1}
              maxLength={4000}
              enterKeyHint="send"
              value={text}
              onChange={(event) => updateText(event.target.value)}
              onBlur={stopTyping}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-bar">
              <div className="kind-picker" role="group" aria-label="Message type">
                {KIND_OPTIONS.map((option) => {
                  const OptionIcon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`kind-btn kind-${option.value} ${kind === option.value ? 'active' : ''}`}
                      aria-pressed={kind === option.value}
                      title={`${option.label} · ${option.hint}`}
                      onClick={() => setKind(option.value)}
                    >
                      <OptionIcon size={12} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div className="composer-actions">
                <button
                  type="button"
                  className="btn btn-primary composer-send"
                  aria-label="Send message"
                  disabled={!text.trim()}
                  onClick={send}
                >
                  <SendIcon size={15} />
                  <span className="send-label">Send</span>
                </button>
              </div>
            </div>
            <p className="composer-hint">{activeOption.hint}</p>
          </div>
        )}
      </div>
    </section>
  );
}
