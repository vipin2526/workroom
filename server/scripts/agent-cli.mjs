// Terminal chat client for a room agent. Only needs the agent token:
//   npm run agent -- rf_...
import { createInterface } from 'node:readline';
import WebSocket from 'ws';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
}

const TOKEN =
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.AGENT_TOKEN;
const SERVER_URL = argValue('--server') ?? process.env.SERVER_URL ?? 'http://localhost:4000';

if (!TOKEN) {
  console.error('Usage: npm run agent -- <agent-token> [--server http://localhost:4000]');
  console.error('Create an agent in the room People panel and copy its token.');
  process.exit(1);
}

const wsUrl = `${SERVER_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(TOKEN)}`;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const interactive = Boolean(process.stdin.isTTY);
const queued = [];
let me = null;
let room = null;
let presence = [];
let quitting = false;
let socket = null;
let retries = 0;
let watchdogTimer = null;
const WATCHDOG_TIMEOUT_MS = 50_000;

function resetWatchdog() {
  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    if (!quitting && socket) {
      console.log('\n[Watchdog] Server quiet for 50s. Reconnecting...');
      try {
        socket.terminate();
      } catch {}
    }
  }, WATCHDOG_TIMEOUT_MS);
}

function printPresence() {
  if (presence.length === 0) {
    console.log('No one in the room yet.');
    return;
  }
  for (const entry of presence) {
    const kind = entry.type === 'agent' ? 'agent' : 'human';
    const activity = entry.activity ? ` — ${entry.activity}` : '';
    console.log(`  ${entry.name} (${kind}, ${entry.role}): ${entry.status}${activity}`);
  }
}

function prompt() {
  if (!interactive) return;
  rl.setPrompt(room ? 'you> ' : '…> ');
  rl.prompt();
}

function handleLine(line) {
  const text = line.trim();
  if (!text) {
    prompt();
    return;
  }
  if (text === '/who') {
    printPresence();
    prompt();
    return;
  }

  let kind = 'chat';
  let content = text;
  const prefixed = text.match(/^\/(instruction|suggestion)\s+([\s\S]+)$/);
  if (prefixed) {
    kind = prefixed[1];
    content = prefixed[2];
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'message.send', content, kind }));
  } else {
    queued.push(text);
    console.log('[offline: queued]');
  }
  prompt();
}

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) {
    prompt();
    return;
  }
  if (text === '/quit' || text === '/exit') {
    quitting = true;
    clearTimeout(watchdogTimer);
    socket?.close(1000, 'quit');
    rl.close();
    process.exit(0);
    return;
  }
  if (!room) {
    queued.push(text);
    return;
  }
  handleLine(text);
});

function connect() {
  if (quitting) return;
  clearTimeout(watchdogTimer);

  socket = new WebSocket(wsUrl);

  socket.on('open', () => {
    retries = 0;
    resetWatchdog();
  });

  socket.on('ping', () => resetWatchdog());
  socket.on('pong', () => resetWatchdog());

  socket.on('message', (raw) => {
    resetWatchdog();
    let event;
    try {
      event = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (event.type === 'pong') return;

    switch (event.type) {
      case 'ready':
        me = event.principal;
        console.log(`Signed in as ${me.name}.`);
        break;
      case 'room.state':
        room = event.state.room;
        presence = event.state.presence ?? [];
        console.log('');
        console.log(`Joined “${room.name}”${room.topic ? ` — ${room.topic}` : ''}`);
        console.log('Type to chat. Commands: /instruction <text>, /suggestion <text>, /who, /quit');
        console.log('');
        prompt();
        for (const line of queued.splice(0)) handleLine(line);
        break;
      case 'message.new': {
        const message = event.message;
        const mine = me && message.senderId === me.id;
        const label = message.kind === 'chat' ? '' : `[${message.kind}] `;
        console.log(`${mine ? 'you' : message.senderName}: ${label}${message.content}`);
        if (room && !mine) prompt();
        break;
      }
      case 'presence.update':
        presence = event.presence ?? [];
        break;
      case 'task.updated':
        console.log(
          `[task] “${event.task.title}” → ${event.task.status}${event.task.assigneeName ? ` (${event.task.assigneeName})` : ''}`,
        );
        if (room) prompt();
        break;
      case 'error':
        console.error(`[server] ${event.message}`);
        if (room) prompt();
        break;
      case 'removed':
        console.error('You were removed from the room. Exiting.');
        quitting = true;
        clearTimeout(watchdogTimer);
        socket.close();
        rl.close();
        process.exit(0);
        break;
      default:
        break;
    }
  });

  socket.on('close', (code) => {
    clearTimeout(watchdogTimer);
    socket = null;

    if (quitting) return;

    if (code === 4001 || code === 4003) {
      console.error('\nConnection rejected: token invalid or revoked.');
      rl.close();
      process.exit(1);
    }

    retries += 1;
    const baseDelay = Math.min(1000 * Math.pow(1.5, Math.min(retries, 6)), 15000);
    const jitter = Math.floor(Math.random() * 1000);
    const delay = Math.round(baseDelay + jitter);

    console.log(`\n[Disconnected (${code}). Reconnecting in ${delay}ms...]`);
    setTimeout(connect, delay);
  });

  socket.on('error', (error) => {
    if (!quitting) console.error(`\nConnection error: ${error.message}`);
  });
}

connect();
