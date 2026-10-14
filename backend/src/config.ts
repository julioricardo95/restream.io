import { randomBytes } from "node:crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const encryptionKey = Buffer.from(required("SECRET_ENCRYPTION_KEY"), "hex");
if (encryptionKey.length !== 32) {
  throw new Error("SECRET_ENCRYPTION_KEY debe tener exactamente 64 caracteres hexadecimales");
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databasePath: process.env.DATABASE_PATH ?? "./data/restream.sqlite",
  encryptionKey,
  dashboardToken: required("DASHBOARD_API_TOKEN"),
  webhookToken: required("RTMP_WEBHOOK_TOKEN"),
  rtmpHost: process.env.RTMP_HOST ?? "127.0.0.1",
  rtmpPort: Number(process.env.RTMP_PORT ?? 1935),
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  streamKey: () => randomBytes(32).toString("base64url"),
};