import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Destination, StreamRecord } from "./types.js";

interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export class StreamStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string, private readonly encryptionKey: Buffer) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS streams (
        owner_id TEXT PRIMARY KEY,
        stream_key_hash TEXT NOT NULL UNIQUE,
        encrypted_payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  create(ownerId: string, streamKey: string, destinations: Destination[]): void {
    this.database.prepare(`
      INSERT INTO streams (owner_id, stream_key_hash, encrypted_payload, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(ownerId, this.hash(streamKey), this.encrypt({ streamKey, destinations }), new Date().toISOString());
  }

  getByOwner(ownerId: string): StreamRecord | undefined {
    const row = this.database.prepare(
      "SELECT encrypted_payload FROM streams WHERE owner_id = ?",
    ).get(ownerId) as { encrypted_payload: string } | undefined;
    if (!row) return undefined;
    const payload = this.decrypt(row.encrypted_payload);
    return { ownerId, streamKey: payload.streamKey, destinations: payload.destinations };
  }

  getByStreamKey(streamKey: string): StreamRecord | undefined {
    const row = this.database.prepare(
      "SELECT owner_id, encrypted_payload FROM streams WHERE stream_key_hash = ?",
    ).get(this.hash(streamKey)) as { owner_id: string; encrypted_payload: string } | undefined;
    if (!row) return undefined;
    const payload = this.decrypt(row.encrypted_payload);
    return { ownerId: row.owner_id, streamKey: payload.streamKey, destinations: payload.destinations };
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private encrypt(value: { streamKey: string; destinations: Destination[] }): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const payload: EncryptedPayload = {
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      ciphertext: ciphertext.toString("hex"),
    };
    return JSON.stringify(payload);
  }

  private decrypt(value: string): { streamKey: string; destinations: Destination[] } {
    const payload = JSON.parse(value) as EncryptedPayload;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(payload.iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
    const cleartext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(cleartext) as { streamKey: string; destinations: Destination[] };
  }
}