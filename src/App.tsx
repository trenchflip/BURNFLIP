import { useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import BurnFeed from "./components/BurnFeed";
import CoinFlip from "./components/CoinFlip";
import MarketCapChart from "./components/MarketCapChart";
import MarketCapTicker from "./components/MarketCapTicker";
import StatsPanel from "./components/StatsPanel";
import "./App.css";


export default function App() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<string>("—");
  const [isFlipping, setIsFlipping] = useState(false);
  const prevFlipping = useRef(false);

  const loadBalance = async () => {
    if (!publicKey) {
      setBalance("—");
      return;
    }
    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setBalance((lamports / LAMPORTS_PER_SOL).toFixed(4));
    } catch (e) {
      setBalance("—");
    }
  };

  useEffect(() => {
    loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  useEffect(() => {
    const id = setInterval(() => {
      if (publicKey && !isFlipping) loadBalance();
    }, 2000);
    return () => clearInterval(id);
  }, [publicKey, isFlipping]);

  useEffect(() => {
    if (prevFlipping.current && !isFlipping && publicKey) {
      loadBalance();
    }
    prevFlipping.current = isFlipping;
  }, [isFlipping, publicKey]);

  return (
    <div className="app-shell">
      <div className="top-logo">
        <img src="/burnflip-logo.png" alt="Burn Flip logo" />
      </div>
      <div className="top-socials">
        <a
          href="https://x.com/burnflip_"
          className="x-link"
          target="_blank"
          rel="noreferrer"
          aria-label="BurnFlip on X"
        >
          <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
            <path d="M18.244 2H21l-6.517 7.45L22 22h-6.406l-4.583-5.96L5.406 22H2.65l7.07-8.082L2 2h6.57l4.14 5.41L18.244 2Zm-2.24 18h1.777L8.06 4h-1.8l9.744 16Z" />
          </svg>
        </a>
      </div>
      <div className="top-ticker">
        <MarketCapTicker />
      </div>
      <div className="app-wallet">
        <div className="wallet-left">
          <WalletMultiButton />
        </div>
      </div>
      <div className="app-main">
        <div className="left-stack">
          <MarketCapChart />
          <BurnFeed />
        </div>
        <div className="app-card">
          <div className="card-balance">
        <div className="wallet-balance">
          <span>Balance</span>
          <b>{balance} SOL</b>
        </div>
          </div>
          <CoinFlip onFlipStateChange={setIsFlipping} />
        </div>
      </div>
      <StatsPanel />
    </div>
  );
}
