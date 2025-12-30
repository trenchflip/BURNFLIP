import { useEffect, useMemo, useState } from "react";

const MINT_ADDRESS = "8R5GEZbit9caGoqWq2bwZt2SJykQYPfZL9Rwe3enpump";
const MAX_POINTS = 30;
const CHART_HEIGHT = 90;
const CHART_WIDTH = 260;

export default function MarketCapChart() {
  const [points, setPoints] = useState<number[]>([]);
  const [lastValue, setLastValue] = useState<number | null>(null);

  const loadMarketCap = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/marketcap?mint=${MINT_ADDRESS}`
      );
      const data = await response.json();
      if (typeof data.marketCapUsd === "number") {
        setLastValue(data.marketCapUsd);
        setPoints((prev) => {
          const next = [...prev, data.marketCapUsd];
          return next.slice(-MAX_POINTS);
        });
      }
    } catch (e) {
      setLastValue(null);
    }
  };

  useEffect(() => {
    loadMarketCap();
    const id = setInterval(loadMarketCap, 3000);
    return () => clearInterval(id);
  }, []);

  const { linePoints, areaPoints } = useMemo(() => {
    if (points.length === 0) {
      return { linePoints: "", areaPoints: "" };
    }
    const min = Math.min(...points);
    const max = Math.max(...points);
    const padding = Math.max(1, (max - min) * 0.1);
    const range = Math.max(1, max - min + padding * 2);

    const coords = points.map((value, index) => {
      const x = (index / Math.max(1, points.length - 1)) * CHART_WIDTH;
      const y =
        CHART_HEIGHT -
        ((value - (min - padding)) / range) * CHART_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const linePoints = coords.join(" ");
    const areaPoints = `${linePoints} ${CHART_WIDTH},${CHART_HEIGHT} 0,${CHART_HEIGHT}`;
    return { linePoints, areaPoints };
  }, [points]);

  return (
    <div className="marketcap-chart">
      <div className="marketcap-chart-header">
        <span>BurnFlip MKT</span>
        <b>{lastValue ? `$${lastValue.toFixed(2)}` : "—"}</b>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="marketcap-chart-canvas"
        role="img"
        aria-label="Live market cap chart"
      >
        {areaPoints ? (
          <>
            <defs>
              <linearGradient id="mktGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255, 180, 90, 0.55)" />
                <stop offset="100%" stopColor="rgba(90, 24, 10, 0)" />
              </linearGradient>
            </defs>
            <polygon points={areaPoints} fill="url(#mktGlow)" />
            <polyline
              points={linePoints}
              fill="none"
              stroke="#ffd166"
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        ) : (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255, 217, 179, 0.7)"
            fontSize="12"
          >
            Loading chart…
          </text>
        )}
      </svg>
      <div className="marketcap-chart-foot">Live update · 3s</div>
    </div>
  );
}
