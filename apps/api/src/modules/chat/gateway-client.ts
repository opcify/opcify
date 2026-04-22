import { randomUUID } from "node:crypto";
import { createLogger } from "../../logger.js";

const log = createLogger("gateway-ws");

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type EventHandler = (event: string, payload: unknown) => void;

/**
 * WebSocket client that connects to an OpenClaw gateway inside a workspace's
 * Docker container. Uses the gateway's JSON-RPC protocol v3.
 *
 * Wire format:
 *   Request:  { type: "req", id, method, params }
 *   Response: { type: "res", id, ok, payload?, error? }
 *   Event:    { type: "event", event, payload?, seq? }
 *
 * Connect flow:
 *   1. Open WS → server sends event `connect.challenge` with nonce
 *   2. Client sends `connect` request with auth token + client info
 *   3. Server responds with `hello-ok`
 */
export class GatewayWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private eventHandlers = new Set<EventHandler>();
  private closed = false;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 800;
  private _connected = false;

  private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  private static readonly MAX_BACKOFF_MS = 15_000;
  private static readonly CONNECT_TIMEOUT_MS = 12_000;

  constructor(
    private url: string,
    private token: string,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Open the WebSocket connection and complete the gateway handshake.
   * Resolves when the `hello-ok` response is received.
   */
  connect(): Promise<void> {
    if (this._connected) return Promise.resolve();
    this.closed = false;

    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      const timer = setTimeout(() => {
        this.connectResolve = null;
        this.connectReject = null;
        this.closed = true;
        this.ws?.close();
        this.clearTimers();
        reject(new Error("gateway connect timed out"));
      }, GatewayWsClient.CONNECT_TIMEOUT_MS);

      const origResolve = resolve;
      const origReject = reject;
      this.connectResolve = () => { clearTimeout(timer); origResolve(); };
      this.connectReject = (err) => { clearTimeout(timer); origReject(err); };

      this.openSocket();
    });
  }

  disconnect(): void {
    this.closed = true;
    this._connected = false;
    this.clearTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.flushPending(new Error("gateway client disconnected"));
  }

  /**
   * Send a JSON-RPC request and await the response.
   */
  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway not connected");
    }
    this.touchIdle();

    const id = randomUUID();
    const frame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  /**
   * Subscribe to server-pushed events. Returns an unsubscribe function.
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  // ── Internal ──────────────────────────────────────────────────────

  private openSocket(): void {
    if (this.closed) return;

    const wsUrl = this.url.replace(/^http/, "ws");
    log.info("Connecting to gateway", { url: wsUrl });

    // Send Origin + Authorization headers so the gateway's browser-origin
    // check passes and the WebSocket upgrade is authenticated.
    this.ws = new WebSocket(wsUrl, {
      headers: {
        Origin: this.url,
        Authorization: `Bearer ${this.token}`,
      },
    } as unknown as string[]);

    this.ws.addEventListener("open", () => {
      log.info("WebSocket open, waiting for connect challenge");
    });

    this.ws.addEventListener("message", (ev) => {
      this.handleMessage(String(ev.data ?? ""));
    });

    this.ws.addEventListener("close", (ev) => {
      // The DOM `CloseEvent` type isn't in the api package's tsconfig lib, but
      // the runtime payload always carries `code` and `reason` regardless of
      // whether we're using the global WebSocket or `ws`. Cast against a local
      // shape rather than depending on `lib: ["DOM"]`.
      const e = ev as unknown as { code: number; reason: string };
      const reason = String(e.reason ?? "");
      log.info("WebSocket closed", { code: e.code, reason });
      this._connected = false;
      this.ws = null;
      this.flushPending(new Error(`gateway closed (${e.code}): ${reason}`));

      if (!this.closed) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener("error", () => {
      // close handler will fire
    });
  }

  private handleMessage(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const type = parsed.type as string;

    // Server-pushed event
    if (type === "event") {
      const event = parsed.event as string;
      const payload = parsed.payload;

      // Handle connect challenge — send connect request
      if (event === "connect.challenge") {
        const nonce =
          payload && typeof payload === "object" && "nonce" in payload
            ? (payload as { nonce: string }).nonce
            : undefined;
        void this.sendConnect(nonce);
        return;
      }

      // Dispatch to subscribers
      for (const handler of this.eventHandlers) {
        try {
          handler(event, payload);
        } catch (err) {
          log.error("Event handler error", {
            event,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }

    // Request response
    if (type === "res") {
      const id = parsed.id as string;
      const ok = parsed.ok as boolean;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);

      if (ok) {
        p.resolve(parsed.payload);
      } else {
        const err = parsed.error as
          | { code?: string; message?: string }
          | undefined;
        p.reject(
          new Error(err?.message ?? "gateway request failed"),
        );
      }
    }
  }

  private async sendConnect(_nonce?: string): Promise<void> {
    try {
      await this.request("connect", {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-control-ui",
          version: "opcify-api",
          platform: "node",
          mode: "backend",
        },
        role: "operator",
        scopes: [
          "operator.admin",
          "operator.read",
          "operator.write",
        ],
        caps: [],
        auth: { token: this.token },
        userAgent: "opcify-api/1.0",
        locale: "en",
      });

      this._connected = true;
      this.backoffMs = 800;
      this.touchIdle();
      log.info("Gateway connected");
      this.connectResolve?.();
      this.connectResolve = null;
      this.connectReject = null;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(String(err));
      log.error("Gateway connect failed", { error: error.message });
      this.connectReject?.(error);
      this.connectResolve = null;
      this.connectReject = null;
      this.ws?.close();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(
      this.backoffMs * 1.7,
      GatewayWsClient.MAX_BACKOFF_MS,
    );
    log.info("Scheduling reconnect", { delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private flushPending(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      log.info("Idle timeout — disconnecting");
      this.disconnect();
    }, GatewayWsClient.IDLE_TIMEOUT_MS);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
