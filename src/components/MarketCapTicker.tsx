import React, { useEffect, useState } from "react";

const SERVER_URL =
  (import.meta.env?.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8787";
const MINT = "8R5GEZbit9caGoqWq2bwZt2SJykQYPfZL9Rwe3enpump";

export default function MarketCapTicker() {
  const [marketCap, setMarketCap] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const loadMarketCap = async () => {
    try {
      setLoading(true);
      const resp = await fetch(`${SERVER_URL}/marketcap?mint=${MINT}`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { marketCapUsd?: number | null };
      if (typeof data.marketCapUsd === "number") {
        setMarketCap(data.marketCapUsd);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMarketCap();
    const id = setInterval(loadMarketCap, 3000);
    return () => clearInterval(id);
  }, []);

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  return (
    <div className="marketcap-pill">
      <span>BurnFlip MKT</span>
      <b>{marketCap == null ? (loading ? "…" : "—") : formatter.format(marketCap)}</b>
    </div>
  );
}
