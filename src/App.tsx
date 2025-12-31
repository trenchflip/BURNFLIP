import { useEffect, useState } from "react";
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
  const [loadingBalance, setLoadingBalance] = useState(false);

  const loadBalance = async () => {
    if (!publicKey) {
      setBalance("—");
      return;
    }
    try {
      setLoadingBalance(true);
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setBalance((lamports / LAMPORTS_PER_SOL).toFixed(4));
    } catch (e) {
      setBalance("—");
    } finally {
      setLoadingBalance(false);
    }
  };

  useEffect(() => {
    loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  useEffect(() => {
    const id = setInterval(() => {
      if (publicKey) loadBalance();
    }, 2000);
    return () => clearInterval(id);
  }, [publicKey]);

  return (
    <div className="app-shell">
      <div className="top-logo">
        <img src="/burnflip-logo.png" alt="Burn Flip logo" />
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
          <CoinFlip />
        </div>
      </div>
      <StatsPanel />
    </div>
  );
}
