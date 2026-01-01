import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import "dotenv/config";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const app = express();
app.use(cors());
app.use(express.json());

// ---- Config ----
const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");
const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_PATH = path.join(BASE_DIR, "processed.json");
const STATS_PATH = path.join(BASE_DIR, "stats.json");
const BURNS_PATH = path.join(BASE_DIR, "burns.json");
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_MARKET_MAX = 120;
const FAIR_SEED_BYTES = 32;
const BURN_INTERVAL_SEC = Number(process.env.BURN_INTERVAL_SEC || 150);
const PUMPFUN_API = process.env.PUMPFUN_API || "https://frontend-api.pump.fun";
const DEXSCREENER_API = process.env.DEXSCREENER_API || "https://api.dexscreener.com";
const JUPITER_PRICE_API = process.env.JUPITER_PRICE_API || "https://price.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const WIN_CHANCE = 0.5;
const HOUSE_EDGE = 0.025;
const PAYOUT_MULTIPLIER = (1 - HOUSE_EDGE) / WIN_CHANCE;

// Load HOUSE keypair from file
const HOUSE_PATH = process.env.HOUSE_PATH
  ? path.resolve(process.env.HOUSE_PATH)
  : path.join(BASE_DIR, "house.json");
if (!fs.existsSync(HOUSE_PATH)) {
  throw new Error(
    `HOUSE keypair missing. Set HOUSE_PATH or provide ${HOUSE_PATH}.`
  );
}
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(HOUSE_PATH, "utf8")));
const HOUSE = Keypair.fromSecretKey(secret);

console.log("HOUSE pubkey:", HOUSE.publicKey.toBase58());

const processedSigs = new Set();
try {
  const raw = fs.readFileSync(PROCESSED_PATH, "utf8");
  const items = JSON.parse(raw);
  if (Array.isArray(items)) {
    for (const sig of items) processedSigs.add(sig);
  }
} catch (e) {
  // ok if missing or invalid; start fresh
}

function persistProcessedSigs() {
  const items = Array.from(processedSigs).slice(-5000);
  fs.writeFileSync(PROCESSED_PATH, JSON.stringify(items, null, 2));
}

function getKeyString(keyObj) {
  if (!keyObj) return null;
  if (typeof keyObj === "string") return keyObj;
  if (keyObj.pubkey) return keyObj.pubkey.toBase58?.() ?? String(keyObj.pubkey);
  return keyObj.toBase58?.() ?? String(keyObj);
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

let serverSeed = crypto.randomBytes(FAIR_SEED_BYTES).toString("hex");
let serverHash = sha256Hex(serverSeed);

function rotateServerSeed() {
  serverSeed = crypto.randomBytes(FAIR_SEED_BYTES).toString("hex");
  serverHash = sha256Hex(serverSeed);
}

const stats = {
  totalWagersLamports: 0,
  totalBurnedLamports: 0,
  lastBuybackTx: null,
};

try {
  const raw = fs.readFileSync(STATS_PATH, "utf8");
  const data = JSON.parse(raw);
  if (data && typeof data === "object") {
    stats.totalWagersLamports = Number(data.totalWagersLamports) || 0;
    stats.totalBurnedLamports = Number(data.totalBurnedLamports) || 0;
    stats.lastBuybackTx = typeof data.lastBuybackTx === "string" ? data.lastBuybackTx : null;
  }
} catch (e) {
  // ok if missing or invalid; start fresh
}

function persistStats() {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

function readBurns() {
  try {
    const raw = fs.readFileSync(BURNS_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function createRateLimiter(maxPerWindow, windowMs) {
  const store = new Map();
  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = store.get(key) ?? { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    store.set(key, entry);
    if (entry.count > maxPerWindow) {
      return res.status(429).json({ error: "Too many requests. Try again soon." });
    }
    return next();
  };
}

const rateLimit = createRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
const rateLimitMarket = createRateLimiter(RATE_LIMIT_MARKET_MAX, RATE_LIMIT_WINDOW_MS);

// Health check
app.get("/", (req, res) => res.json({ ok: true }));

// Market cap proxy (pump.fun)
app.get("/marketcap", rateLimitMarket, async (req, res) => {
  try {
    const mint = req.query.mint;
    const debug = req.query.debug === "1";
    if (!mint || typeof mint !== "string") {
      return res.status(400).json({ error: "Missing mint" });
    }
    let marketCapUsd = null;
    let marketCapSol = null;
    let debugInfo = { pump: null, dex: null, jup: null };

    const pumpResp = await fetch(`${PUMPFUN_API}/coins/${mint}`);
    const pumpText = await pumpResp.text();
    if (debug) {
      debugInfo.pump = {
        status: pumpResp.status,
        body: pumpText.slice(0, 600),
      };
    }
    if (pumpResp.ok) {
      const data = JSON.parse(pumpText);
      marketCapUsd =
        data.market_cap_usd ??
        data.marketCapUsd ??
        data.usd_market_cap ??
        data.usdMarketCap ??
        null;
      marketCapSol = data.market_cap ?? data.marketCap ?? data.market_cap_sol ?? null;
    }

    if (marketCapUsd == null && marketCapSol != null) {
      const priceResp = await fetch(`${JUPITER_PRICE_API}/v6/price?ids=${SOL_MINT}`);
      const priceText = await priceResp.text();
      if (debug) {
        debugInfo.jup = {
          status: priceResp.status,
          body: priceText.slice(0, 600),
        };
      }
      if (priceResp.ok) {
        const priceData = JSON.parse(priceText);
        const solPrice = priceData?.data?.[SOL_MINT]?.price;
        if (typeof solPrice === "number") {
          marketCapUsd = Number(marketCapSol) * solPrice;
        }
      }
    }

    if (marketCapUsd == null) {
      const dexResp = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${mint}`);
      const dexText = await dexResp.text();
      if (debug) {
        debugInfo.dex = {
          status: dexResp.status,
          body: dexText.slice(0, 600),
        };
      }
      if (dexResp.ok) {
        const data = JSON.parse(dexText);
        const pair = Array.isArray(data.pairs) ? data.pairs[0] : null;
        marketCapUsd = pair?.fdv ?? pair?.marketCap ?? null;
      }
    }

    if (marketCapUsd == null) {
      const priceResp = await fetch(`${JUPITER_PRICE_API}/v6/price?ids=${mint}`);
      const priceText = await priceResp.text();
      if (debug) {
        debugInfo.jup = {
          status: priceResp.status,
          body: priceText.slice(0, 600),
        };
      }
      if (priceResp.ok) {
        const priceData = JSON.parse(priceText);
        const tokenPrice = priceData?.data?.[mint]?.price;
        if (typeof tokenPrice === "number") {
          const supply = await connection.getTokenSupply(new PublicKey(mint), "confirmed");
          const uiSupply = Number(supply.value.uiAmountString ?? supply.value.uiAmount ?? 0);
          if (uiSupply > 0) {
            marketCapUsd = uiSupply * tokenPrice;
          }
        }
      }
    }

    if (marketCapUsd == null) {
      return res.status(502).json({
        error: "Market data unavailable",
        ...(debug ? { debug: debugInfo } : {}),
      });
    }

    return res.json({ marketCapUsd });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// Public stats
app.get("/stats", rateLimit, async (req, res) => {
  try {
    const houseLamports = await connection.getBalance(HOUSE.publicKey, "confirmed");
    return res.json({
      totalWagersLamports: stats.totalWagersLamports,
      totalBurnedLamports: stats.totalBurnedLamports,
      lastBuybackTx: stats.lastBuybackTx,
      houseBalanceLamports: houseLamports,
      totalWagersSol: stats.totalWagersLamports / LAMPORTS_PER_SOL,
      totalBurnedSol: stats.totalBurnedLamports / LAMPORTS_PER_SOL,
      houseBalanceSol: houseLamports / LAMPORTS_PER_SOL,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

app.get("/burns", rateLimit, (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  const burns = readBurns();
  const latest = burns.slice(-limit).reverse();
  const last = burns[burns.length - 1];
  let nextBurnAt = null;
  let secondsRemaining = null;
  if (last?.timestamp) {
    const lastTs = Date.parse(last.timestamp);
    if (!Number.isNaN(lastTs)) {
      nextBurnAt = new Date(lastTs + BURN_INTERVAL_SEC * 1000).toISOString();
      const diff = Math.ceil((lastTs + BURN_INTERVAL_SEC * 1000 - Date.now()) / 1000);
      secondsRemaining = Math.max(0, diff);
    }
  }
  return res.json({
    burns: latest,
    nextBurnAt,
    secondsRemaining,
    intervalSeconds: BURN_INTERVAL_SEC,
  });
});

// HOUSE balance + max bet
app.get("/house-balance", rateLimit, async (req, res) => {
  try {
    const houseLamports = await connection.getBalance(HOUSE.publicKey, "confirmed");
    const maxBetLamports = Math.max(0, Math.floor(houseLamports * 0.1));
    return res.json({
      houseLamports,
      maxBetLamports,
      houseSol: houseLamports / LAMPORTS_PER_SOL,
      maxBetSol: maxBetLamports / LAMPORTS_PER_SOL,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// Provably fair commit (server hash)
app.get("/fair/commit", rateLimit, (req, res) => {
  return res.json({ serverHash });
});

// Provably fair flip
app.post("/fair/flip", rateLimit, (req, res) => {
  try {
    const { clientSeed, nonce } = req.body || {};
    if (!clientSeed || typeof clientSeed !== "string") {
      return res.status(400).json({ error: "Missing clientSeed" });
    }
    if (!Number.isInteger(nonce) || nonce < 0) {
      return res.status(400).json({ error: "Invalid nonce" });
    }

    const digest = sha256Hex(`${serverSeed}:${clientSeed}:${nonce}`);
    const roll = parseInt(digest.slice(0, 8), 16);
    const result = roll % 2 === 0 ? "HEADS" : "TAILS";

    const reveal = { serverSeed, serverHash, clientSeed, nonce, digest, result };
    rotateServerSeed();
    return res.json({ ...reveal, nextServerHash: serverHash });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * POST /settle
 * body: { signature: string, expectedLamports: number, clientSeed: string, nonce: number }
 */
app.post("/settle", rateLimit, async (req, res) => {
  try {
    const { signature, expectedLamports, clientSeed, nonce } = req.body || {};

    if (!signature || typeof signature !== "string") {
      return res.status(400).json({ error: "Missing signature" });
    }
    if (processedSigs.has(signature)) {
      return res.status(409).json({ error: "Signature already settled" });
    }
    if (
      expectedLamports == null ||
      typeof expectedLamports !== "number" ||
      expectedLamports <= 0
    ) {
      return res.status(400).json({ error: "Invalid expectedLamports" });
    }
    if (!clientSeed || typeof clientSeed !== "string") {
      return res.status(400).json({ error: "Missing clientSeed" });
    }
    if (!Number.isInteger(nonce) || nonce < 0) {
      return res.status(400).json({ error: "Invalid nonce" });
    }

    // 1) Fetch parsed transaction
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx) {
      return res.status(400).json({ error: "Transaction not found / not confirmed yet" });
    }
    if (tx.meta?.err) {
      return res.status(400).json({ error: "Transaction failed on-chain" });
    }

    // 2) Find a SystemProgram transfer into HOUSE
    // We'll identify the "player" as the transfer source.
    const playerSources = new Set();
    let foundLamports = 0;

    const instructions = tx.transaction.message.instructions;

    for (const ix of instructions) {
      // parsed instructions have this shape when using getParsedTransaction
      if (
        ix.program === "system" &&
        ix.parsed?.type === "transfer"
      ) {
        const info = ix.parsed.info;
        const to = info.destination;
        const from = info.source;
        const lamports = Number(info.lamports);

        if (to === HOUSE.publicKey.toBase58()) {
          playerSources.add(from);
          foundLamports += lamports;
        }
      }
    }

    if (playerSources.size === 0) {
      return res.status(400).json({ error: "No transfer to HOUSE found in this tx" });
    }
    if (playerSources.size > 1) {
      return res.status(400).json({ error: "Multiple payer sources in tx" });
    }

    if (foundLamports !== expectedLamports) {
      return res.status(400).json({
        error: `Incorrect amount. Found ${foundLamports} lamports, expected ${expectedLamports}`,
      });
    }

    const houseBalForCap = await connection.getBalance(HOUSE.publicKey, "confirmed");
    const maxBetLamports = Math.max(0, Math.floor(houseBalForCap * 0.1));
    if (foundLamports > maxBetLamports) {
      return res.status(400).json({
        error: `Bet exceeds max (10% of house balance). Max ${maxBetLamports} lamports.`,
      });
    }

    const playerPubkeyStr = Array.from(playerSources)[0];
    const player = new PublicKey(playerPubkeyStr);
    const feePayer = getKeyString(tx.transaction.message.accountKeys?.[0]);
    if (feePayer && feePayer !== playerPubkeyStr) {
      return res.status(400).json({ error: "Fee payer does not match player" });
    }

    // 3) Decide win/lose (provably fair)
    const digest = sha256Hex(`${serverSeed}:${clientSeed}:${nonce}`);
    const roll = parseInt(digest.slice(0, 8), 16);
    const result = roll % 2 === 0 ? "HEADS" : "TAILS";
    const win = result === "HEADS";
    const reveal = { serverSeed, serverHash, clientSeed, nonce, digest, result };
    rotateServerSeed();

    if (!win) {
      stats.totalWagersLamports += expectedLamports;
      persistStats();
      processedSigs.add(signature);
      persistProcessedSigs();
      return res.json({ win: false, ...reveal, nextServerHash: serverHash });
    }

    // 4) Pay out (payout multiplier)
    const payoutLamports = Math.floor(expectedLamports * PAYOUT_MULTIPLIER);

    // check HOUSE balance
    const houseBal = await connection.getBalance(HOUSE.publicKey, "confirmed");
    if (houseBal < payoutLamports + 5000) {
      return res.status(400).json({ error: "HOUSE wallet has insufficient funds for payout" });
    }

    const latest = await connection.getLatestBlockhash("confirmed");
    const payoutTx = new Transaction({
      feePayer: HOUSE.publicKey,
      recentBlockhash: latest.blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: HOUSE.publicKey,
        toPubkey: player,
        lamports: payoutLamports,
      })
    );

    payoutTx.sign(HOUSE);

    const payoutSig = await connection.sendRawTransaction(payoutTx.serialize(), {
      skipPreflight: false,
    });

    try {
      await connection.confirmTransaction(
        { signature: payoutSig, ...latest },
        "confirmed"
      );
    } catch (e) {
      // Don't fail the settle response if confirmation is slow/expired.
    }

    stats.totalWagersLamports += expectedLamports;
    persistStats();

    processedSigs.add(signature);
    persistProcessedSigs();

    return res.json({ win: true, payoutSig, ...reveal, nextServerHash: serverHash });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
