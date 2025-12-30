import React, { useEffect, useState } from "react";

type StatsResponse = {
  totalWagersSol?: number;
  totalBurnedSol?: number;
  lastBuybackTx?: string | null;
  houseBalanceSol?: number;
};

const SERVER_URL =
  (import.meta.env?.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8787";

export default function StatsPanel() {
  const [stats, setStats] = useState<StatsResponse>({});
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    try {
      setLoading(true);
      const resp = await fetch(`${SERVER_URL}/stats`);
      if (!resp.ok) return;
      const data = (await resp.json()) as StatsResponse;
      setStats(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    const id = setInterval(loadStats, 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="stats-panel">
      <div className="stats-header">
        <h3>Public Stats</h3>
        <button className="stats-refresh" onClick={loadStats} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      <div className="stats-grid">
        <div className="stats-card">
          <span>Total Wagers</span>
          <b>{stats.totalWagersSol?.toFixed(4) ?? "—"} SOL</b>
        </div>
        <div className="stats-card">
          <span>Total Burned</span>
          <b>{stats.totalBurnedSol?.toFixed(4) ?? "—"} SOL</b>
        </div>
        <div className="stats-card">
          <span>Last Buyback Tx</span>
          <b>{stats.lastBuybackTx ?? "—"}</b>
        </div>
        <div className="stats-card">
          <span>Live House Balance</span>
          <b>{stats.houseBalanceSol?.toFixed(4) ?? "—"} SOL</b>
        </div>
      </div>
    </div>
  );
}
