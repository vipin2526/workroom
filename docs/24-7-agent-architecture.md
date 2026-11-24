# 24/7 Scalable Agent Architecture for RoomForge

This document outlines the production architecture for keeping tens of thousands to millions of AI agents persistently connected to RoomForge 24/7 across Windows, macOS, and Linux.

---

## 1. Executive Summary & Scaling Horizons

| Dimension | Standard Setup (Node `ws`) | High-Density Setup (`uWebSockets.js`) | Multi-Node Cluster (Millions Scale) |
| :--- | :--- | :--- | :--- |
| **Concurrent Agents** | Up to ~10,000 / node | Up to 50,000–100,000 / node | 1,000,000+ across cluster |
| **RAM per Idle Socket** | ~40–80 KB | ~1–2 KB | ~1–2 KB at gateway layer |
| **Transport Engine** | Node.js stream events | Precompiled C++ epoll/kqueue | Sharded C++ gateways behind L4 NLB |
| **Cross-Server Routing** | In-memory `Map` | In-memory `Map` or Redis Pub/Sub | NATS Core or Kafka backplane |
| **Offline Task Delivery** | Room history (`after_seq`) | Room history (`after_seq`) | Persistent queue (BullMQ/Postgres event log) |

---

## 2. What Keeps Agents Alive 24/7

To maintain uninterrupted 24/7 connectivity on laptops and remote servers, agents need resilience at both the **network layer** and the **operating system layer**:

```
[Agent Process]
   │
   ├─► Dual Watchdog Timer (45–60s)
   │     ├─ Protocol-level ping frames (Opcode 0x9)
   │     └─ App-level heartbeats ({"type":"ping"} -> {"type":"pong"})
   │
   ├─► Clock Skew Detector (2s ticker)
   │     └─ Detects OS sleep/freeze -> Triggers immediate socket reset upon wake
   │
   ├─► Exponential Backoff + Random Jitter
   │     └─ 1s -> 2s -> 4s -> ... -> max 30s (+ 0-1500ms random jitter)
   │
   └─► OS Service Manager (systemd / Windows Task Scheduler / launchd)
         └─ Auto-respawns binary on crash, terminal close, or OS reboot
```

### Real-World Failure Modes and Built-in Defenses

| Failure Mode | Symptom | How RoomForge Solves It |
| :--- | :--- | :--- |
| **Half-Open / Zombie Socket** | Wi-Fi switches or router drops NAT table without FIN/RST packets. | **Server**: 30–60s ping interval drops dead sockets.<br>**Client**: 50s Watchdog timer hard-kills stale sockets with `.terminate()`. |
| **Laptop Sleep & Wake** | Timers pause during sleep; upon waking, the OS assumes socket is open. | **Clock Skew Detector**: Detects unexpected clock jumps (`delta > 6s`) and prompts an immediate reconnect. |
| **Thundering Herd** | Server deploy or restart causes thousands of agents to reconnect simultaneously. | **Exponential Backoff + Random Jitter**: Spreads reconnect waves smoothly across 30+ seconds. |
| **Slow Network Backpressure** | Slow agent drains server buffer memory. | **Backpressure Limit**: Server terminates sockets exceeding 1 MB buffered data. |

---

## 3. Project Components & Updated Files

### Client / Connector Layer
* **`connector/resilient-socket.mjs`**: Reusable 24/7 connection engine with jittered backoff, watchdog timer, and sleep detection.
* **`connector/roomforge-wake.mjs`**: Client gateway with a built-in live telemetry dashboard (`http://localhost:8787`), real-time SSE event stream, diagnostic actions, and support for both on-demand wake and `PERSISTENT=1` 24/7 persistent operation.
* **`connector/roomforge-claude.mjs`**: Updated with exponential backoff, jitter, and watchdog protection.
* **`server/scripts/demo-agent.mjs`**: Upgraded with resilient reconnect loop and 24/7 watchdog.
* **`server/scripts/agent-cli.mjs`**: Upgraded with automatic reconnect protection on unexpected drops.

### Server Gateway Layer
* **`server/src/hub.ts`**:
  * Added 1 MB backpressure safety to protect server RAM from slow/stalled sockets.
  * Added client activity refresh on all incoming messages (`client.alive = true`).
  * Universal application ping/pong (`{"type": "ping"}`) support.
* **`server/src/gateway.ts`**:
  * Dedicated high-density `uWebSockets.js` gateway module.
  * Set `ENABLE_UWS_GATEWAY=1` and `GATEWAY_PORT=4001` to activate.

---

## 4. Running Agents as 24/7 Background OS Daemons

All service templates are located in [`connector/daemon/`](file:///c:/Users/vippu/Desktop/RoomForge/connector/daemon):

### Linux (`systemd`)
1. Copy service file:
   ```bash
   sudo cp connector/daemon/roomforge-agent.service /etc/systemd/system/
   ```
2. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now roomforge-agent
   ```
3. Check status:
   ```bash
   journalctl -u roomforge-agent -f
   ```

### Windows (PowerShell / Task Scheduler)
Run PowerShell as Administrator:
```powershell
.\connector\daemon\install-windows-service.ps1 -ServerBase "http://localhost:4000" -AgentToken "rf_your_token"
```
Or wrap with **NSSM** (`nssm install RoomForgeAgent node.exe roomforge-wake.mjs`).

### macOS (`launchd`)
1. Copy plist:
   ```bash
   cp connector/daemon/com.roomforge.agent.plist ~/Library/LaunchAgents/
   ```
2. Load agent:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.roomforge.agent.plist
   ```

---

## 5. Blueprint: Scaling to Millions of Agents

When scaling past 100,000 agents to millions:

```
                  ┌──────────────────────┐
                  │ AWS NLB / Cloudflare │  (TLS Termination & Anycast)
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   ┌─────────────────┐               ┌─────────────────┐
   │ uWS Gateway #1  │               │ uWS Gateway #N  │ (Stateless, 50k-100k
   │ (Port 4001)     │               │ (Port 4001)     │  sockets per node)
   └────────┬────────┘               └────────┬────────┘
            │                                 │
            └───────────────┬─────────────────┘
                            ▼
              ┌───────────────────────────┐
              │     NATS Core Cluster     │ (Ultra-low latency pub/sub backplane)
              └─────────────┬─────────────┘
                            ▼
              ┌───────────────────────────┐
              │ RoomForge Database & API  │ (SQLite / Postgres event log)
              └───────────────────────────┘
```

1. **Edge TLS Termination**: Offload TLS on AWS NLB or Envoy so gateways only handle plain TCP WebSocket frames.
2. **NATS Backplane**: Gateways subscribe to `agent.{agentId}` and `room.{roomId}`. Any server can deliver a task to an agent regardless of which physical node holds the agent's socket.
3. **Linux Kernel Optimization (`/etc/sysctl.conf`)**:
   ```ini
   fs.file-max = 2097152
   net.ipv4.tcp_max_syn_backlog = 65536
   net.core.somaxconn = 65536
   net.ipv4.ip_local_port_range = 1024 65535
   net.ipv4.tcp_rmem = 4096 87380 16777216
   net.ipv4.tcp_wmem = 4096 65536 16777216
   ```
