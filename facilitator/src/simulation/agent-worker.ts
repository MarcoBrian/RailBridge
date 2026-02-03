import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as any;
}

import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, "..", "..", ".env");
dotenv.config({ path: envPath });

export interface AgentConfig {
    id: string;
    privateKey: `0x${string}`;
    merchantUrl: string;
    label?: string;
}

export class BridgeAgent {
    private client: x402Client;
    private fetchWithPayment: typeof fetch;
    public id: string;
    private label: string;
    private merchantUrl: string;

    constructor(config: AgentConfig) {
        this.id = config.id;
        this.label = config.label || `Agent-${this.id.slice(0, 4)}`;
        this.merchantUrl = config.merchantUrl;

        const account = privateKeyToAccount(config.privateKey);
        const signer = createWalletClient({
            account,
            chain: baseSepolia,
            transport: http(),
        });

        const networkSelector = (
            _x402Version: number,
            options: any[],
        ): any => {
            const match = options.find(opt => opt.network === "eip155:84532");
            return match || options[0];
        };

        this.client = new x402Client(networkSelector);
        registerExactEvmScheme(this.client, { signer: account });

        this.fetchWithPayment = wrapFetchWithPayment(fetch, this.client);
    }

    private log(message: string) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${this.label}] ${message}`);
    }

    async runTask(path: string = "/api/premium") {
        this.log(`🚀 Starting bridge task: ${path}`);

        try {
            const response = await this.fetchWithPayment(`${this.merchantUrl}${path}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (response.ok) {
                const data = await response.json();
                this.log(`✅ Task Completed Successfully!`);
                return { success: true, data };
            } else {
                this.log(`❌ Task Failed with status: ${response.status}`);
                return { success: false, status: response.status };
            }
        } catch (error) {
            this.log(`💥 Critical Error during task: ${error instanceof Error ? error.message : String(error)}`);
            return { success: false, error };
        }
    }
}

// If executed directly (standalone worker mode)
if (process.argv[1] === __filename) {
    const [, , id, pkey, url] = process.argv;
    if (!pkey || !url) {
        console.error("Usage: agent-worker.ts <id> <privateKey> <merchantUrl>");
        process.exit(1);
    }

    const agent = new BridgeAgent({
        id,
        privateKey: pkey as `0x${string}`,
        merchantUrl: url,
    });

    agent.runTask().catch(console.error);
}
