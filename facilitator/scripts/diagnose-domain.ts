import { createPublicClient, http, keccak256, toHex } from "viem";
import { hashStruct } from "viem/utils";

const EIP712_DOMAIN_ABI = [
  {
    name: "eip712Domain",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;

const DOMAIN_SEPARATOR_ABI = [
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const TOKEN_DOMAIN_ABI = [
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const hashStructUnsafe = hashStruct as unknown as (args: {
  data: Record<string, unknown>;
  primaryType: string;
  types: Record<string, { name: string; type: string }[]>;
}) => `0x${string}`;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const match = args.find((arg) => arg.startsWith(`${name}=`));
    return match ? match.split("=")[1] : undefined;
  };
  const network = getArg("NETWORK") ?? process.env.NETWORK;
  const rpc = getArg("RPC") ?? process.env.RPC;
  const token = getArg("TOKEN") ?? process.env.TOKEN;
  if (!network || !rpc || !token) {
    throw new Error(
      "Usage: NETWORK=eip155:59141 RPC=<rpc_url> TOKEN=<usdc_address> tsx scripts/diagnose-domain.ts",
    );
  }
  return { network, rpc, token };
};

const run = async () => {
  const { network, rpc, token } = parseArgs();
  const chainId = Number(network.split(":")[1]);
  const client = createPublicClient({
    chain: {
      id: chainId,
      name: network,
      nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    },
    transport: http(rpc),
  });

  console.log(`Network: ${network}`);
  console.log(`Token: ${token}`);
  console.log(`RPC: ${rpc}`);

  const tokenName = await client.readContract({
    address: token as `0x${string}`,
    abi: TOKEN_DOMAIN_ABI,
    functionName: "name",
  });
  const tokenVersion = await client.readContract({
    address: token as `0x${string}`,
    abi: TOKEN_DOMAIN_ABI,
    functionName: "version",
  });

  console.log(`Token name: ${tokenName}`);
  console.log(`Token version: ${tokenVersion}`);

  try {
    const domain = await client.readContract({
      address: token as `0x${string}`,
      abi: EIP712_DOMAIN_ABI,
      functionName: "eip712Domain",
    });
    const fields = Number(domain[0]);
    console.log(`eip712Domain fields: ${fields}`);
    console.log(`eip712Domain name: ${domain[1]}`);
    console.log(`eip712Domain version: ${domain[2]}`);
    console.log(`eip712Domain chainId: ${domain[3].toString()}`);
    console.log(`eip712Domain verifyingContract: ${domain[4]}`);
    console.log(`eip712Domain salt: ${domain[5]}`);
  } catch (error) {
    console.warn("eip712Domain not available");
  }

  const domainSeparator = await client.readContract({
    address: token as `0x${string}`,
    abi: DOMAIN_SEPARATOR_ABI,
    functionName: "DOMAIN_SEPARATOR",
  });
  console.log(`DOMAIN_SEPARATOR: ${domainSeparator}`);

  const chainIdCandidates = [BigInt(chainId), 1n, 0n];
  const saltBytes32 = toHex(chainId, { size: 32 });
  const saltCandidates = [saltBytes32, keccak256(saltBytes32)];
  const fieldCombos = [
    { name: true, version: true, verifyingContract: true, chainId: false, salt: false },
    { name: true, version: true, verifyingContract: true, chainId: true, salt: false },
    { name: true, version: true, verifyingContract: true, chainId: false, salt: true },
    { name: true, version: true, verifyingContract: true, chainId: true, salt: true },
    { name: true, version: false, verifyingContract: true, chainId: false, salt: false },
    { name: true, version: false, verifyingContract: true, chainId: true, salt: false },
    { name: true, version: false, verifyingContract: true, chainId: false, salt: true },
    { name: true, version: false, verifyingContract: true, chainId: true, salt: true },
  ];

  for (const combo of fieldCombos) {
    const types = {
      EIP712Domain: [
        combo.name ? { name: "name", type: "string" } : null,
        combo.version ? { name: "version", type: "string" } : null,
        combo.chainId ? { name: "chainId", type: "uint256" } : null,
        combo.verifyingContract ? { name: "verifyingContract", type: "address" } : null,
        combo.salt ? { name: "salt", type: "bytes32" } : null,
      ].filter(Boolean) as { name: string; type: string }[],
    };
    const chainIds = combo.chainId ? chainIdCandidates : [undefined];
    const salts = combo.salt ? saltCandidates : [undefined];

    for (const chainIdCandidate of chainIds) {
      for (const saltCandidate of salts) {
        const separator = hashStructUnsafe({
          data: {
            ...(combo.name ? { name: tokenName } : {}),
            ...(combo.version ? { version: tokenVersion } : {}),
            ...(combo.verifyingContract ? { verifyingContract: token as `0x${string}` } : {}),
            ...(chainIdCandidate !== undefined ? { chainId: chainIdCandidate } : {}),
            ...(saltCandidate !== undefined ? { salt: saltCandidate } : {}),
          },
          primaryType: "EIP712Domain",
          types,
        });
        if (separator === domainSeparator) {
          console.log("✅ DOMAIN match found");
          console.log(`fields: ${JSON.stringify(combo)}`);
          console.log(`chainId: ${chainIdCandidate?.toString() ?? "none"}`);
          console.log(`salt: ${saltCandidate ?? "none"}`);
          return;
        }
      }
    }
  }

  console.log("❌ No domain match found");
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

