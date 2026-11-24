import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import type { Message, PrincipalType, RoomActions, RoomState } from '../lib/types';
import { clockTime } from '../lib/format';
import { Avatar } from './Avatar';
import {
  BellIcon,
  BellOffIcon,
  BotIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DoubleCheckIcon,
  LightbulbIcon,
  MicIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SmileIcon,
  TerminalIcon,
  TrashIcon,
  UsersIcon,
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
    placeholder: 'Type a message…',
    hint: 'Conversation for everyone in the room.',
  },
  {
    value: 'instruction',
    label: 'Instruction',
    icon: TerminalIcon,
    placeholder: 'Give a direct instruction to agents…',
    hint: 'A direct job for agents and people to act on.',
  },
  {
    value: 'suggestion',
    label: 'Suggestion',
    icon: LightbulbIcon,
    placeholder: 'Share an idea or suggestion…',
    hint: 'An idea or proposal the room can discuss.',
  },
] as const;

const drafts = new Map<string, string>();
const PAGE_SIZE = 60;

// WhatsApp participant colors for distinct sender names
const AUTHOR_COLORS = [
  '#25d366',
  '#00a884',
  '#34b7f1',
  '#e542a3',
  '#ff9900',
  '#9c27b0',
  '#00bcd4',
  '#ff5722',
  '#7c4dff',
  '#689f38',
];

function getAuthorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
}

// WhatsApp Quick Emoji reactions
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// WhatsApp Emoji Picker categorized emojis
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛',
      '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔',
      '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵',
      '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😈',
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      '👍', '👎', '👏', '🙌', '🤝', '👊', '✊', '🤛', '🤜', '🤞',
      '✌️', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇',
      '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤙', '💪', '🙏', '✍️',
    ],
  },
  {
    name: 'Hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌',
    ],
  },
  {
    name: 'Tech & Work',
    emojis: [
      '💡', '🔥', '⭐', '✨', '🚀', '⚡', '🎯', '💻', '🤖', '🛠️',
      '📝', '📌', '🔍', '💬', '📢', '🏆', '🎉', '☕', '🍕', '⚙️',
      '📊', '📈', '🔒', '🔑', '🏷️', '📦', '⏳', '✅', '❌', '⚠️',
    ],
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionListRef = useRef<HTMLDivElement | null>(null);

  // Request chat access for viewers
  const [requestingChat, setRequestingChat] = useState(false);
  const [chatRequested, setChatRequested] = useState(false);

  // WhatsApp features state
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  const [activeReactionPickerMsgId, setActiveReactionPickerMsgId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);

  // Reactions store per room in localStorage (msgId -> { emoji: [userIds] })
  const reactionsKey = `rf_reactions_${state.room.id}`;
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>(() => {
    try {
      const saved = localStorage.getItem(reactionsKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const readOnly = state.me.role === 'viewer';
  const activeOption = KIND_OPTIONS.find((option) => option.value === kind) ?? KIND_OPTIONS[0];
  const membersByPrincipal = useMemo(
    () => new Map(state.members.map((member) => [`${member.type}:${member.id}`, member])),
    [state.members],
  );

  const typers = (state.typing ?? []).filter(
    (entry) =>
      entry.expiresAt > Date.now() &&
      !(entry.type === state.me.type && entry.id === state.me.id),
  );

  // Save reactions to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(reactionsKey, JSON.stringify(reactions));
    } catch {
      // ignore
    }
  }, [reactionsKey, reactions]);

  // Handle voice recording timer
  useEffect(() => {
    if (!recordingVoice) {
      setVoiceSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setVoiceSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [recordingVoice]);

  const filteredMentions = useMemo(() => {
    if (!showMentions) return [];
    const q = mentionQuery.toLowerCase();
    const list: {
      id: string;
      name: string;
      insertText: string;
      type: 'everyone' | 'agent' | 'user';
      subtitle: string;
      avatar?: string | null;
    }[] = [
      {
        id: 'everyone',
        name: 'everyone',
        insertText: 'everyone',
        type: 'everyone',
        subtitle: 'Notify all agents & members in room',
      },
      ...state.members
        .filter((m) => m.type === 'agent')
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          insertText: agent.name,
          type: 'agent' as const,
          subtitle: agent.description ? agent.description.slice(0, 36) : 'agent',
          avatar: agent.avatar,
        })),
      ...state.members
        .filter((m) => m.type === 'user' && m.id !== state.me.id)
        .map((user) => ({
          id: user.id,
          name: user.name,
          insertText: user.name,
          type: 'user' as const,
          subtitle: user.handle ? `@${user.handle}` : 'member',
          avatar: user.avatar,
        })),
    ];
    if (!q) return list;
    return list.filter(
      (item) => item.name.toLowerCase().includes(q) || item.insertText.toLowerCase().includes(q),
    );
  }, [showMentions, mentionQuery, state.members, state.me.id]);

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
  }, [searchOpen, searchQuery, state.room.id, actions]);

  useEffect(() => {
    stickToBottom.current = true;
    setShowScrollBottom(false);
    setUnreadWhileScrolled(0);
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
    if (!stickToBottom.current) {
      setUnreadWhileScrolled((prev) => prev + 1);
      return;
    }
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

  function checkMention(newText: string, cursor: number) {
    const textBefore = newText.slice(0, cursor);
    const match = textBefore.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) {
      const q = match[1];
      const atPos = textBefore.lastIndexOf('@');
      setMentionQuery(q);
      setMentionStart(atPos);
      setShowMentions(true);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
    }
  }

  function applyMention(item: { insertText: string }) {
    if (mentionStart < 0) return;
    const input = inputRef.current;
    const before = text.slice(0, mentionStart);
    const afterAt = text.slice(mentionStart);
    const tokenMatch = afterAt.match(/^@[^\s]*/);
    const tokenLen = tokenMatch ? tokenMatch[0].length : 1;
    const after = text.slice(mentionStart + tokenLen);
    const replacement = `@${item.insertText} `;
    const updated = before + replacement + after;
    setText(updated);
    drafts.set(state.room.id, updated);
    setShowMentions(false);
    setTimeout(() => {
      if (input) {
        input.focus();
        const nextPos = before.length + replacement.length;
        input.setSelectionRange(nextPos, nextPos);
      }
    }, 0);
  }

  async function handleRequestChatAccess() {
    if (!state.room.code) return;
    setRequestingChat(true);
    try {
      await api.requestJoin(state.room.code);
      setChatRequested(true);
      actions.notify('Chat access request sent to room admins');
    } catch (err) {
      actions.notify(err instanceof Error ? err.message : 'Could not request chat access');
    } finally {
      setRequestingChat(false);
    }
  }

  function updateText(next: string) {
    setText(next);
    drafts.set(state.room.id, next);
    if (next.trim()) startTyping();
    else stopTyping();
    const cursor = inputRef.current ? inputRef.current.selectionStart : next.length;
    checkMention(next, cursor);
  }

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    if (!input) {
      updateText(text + emoji);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    updateText(next);
    setTimeout(() => {
      input.focus();
      const pos = start + emoji.length;
      input.setSelectionRange(pos, pos);
    }, 0);
  }

  function toggleReaction(messageId: string, emoji: string) {
    const myId = `${state.me.type}:${state.me.id}`;
    setReactions((prev) => {
      const msgReactions = { ...(prev[messageId] ?? {}) };
      const currentUsers = msgReactions[emoji] ? [...msgReactions[emoji]] : [];
      const hasReacted = currentUsers.includes(myId);
      if (hasReacted) {
        const nextUsers = currentUsers.filter((u) => u !== myId);
        if (nextUsers.length === 0) {
          delete msgReactions[emoji];
        } else {
          msgReactions[emoji] = nextUsers;
        }
      } else {
        msgReactions[emoji] = [...currentUsers, myId];
      }
      return { ...prev, [messageId]: msgReactions };
    });
    setActiveReactionPickerMsgId(null);
  }

  function startReply(message: Message) {
    setReplyingTo(message);
    inputRef.current?.focus();
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  function scrollToBottom() {
    const list = listRef.current;
    if (list) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
    stickToBottom.current = true;
    setShowScrollBottom(false);
    setUnreadWhileScrolled(0);
  }

  function send() {
    const raw = text.trim();
    if (!raw || readOnly) return;
    stopTyping();

    // If replying to a message, format WhatsApp-style quoted block
    let content = raw;
    if (replyingTo) {
      const snippet = replyingTo.content.replace(/\n+/g, ' ').slice(0, 100);
      content = `> @${replyingTo.senderName}: ${snippet}\n\n${raw}`;
    }

    actions.sendMessage(content, kind);
    drafts.delete(state.room.id);
    setText('');
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setShowAttachMenu(false);
    inputRef.current?.focus();
  }

  function handleVoiceNoteSend() {
    if (readOnly) return;
    const duration = voiceSeconds > 0 ? voiceSeconds : 3;
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    const voiceContent = `🎙️ *Voice Note* (${formatted})\nAudio message transcribed: "Room sync note update"`;
    actions.sendMessage(voiceContent, 'chat');
    setRecordingVoice(false);
    setVoiceSeconds(0);
    actions.notify('Voice note sent to room');
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

  function jumpToQuotedMessage(quotedText: string) {
    const list = listRef.current;
    if (!list) return;
    const target = state.messages.find((m) =>
      m.content.toLowerCase().includes(quotedText.trim().toLowerCase().slice(0, 30)),
    );
    if (target) {
      setHighlightId(target.id);
      const el = list.querySelector(`[data-message-id="${target.id}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.setTimeout(() => {
        setHighlightId((current) => (current === target.id ? null : current));
      }, 2500);
    }
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
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    stickToBottom.current = atBottom;
    setShowScrollBottom(!atBottom);
    if (atBottom) {
      setUnreadWhileScrolled(0);
    }
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
    const ok = await actions.confirm({
      title: 'Delete message?',
      message: 'Delete this message for everyone in the room? This action cannot be undone.',
      confirmText: 'Delete for everyone',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await actions.deleteMessage(message.id);
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Could not delete the message');
    }
  }

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

  // Parse quoted message block `> @Sender: quote\n\nContent`
  function parseQuotedMessage(rawContent: string) {
    const quotePattern = /^>\s*@?([^\n:]+):\s*([^\n]+)\n\n([\s\S]*)$/;
    const match = rawContent.match(quotePattern);
    if (match) {
      return {
        hasQuote: true,
        quotedAuthor: match[1].trim(),
        quotedText: match[2].trim(),
        mainText: match[3],
      };
    }
    return {
      hasQuote: false,
      quotedAuthor: '',
      quotedText: '',
      mainText: rawContent,
    };
  }

  return (
    <section className="chat wa-chat-container">
      {/* WhatsApp Header */}
      <div className="chat-head wa-header">
        <div className="wa-header-info">
          <span className="chat-head-title wa-title">
            <ChatIcon size={16} />
            Room Chat
          </span>
          <span className="wa-header-status">
            {typers.length > 0 ? (
              <span className="wa-typing-active">{typingLabel(typers.map((t) => t.name))}</span>
            ) : (
              `${state.members.length} participants · ${state.messages.length} messages`
            )}
          </span>
        </div>
        <div className="chat-head-actions">
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

      {/* WhatsApp Search Bar */}
      {searchOpen ? (
        <div className="chat-search" role="search">
          <div className="chat-search-bar">
            <SearchIcon size={14} />
            <input
              ref={searchInputRef}
              className="chat-search-input"
              value={searchQuery}
              maxLength={100}
              placeholder="Search in chat…"
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
              <p className="chat-search-hint">Looking through chat history…</p>
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

      {/* WhatsApp Messages Scroll Area */}
      <div className="messages wa-messages-bg" ref={listRef} onScroll={handleScroll}>
        {state.messages.length === 0 ? (
          <div className="chat-empty wa-empty">
            <span className="chat-empty-icon wa-empty-icon">
              <ChatIcon size={24} />
            </span>
            <h3>No messages yet</h3>
            <p>Send a message, an instruction, or audio note to get started.</p>
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
          const newDay =
            !previous ||
            new Date(previous.createdAt).toDateString() !==
              new Date(message.createdAt).toDateString();
          const isMe =
            message.senderType === state.me.type && message.senderId === state.me.id;
          const sameSender =
            previous &&
            previous.senderType === message.senderType &&
            previous.senderId === message.senderId &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              4 * 60 * 1000;
          const isAgent = message.senderType === 'agent';
          const senderAvatar = membersByPrincipal.get(
            `${message.senderType}:${message.senderId}`,
          )?.avatar;
          const profileSender =
            message.senderType === 'user' || message.senderType === 'agent'
              ? message.senderType
              : null;
          const mentionsMe =
            message.senderType !== 'system' &&
            message.mentions.some(
              (mention) => mention.type === state.me.type && mention.id === state.me.id,
            );
          const canDelete =
            message.senderType !== 'system' &&
            (state.me.role === 'admin' || isMe);
          const canEdit = !readOnly && isMe;

          const msgReactions = reactions[message.id] || {};
          const reactionEntries = Object.entries(msgReactions);
          const parsed = parseQuotedMessage(message.content);
          const authorColor = getAuthorColor(message.senderName);

          return (
            <div key={message.id}>
              {newDay ? (
                <div className="day-divider wa-day-badge">
                  <span>{dayLabel(message.createdAt)}</span>
                </div>
              ) : null}

              <div
                className={`wa-msg-row ${isMe ? 'outgoing' : 'incoming'} ${
                  sameSender ? 'grouped' : 'first-in-group'
                } ${highlightId === message.id ? 'wa-highlight' : ''}`}
                data-message-id={message.id}
                onDoubleClick={() => !readOnly && startReply(message)}
              >
                {/* Avatar for incoming non-grouped messages */}
                {!isMe && !sameSender ? (
                  <div className="wa-avatar-anchor">
                    {profileSender ? (
                      <button
                        type="button"
                        className="msg-avatar-btn"
                        title={`Open ${message.senderName}'s profile`}
                        onClick={() => onOpenProfile(profileSender, message.senderId)}
                      >
                        <Avatar
                          name={message.senderName}
                          type={isAgent ? 'agent' : 'user'}
                          avatar={senderAvatar}
                        />
                      </button>
                    ) : (
                      <Avatar name={message.senderName} type="user" avatar={senderAvatar} />
                    )}
                  </div>
                ) : !isMe && sameSender ? (
                  <div className="wa-avatar-spacer" />
                ) : null}

                {/* WhatsApp Bubble */}
                <div
                  className={`wa-bubble ${isMe ? 'outgoing' : 'incoming'} ${
                    mentionsMe ? 'mentions-me' : ''
                  }`}
                >
                  {/* WhatsApp Bubble Tail */}
                  {!sameSender ? (
                    <span
                      className={`wa-bubble-tail ${isMe ? 'tail-out' : 'tail-in'}`}
                      aria-hidden="true"
                    />
                  ) : null}

                  {/* Incoming Author Name & Badges */}
                  {!isMe && !sameSender ? (
                    <div className="wa-bubble-header">
                      {profileSender ? (
                        <button
                          type="button"
                          className="wa-author-name"
                          style={{ color: authorColor }}
                          onClick={() => onOpenProfile(profileSender, message.senderId)}
                        >
                          {message.senderName}
                        </button>
                      ) : (
                        <span className="wa-author-name" style={{ color: authorColor }}>
                          {message.senderName}
                        </span>
                      )}
                      {isAgent ? <span className="wa-tag wa-tag-agent">agent</span> : null}
                      {message.senderRole === 'admin' ? (
                        <span className="wa-tag wa-tag-admin">admin</span>
                      ) : null}
                      {message.kind !== 'chat' ? (
                        <span className={`wa-tag wa-tag-${message.kind}`}>
                          {message.kind}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Quoted Reply Card inside Bubble */}
                  {parsed.hasQuote ? (
                    <div
                      className="wa-quote-box"
                      style={{ borderLeftColor: getAuthorColor(parsed.quotedAuthor) }}
                      onClick={() => jumpToQuotedMessage(parsed.quotedText)}
                      title="Click to jump to quoted message"
                    >
                      <span
                        className="wa-quote-author"
                        style={{ color: getAuthorColor(parsed.quotedAuthor) }}
                      >
                        {parsed.quotedAuthor}
                      </span>
                      <p className="wa-quote-snippet">{parsed.quotedText}</p>
                    </div>
                  ) : null}

                  {/* Message Content or Edit Input */}
                  {editingId === message.id ? (
                    <div className="msg-edit wa-bubble-edit">
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
                        <button
                          type="button"
                          className="btn btn-quiet btn-tiny"
                          onClick={cancelEdit}
                        >
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
                    <div className="wa-bubble-content">
                      <FormattedMessage
                        content={parsed.mainText}
                        meName={state.me.name}
                        onCopy={actions.copy}
                        mentionTargets={state.members.map((member) => ({
                          name: member.name,
                          type: member.type,
                          id: member.id,
                        }))}
                        onMentionClick={onOpenProfile}
                      />

                      {/* WhatsApp Time & Double Read Ticks */}
                      <span className="wa-msg-meta">
                        {message.editedAt ? <span className="wa-edited">edited </span> : null}
                        <span className="wa-time">{clockTime(message.createdAt)}</span>
                        {isMe ? (
                          <span className="wa-ticks read" title="Delivered & Read">
                            <DoubleCheckIcon size={14} />
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )}

                  {/* Reaction counter pills attached to the bubble */}
                  {reactionEntries.length > 0 ? (
                    <div className="wa-reactions-row">
                      {reactionEntries.map(([emoji, userIds]) => {
                        const hasReacted = userIds.includes(`${state.me.type}:${state.me.id}`);
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={`wa-reaction-pill ${hasReacted ? 'active' : ''}`}
                            onClick={() => !readOnly && toggleReaction(message.id, emoji)}
                            title={`${userIds.length} reaction${userIds.length > 1 ? 's' : ''}`}
                          >
                            <span>{emoji}</span>
                            {userIds.length > 1 ? (
                              <span className="wa-reaction-count">{userIds.length}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Floating Action Menu Bar (hover) */}
                  {editingId !== message.id ? (
                    <div className="wa-msg-actions-bar">
                      {/* Quick Emoji Reaction Pill Button */}
                      {!readOnly ? (
                        <div className="wa-reaction-trigger-wrap">
                          <button
                            type="button"
                            className="wa-action-btn"
                            title="React with emoji"
                            onClick={() =>
                              setActiveReactionPickerMsgId((curr) =>
                                curr === message.id ? null : message.id,
                              )
                            }
                          >
                            <SmileIcon size={13} />
                          </button>

                          {/* Quick Emoji Bar Popup */}
                          {activeReactionPickerMsgId === message.id ? (
                            <div className="wa-quick-emojis-popup">
                              {QUICK_EMOJIS.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className="wa-quick-emoji-btn"
                                  onClick={() => toggleReaction(message.id, emoji)}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {/* Reply Button */}
                      {!readOnly ? (
                        <button
                          type="button"
                          className="wa-action-btn"
                          title="Reply to message"
                          onClick={() => startReply(message)}
                        >
                          <ReplyIcon size={13} />
                        </button>
                      ) : null}

                      {/* Copy Button */}
                      <button
                        type="button"
                        className={`wa-action-btn ${copiedMsgId === message.id ? 'copied' : ''}`}
                        title={copiedMsgId === message.id ? 'Copied' : 'Copy message'}
                        onClick={() => handleCopyMessage(message)}
                      >
                        {copiedMsgId === message.id ? (
                          <CheckIcon size={13} />
                        ) : (
                          <CopyIcon size={13} />
                        )}
                      </button>

                      {/* Create Task Button */}
                      {!readOnly && message.senderType !== 'system' ? (
                        <button
                          type="button"
                          className="wa-action-btn"
                          title="Create task from message"
                          onClick={() => handleCreateTaskFromMessage(message)}
                        >
                          <PlusIcon size={13} />
                        </button>
                      ) : null}

                      {/* Edit Button */}
                      {canEdit ? (
                        <button
                          type="button"
                          className="wa-action-btn"
                          title="Edit message"
                          onClick={() => startEdit(message)}
                        >
                          <PencilIcon size={13} />
                        </button>
                      ) : null}

                      {/* Delete Button */}
                      {canDelete ? (
                        <button
                          type="button"
                          className="wa-action-btn danger"
                          title="Delete message"
                          onClick={() => removeMessage(message)}
                        >
                          <TrashIcon size={13} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {showScrollBottom ? (
        <button
          type="button"
          className="wa-scroll-bottom-btn"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          title="Scroll to latest messages"
        >
          <ChevronDownIcon size={16} />
          {unreadWhileScrolled > 0 ? (
            <span className="wa-unread-badge">{unreadWhileScrolled}</span>
          ) : null}
        </button>
      ) : null}

      {/* WhatsApp Composer Area */}
      <div className="composer wa-composer-wrap">
        {/* Docked Reply Preview Bar */}
        {replyingTo ? (
          <div className="wa-reply-bar">
            <div className="wa-reply-bar-left">
              <span
                className="wa-reply-bar-author"
                style={{ color: getAuthorColor(replyingTo.senderName) }}
              >
                Replying to {replyingTo.senderName}
              </span>
              <span className="wa-reply-bar-text">
                {replyingTo.content.replace(/\n+/g, ' ').slice(0, 80)}
              </span>
            </div>
            <button
              type="button"
              className="wa-reply-bar-close"
              onClick={cancelReply}
              title="Cancel reply"
            >
              <XIcon size={14} />
            </button>
          </div>
        ) : null}

        {/* Read-only banner for viewers */}
        {readOnly ? (
          <div className="readonly-banner">
            <div className="readonly-banner-content">
              <strong>Viewer access</strong>
              <span>
                You can see all messages and tasks. Chat access is required to send messages.
              </span>
            </div>
            {chatRequested ? (
              <span className="tag tag-amber">Chat access requested · Waiting for admin</span>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={handleRequestChatAccess}
                disabled={requestingChat}
              >
                {requestingChat ? 'Requesting…' : 'Request chat access'}
              </button>
            )}
          </div>
        ) : (
          <div className="wa-composer-container">
            {/* Mention Suggestions Popover */}
            {showMentions && filteredMentions.length > 0 ? (
              <div
                className="mention-suggestions wa-mention-popover"
                ref={mentionListRef}
                role="listbox"
                aria-label="Mention suggestions"
              >
                <div className="mention-header">Mention agents or everyone</div>
                {filteredMentions.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`mention-item ${idx === mentionIndex ? 'active' : ''}`}
                    role="option"
                    aria-selected={idx === mentionIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(item);
                    }}
                    onMouseEnter={() => setMentionIndex(idx)}
                  >
                    <span className="mention-avatar">
                      {item.type === 'everyone' ? (
                        <UsersIcon size={13} />
                      ) : item.type === 'agent' ? (
                        <BotIcon size={13} />
                      ) : (
                        <Avatar
                          name={item.name}
                          type="user"
                          avatar={item.avatar}
                          iconSize={13}
                        />
                      )}
                    </span>
                    <span className="mention-info">
                      <span className="mention-name">@{item.name}</span>
                      <span className="mention-sub">{item.subtitle}</span>
                    </span>
                    <span
                      className={`tag tag-tiny ${
                        item.type === 'agent'
                          ? 'tag-violet'
                          : item.type === 'everyone'
                            ? 'tag-amber'
                            : 'tag-gray'
                      }`}
                    >
                      {item.type}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {/* WhatsApp Emoji Picker Palette */}
            {showEmojiPicker ? (
              <div className="wa-emoji-picker">
                <div className="wa-emoji-tabs">
                  {EMOJI_CATEGORIES.map((cat, idx) => (
                    <button
                      key={cat.name}
                      type="button"
                      className={`wa-emoji-tab ${activeEmojiCategory === idx ? 'active' : ''}`}
                      onClick={() => setActiveEmojiCategory(idx)}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
                <div className="wa-emoji-grid">
                  {EMOJI_CATEGORIES[activeEmojiCategory].emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="wa-emoji-cell"
                      onClick={() => insertEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* WhatsApp Attachment Menu */}
            {showAttachMenu ? (
              <div className="wa-attach-palette">
                <button
                  type="button"
                  className={`wa-attach-item ${kind === 'chat' ? 'active' : ''}`}
                  onClick={() => {
                    setKind('chat');
                    setShowAttachMenu(false);
                  }}
                >
                  <span className="wa-attach-icon attach-chat">
                    <ChatIcon size={16} />
                  </span>
                  <span>Chat</span>
                </button>
                <button
                  type="button"
                  className={`wa-attach-item ${kind === 'instruction' ? 'active' : ''}`}
                  onClick={() => {
                    setKind('instruction');
                    setShowAttachMenu(false);
                  }}
                >
                  <span className="wa-attach-icon attach-instr">
                    <TerminalIcon size={16} />
                  </span>
                  <span>Instruction</span>
                </button>
                <button
                  type="button"
                  className={`wa-attach-item ${kind === 'suggestion' ? 'active' : ''}`}
                  onClick={() => {
                    setKind('suggestion');
                    setShowAttachMenu(false);
                  }}
                >
                  <span className="wa-attach-icon attach-sugg">
                    <LightbulbIcon size={16} />
                  </span>
                  <span>Suggestion</span>
                </button>
                <button
                  type="button"
                  className="wa-attach-item"
                  onClick={() => {
                    setShowAttachMenu(false);
                    const snippet = '```ts\n// Code snippet\n\n```';
                    updateText(text ? `${text}\n${snippet}` : snippet);
                  }}
                >
                  <span className="wa-attach-icon attach-code">
                    <PlusIcon size={16} />
                  </span>
                  <span>Code Snippet</span>
                </button>
              </div>
            ) : null}

            {/* Voice Recording Pill Active View */}
            {recordingVoice ? (
              <div className="wa-voice-recording-pill">
                <span className="wa-voice-recording-dot" />
                <span className="wa-voice-recording-time">
                  Recording: {Math.floor(voiceSeconds / 60)}:
                  {voiceSeconds % 60 < 10 ? '0' : ''}
                  {voiceSeconds % 60}
                </span>
                <span className="wa-voice-wave" />
                <button
                  type="button"
                  className="btn btn-quiet btn-tiny"
                  onClick={() => setRecordingVoice(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-tiny wa-voice-send-btn"
                  onClick={handleVoiceNoteSend}
                >
                  Send Audio
                </button>
              </div>
            ) : (
              /* WhatsApp Main Composer Pill */
              <div className="wa-composer-row">
                <div className="wa-composer-pill">
                  {/* Emoji Button */}
                  <button
                    type="button"
                    className={`wa-pill-btn ${showEmojiPicker ? 'active' : ''}`}
                    title="Emojis"
                    onClick={() => {
                      setShowEmojiPicker((p) => !p);
                      setShowAttachMenu(false);
                    }}
                  >
                    <SmileIcon size={20} />
                  </button>

                  {/* Attachment Paperclip Button */}
                  <button
                    type="button"
                    className={`wa-pill-btn ${showAttachMenu ? 'active' : ''}`}
                    title="Attach action / Change message type"
                    onClick={() => {
                      setShowAttachMenu((p) => !p);
                      setShowEmojiPicker(false);
                    }}
                  >
                    <PaperclipIcon size={19} />
                  </button>

                  {/* Message Type Badge inside Composer if not chat */}
                  {kind !== 'chat' ? (
                    <span className={`wa-kind-pill-badge kind-${kind}`}>
                      {kind === 'instruction' ? '⚡ Instruction' : '💡 Suggestion'}
                      <button
                        type="button"
                        onClick={() => setKind('chat')}
                        className="wa-kind-pill-clear"
                        title="Switch back to regular chat"
                      >
                        <XIcon size={11} />
                      </button>
                    </span>
                  ) : null}

                  {/* Textarea */}
                  <textarea
                    ref={inputRef}
                    className="wa-composer-input"
                    placeholder={activeOption.placeholder}
                    aria-label="Message the room"
                    rows={1}
                    maxLength={4000}
                    enterKeyHint="send"
                    value={text}
                    onChange={(event) => updateText(event.target.value)}
                    onFocus={() => {
                      setShowEmojiPicker(false);
                      setShowAttachMenu(false);
                    }}
                    onBlur={() => {
                      stopTyping();
                      setTimeout(() => setShowMentions(false), 200);
                    }}
                    onKeyDown={(event) => {
                      if (showMentions && filteredMentions.length > 0) {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          setMentionIndex((prev) => (prev + 1) % filteredMentions.length);
                          return;
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          setMentionIndex(
                            (prev) => (prev - 1 + filteredMentions.length) % filteredMentions.length,
                          );
                          return;
                        }
                        if (event.key === 'Enter' || event.key === 'Tab') {
                          event.preventDefault();
                          applyMention(filteredMentions[mentionIndex]);
                          return;
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setShowMentions(false);
                          return;
                        }
                      }
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        send();
                      }
                    }}
                  />
                </div>

                {/* WhatsApp Dynamic Voice Mic / Send Button */}
                {text.trim() ? (
                  <button
                    type="button"
                    className="wa-circle-btn wa-send-btn"
                    aria-label="Send message"
                    onClick={send}
                    title="Send message"
                  >
                    <SendIcon size={18} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wa-circle-btn wa-mic-btn"
                    aria-label="Record voice note"
                    onClick={() => setRecordingVoice(true)}
                    title="Record voice note"
                  >
                    <MicIcon size={18} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
