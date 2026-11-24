// Demo room agent. It joins over the same WebSocket API as the web client,
// answers instructions aimed at it, and moves assigned tasks to review.
//
// Built for 24/7 reliability with exponential backoff, jitter, and watchdog timer.
import WebSocket from 'ws';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
}

const SERVER_URL = argValue('--server') ?? process.env.SERVER_URL ?? 'http://localhost:4000';
const TOKEN = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.AGENT_TOKEN;
let roomId = process.env.ROOM_ID ?? '';

if (!TOKEN) {
  console.error('Usage: npm run demo:agent -- <agent-token>\nCreate the agent in the room People panel first.');
  process.exit(1);
}

const wsUrl = `${SERVER_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(TOKEN)}`;
const handledTasks = new Set();
const repliedMessages = new Set();

let socket = null;
let me = { id: '', name: 'demo-agent' };
let retries = 0;
let watchdogTimer = null;
let isQuitting = false;
const WATCHDOG_TIMEOUT_MS = 50_000;

function log(...args) {
  console.log('[demo-agent]', ...args);
}

function resetWatchdog() {
  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    log('Watchdog timeout: no ping or message from server in 50s. Recycling socket...');
    if (socket) {
      try {
        socket.terminate();
      } catch {}
    }
  }, WATCHDOG_TIMEOUT_MS);
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function setPresence(status, activity, taskId = null) {
  send({ type: 'presence.set', ...(roomId ? { roomId } : {}), status, activity, taskId });
}

function postMessage(content) {
  send({ type: 'message.send', ...(roomId ? { roomId } : {}), content, kind: 'chat' });
}

async function patchTask(taskId, body) {
  const response = await fetch(`${SERVER_URL}/api/rooms/${roomId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    log('failed to update task', taskId, response.status, await response.text());
    return null;
  }
  return response.json();
}

function maybeHandleTask(task) {
  if (!task || task.assigneeType !== 'agent' || task.assigneeId !== me.id) return;
  if (task.status !== 'doing' || handledTasks.has(task.id)) return;
  handledTasks.add(task.id);

  log(`picking up task “${task.title}”`);
  setPresence('working', `Working on: ${task.title}`, task.id);

  setTimeout(async () => {
    log(`moving task “${task.title}” to review`);
    await patchTask(task.id, { status: 'review' });
    postMessage(`I finished work on “${task.title}” and moved it to Review.`);
    setPresence('online', 'Ready for the next instruction');
  }, 1200);
}

function maybeReply(message) {
  if (!message || message.senderId === me.id || repliedMessages.has(message.id)) return;
  if (!Array.isArray(message.mentions)) return;
  const mentioned = message.mentions.some(
    (mention) => mention.type === 'agent' && mention.id === me.id,
  );
  if (!mentioned) return;
  repliedMessages.add(message.id);

  log(`answering instruction from ${message.senderName}`);
  setPresence('working', `Replying to ${message.senderName}`);

  setTimeout(() => {
    postMessage(
      `Acknowledged, ${message.senderName}. I've logged the ${message.kind} and will report progress as I go.`,
    );
    setPresence('online', 'Ready for the next instruction');
  }, 900);
}

function connect() {
  if (isQuitting) return;
  clearTimeout(watchdogTimer);

  log(`Connecting to ${SERVER_URL}...`);
  socket = new WebSocket(wsUrl);

  socket.on('open', () => {
    log('connected, waiting for the room');
    retries = 0;
    resetWatchdog();
  });

  socket.on('ping', () => resetWatchdog());
  socket.on('pong', () => resetWatchdog());

  socket.on('message', (raw) => {
    resetWatchdog();
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === 'pong') return;

    switch (event.type) {
      case 'ready':
        log(`authenticated as ${event.principal.name}`);
        break;
      case 'room.state': {
        me = event.state.me;
        roomId = event.state.room.id;
        log(`joined room “${event.state.room.name}” as ${me.name}`);
        setPresence('working', 'Watching for instructions');
        for (const task of event.state.tasks ?? []) maybeHandleTask(task);
        break;
      }
      case 'message.new':
        maybeReply(event.message);
        break;
      case 'task.updated':
        maybeHandleTask(event.task);
        break;
      case 'removed':
        log('removed from room, exiting');
        isQuitting = true;
        process.exit(0);
        break;
      case 'error':
        log('server error:', event.message);
        break;
      default:
        break;
    }
  });

  socket.on('close', (code) => {
    clearTimeout(watchdogTimer);
    socket = null;

    if (isQuitting) {
      log('Closed cleanly.');
      return;
    }

    if (code === 4001 || code === 4003) {
      console.error('Credential rejected or join denied. Halting.');
      process.exit(1);
    }

    retries += 1;
    // Exponential backoff with random jitter to prevent thundering herd
    const baseDelay = Math.min(1000 * Math.pow(1.5, Math.min(retries, 8)), 30000);
    const jitter = Math.floor(Math.random() * 1500);
    const delay = Math.round(baseDelay + jitter);

    log(`Disconnected (${code}). Reconnecting in ${delay}ms (attempt #${retries})...`);
    setTimeout(connect, delay);
  });

  socket.on('error', (error) => {
    log('socket error:', error.message);
  });
}

process.on('SIGINT', () => {
  isQuitting = true;
  clearTimeout(watchdogTimer);
  socket?.close(1000, 'SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  isQuitting = true;
  clearTimeout(watchdogTimer);
  socket?.close(1000, 'SIGTERM');
  process.exit(0);
});

connect();
