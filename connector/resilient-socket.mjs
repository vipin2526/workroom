// Resilient WebSocket connection manager for 24/7 RoomForge agents.
//
// Designed to keep agents reliably connected 24/7 across Windows, macOS, and Linux:
// 1. Exponential backoff with random jitter (prevents thundering herds on server reboot).
// 2. Dual watchdog timer (handles protocol-level ping/pong + application heartbeats).
// 3. Laptop sleep / network-switch detection (identifies zombie sockets on OS wake).
// 4. Safe JSON framing and offline outbox queueing.

import WebSocket from 'ws';

export class ResilientAgentSocket {
  constructor(options) {
    this.url = options.url;
    this.name = options.name || 'agent';
    this.watchdogTimeoutMs = options.watchdogTimeoutMs ?? 45_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25_000;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.jitterMs = options.jitterMs ?? 1_500;

    this.onMessage = options.onMessage || (() => {});
    this.onReady = options.onReady || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onError = options.onError || (() => {});

    this.ws = null;
    this.retries = 0;
    this.watchdogTimer = null;
    this.heartbeatTimer = null;
    this.sleepDetectTimer = null;
    this.lastTick = Date.now();
    this.isManualClose = false;
    this.outbox = [];
  }

  log(...args) {
    console.log(`[${this.name}]`, ...args);
  }

  warn(...args) {
    console.warn(`[${this.name}]`, ...args);
  }

  connect() {
    this.isManualClose = false;
    this.startSleepDetector();

    try {
      this.ws = new WebSocket(typeof this.url === 'function' ? this.url() : this.url);
    } catch (err) {
      this.warn('Failed to construct WebSocket:', err.message);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.log('Connection established');
      this.retries = 0;
      this.resetWatchdog();
      this.startHeartbeat();
      this.flushOutbox();
    });

    // Capture low-level protocol ping frames (opcode 0x9)
    this.ws.on('ping', () => {
      this.resetWatchdog();
    });

    // Capture low-level protocol pong frames (opcode 0xA)
    this.ws.on('pong', () => {
      this.resetWatchdog();
    });

    this.ws.on('message', (raw) => {
      this.resetWatchdog();
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        // Non-JSON frame ignored
        return;
      }

      if (payload.type === 'pong') {
        // Application-level pong
        return;
      }

      if (payload.type === 'ready') {
        this.onReady(payload);
      }

      this.onMessage(payload);
    });

    // Important: Do not call ws.close() in ws.on('error').
    // The ws library always emits 'close' after 'error'.
    this.ws.on('error', (err) => {
      this.warn('Socket error:', err.message);
      this.onError(err);
    });

    this.ws.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer ? reasonBuffer.toString() : '';
      this.clearTimers();
      this.ws = null;

      this.onClose(code, reason);

      if (this.isManualClose) {
        this.log('Connection closed cleanly.');
        return;
      }

      // Permanent rejection codes:
      // 4001: Invalid / revoked token
      // 4003: Join request denied
      if (code === 4001 || code === 4003) {
        this.warn(`Authentication failed (${code}: ${reason || 'rejected'}). Halting reconnect.`);
        return;
      }

      this.scheduleReconnect();
    });
  }

  resetWatchdog() {
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      this.warn(`Watchdog timeout (${this.watchdogTimeoutMs}ms silence). Forcing reconnect...`);
      if (this.ws) {
        try {
          this.ws.terminate(); // Hard-kill zombie socket
        } catch {
          // ignore
        }
      }
    }, this.watchdogTimeoutMs);
  }

  startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          // Send lightweight application ping in case reverse proxies strip opcode 0x9
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore send error; close/watchdog handles it
        }
      }
    }, this.heartbeatIntervalMs);
  }

  // Detects laptop sleep or long system freezes
  startSleepDetector() {
    if (this.sleepDetectTimer) return;
    this.lastTick = Date.now();
    this.sleepDetectTimer = setInterval(() => {
      const now = Date.now();
      const delta = now - this.lastTick;
      this.lastTick = now;

      // If more than 6 seconds elapsed in a 2-second interval, machine went to sleep
      if (delta > 6_000) {
        this.warn(`OS sleep/freeze detected (clock jumped by ${delta}ms). Verifying socket...`);
        if (this.ws) {
          // Promptly test or recycle connection
          try {
            this.ws.terminate();
          } catch {
            // ignore
          }
        }
      }
    }, 2_000);
    this.sleepDetectTimer.unref?.();
  }

  scheduleReconnect() {
    this.retries += 1;
    // Exponential backoff: baseDelay * 2^(retries-1), capped at maxDelay
    const expDelay = Math.min(this.baseDelayMs * Math.pow(1.5, Math.min(this.retries, 10)), this.maxDelayMs);
    // Add random jitter to protect server against thundering herds
    const jitter = Math.floor(Math.random() * this.jitterMs);
    const delay = Math.round(expDelay + jitter);

    this.log(`Reconnecting in ${delay}ms (attempt #${this.retries})...`);
    setTimeout(() => {
      if (!this.isManualClose) {
        this.connect();
      }
    }, delay);
  }

  send(payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(data);
        return true;
      } catch (err) {
        this.warn('Send error:', err.message);
      }
    }

    // Queue in memory for temporary drops (cap at 200 items to avoid RAM leak)
    if (this.outbox.length < 200) {
      this.outbox.push(data);
    }
    return false;
  }

  flushOutbox() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.outbox.length > 0) {
      const item = this.outbox.shift();
      try {
        this.ws.send(item);
      } catch {
        this.outbox.unshift(item);
        break;
      }
    }
  }

  clearTimers() {
    clearTimeout(this.watchdogTimer);
    clearInterval(this.heartbeatTimer);
    this.watchdogTimer = null;
    this.heartbeatTimer = null;
  }

  close(code = 1000, reason = 'client close') {
    this.isManualClose = true;
    this.clearTimers();
    clearInterval(this.sleepDetectTimer);
    this.sleepDetectTimer = null;
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        // already closed
      }
    }
  }

  terminate() {
    this.isManualClose = true;
    this.clearTimers();
    clearInterval(this.sleepDetectTimer);
    this.sleepDetectTimer = null;
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // already closed
      }
    }
  }

  isOpen() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }
}
