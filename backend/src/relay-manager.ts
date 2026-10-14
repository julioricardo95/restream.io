import { spawn, type ChildProcess } from "node:child_process";
import type { Destination } from "./types.js";

interface RelaySession {
  clientId?: string;
  destinations: Destination[];
  child?: ChildProcess;
  retryTimer?: NodeJS.Timeout;
  stopped: boolean;
  attempts: number;
}

const MAX_START_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

export class RelayManager {
  private readonly sessions = new Map<string, RelaySession>();

  constructor(
    private readonly ffmpegPath: string,
    private readonly rtmpHost: string,
    private readonly rtmpPort: number,
  ) {}

  start(streamKey: string, destinations: Destination[], clientId?: string): void {
    this.stop(streamKey);
    const session: RelaySession = { destinations, stopped: false, attempts: 0 };
    if (clientId) session.clientId = clientId;
    this.sessions.set(streamKey, session);
    this.scheduleAttempt(streamKey, session, RETRY_DELAYS_MS[0] ?? 500);
  }

  stop(streamKey: string, clientId?: string): void {
    const session = this.sessions.get(streamKey);
    if (!session) return;
    if (clientId && session.clientId && clientId !== session.clientId) return;

    session.stopped = true;
    if (session.retryTimer) clearTimeout(session.retryTimer);
    session.child?.kill("SIGTERM");
    this.sessions.delete(streamKey);
  }

  private scheduleAttempt(streamKey: string, session: RelaySession, delay: number): void {
    session.retryTimer = setTimeout(() => this.runAttempt(streamKey, session), delay);
    session.retryTimer.unref();
  }

  private runAttempt(streamKey: string, session: RelaySession): void {
    if (session.stopped || this.sessions.get(streamKey) !== session) return;
    session.attempts += 1;

    const input = `rtmp://${this.rtmpHost}:${this.rtmpPort}/live/${streamKey}`;
    const args = ["-hide_banner", "-loglevel", "warning", "-rw_timeout", "15000000", "-i", input];
    for (const destination of session.destinations) {
      args.push("-map", "0:v?", "-map", "0:a?", "-c:v", "copy", "-c:a", "copy", "-f", "flv", destination.url);
    }

    const child = spawn(this.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    session.child = child;
    const startedAt = Date.now();
    let failureHandled = false;
    const handleFailure = () => {
      if (failureHandled) return;
      failureHandled = true;
      this.retry(streamKey, session);
    };
    child.on("error", (error) => {
      console.error(`No se pudo iniciar FFmpeg: ${error.message}`);
      handleFailure();
    });
    child.on("exit", (code, signal) => {
      if (session.stopped || this.sessions.get(streamKey) !== session) return;
      console.error(`FFmpeg terminó (code=${code}, signal=${signal}); se intentará recuperar el relé`);
      if (Date.now() - startedAt > 30_000) session.attempts = 0;
      handleFailure();
    });
  }

  private retry(streamKey: string, session: RelaySession): void {
    if (session.stopped || this.sessions.get(streamKey) !== session) return;
    delete session.child;
    if (session.attempts >= MAX_START_ATTEMPTS) {
      console.error(`Se agotaron los reintentos de FFmpeg para el stream ${streamKey.slice(0, 6)}...`);
      this.sessions.delete(streamKey);
      return;
    }
    const delay = RETRY_DELAYS_MS[session.attempts] ?? RETRY_DELAYS_MS.at(-1) ?? 8_000;
    this.scheduleAttempt(streamKey, session, delay);
  }
}