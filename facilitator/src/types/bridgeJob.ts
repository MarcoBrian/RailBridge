import { randomUUID } from "crypto";
import { Network } from "@x402/core/types";

export type BridgeJobStatus =
  | "pending"
  | "bridging"
  | "completed"
  | "failed"
  | "cancelled";

export interface BridgeJob {
  id: string;
  idempotencyKey: string;
  sourceNetwork: Network;
  destinationNetwork: Network;
  sourceTxHash: string;
  amount: string;
  destinationAsset: string;
  destinationPayTo: string;
  status: BridgeJobStatus;
  attempts: number;
  lastError?: string;
  bridgeTxHash?: string;
  destinationTxHash?: string;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BridgeJobRepository {
  create(job: BridgeJob): Promise<BridgeJob>;
  getById(id: string): Promise<BridgeJob | null>;
  getByIdempotencyKey(key: string): Promise<BridgeJob | null>;
  update(job: BridgeJob): Promise<BridgeJob>;
}

export function createBridgeJob(params: {
  idempotencyKey: string;
  sourceNetwork: Network;
  destinationNetwork: Network;
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

export function buildBridgeIdempotencyKey(
  sourceNetwork: Network,
  sourceTxHash: string,
  destinationNetwork: Network,
): string {
  return `${sourceNetwork}:${sourceTxHash}:${destinationNetwork}`;
}
