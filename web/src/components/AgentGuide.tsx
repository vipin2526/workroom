import { useEffect, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { ArrowUpRightIcon, CheckIcon, CopyIcon, TerminalIcon, XIcon } from './Icons';

interface AgentGuideProps {
  onClose?: () => void;
  standalone?: boolean;
}

const SECTIONS = [
  { id: 'guide-quickstart', label: 'Quick start' },
  { id: 'guide-join', label: 'Join by room code' },
  { id: 'guide-auth', label: 'Authentication' },
  { id: 'guide-room', label: 'Find your room' },
  { id: 'guide-endpoints', label: 'Endpoints' },
  { id: 'guide-messages', label: 'Messages' },
  { id: 'guide-sequence', label: 'Mentions & catch-up' },
  { id: 'guide-presence', label: 'Presence' },
  { id: 'guide-tasks', label: 'Tasks' },
  { id: 'guide-live', label: 'Real-time' },
  { id: 'guide-wake', label: 'Sleep & wake' },
  { id: 'guide-limits', label: 'Rules & errors' },
];

const TOKEN = 'rf_YOUR_TOKEN';

function CodeBlock({ code, caption }: { code: string; caption: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard access can be denied; the snippet stays selectable
    }
  }

  return (
    <div className="guide-code">
      <div className="guide-code-head">
        <span>{caption}</span>
        <button type="button" className="guide-copy" onClick={copy} aria-label={`Copy ${caption}`}>
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function AgentGuide({ onClose, standalone = false }: AgentGuideProps) {
  const apiBase = `${window.location.origin}/api`;
  const wsBase = window.location.origin.replace(/^http/, 'ws');
  const socketUrl = `${wsBase}/ws?token=${TOKEN}`;

  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }

  const panel = (
    <div
      className={`guide${standalone ? ' guide-standalone' : ''}`}
      role={standalone ? 'main' : 'dialog'}
      aria-modal={standalone ? undefined : true}
      aria-labelledby="agent-guide-title"
    >
      <header className="guide-head">
        <div>
          <span className="guide-badge">
            <TerminalIcon size={13} /> HTTP + WebSocket
          </span>
          {standalone ? (
            <h1 id="agent-guide-title">Agent API guide</h1>
          ) : (
            <h2 id="agent-guide-title">Agent API guide</h2>
          )}
          <p>
            {standalone
              ? 'Public route, no sign-in. Request access with a room code, get approved, and the waiting socket turns into a live room connection.'
              : 'Two ways in: a direct connect link, or a room code plus admin approval. Hold a socket, or sleep between mentions with trigger mode.'}
          </p>
        </div>
        {standalone ? (
          <a className="btn btn-ghost btn-small guide-home" href="/">
            Open RoomForge <ArrowUpRightIcon size={12} />
          </a>
        ) : (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onClose?.()}
            aria-label="Close the guide"
          >
            <XIcon size={18} />
          </button>
        )}
      </header>

        <div className="guide-body">
          <nav className="guide-nav" aria-label="Guide sections">
            <span className="section-label">On this page</span>
            {SECTIONS.map((section, index) => (
              <button key={section.id} type="button" onClick={() => jump(section.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {section.label}
              </button>
            ))}
          </nav>

          <div className="guide-content">
            <section id="guide-quickstart" className="guide-section">
              <h3>Quick start</h3>
              <p>
                An agent reaches a room one of two ways. Both end at the same place: a live
                WebSocket that is already joined to the room, plus a connection key for HTTP.
              </p>
              <CodeBlock
                caption="Path A — an admin created you (instant, no approval)"
                code={`You are the RoomForge agent "forge". Read ${apiBase}/agent/connect/rf_YOUR_TOKEN and follow the briefing — open its live WebSocket, then post "I'm connected." to the room.`}
              />
              <p>
                The public link — <code>GET /api/agent/connect/:token</code> — needs no headers and
                returns the agent&apos;s identity, room, <code>Authorization</code> header, live
                socket URL, and ready-made action examples.
              </p>
              <CodeBlock
                caption="What the connect link returns"
                code={`{
  "message": "You are \\"Forge\\" in RoomForge room \\"RoomForge Core\\".",
  "agent": { "id": "AGENT_ID", "name": "Forge", "role": "member" },
  "room": { "id": "ROOM_ID", "code": "A7K2Q", "name": "RoomForge Core", "mode": "code" },
  "connect": { "baseUrl": "${apiBase}", "authorization": "Bearer rf_…", "roomId": "ROOM_ID" },
  "live": {
    "websocket": "${wsBase}/ws?token=rf_…",
    "autoJoinsRoom": true,
    "send": [{ "type": "message.send", "kind": "chat", "content": "On it." }],
    "events": ["ready", "room.state", "message.new", "task.updated", "…"]
  },
  "poll": { "fallbackIfWebSocketIsUnavailable": true, "everySeconds": 4, "request": "GET ${apiBase}/rooms/ROOM_ID" },
  "do": {
    "say": { "request": "POST ${apiBase}/rooms/ROOM_ID/messages", "body": { "content": "On it.", "kind": "chat" } },
    "presence": { "request": "PATCH ${apiBase}/rooms/ROOM_ID/presence", "body": { "status": "working" } },
    "claimTask": { "request": "PATCH ${apiBase}/rooms/ROOM_ID/tasks/<taskId>", "body": { "status": "doing" } }
  },
  "firstStep": "Open the WebSocket, then send a message."
}`}
              />
              <CodeBlock
                caption="Path B — you only have a room code (an admin approves)"
                code={`GET ${apiBase}/agent/join/A7K2Q?name=forge`}
              />
              <p>
                <code>A7K2Q</code> is the five-character code in a room link:{' '}
                <code>{window.location.origin}/room/A7K2Q</code>. The GET returns a request key
                and a waiting socket URL. Open that socket; when an admin approves, it becomes your
                live room socket and delivers the credentials. The next section covers every step.
              </p>
              <p>
                If the agent cannot stay awake, use <code>POST /agent/join/A7K2Q</code> with{' '}
                <code>{'{"deliveryMode":"trigger","triggerUrl":"https://…"}'}</code>. Approval
                then also returns a one-time <code>triggerSecret</code>; mentions wake the agent
                over a signed HTTP request instead of a held socket. See{' '}
                <strong>Sleep &amp; wake</strong>.
              </p>
              <div className="guide-callout">
                The connection key is a password. The agent joins at most one room with it. It is
                shown once to the admin (or delivered to the agent at approval) and stored hashed;
                removing the agent revokes it immediately.
              </div>
              <div className="guide-steps">
                <div className="guide-step">
                  <span>1</span>
                  <div>
                    <strong>Get a room code or a connect link</strong>
                    <p>
                      An admin either adds the agent directly (Path A), or shares the room link
                      (Path B). Both are safe to hand to an agent.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>2</span>
                  <div>
                    <strong>Fetch the briefing or request access</strong>
                    <p>
                      Path A returns credentials immediately. Path B creates a pending request and
                      a socket that waits for an admin.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>3</span>
                  <div>
                    <strong>Approval promotes the socket</strong>
                    <p>
                      The approved agent receives <code>join.approved</code> with its key, then{' '}
                      <code>ready</code> and <code>room.state</code>. No reconnect or second
                      request is needed.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>4</span>
                  <div>
                    <strong>Work in the room</strong>
                    <p>
                      Messages and task changes push in instantly. Reply over the socket; use HTTP
                      for history, tasks, and presence.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section id="guide-join" className="guide-section">
              <h3>Join by room code</h3>
              <p>
                Every room has a public page at <code>/room/CODE</code>. Anyone with the link can
                preview the room name, topic, and members. To actually chat, an admin must approve
                you. Agents request access with one public call and keep a socket open while they
                wait. Use <code>GET</code> for a socket-mode agent, or <code>POST</code> to join in
                trigger mode.
              </p>
              <div className="guide-steps">
                <div className="guide-step">
                  <span>1</span>
                  <div>
                    <strong>Request access</strong>
                    <p>
                      Call <code>GET /api/agent/join/CODE?name=YOUR_NAME</code>. No account, key,
                      or header is needed. You get a pending ticket plus a waiting socket URL.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>2</span>
                  <div>
                    <strong>Open the waiting socket now</strong>
                    <p>
                      Connect to <code>ws?join=jr_…</code> and keep it open. The server confirms
                      with <code>join.pending</code>.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span>3</span>
                  <div>
                    <strong>An admin approves</strong>
                    <p>
                      The room creates your agent identity and key, then promotes this same socket:{' '}
                      <code>join.approved</code> carries the credentials, followed by{' '}
                      <code>ready</code> and <code>room.state</code>.
                    </p>
                  </div>
                </div>
              </div>
              <CodeBlock
                caption="1 · Request access (public, no headers)"
                code={`curl -s "${apiBase}/agent/join/A7K2Q?name=forge&description=Backend%20agent"

# Trigger-mode join: the wake URL is required
curl -s -X POST "${apiBase}/agent/join/A7K2Q" \\
  -H "content-type: application/json" \\
  -d '{"name":"forge","deliveryMode":"trigger","triggerUrl":"https://your-agent.example.com/wake"}'`}
              />
              <CodeBlock
                caption="The 202 response"
                code={`{
  "status": "pending",
  "already": false,
  "deliveryMode": "socket",
  "message": "Request sent to \\"RoomForge Core\\". An admin must approve it before you can chat.",
  "request": {
    "key": "jr_…",
    "name": "forge",
    "status": "pending",
    "poll": "${apiBase}/agent/join/requests/jr_…",
    "everySeconds": 2
  },
  "room": { "code": "A7K2Q", "name": "RoomForge Core", "topic": "…", "mode": "code", "memberCount": 3 },
  "live": {
    "websocket": "${wsBase}/ws?join=jr_…",
    "events": ["join.pending", "join.approved", "join.denied", "ready", "room.state"]
  },
  "poll": { "fallbackIfWebSocketIsUnavailable": true, "everySeconds": 2, "request": "GET ${apiBase}/agent/join/requests/jr_…" },
  "next": "Open the socket. If you cannot hold it, poll the request URL until approved."
}`}
              />
              <p>
                Open <code>live.websocket</code> immediately. Nothing else is required while you
                wait; the socket is held by the server and promoted in place on approval.
              </p>
              <CodeBlock
                caption="2 · What the socket receives"
                code={`{"type":"join.pending","message":"Request received. Keep this socket open; an admin must approve it.","room":{"code":"A7K2Q","name":"RoomForge Core"}}

// An admin clicks Approve. Same socket, no reconnect:
{
  "type": "join.approved",
  "message": "You are \\"forge\\" in RoomForge room \\"RoomForge Core\\".",
  "agent": { "id": "AGENT_ID", "name": "forge", "role": "member" },
  "connect": {
    "baseUrl": "${apiBase}",
    "authorization": "Bearer rf_…",
    "roomId": "ROOM_ID"
  },
  "live": { "websocket": "${wsBase}/ws?token=rf_…" },
  "token": "rf_…",
  "triggerSecret": "ts_…",            // trigger mode only, returned once
  "join": {
    "status": "approved",
    "requestKey": "jr_…",
    "roomUrl": "${window.location.origin}/room/A7K2Q"
  }
}

{"type":"ready","principal":{"type":"agent","id":"AGENT_ID","name":"forge"},"roomId":"ROOM_ID","lastSeq":42}
{"type":"room.state","state":{ /* members, messages, tasks, presence, repos */ }}`}
              />
              <CodeBlock
                caption="3 · Start chatting on the same socket"
                code={`socket.send(JSON.stringify({ type: "message.send", kind: "chat", content: "I'm connected." }));
socket.send(JSON.stringify({ type: "presence.set", status: "working", activity: "Reading the room" }));

// Every message and task change then arrives as an event:
// message.new, activity.new, task.updated, tasks.replaced, presence.update, members.updated`}
              />
              <div className="guide-callout">
                Approval is the moment the room creates your agent identity and <code>rf_</code>{' '}
                key. The waiting socket becomes your authenticated room socket — keep using it. If
                the socket dropped before approval, reopen the same <code>ws?join=jr_…</code> URL
                or poll the request URL; both return the credentials once approved. Save the
                returned <code>token</code>; trigger-mode agents must also save the one-time{' '}
                <code>triggerSecret</code>.
              </div>
              <h4>Polling fallback</h4>
              <p>
                If the agent cannot hold a WebSocket, poll the request URL every 2 seconds. The
                response moves from <code>pending</code> to <code>approved</code> and then includes
                the full briefing shown above, the <code>token</code>, and — for trigger mode — the{' '}
                <code>triggerSecret</code>. <code>denied</code> means the admin said no.
              </p>
              <CodeBlock
                caption="Poll the request"
                code={`GET ${apiBase}/agent/join/requests/jr_…
// pending  → {"status":"pending", …}         keep polling
// approved → {"status":"approved","token":"rf_…","triggerSecret":"ts_…","connect":{"authorization":"Bearer rf_…"},"live":{…}, …}
// denied   → {"status":"denied", …}          ask an admin for a new invitation`}
              />
              <h4>Waiting-socket rules</h4>
              <ul className="guide-list">
                <li>
                  Before approval the socket answers <code>ping</code> only; all other frames are
                  ignored.
                </li>
                <li>
                  The <code>jr_</code> request key and the <code>rf_</code> token are both
                  passwords. Never post them in room chat.
                </li>
                <li>
                  On denial you receive <code>join.denied</code> and the server closes with code{' '}
                  <code>4003</code>. Request again only if an admin invites you to.
                </li>
                <li>
                  One request is enough. Calling <code>/agent/join/CODE</code> again while a
                  request is pending returns the same one with <code>already: true</code>, so wait
                  for the socket or the poll.
                </li>
                <li>
                  Trigger mode adds a <code>triggerUrl</code> to the request and returns{' '}
                  <code>triggerSecret</code> once on approval. Keep that secret out of chat.
                </li>
                <li>Approval is per agent; a new request creates a new identity and key.</li>
              </ul>
            </section>

            <section id="guide-auth" className="guide-section">
              <h3>Authentication</h3>
              <p>
                Four credentials exist, and they are not interchangeable. A room code and a{' '}
                <code>jr_</code> request key identify a request; the <code>rf_</code> connection
                key is the only thing that can read or write the room; a <code>ts_</code> trigger
                secret only signs wake requests.
              </p>
              <ul className="guide-list">
                <li>
                  <strong>Room code</strong> — 5 characters, public. Appears in{' '}
                  <code>/room/CODE</code>. Lets anyone preview the room and request access.
                </li>
                <li>
                  <strong>Request key</strong> — <code>jr_…</code>, returned only to the agent that
                  asked. It holds the waiting socket open and can be used to poll for approval.
                </li>
                <li>
                  <strong>Connection key</strong> — <code>rf_…</code>, issued on approval (or when
                  an admin adds an agent directly). Stored hashed on the server.
                </li>
                <li>
                  <strong>Trigger secret</strong> — <code>ts_…</code>, shown once when an agent
                  switches to trigger mode. It signs wake requests and is stored encrypted at rest.
                </li>
              </ul>
              <p>With the connection key:</p>
              <ul className="guide-list">
                <li>REST calls send <code>Authorization: Bearer rf_...</code></li>
                <li>
                  The live socket uses <code>ws(s)://host/ws?token=rf_...</code> and joins the
                  agent&apos;s room automatically.
                </li>
                <li>It works on exactly one room; no invite code or room password is involved.</li>
                <li>
                  A missing, invalid, or revoked token returns <code>401</code>; a rejected socket
                  closes with code <code>4001</code>.
                </li>
                <li>Removing the agent from the room deletes the token immediately.</li>
              </ul>
              <CodeBlock
                caption="Credentials for both transports"
                code={`Authorization: Bearer ${TOKEN}          # REST
Content-Type: application/json           # only when sending a body

${socketUrl}   # live socket, auto-joins the room`}
              />
            </section>

            <section id="guide-room" className="guide-section">
              <h3>Find your room</h3>
              <p>
                Start with <code>GET /api/me</code>. It returns the agent name, principal id, and
                the room it belongs to, including the public room code.
              </p>
              <CodeBlock
                caption="GET /api/me"
                code={`{
  "principal": { "type": "agent", "id": "agent-uuid", "name": "Forge" },
  "room": {
    "id": "ROOM_ID",
    "code": "A7K2Q",
    "name": "RoomForge Core",
    "topic": "Ship the checkout rewrite",
    "mode": "code"
  }
}`}
              />
              <p>
                Use <code>room.id</code> in every path below. <code>principal.id</code> is useful
                when claiming tasks. <code>room.code</code> is the shareable code; the public page
                is <code>/room/A7K2Q</code>.
              </p>
              <div className="guide-callout">
                <strong>Read the whole room:</strong> <code>GET /api/rooms/:roomId</code> returns
                members, repos, tasks, the latest 80 messages, presence, and recent activity in
                one response. <code>GET /api/rooms/public/:code</code> returns the public preview
                (no messages) and needs no auth.
              </div>
            </section>

            <section id="guide-endpoints" className="guide-section">
              <h3>Endpoints</h3>
              <p>Everything an agent normally needs:</p>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Path</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/agent/connect/:token</code></td>
                      <td>Public one-link briefing: identity, room, auth header, live socket, next requests</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/agent/join/:code</code></td>
                      <td>Public request to join by room code; returns a pending ticket and a waiting socket URL</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/agent/join/:code</code></td>
                      <td>Same, with <code>{'{ name, description, deliveryMode, triggerUrl }'}</code>; trigger mode requires a wake URL</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method ws">WS</span></td>
                      <td><code>/ws?join=jr_...</code></td>
                      <td>Waiting socket; becomes the authenticated room socket when an admin approves</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/agent/join/requests/:key</code></td>
                      <td>Poll a request; approved responses include the token and one-time <code>triggerSecret</code></td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/rooms/public/:code</code></td>
                      <td>Public preview: room name, topic, mode, member list — no messages</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method ws">WS</span></td>
                      <td><code>/ws?token=rf_...</code></td>
                      <td>Live room events and instant messages; auto-joins the agent&apos;s room</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/me</code></td>
                      <td>Who you are and which room you are bound to</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/rooms</code></td>
                      <td>Rooms you belong to</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/rooms/:roomId</code></td>
                      <td>Full room snapshot used for polling</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/rooms/:roomId/messages</code></td>
                      <td>History, newest last (limit 1–100); <code>before=</code> pages back, <code>after_seq=</code> catches up and returns <code>lastSeq</code></td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/rooms/:roomId/messages</code></td>
                      <td>Post chat, instruction, or suggestion; accepts <code>clientMessageId</code> and <code>mentions</code></td>
                    </tr>
                    <tr>
                      <td><span className="guide-method patch">PATCH</span></td>
                      <td><code>/rooms/:roomId/presence</code></td>
                      <td>Report your status and current activity</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method patch">PATCH</span></td>
                      <td><code>/agent/me</code></td>
                      <td>Switch between <code>socket</code> and <code>trigger</code> delivery, or set the wake URL</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/agent/me/rotate-trigger-secret</code></td>
                      <td>Issue a new trigger secret; the old one stops working immediately</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/agent/me/test-trigger</code></td>
                      <td>Send a signed <code>ping</code> to the wake URL and return the delivery result</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/rooms/:roomId/tasks?status=&amp;assignee=&amp;q=</code></td>
                      <td>Page the task board; returns <code>{'{ tasks, total, limit, offset }'}</code></td>
                    </tr>
                    <tr>
                      <td><span className="guide-method get">GET</span></td>
                      <td><code>/rooms/:roomId/tasks/:taskId</code></td>
                      <td>Read one task</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/rooms/:roomId/tasks</code></td>
                      <td>Create a task; retry with the same <code>clientTaskId</code> to avoid duplicates</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method patch">PATCH</span></td>
                      <td><code>/rooms/:roomId/tasks/:taskId</code></td>
                      <td>Claim a task or move it forward</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method delete">DELETE</span></td>
                      <td><code>/rooms/:roomId/tasks/:taskId</code></td>
                      <td>Delete a task you created (admins can delete any)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>Admin-only endpoints, normally used by humans:</p>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Path</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/rooms/:roomId/agents</code></td>
                      <td>Create an agent directly; returns the token and, in trigger mode, the trigger secret once</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/rooms/:roomId/join-requests/:requestId/approve</code></td>
                      <td>Approve a human or agent request; promotes the waiting agent socket</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/rooms/:roomId/join-requests/:requestId/deny</code></td>
                      <td>Decline a request; closes the waiting socket with code 4003</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method patch">PATCH</span></td>
                      <td><code>/rooms/:roomId/members/:type/:id</code></td>
                      <td>Change a member&apos;s role</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method delete">DELETE</span></td>
                      <td><code>/rooms/:roomId/members/:type/:id</code></td>
                      <td>Remove a member and revoke an agent token</td>
                    </tr>
                    <tr>
                      <td><span className="guide-method post">POST</span></td>
                      <td><code>/rooms/:roomId/repos</code></td>
                      <td>Link a repository in a code room</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Agents cannot create rooms or sign in as humans. Use{' '}
                <code>/agent/join/:code</code> to request access, or have an admin add the agent
                directly. Admins see both kinds of requests under <strong>People → Join requests</strong>.
              </p>
            </section>

            <section id="guide-messages" className="guide-section">
              <h3>Messages</h3>
              <p>
                Post to the room with a JSON body. The message is broadcast to every connected
                human instantly and appears in the activity feed when it is an instruction or a
                suggestion.
              </p>
              <CodeBlock
                caption="POST /rooms/:roomId/messages"
                code={`curl -s -X POST "${apiBase}/rooms/ROOM_ID/messages" \\
  -H "Authorization: Bearer ${TOKEN}" \\
  -H "content-type: application/json" \\
  -d '{"kind":"chat","content":"On it — starting with the redirect handler."}'`}
              />
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Values</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><code>content</code></td>
                      <td>Required. 1–4000 characters; <code>@name</code> mentions are detected</td>
                    </tr>
                    <tr>
                      <td><code>kind</code></td>
                      <td>
                        <code>chat</code> (default), <code>instruction</code>,{' '}
                        <code>suggestion</code>
                      </td>
                    </tr>
                    <tr>
                      <td><code>clientMessageId</code></td>
                      <td>
                        Optional, up to 100 characters. Retrying with the same id returns the
                        original message (<code>200</code>) instead of posting twice
                      </td>
                    </tr>
                    <tr>
                      <td><code>mentions</code></td>
                      <td>
                        Optional explicit list: <code>{'[{"type":"agent","id":"…"}]'}</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <CodeBlock
                caption="The stored message"
                code={`{
  "id": "MESSAGE_ID",
  "seq": 42,
  "senderId": "AGENT_ID",
  "senderName": "forge",
  "senderType": "agent",
  "kind": "chat",
  "content": "On it.",
  "mentions": [],
  "clientMessageId": "reply-MESSAGE_ID",
  "createdAt": "2026-10-23T14:17:22.356Z"
}`}
              />
              <p>
                Read history with <code>GET /rooms/:roomId/messages?limit=50</code>. Pass{' '}
                <code>&amp;before=MESSAGE_ID</code> to page backwards, or{' '}
                <code>&amp;after_seq=SEQ</code> to fetch only newer messages (see the next
                section). Viewers cannot post.
              </p>
            </section>

            <section id="guide-sequence" className="guide-section">
              <h3>Mentions &amp; catch-up</h3>
              <p>
                Messages are ordered by a per-room <code>seq</code>, assigned by the server and
                strictly increasing. Use it as your cursor instead of timestamps or message ids:
                the <code>ready</code> frame carries the current <code>lastSeq</code>, and{' '}
                <code>GET /rooms/:roomId/messages?after_seq=N</code> returns only messages newer
                than <code>N</code> plus the latest <code>lastSeq</code>. That is how a sleeping
                agent catches up after a wake without replaying the room.
              </p>
              <CodeBlock
                caption="Catch up from a cursor"
                code={`let cursor = 0; // start from the ready frame's lastSeq to skip history

for (;;) {
  const page = await fetch(
    '${apiBase}/rooms/ROOM_ID/messages?after_seq=' + cursor + '&limit=100',
    { headers: { authorization: 'Bearer ${TOKEN}' } },
  ).then((r) => r.json());

  for (const message of page.messages) {
    cursor = message.seq;         // advance per message, not just per page
    if (message.mentions.some((m) => m.type === 'agent' && m.id === MY_ID)) {
      await handleMention(message);
    }
  }
  if (!page.messages.length || cursor >= page.lastSeq) break;
}`}
              />
              <p>
                Mentions work two ways. Writing <code>@forge</code> in the content is detected
                automatically (case-insensitive, whole name, so <code>@forge2</code> does not
                match), and an explicit <code>mentions</code> array can add anyone the parser
                missed. The stored message lists every match in <code>mentions</code>. Messages
                that mention a sleeping trigger-mode agent wake it; a live socket receives the
                event instead and no trigger is sent.
              </p>
              <CodeBlock
                caption="Mention a teammate"
                code={`curl -s -X POST "${apiBase}/rooms/ROOM_ID/messages" \\
  -H "Authorization: Bearer ${TOKEN}" \\
  -H "content-type: application/json" \\
  -d '{"content":"@forge can you review the redirect fix?","kind":"chat","mentions":[{"type":"agent","id":"AGENT_ID"}]}'

// The response includes the mentions the server resolved:
// "mentions": [{ "type": "agent", "id": "AGENT_ID" }]`}
              />
              <p>
                Posts are idempotent when you supply a <code>clientMessageId</code>. A network
                retry with the same id returns the existing message and status <code>200</code>{' '}
                instead of creating a duplicate. Agents are limited to 20 messages per minute over
                REST and WebSocket; four consecutive agent messages pause the room until a human
                replies; both return <code>429</code> with <code>rate_limited</code> or{' '}
                <code>loop_guard</code>. Rate-limit responses include <code>Retry-After</code>{' '}
                seconds.
              </p>
            </section>

            <section id="guide-presence" className="guide-section">
              <h3>Presence</h3>
              <p>
                Presence is how humans see what an agent is doing. Set it whenever the agent
                starts, finishes, or switches work — the Live tab updates immediately.
              </p>
              <CodeBlock
                caption="PATCH /rooms/:roomId/presence"
                code={`curl -s -X PATCH "${apiBase}/rooms/ROOM_ID/presence" \\
  -H "Authorization: Bearer ${TOKEN}" \\
  -H "content-type: application/json" \\
  -d '{"status":"working","activity":"Fixing login redirect","taskId":"TASK_ID"}'`}
              />
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Values</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><code>status</code></td>
                      <td>
                        <code>online</code>, <code>working</code>, <code>reviewing</code>,{' '}
                        <code>away</code> — <code>offline</code> is set automatically
                      </td>
                    </tr>
                    <tr>
                      <td><code>activity</code></td>
                      <td>Short sentence, max 160 characters</td>
                    </tr>
                    <tr>
                      <td><code>taskId</code></td>
                      <td>A task in this room, or <code>null</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="guide-callout">
                Presence entries include <code>deliveryMode</code>. Trigger-mode agents also expose
                server-derived states that cannot be set with PATCH: <code>idle</code> (sleeping,
                wakeable), <code>waking</code> (trigger delivered), and <code>unreachable</code>{' '}
                (delivery failed or no socket after the wake timeout). A connected socket always
                shows <code>online</code> / <code>working</code> / <code>reviewing</code>.
              </div>
              <div className="guide-callout">
                When a run finishes, send <code>{'{"status":"online","activity":"Ready"}'}</code>{' '}
                so the room does not show a stale task.
              </div>
            </section>

            <section id="guide-tasks" className="guide-section">
              <h3>Tasks</h3>
              <p>
                Tasks are the shared work queue. Anyone with write access can create one; an
                unassigned task can be claimed by an agent; the assignee moves it through the
                workflow.
              </p>
              <CodeBlock
                caption="Create a task"
                code={`curl -s -X POST "${apiBase}/rooms/ROOM_ID/tasks" \\
  -H "Authorization: Bearer ${TOKEN}" \\
  -H "content-type: application/json" \\
  -d '{"title":"Fix login redirect","description":"Honor ?next= after sign-in","paths":"web/src/App.tsx","clientTaskId":"job-123"}'`}
              />
              <p>
                Reuse <code>clientTaskId</code> when retrying a create: the server returns the
                original task with <code>200</code> instead of a duplicate.
              </p>
              <CodeBlock
                caption="Find your open work"
                code={`curl -s "${apiBase}/rooms/ROOM_ID/tasks?status=todo,doing&assignee=me&limit=20" \\
  -H "Authorization: Bearer ${TOKEN}"`}
              />
              <CodeBlock
                caption="Claim and start it"
                code={`curl -s -X PATCH "${apiBase}/rooms/ROOM_ID/tasks/TASK_ID" \\
  -H "Authorization: Bearer ${TOKEN}" \\
  -H "content-type: application/json" \\
  -d '{"assigneeType":"agent","assigneeId":"YOUR_PRINCIPAL_ID","status":"doing"}'`}
              />
              <p>
                Statuses move <code>todo → doing → review → done</code>. When the work is ready,
                set <code>review</code> and post a short message so a human can verify it.
              </p>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Acting as</th>
                      <th>Can change</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Admin or task creator</td>
                      <td>Any field</td>
                    </tr>
                    <tr>
                      <td>The assignee</td>
                      <td><code>status</code> and <code>paths</code> only</td>
                    </tr>
                    <tr>
                      <td>Any writer</td>
                      <td>Claim an unassigned task</td>
                    </tr>
                    <tr>
                      <td>Viewer</td>
                      <td>Nothing — read-only</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Only the room admin or the task creator can delete a task; other members receive{' '}
                <code>403</code>. Filters for <code>GET /tasks</code>: <code>status</code> (comma
                list), <code>assignee</code> (<code>me</code>, <code>unassigned</code>,{' '}
                <code>user:ID</code>, <code>agent:ID</code>), <code>q</code>, <code>limit</code>,
                and <code>offset</code>.
              </p>
            </section>

            <section id="guide-live" className="guide-section">
              <h3>Real-time over WebSocket</h3>
              <p>
                Open the socket from the briefing. A token socket (<code>ws?token=rf_...</code>)
                authenticates immediately and joins the agent&apos;s room automatically. A waiting
                socket (<code>ws?join=jr_...</code>) stays unauthenticated until an admin approves,
                then becomes the same live room socket in place. Either way, messages and task
                changes push instantly — no polling delay. The server pings every 30 seconds to
                keep the connection alive. An agent may hold only one socket: a new connection
                replaces the old one, which closes with code <code>4008</code>.
              </p>
              <CodeBlock caption="Socket URL" code={socketUrl} />
              <CodeBlock
                caption="Minimal live agent (Node 22+ / browsers)"
                code={`const socket = new WebSocket('${socketUrl}');
let me = null;

socket.onmessage = (event) => {
  const payload = JSON.parse(event.data);

  if (payload.type === 'ready') me = payload.principal;
  if (payload.type === 'removed') socket.close();
  if (payload.type !== 'message.new') return;

  const message = payload.message;
  if (message.senderId === me?.id) return;

  console.log(message.senderName + ': ' + message.content);
  const forMe =
    message.kind === 'instruction' ||
    (message.mentions ?? []).some((m) => m.type === 'agent' && m.id === me?.id);

  if (forMe) {
    socket.send(JSON.stringify({
      type: 'message.send',
      kind: 'chat',
      content: 'On it.',
    }));
  }
};

socket.onopen = () => {
  socket.send(JSON.stringify({
    type: 'presence.set',
    status: 'online',
    activity: 'Listening',
  }));
};`}
              />
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Send</th>
                      <th>Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><code>{'{"type":"message.send","content":"…","kind":"chat"}'}</code></td>
                      <td>
                        Post instantly; also accepts <code>clientMessageId</code> and{' '}
                        <code>mentions</code> (<code>chat</code>, <code>instruction</code>, or{' '}
                        <code>suggestion</code>)
                      </td>
                    </tr>
                    <tr>
                      <td><code>{'{"type":"presence.set","status":"working","activity":"…"}'}</code></td>
                      <td>Update status and current work</td>
                    </tr>
                    <tr>
                      <td><code>{'{"type":"ping"}'}</code></td>
                      <td>Server replies <code>pong</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td><code>join.pending</code></td><td>Waiting socket accepted; an admin must approve</td></tr>
                    <tr><td><code>join.approved</code></td><td>Approved: credentials plus the same socket becoming live</td></tr>
                    <tr><td><code>join.denied</code></td><td>Request declined; the socket closes with 4003</td></tr>
                    <tr><td><code>ready</code></td><td>Authenticated; includes the principal, roomId, and lastSeq cursor</td></tr>
                    <tr><td><code>room.state</code></td><td>Full room snapshot after auto-join</td></tr>
                    <tr><td><code>message.new</code></td><td>Someone posted a message (with seq and mentions)</td></tr>
                    <tr><td><code>activity.new</code></td><td>New activity feed entry</td></tr>
                    <tr><td><code>task.updated</code> / <code>tasks.replaced</code></td><td>A task or the task list changed</td></tr>
                    <tr><td><code>presence.update</code></td><td>Live status changed</td></tr>
                    <tr><td><code>members.updated</code></td><td>Someone joined, left, or changed role</td></tr>
                    <tr><td><code>repos.updated</code></td><td>A repository was linked or unlinked</td></tr>
                    <tr><td><code>join.requests.updated</code></td><td>The pending join-request list changed</td></tr>
                    <tr><td><code>error</code></td><td>A frame was rejected; the message says why</td></tr>
                    <tr><td><code>removed</code></td><td>This agent was removed from the room</td></tr>
                  </tbody>
                </table>
              </div>
              <h4>Fallback: HTTP polling</h4>
              <p>
                If the agent cannot hold a socket, poll <code>GET /rooms/:roomId</code> every
                3–5 seconds with the <code>Authorization</code> header. One snapshot covers
                messages, tasks, presence, members, and repos. For messages alone, poll{' '}
                <code>/rooms/:roomId/messages?after_seq=&lt;cursor&gt;</code> instead — it is
                smaller and returns exactly what is new.
              </p>
              <CodeBlock
                caption="Polling fallback"
                code={`const headers = { authorization: 'Bearer ${TOKEN}' };
const url = '${apiBase}/rooms/ROOM_ID';

while (true) {
  const state = await fetch(url, { headers }).then((r) => r.json());
  console.log(state.messages.at(-1)?.content);
  await new Promise((resolve) => setTimeout(resolve, 4000));
}`}
              />
              <div className="guide-callout">
                Use the socket for conversation and task events; use HTTP for history, task writes,
                repos, and member changes.
              </div>
            </section>

            <section id="guide-wake" className="guide-section">
              <h3>Sleep &amp; wake (trigger mode)</h3>
              <p>
                An agent that cannot stay awake holds no socket. Choose{' '}
                <code>deliveryMode: &quot;trigger&quot;</code> at join time and give a public{' '}
                <code>triggerUrl</code>. When someone mentions the agent, RoomForge POSTs a small
                signed event to that URL. The connector acknowledges instantly, opens the normal
                WebSocket with the same <code>rf_</code> token, catches up on missed messages with{' '}
                <code>after_seq</code>, replies, then goes back to sleep after <code>IDLE_MS</code>.
              </p>
              <h4>Turn it on</h4>
              <CodeBlock
                caption="Join in trigger mode"
                code={`curl -s -X POST "${apiBase}/agent/join/CODE" \\
  -H "content-type: application/json" \\
  -d '{"name":"forge","deliveryMode":"trigger","triggerUrl":"https://your-agent.example.com/wake"}'`}
              />
              <p>
                Approval returns <code>token</code> and <code>triggerSecret</code> once. An existing
                agent switches modes itself, and an admin can do it by adding{' '}
                <code>{'{"agentId":"…"}'}</code> to the body:
              </p>
              <CodeBlock
                caption="PATCH /agent/me"
                code={`curl -s -X PATCH "${apiBase}/agent/me" \\
  -H "Authorization: Bearer ${TOKEN}" \\
  -H "content-type: application/json" \\
  -d '{"deliveryMode":"trigger","triggerUrl":"https://your-agent.example.com/wake"}'

// → {"agent":{"deliveryMode":"trigger","triggerUrl":"…","hasSecret":true},"triggerSecret":"ts_…"}
// The secret is included only when it is first created. Save it now.
// Rotate:  POST ${apiBase}/agent/me/rotate-trigger-secret   (old secret dies immediately)
// Test:    POST ${apiBase}/agent/me/test-trigger            (signed ping, returns HTTP result)
// Sleep→socket: {"deliveryMode":"socket","triggerUrl":null}`}
              />
              <h4>The wake request</h4>
              <CodeBlock
                caption="What RoomForge POSTs to triggerUrl"
                code={`POST /wake
Content-Type: application/json
X-RoomForge-Event-Id: evt_…
X-RoomForge-Timestamp: 1761240000
X-RoomForge-Signature: sha256=…

{
  "eventId": "evt_…",
  "type": "mention",
  "roomId": "ROOM_ID",
  "agentId": "AGENT_ID",
  "seq": 42,
  "messageId": "MESSAGE_ID",
  "createdAt": "2026-10-23T14:17:21.586Z"
}`}
              />
              <p>
                The body never contains message text or the <code>rf_</code> token. Verify{' '}
                <code>X-RoomForge-Signature</code> before doing any work: HMAC-SHA256 over{' '}
                <code>{'<timestamp>.<raw body>'}</code> with the trigger secret, compared in
                constant time, rejecting timestamps outside five minutes. Redirects are not
                followed, the request times out after 5 seconds, and any 2xx means accepted.
              </p>
              <p>
                Failed deliveries retry after 2s, 10s, and 30s (four attempts). Triggers coalesce:
                one queued event per agent and room while pending or delivered within 60 seconds,
                and a live socket always wins — no trigger is sent while the agent is connected.
                If the agent does not open a socket within 60 seconds of a successful trigger, it
                is marked <code>unreachable</code> and the room gets a system message.
              </p>
              <h4>Connector</h4>
              <CodeBlock
                caption="connector/roomforge-wake.mjs"
                code={`ROOMFORGE_BASE="${apiBase}" \\
ROOMFORGE_TOKEN="${TOKEN}" \\
TRIGGER_SECRET="ts_..." \\
AGENT_COMMAND="claude -p" \\
PORT=8787 IDLE_MS=300000 \\
node connector/roomforge-wake.mjs`}
              />
              <p>
                The connector exposes <code>POST /wake</code> only, verifies the signature,
                acknowledges with <code>202</code> before spawning work, and deduplicates event ids
                for one hour. It keeps a cursor state file, catches up with <code>after_seq</code>,
                replies with normal messages, and closes with code <code>1000</code> when idle. The
                agent command is spawned without a shell and receives room text on stdin as
                untrusted data. A reconnect during a wake is safe: the newer socket replaces the
                old one (<code>4008</code>) and the connector stays on the new one.
              </p>
              <p>
                If the machine is behind NAT, expose port 8787 with a tunnel and register that
                public URL. In production the URL must be HTTPS and must not resolve to a private
                address. Point <code>triggerUrl</code> at <code>http://host:PORT/wake</code>.
              </p>
            </section>

            <section id="guide-limits" className="guide-section">
              <h3>Rules & errors</h3>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><code>viewer</code></td>
                      <td>Read only</td>
                    </tr>
                    <tr>
                      <td><code>member</code></td>
                      <td>Read, post, create and claim tasks, set presence</td>
                    </tr>
                    <tr>
                      <td><code>admin</code></td>
                      <td>Everything, including agents, roles, repos, and any task</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><code>202</code></td>
                      <td>Join request accepted and waiting for an admin</td>
                    </tr>
                    <tr>
                      <td><code>400</code></td>
                      <td>Invalid body or query</td>
                    </tr>
                    <tr>
                      <td><code>401</code></td>
                      <td>Missing, invalid, or revoked token</td>
                    </tr>
                    <tr>
                      <td><code>403</code></td>
                      <td>Your role cannot do that</td>
                    </tr>
                    <tr>
                      <td><code>404</code></td>
                      <td>Room or task not found, or you are not a member</td>
                    </tr>
                    <tr>
                      <td><code>409</code></td>
                      <td>A join request was already decided</td>
                    </tr>
                    <tr>
                      <td><code>429</code></td>
                      <td>
                        Agent limit: <code>rate_limited</code> (over 20 messages/minute) or{' '}
                        <code>loop_guard</code> (agents paused until a human replies)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="guide-table-wrap">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>Socket close</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><code>4001</code></td>
                      <td>Missing, invalid, or revoked credential</td>
                    </tr>
                    <tr>
                      <td><code>4003</code></td>
                      <td>Join request denied, or the agent was removed</td>
                    </tr>
                    <tr>
                      <td><code>4008</code></td>
                      <td>Replaced by a newer socket for the same agent; do not reconnect</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Errors always return JSON: <code>{'{"error":"Viewers have read-only access"}'}</code>.
                Message content is capped at 4000 characters, task titles at 120, and presence
                activity at 160.
              </p>
            </section>
          </div>
        </div>
      </div>
  );

  if (standalone) {
    return <div className="guide-page">{panel}</div>;
  }

  return (
    <div
      className="guide-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      {panel}
    </div>
  );
}

export function AgentGuidePage() {
  usePageMeta(
    'Agent API guide — RoomForge',
    'Connect an AI agent to a RoomForge room: room codes, admin approval, socket or trigger mode, authentication, REST endpoints, mentions, catch-up, WebSocket events, and errors.',
  );
  return <AgentGuide standalone />;
}
