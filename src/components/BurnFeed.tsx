import { useEffect, useState } from "react";

type BurnEntry = {
  signature: string;
  timestamp: string;
  burnAmountUi?: string;
  burnAmountRaw?: string;
  dryRun?: boolean;
};

const POLL_MS = 8000;
const TICK_MS = 1000;

function shortSig(sig: string) {
  return `${sig.slice(0, 6)}...${sig.slice(-6)}`;
}

export default function BurnFeed() {
  const [burns, setBurns] = useState<BurnEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(null);

  const loadBurns = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/burns?limit=12`
      );
      const data = await response.json();
      if (Array.isArray(data.burns)) {
        setBurns(data.burns);
      }
      if (typeof data.secondsRemaining === "number") {
        setSecondsRemaining(data.secondsRemaining);
      }
      if (typeof data.intervalSeconds === "number") {
        setIntervalSeconds(data.intervalSeconds);
      }
    } catch (e) {
      setBurns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBurns();
    const id = setInterval(loadBurns, POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (secondsRemaining == null) return;
    const id = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev == null) return prev;
        return Math.max(0, prev - 1);
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [secondsRemaining]);

  const formatCountdown = (value: number | null) => {
    if (value == null) return "—";
    const mins = Math.floor(value / 60);
    const secs = value % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div className="burns-card">
      <div className="burns-header">
        <h3>Burn Feed</h3>
        <span>
          Next burn{" "}
          {intervalSeconds ? `(${Math.round(intervalSeconds / 60)}m)` : ""} ·{" "}
          {formatCountdown(secondsRemaining)}
        </span>
      </div>
      <div className="burns-list">
        {loading ? (
          <div className="burns-empty">Loading burns…</div>
        ) : burns.length === 0 ? (
          <div className="burns-empty">No burns yet.</div>
        ) : (
          burns.map((burn) => (
            <div className="burns-row" key={burn.signature}>
              <div className="burns-left">
                <span className="burns-amount">
                  🔥 {burn.burnAmountUi ?? "—"} BURN
                  {burn.dryRun && <span className="burns-badge">Dry run</span>}
                </span>
                <span className="burns-time">
                  {new Date(burn.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <a
                className="burns-link"
                href={`https://solscan.io/tx/${burn.signature}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortSig(burn.signature)}
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
