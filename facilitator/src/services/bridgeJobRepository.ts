import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { BridgeJob, BridgeJobRepository, BridgeJobStatus } from "../types/bridgeJob.js";

type BridgeJobRow = {
  id: string;
  idempotency_key: string;
  source_network: string;
  destination_network: string;
  source_tx_hash: string;
  amount: string;
  destination_asset: string;
  destination_pay_to: string;
  status: BridgeJobStatus;
  attempts: number;
  last_error: string | null;
  bridge_tx_hash: string | null;
  destination_tx_hash: string | null;
  message_id: string | null;
  created_at: string;
  updated_at: string;
};

export class SqliteBridgeJobRepository implements BridgeJobRepository {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_jobs (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE NOT NULL,
        source_network TEXT NOT NULL,
        destination_network TEXT NOT NULL,
        source_tx_hash TEXT NOT NULL,
        amount TEXT NOT NULL,
        destination_asset TEXT NOT NULL,
        destination_pay_to TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        last_error TEXT,
        bridge_tx_hash TEXT,
        destination_tx_hash TEXT,
        message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bridge_jobs_status_idx ON bridge_jobs(status);
      CREATE INDEX IF NOT EXISTS bridge_jobs_source_tx_idx ON bridge_jobs(source_tx_hash);
    `);
  }

  create(job: BridgeJob): Promise<BridgeJob> {
    const statement = this.db.prepare(
      `INSERT INTO bridge_jobs (
        id,
        idempotency_key,
        source_network,
        destination_network,
        source_tx_hash,
        amount,
        destination_asset,
        destination_pay_to,
        status,
        attempts,
        last_error,
        bridge_tx_hash,
        destination_tx_hash,
        message_id,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @idempotencyKey,
        @sourceNetwork,
        @destinationNetwork,
        @sourceTxHash,
        @amount,
        @destinationAsset,
        @destinationPayTo,
        @status,
        @attempts,
        @lastError,
        @bridgeTxHash,
        @destinationTxHash,
        @messageId,
        @createdAt,
        @updatedAt
      )`,
    );
    statement.run({
      ...job,
      lastError: job.lastError ?? null,
      bridgeTxHash: job.bridgeTxHash ?? null,
      destinationTxHash: job.destinationTxHash ?? null,
      messageId: job.messageId ?? null,
    });
    return Promise.resolve(job);
  }

  getById(id: string): Promise<BridgeJob | null> {
    const row = this.db
      .prepare(`SELECT * FROM bridge_jobs WHERE id = ?`)
      .get(id) as BridgeJobRow | undefined;
    return Promise.resolve(row ? this.mapRow(row) : null);
  }

  getByIdempotencyKey(key: string): Promise<BridgeJob | null> {
    const row = this.db
      .prepare(`SELECT * FROM bridge_jobs WHERE idempotency_key = ?`)
      .get(key) as BridgeJobRow | undefined;
    return Promise.resolve(row ? this.mapRow(row) : null);
  }

  update(job: BridgeJob): Promise<BridgeJob> {
    const statement = this.db.prepare(
      `UPDATE bridge_jobs SET
        source_network = @sourceNetwork,
        destination_network = @destinationNetwork,
        source_tx_hash = @sourceTxHash,
        amount = @amount,
        destination_asset = @destinationAsset,
        destination_pay_to = @destinationPayTo,
        status = @status,
        attempts = @attempts,
        last_error = @lastError,
        bridge_tx_hash = @bridgeTxHash,
        destination_tx_hash = @destinationTxHash,
        message_id = @messageId,
        updated_at = @updatedAt
      WHERE id = @id`,
    );
    statement.run({
      ...job,
      lastError: job.lastError ?? null,
      bridgeTxHash: job.bridgeTxHash ?? null,
      destinationTxHash: job.destinationTxHash ?? null,
      messageId: job.messageId ?? null,
    });
    return Promise.resolve(job);
  }

  createNewJob(params: {
    idempotencyKey: string;
    sourceNetwork: string;
    destinationNetwork: string;
    sourceTxHash: string;
    amount: string;
    destinationAsset: string;
    destinationPayTo: string;
  }): BridgeJob {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      idempotencyKey: params.idempotencyKey,
      sourceNetwork: params.sourceNetwork,
      destinationNetwork: params.destinationNetwork,
      sourceTxHash: params.sourceTxHash,
      amount: params.amount,
      destinationAsset: params.destinationAsset,
      destinationPayTo: params.destinationPayTo,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mapRow(row: BridgeJobRow): BridgeJob {
    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      sourceNetwork: row.source_network,
      destinationNetwork: row.destination_network,
      sourceTxHash: row.source_tx_hash,
      amount: row.amount,
      destinationAsset: row.destination_asset,
      destinationPayTo: row.destination_pay_to,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error ?? undefined,
      bridgeTxHash: row.bridge_tx_hash ?? undefined,
      destinationTxHash: row.destination_tx_hash ?? undefined,
      messageId: row.message_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
