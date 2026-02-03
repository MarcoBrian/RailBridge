import { BridgeAgent } from "./agent-worker.js";
import { generatePrivateKey } from "viem/accounts";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, "..", "..", ".env");
dotenv.config({ path: envPath });

const MERCHANT_URL = process.env.MERCHANT_URL || "http://localhost:4021";
const DEFAULT_AGENT_COUNT = 3;

async function runSwarmSimulation(count: number) {
    console.log(`\n=== 🐝 BRIDGE SIMULATION SWARM STARTING ===`);
    console.log(`Targeting Merchant: ${MERCHANT_URL}`);
    console.log(`Spawning ${count} Agents...\n`);

    const agents: BridgeAgent[] = [];

    // 1. Initialize Agents
    // In a real scenario, we might need real funded accounts. 
    // For simulation, we generate keys. If the bridge needs real gas on source,
    // the user will need to supply funded keys.
    for (let i = 0; i < count; i++) {
        const id = `agent-${i + 1}`;
        // Use the primary ENV key for the first agent, generate others (might need funding!)
        const pkey = (i === 0 && process.env.CLIENT_PRIVATE_KEY)
            ? process.env.CLIENT_PRIVATE_KEY as `0x${string}`
            : generatePrivateKey();

        agents.push(new BridgeAgent({
            id,
            privateKey: pkey,
            merchantUrl: MERCHANT_URL,
            label: `Agent-${i + 1}`
        }));
    }

    console.log(`Initialization complete. Launching concurrent tasks...\n`);

    // 2. Execute concurrently
    const startTime = Date.now();
    const results = await Promise.all(agents.map(agent => agent.runTask()));
    const endTime = Date.now();

    // 3. Report Results
    console.log(`\n=== 📊 SWARM SIMULATION REPORT ===`);
    const total = results.length;
    const successes = results.filter(r => r.success).length;
    const failures = total - successes;

    console.log(`Total Agents: ${total}`);
    console.log(`Successes:     ${successes}`);
    console.log(`Failures:      ${failures}`);
    console.log(`Duration:      ${(endTime - startTime) / 1000}s`);

    if (successes === total) {
        console.log(`\n🏆 ALL AGENTS SUCCESSFULLY BRIDGED!`);
    } else {
        console.log(`\n⚠️ SYNERGY TEST PARTIAL SUCCESS: ${successes}/${total}`);
    }
}

// Read agent count from CLI or default
const agentCountArg = process.argv.slice(2).find(arg => arg.startsWith("--agents="))?.split("=")[1];
const count = agentCountArg ? parseInt(agentCountArg) : DEFAULT_AGENT_COUNT;

runSwarmSimulation(count).catch(err => {
    console.error("Simulation failed:", err);
});
