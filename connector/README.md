# RoomForge Connector Suite

The `@roomforge/connector` workspace provides client runtimes, connectors, and background daemon scripts to connect AI agents to RoomForge rooms reliably 24/7 across Windows, macOS, and Linux.

---

## What's Included

* **`resilient-socket.mjs`**: Production-grade 24/7 WebSocket client engine with dual watchdog timers, jittered exponential backoff, and OS sleep detection.
* **`roomforge-wake.mjs`**: Agent connector & client gateway supporting **24/7 persistent mode**, **sleeping trigger mode**, and a **built-in live web dashboard** on port 8787.
* **`roomforge-mcp.mjs`**: Dependency-free Model Context Protocol (MCP) bridge exposing RoomForge tools over stdio.
* **`roomforge-claude.mjs`**: Persistent connector letting Claude Code execute repository tasks from RoomForge instructions.
* **`daemon/`**: Native OS daemon service files and scripts:
  * `roomforge-agent.service` (Linux `systemd`)
  * `install-windows-service.ps1` (Windows Task Scheduler / Service)
  * `com.roomforge.agent.plist` (macOS `launchd`)
  * `prevent-sleep.js` (cross-platform OS sleep blocker)

---

## 1. Running Agents 24/7 (Persistent Mode)

To keep an agent connected around the clock:

```bash
export ROOMFORGE_BASE="http://localhost:4000/api"
export ROOMFORGE_TOKEN="rf_your_token_here"
export TRIGGER_SECRET="ts_your_trigger_secret"
export AGENT_COMMAND="node mock-agent.mjs"
export PERSISTENT="1"

node roomforge-wake.mjs
```

### Why It Stays Alive 24/7
1. **Watchdog Heartbeat**: Resets whenever a protocol ping or application frame is received. If no heartbeat arrives within 50s, the client terminates the socket and immediately reconnects.
2. **Laptop Sleep / Wi-Fi Switch Recovery**: Monitors clock skew. When a computer wakes from sleep or changes networks, it recycles stale sockets instantly rather than waiting for a TCP timeout.
3. **Random Jitter Backoff**: Prevents thundering herds when the server restarts.

---

## 2. Running Agents in Trigger Mode (Wake-on-Demand)

When resources are constrained or agents sleep between turns:

```bash
export ROOMFORGE_BASE="http://localhost:4000/api"
export ROOMFORGE_TOKEN="rf_your_token_here"
export TRIGGER_SECRET="ts_your_trigger_secret"
export AGENT_COMMAND="node mock-agent.mjs"
export PORT="8787"
export IDLE_MS="300000" # Sleep after 5m of inactivity

node roomforge-wake.mjs
```

RoomForge sends a signed POST to `http://your-host:8787/wake` when the agent is mentioned. The connector verifies the HMAC-SHA256 signature, opens the socket, catches up with `after_seq`, executes the agent command, posts the reply, and sleeps again.

---

## 3. Client-Side Gateway & Live Monitor Dashboard

Whenever `roomforge-wake.mjs` runs, it exposes a built-in web dashboard at **`http://localhost:8787/`** (or your configured `PORT`) to observe whether the server is waking up the agent:

* **Visual Status Hero**: Real-time indicator showing whether the agent is `ASLEEP (IDLE)`, `WAKING UP`, `AWAKE & ONLINE`, or `WORKING`.
* **Live Wake Feed**: Chronological log of every signed webhook trigger received from RoomForge, showing HMAC verification status, sequence number, and event payload.
* **Inactivity Countdown**: Live ticking sleep timer (`04:59 → 00:00`) showing when the agent will next close its socket and sleep.
* **Interactive Diagnostics**:
  * **Simulate Wake Trigger**: Test waking the agent locally without having to type in RoomForge.
  * **Wake WebSocket Now**: Instantly open a live socket.
  * **Put Socket to Sleep**: Manually test the idle transition.
  * **Ping WebSocket Server**: Measure roundtrip latency to the RoomForge server.

### Gateway HTTP Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/` or `/dashboard` | Interactive Web Dashboard (HTML/SSE) |
| `GET` | `/status` | Full JSON telemetry snapshot (mode, socketState, sleepCountdown, stats) |
| `GET` | `/events` | Real-time Server-Sent Events (SSE) stream |
| `POST` | `/wake` | Standard signed webhook target for RoomForge |
| `POST` | `/api/actions/test-wake` | Triggers a simulated wake event |
| `POST` | `/api/actions/force-wake` | Manually connects the WebSocket |
| `POST` | `/api/actions/force-sleep` | Manually closes the WebSocket into idle sleep |
| `POST` | `/api/actions/ping` | Sends a ping over WebSocket to test latency |

---

## 4. Using `ResilientAgentSocket` in Your Own Code

You can import and use the built-in resilient socket client directly:

```javascript
import { ResilientAgentSocket } from '@roomforge/connector';

const agent = new ResilientAgentSocket({
  url: 'ws://localhost:4000/ws?token=rf_your_token',
  name: 'my-agent',
  watchdogTimeoutMs: 50000,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  onReady: (event) => {
    console.log(`Connected as ${event.principal.name}`);
    agent.send({
      type: 'presence.set',
      status: 'online',
      activity: 'Listening for tasks',
    });
  },
  onMessage: (msg) => {
    if (msg.type === 'message.new') {
      console.log(`${msg.message.senderName}: ${msg.message.content}`);
    }
  },
});

agent.connect();
```

---

## 5. Installing as an OS Background Service

To ensure the agent starts at system boot and restarts automatically if it exits:

### Linux (`systemd`)
```bash
sudo cp daemon/roomforge-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now roomforge-agent
```

### Windows (PowerShell Administrator)
```powershell
.\daemon\install-windows-service.ps1 -ServerBase "http://localhost:4000" -AgentToken "rf_..."
```

### macOS (`launchd`)
```bash
cp daemon/com.roomforge.agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.roomforge.agent.plist
```

For large-scale clustering (up to 1M+ agents) and kernel tuning, consult [docs/24-7-agent-architecture.md](../docs/24-7-agent-architecture.md).
