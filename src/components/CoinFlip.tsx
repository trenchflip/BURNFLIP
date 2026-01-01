import React, { useMemo, useRef, useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

type FlipSide = "HEADS" | "TAILS";

type FlipItem = {
  id: string;
  ts: number;
  betSol: number;
  pick: FlipSide;
  result: FlipSide;
  win: boolean;
};

type SettleResponse =
  | {
      win: true;
      payoutSig: string;
      serverSeed: string;
      serverHash: string;
      clientSeed: string;
      nonce: number;
      digest: string;
      result: FlipSide;
      nextServerHash: string;
    }
  | {
      win: false;
      serverSeed: string;
      serverHash: string;
      clientSeed: string;
      nonce: number;
      digest: string;
      result: FlipSide;
      nextServerHash: string;
    }
  | { error: string };

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type CoinFlipProps = {
  onFlipStateChange?: (isFlipping: boolean) => void;
};

export default function CoinFlip({ onFlipStateChange }: CoinFlipProps) {
  const [bet, setBet] = useState("0.1");
  const [pick, setPick] = useState<FlipSide>("HEADS");
  const [flipping, setFlipping] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [lastResult, setLastResult] = useState<FlipSide | null>(null);
  const [resultTone, setResultTone] = useState<"" | "win" | "loss">("");
  const [soundOn, setSoundOn] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [payoutSig, setPayoutSig] = useState<string | null>(null);
  const [payoutStatus, setPayoutStatus] = useState<"pending" | "confirmed" | null>(null);
  const [wagerSig, setWagerSig] = useState<string | null>(null);
  const [clientSeed, setClientSeed] = useState(() =>
    Math.random().toString(36).slice(2, 10)
  );
  const [nonce, setNonce] = useState(0);
  const [serverHash, setServerHash] = useState<string>("");
  const [reveal, setReveal] = useState<string>("");

  // store flip history
  const [history, setHistory] = useState<FlipItem[]>([]);

  const winChance = 0.5;
  const houseEdge = 0.025;
  const payoutMultiplier = useMemo(() => {
    return (1 - houseEdge) / winChance;
  }, [houseEdge, winChance]);

  const SERVER_URL =
    (import.meta.env?.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8787";
  const HOUSE = useMemo(
    () => new PublicKey("LCnErcGyqRTt8R14nmY9gMVgAbP15rDcpLwbpmwLdYD"),
    []
  );

  useEffect(() => {
    const loadCommit = async () => {
      try {
        const resp = await fetch(`${SERVER_URL}/fair/commit`);
        if (!resp.ok) return;
        const data = (await resp.json()) as { serverHash?: string };
        if (data.serverHash) setServerHash(data.serverHash);
      } catch {
        // ignore
      }
    };
    loadCommit();
  }, [SERVER_URL]);

  const betSol = useMemo(() => {
    const n = Number(bet);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [bet]);

  const playTone = async (startHz: number, endHz: number, duration: number) => {
    if (!soundOn) return;
    const ctx = audioRef.current ?? new AudioContext();
    audioRef.current = ctx;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(startHz, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endHz, ctx.currentTime + duration);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  const playWin = async () => {
    await playTone(520, 920, 0.18);
    await playTone(620, 1040, 0.22);
  };

  const playLoss = async () => {
    await playTone(260, 160, 0.28);
  };

  const flipDurationMs = 1100;

  const doFlip = async () => {
    if (flipping) return;
    if (betSol <= 0) {
      setMessage("Enter a valid bet amount.");
      return;
    }
    if (!clientSeed) {
      setMessage("Enter a client seed.");
      return;
    }
    if (!publicKey) {
      setMessage("Connect your wallet first.");
      return;
    }

    setFlipping(true);
    onFlipStateChange?.(true);
    setResultTone("");
    setMessage("Waiting for wallet approval");
    setPayoutSig(null);
    setPayoutStatus(null);
    setWagerSig(null);
    setAnimating(false);
    playTone(980, 240, 0.7);

    try {
      const expectedLamports = Math.round(betSol * LAMPORTS_PER_SOL);
      const buildTx = async () => {
        const latest = await connection.getLatestBlockhash("confirmed");
        return new Transaction({
          feePayer: publicKey,
          recentBlockhash: latest.blockhash,
        }).add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: HOUSE,
            lamports: expectedLamports,
          })
        );
      };

      const sendWithRetry = async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const tx = await buildTx();
          try {
            setMessage(attempt === 0 ? "Submitting wager..." : "Refreshing blockhash...");
            return await sendTransaction(tx, connection, {
              skipPreflight: false,
              preflightCommitment: "processed",
              maxRetries: 3,
            });
          } catch (err: any) {
            const msg = err?.message ?? "";
            if (
              msg.includes("block height exceeded") ||
              msg.includes("Blockhash not found")
            ) {
              if (attempt === 0) continue;
              throw new Error("Blockhash expired. Please try again.");
            }
            throw err;
          }
        }
        throw new Error("Failed to send transaction.");
      };

      const signature = await sendWithRetry();
      setWagerSig(signature);
      setMessage("Transaction sent. Waiting for confirmation...");

      const settleWithRetry = async (attempts: number) => {
        for (let i = 0; i < attempts; i += 1) {
          const resp = await fetch(`${SERVER_URL}/settle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signature, expectedLamports, clientSeed, nonce }),
          });
          const data = (await resp.json()) as SettleResponse;
          if (resp.ok && "result" in data) return data;
          const msg = "error" in data ? data.error : "Settle failed.";
          const pending =
            msg.includes("Transaction not found") || msg.includes("not confirmed");
          if (!pending || i === attempts - 1) throw new Error(msg);
          setMessage("Pending on-chain confirmation...");
          await new Promise((r) => setTimeout(r, 2000));
        }
        throw new Error("Settle failed.");
      };

      const data = await settleWithRetry(30);
      const result: FlipSide = data.result;
      setServerHash(data.nextServerHash ?? "");
      setReveal(`Server Seed: ${data.serverSeed} • Hash: ${data.serverHash} • Digest: ${data.digest}`);
      setNonce((n) => n + 1);
      const win = result === pick;
      setMessage("Confirmed. Flipping...");
      setAnimating(true);
      await new Promise((r) => setTimeout(r, flipDurationMs));
      setLastResult(result);
      setAnimating(false);

      const item: FlipItem = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ts: Date.now(),
        betSol,
        pick,
        result,
        win,
      };

      setHistory((prev) => [item, ...prev].slice(0, 50));
      if (data.win) {
        setPayoutSig(data.payoutSig);
        setPayoutStatus("pending");
      }
      setMessage(win ? "You won 🎉" : "You lost 😵");
      setResultTone(win ? "win" : "loss");
      if (win) {
        playWin();
      } else {
        playLoss();
      }
    } catch (e: any) {
      setAnimating(false);
      setMessage(e?.message ?? "Flip failed.");
    } finally {
      setFlipping(false);
      onFlipStateChange?.(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!payoutSig) return undefined;
    const check = async () => {
      try {
        const status = await connection.getSignatureStatus(payoutSig, {
          searchTransactionHistory: true,
        });
        if (status?.value?.confirmationStatus === "confirmed" || status?.value?.confirmationStatus === "finalized") {
          if (active) setPayoutStatus("confirmed");
        }
      } catch (e) {
        // ignore
      }
    };
    check();
    const id = setInterval(check, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [connection, payoutSig]);

  const quickBet = (v: number) => setBet(String(v));

  return (
    <div
      className={`card-shell ${
        resultTone === "win" ? "result-win" : resultTone === "loss" ? "result-loss" : ""
      }`}
      style={{
        borderRadius: 14,
        padding: 16,
        marginTop: 16,
        color: "#fff",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <button
          onClick={() => setSoundOn((v) => !v)}
          disabled={flipping}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255, 138, 56, 0.5)",
            background: soundOn
              ? "linear-gradient(135deg, #ff7a18, #ffd166)"
              : "rgba(34, 12, 10, 0.8)",
            color: soundOn ? "#2d0b05" : "#f7cba3",
            fontWeight: 700,
            cursor: flipping ? "not-allowed" : "pointer",
            opacity: flipping ? 0.7 : 1,
          }}
        >
          Sound {soundOn ? "On" : "Off"}
        </button>

        <div className="coin-wrap">
          <div
            className={`coin ${animating ? "flip" : ""} ${
              lastResult ? lastResult.toLowerCase() : "heads"
            }`}
          >
            <div className="coin-face front">
              <img
                src="/coin-heads.png"
                alt="Heads"
                className="coin-face-image"
              />
            </div>
            <div className="coin-face back">
              <img
                src="/coin-tails.png"
                alt="Tails"
                className="coin-face-image"
              />
            </div>
          </div>
        </div>

        <div className="odds-row">
          <div className="odds-card">
            <span>Payout</span>
            <b>{payoutMultiplier.toFixed(2)}x</b>
          </div>
          <div className="odds-card">
            <span>House Edge</span>
            <b>{(houseEdge * 100).toFixed(1)}%</b>
          </div>
        </div>

        <div className="pick-row">
          <button
            onClick={() => setPick("HEADS")}
            disabled={flipping}
            className={`pick-btn ${pick === "HEADS" ? "active" : ""}`}
          >
            HEADS
          </button>
          <button
            onClick={() => setPick("TAILS")}
            disabled={flipping}
            className={`pick-btn ${pick === "TAILS" ? "active" : ""}`}
          >
            TAILS
          </button>
        </div>

        <label className="bet-label">
          Bet (SOL)
        </label>
        <input
          value={bet}
          onChange={(e) => setBet(e.target.value)}
          placeholder="0.1"
          disabled={flipping}
          className="bet-input"
        />

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={() => quickBet(0.05)}
            style={{ ...qbStyle, opacity: flipping ? 0.7 : 1, cursor: flipping ? "not-allowed" : "pointer" }}
            disabled={flipping}
          >
            0.05
          </button>
          <button
            onClick={() => quickBet(0.1)}
            style={{ ...qbStyle, opacity: flipping ? 0.7 : 1, cursor: flipping ? "not-allowed" : "pointer" }}
            disabled={flipping}
          >
            0.1
          </button>
          <button
            onClick={() => quickBet(0.25)}
            style={{ ...qbStyle, opacity: flipping ? 0.7 : 1, cursor: flipping ? "not-allowed" : "pointer" }}
            disabled={flipping}
          >
            0.25
          </button>
          <button
            onClick={() => quickBet(0.5)}
            style={{ ...qbStyle, opacity: flipping ? 0.7 : 1, cursor: flipping ? "not-allowed" : "pointer" }}
            disabled={flipping}
          >
            0.5
          </button>
        </div>

        <button
          onClick={doFlip}
          disabled={flipping}
          style={{
            marginTop: 12,
            width: "100%",
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255, 138, 56, 0.6)",
            background: flipping
              ? "rgba(40, 16, 12, 0.8)"
              : "linear-gradient(135deg, #ff7a18, #ffd166)",
            color: flipping ? "#f7cba3" : "#2d0b05",
            fontWeight: 700,
            cursor: flipping ? "not-allowed" : "pointer",
          }}
        >
          {flipping ? "Flipping..." : "Flip"}
        </button>

        {message && (
          <div style={{ marginTop: 12, opacity: 0.95, textAlign: "center" }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{message}</span>
            <div style={{ marginTop: 6, color: "#bbb" }}>
              Pick: <b>{pick}</b>
            </div>
            {payoutSig && (
              <div style={{ marginTop: 6, color: "#ffd9b3", wordBreak: "break-word" }}>
                Payout tx: <code>{payoutSig}</code>
                {payoutStatus && (
                  <span style={{ marginLeft: 8, color: payoutStatus === "confirmed" ? "#9fffb3" : "#ffd166" }}>
                    {payoutStatus === "confirmed" ? "Confirmed" : "Pending..."}
                  </span>
                )}
              </div>
            )}
            {wagerSig && (
              <div style={{ marginTop: 6, color: "#ffd9b3", wordBreak: "break-word" }}>
                Wager tx: <code>{wagerSig}</code>
              </div>
            )}
          </div>
        )}

        <div style={{ width: "100%" }}>
          <h3 style={{ marginTop: 10, textAlign: "center" }}>Recent Plays</h3>

          {history.length === 0 ? (
            <div style={{ padding: 12, borderRadius: 12, border: "1px solid #512020", color: "#f7cba3", textAlign: "center" }}>
              No flips yet. Make your first flip.
            </div>
          ) : (
            <div className="history-scroll" style={{ border: "1px solid #512020", borderRadius: 12, overflow: "hidden", height: 200, overflowY: "auto" }}>
              {history.slice(0, 3).map((h) => (
                <div
                  key={h.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: 12,
                    borderBottom: "1px solid #3b1510",
                    background: "#250d0b",
                  }}
                >
                  <div style={{ minWidth: 90, color: "#aaa" }}>{formatTime(h.ts)}</div>

                  <div style={{ flex: 1 }}>
                    Bet: <b>{h.betSol}</b> SOL • Pick: <b>{h.pick}</b> • Result: <b>{h.result}</b>
                  </div>

                  <div style={{ fontWeight: 800 }}>
                    {h.win ? "WIN" : "LOSS"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fair-panel">
          <div className="fair-row">
            <span>Server Hash (pre-flip)</span>
            <code>{serverHash || "—"}</code>
          </div>
          <div className="fair-row">
            <span>Client Seed</span>
            <input
              value={clientSeed}
              onChange={(e) => setClientSeed(e.target.value)}
              disabled={flipping}
              className="seed-input"
            />
          </div>
          <div className="fair-row">
            <span>Nonce</span>
            <b>{nonce}</b>
          </div>
          {reveal && (
            <div className="fair-reveal">
              <span>Reveal</span>
              <code>{reveal}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const qbStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #512020",
  background: "#250d0b",
  color: "#fff",
  cursor: "pointer",
};
