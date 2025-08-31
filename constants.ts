import { ethers } from "ethers";

// --- Config: set via Vite env or fallback to provided endpoints ---
export const WS_URL = (import.meta as any).env?.VITE_WS_MONAD_TESTNET || "wss://testnet-rpc.monad.xyz";
export const HTTP_URL = (import.meta as any).env?.VITE_HTTP_MONAD_TESTNET || "https://cosmological-tame-resonance.monad-testnet.quiknode.pro/84ed94f365bde58e2b51be6d0f1c8fa3a8e0a932/";

// --- Network Constants ---
export const CHAIN_ID = 10143; // Monad Testnet

// --- Ethers Constants ---
export const ZERO_ADDR = ethers.ZeroAddress; // 0x0000...0000
export const ZERO_TOPIC = ethers.zeroPadValue(ZERO_ADDR, 32);

// --- Event Topics ---
// Transfer(address,address,uint256)
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// TransferSingle(address,address,address,uint255,uint255)
export const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
// TransferBatch(address,address,address,uint255[],uint255[])
export const TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

// --- ABIs ---
export const METADATA_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// --- Filter Contracts ---
export const MINT_CONTRACT_WHITELIST = [
  "0x00000000009a1E02f00E280dcfA4C81c55724212",
];