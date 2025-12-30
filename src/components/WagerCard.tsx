import React, { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

type SettleResponse =
  | { win: true; payoutSig: string }
  | { win: false }
  | { error: string };

const SERVER_URL =
  (import.meta.env?.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8787";

export default function WagerCard() {
  const { publicKey, sendTransaction } = useWallet();

  const [sol, setSol] = useState("0.1");
  const [status, setStatus] = useState("");
  const [wagerSig, setWagerSig] = useState<string | null>(null);
  const [payoutSig, setPayoutSig] = useState<string | null>(null);
  const [maxBetLamports, setMaxBetLamports] = useState<number | null>(null);
  const [resultTone, setResultTone] = useState<"" | "win" | "loss">("");
  const [isBusy, setIsBusy] = useState(false);

  // ✅ Put your HOUSE address here as a STRING
  // (this is the pubkey for server/house.json)
  const HOUSE = useMemo(
    () => new PublicKey("LCnErcGyqRTt8R14nmY9gMVgAbP15rDcpLwbpmwLdYD"),
    []
  );

  useEffect(() => {
    let active = true;

    const loadMaxBet = async () => {
      try {
        const resp = await fetch(`${SERVER_URL}/house-balance`);
        if (!resp.ok) return;
        const data = (await resp.json()) as { maxBetLamports?: number };
        if (active && typeof data.maxBetLamports === "number") {
          setMaxBetLamports(data.maxBetLamports);
        }
      } catch (e) {
        // ignore; max bet display will be hidden
      }
    };

    loadMaxBet();

    return () => {
      active = false;
    };
  }, []);

  const betLamports = useMemo(() => {
    const n = Number(sol);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * LAMPORTS_PER_SOL);
  }, [sol]);

  const maxBetSol = useMemo(() => {
    if (maxBetLamports == null) return null;
    return maxBetLamports / LAMPORTS_PER_SOL;
  }, [maxBetLamports]);

  const exceedsMax =
    maxBetLamports != null && betLamports != null && betLamports > maxBetLamports;

  const onWager = async () => {
    try {
      if (isBusy) return;
      setStatus("");
      setWagerSig(null);
      setPayoutSig(null);
      setResultTone("");

      if (!publicKey) {
        setStatus("Connect your wallet first.");
        return;
      }

      if (betLamports == null) {
        setStatus("Enter a valid SOL amount.");
        return;
      }
      if (exceedsMax) {
        setStatus("Bet exceeds max.");
        return;
      }

      const expectedLamports = betLamports;

      // ✅ Use ONE connection
      const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

      // ✅ Get fresh blockhash right before sending
      const latest = await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: latest.blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: HOUSE,
          lamports: expectedLamports,
        })
      );

      setIsBusy(true);
      setStatus("Waiting for wallet approval");
      const signature = await sendTransaction(tx, connection);

      setStatus("Confirming wager...");
      await connection.confirmTransaction(
        {
          signature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed"
      );

      setWagerSig(signature);

      // ✅ Call your server to settle
      setStatus("Flipping...");
      const resp = await fetch(`${SERVER_URL}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, expectedLamports }),
      });

      const data = (await resp.json()) as SettleResponse;

      if (!resp.ok) {
        const msg = "error" in data ? data.error : "Settle failed.";
        setStatus(`Settle failed: ${msg}`);
        return;
      }

      if ("win" in data && data.win) {
        setStatus("You won 🎉");
        setResultTone("win");
        setPayoutSig(data.payoutSig);
      } else {
        setStatus("You lost 😵");
        setResultTone("loss");
      }
    } catch (e: any) {
      setStatus(e?.message ?? "Transaction failed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className={`card-shell ${
        resultTone === "win" ? "result-win" : resultTone === "loss" ? "result-loss" : ""
      }`}
      style={{
        padding: 16,
        borderRadius: 12,
        maxWidth: 420,
        marginTop: 16,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Wager (Mainnet)</h2>

      <label style={{ display: "block", marginBottom: 8 }}>Amount (SOL)</label>

      <input
        value={sol}
        onChange={(e) => setSol(e.target.value)}
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 10,
          border: "1px solid #2d3b36",
          background: "#0f1715",
          color: "#fff",
        }}
        placeholder="0.1"
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {[0.05, 0.1, 0.25, 0.5].map((v) => {
          const disabled = maxBetSol != null && v > maxBetSol;
          return (
            <button
              key={v}
              onClick={() => setSol(String(v))}
              disabled={disabled}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #2d3b36",
                background: disabled ? "#1a1f1d" : "#0d1412",
                color: disabled ? "#5f6b64" : "#fff",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {v}
            </button>
          );
        })}

        <button
          onClick={() => {
            if (maxBetSol != null) setSol(maxBetSol.toFixed(4));
          }}
          disabled={maxBetSol == null || maxBetSol <= 0}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #2d3b36",
            background: maxBetSol == null || maxBetSol <= 0 ? "#1a1f1d" : "#0d1412",
            color: maxBetSol == null || maxBetSol <= 0 ? "#5f6b64" : "#fff",
            cursor: maxBetSol == null || maxBetSol <= 0 ? "not-allowed" : "pointer",
          }}
        >
          Max
        </button>
      </div>

      {maxBetSol != null && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Max bet: {maxBetSol.toFixed(4)} SOL
        </div>
      )}

      <button
        onClick={onWager}
        disabled={isBusy || exceedsMax}
        style={{
          marginTop: 12,
          width: "100%",
          padding: 12,
          borderRadius: 10,
          cursor: isBusy || exceedsMax ? "not-allowed" : "pointer",
          opacity: isBusy || exceedsMax ? 0.6 : 1,
          border: "1px solid #4b3b1f",
          background: "linear-gradient(135deg, #f0cf7a, #d7a741)",
          color: "#2a1b00",
          fontWeight: 700,
        }}
      >
        {isBusy ? "Working..." : "Wager"}
      </button>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {wagerSig && (
        <p style={{ marginTop: 8, wordBreak: "break-word" }}>
          Wager tx: <code>{wagerSig}</code>
        </p>
      )}

      {payoutSig && (
        <p style={{ marginTop: 8, wordBreak: "break-word" }}>
          Payout tx: <code>{payoutSig}</code>
        </p>
      )}
    </div>
  );
}
