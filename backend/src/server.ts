import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { RelayManager } from "./relay-manager.js";
import { StreamStore } from "./store.js";
import type { Destination, Platform } from "./types.js";

const app = express();
const store = new StreamStore(config.databasePath, config.encryptionKey);
const relays = new RelayManager(config.ffmpegPath, config.rtmpHost, config.rtmpPort);
const platforms = new Set<Platform>(["twitch", "youtube", "facebook", "custom"]);

app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "8kb" }));
app.use(express.json({ limit: "32kb" }));

function matchesToken(received: unknown, expected: string): boolean {
  if (typeof received !== "string" || !received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function requireDashboardToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!matchesToken(token, config.dashboardToken)) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
}

function validateDestinations(value: unknown): Destination[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return undefined;
  const destinations: Destination[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const candidate = item as { platform?: unknown; url?: unknown };
    if (typeof candidate.platform !== "string" || !platforms.has(candidate.platform as Platform)) return undefined;
    if (typeof candidate.url !== "string" || candidate.url.length > 2_048) return undefined;
    try {
      const url = new URL(candidate.url);
      if (url.protocol !== "rtmp:" && url.protocol !== "rtmps:") return undefined;
      destinations.push({ platform: candidate.platform as Platform, url: candidate.url });
    } catch {
      return undefined;
    }
  }
  return destinations;
}

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

app.post("/api/streams", requireDashboardToken, (req, res) => {
  const ownerId = typeof req.body.ownerId === "string" ? req.body.ownerId.trim() : "";
  const destinations = validateDestinations(req.body.destinations);
  if (!ownerId || ownerId.length > 128 || !destinations) {
    res.status(400).json({ error: "ownerId o destinos inválidos" });
    return;
  }
  if (store.getByOwner(ownerId)) {
    res.status(409).json({ error: "El usuario ya tiene una configuración de stream" });
    return;
  }

  const streamKey = config.streamKey();
  store.create(ownerId, streamKey, destinations);
  res.status(201).json({
    ownerId,
    streamKey,
    rtmpUrl: `rtmp://${req.hostname}:1935/live`,
    destinations: destinations.map(({ platform }) => ({ platform })),
  });
});

app.get("/api/streams/:ownerId", requireDashboardToken, (req, res) => {
  const ownerId = req.params.ownerId;
  if (typeof ownerId !== "string") {
    res.status(400).json({ error: "ownerId inválido" });
    return;
  }
  const stream = store.getByOwner(ownerId);
  if (!stream) {
    res.status(404).json({ error: "Stream no encontrado" });
    return;
  }
  res.json({
    ownerId: stream.ownerId,
    streamKey: stream.streamKey,
    rtmpUrl: `rtmp://${req.hostname}:1935/live`,
    destinations: stream.destinations.map(({ platform }) => ({ platform })),
  });
});

app.post("/internal/rtmp/on_publish", (req, res) => {
  if (!matchesToken(req.query.token, config.webhookToken)) {
    res.sendStatus(403);
    return;
  }
  const streamKey = typeof req.body.name === "string" ? req.body.name : "";
  const stream = store.getByStreamKey(streamKey);
  if (!stream || stream.destinations.length === 0) {
    res.sendStatus(403);
    return;
  }

  const clientId = typeof req.body.clientid === "string" ? req.body.clientid : undefined;
  relays.start(streamKey, stream.destinations, clientId);
  res.sendStatus(200);
});

app.post("/internal/rtmp/on_publish_done", (req, res) => {
  if (!matchesToken(req.query.token, config.webhookToken)) {
    res.sendStatus(403);
    return;
  }
  const streamKey = typeof req.body.name === "string" ? req.body.name : "";
  const clientId = typeof req.body.clientid === "string" ? req.body.clientid : undefined;
  if (streamKey) relays.stop(streamKey, clientId);
  res.sendStatus(200);
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`API Restream MVP escuchando en el puerto ${config.port}`);
});