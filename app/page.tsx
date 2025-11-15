"use client";

import { useEffect, useState, useCallback } from "react";
import { MetricsChart } from "@/components/metrics-chart";
import { CryptoCard } from "@/components/crypto-card";
import { ModelsView } from "@/components/models-view";

import { Card } from "@/components/ui/card";
import { MarketState } from "@/lib/trading/current-market-state";
import { MetricData } from "@/lib/types/metrics";

interface CryptoPricing {
  btc: MarketState;
  eth: MarketState;
  sol: MarketState;
  doge: MarketState;
  bnb: MarketState;
}

interface MetricsResponse {
  data: {
    metrics: MetricData[];
    totalCount: number;
    model: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  success: boolean;
}

interface PricingResponse {
  data: {
    pricing: CryptoPricing;
  };
  success: boolean;
}

export default function Home() {
  const [metricsData, setMetricsData] = useState<MetricData[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [pricing, setPricing] = useState<CryptoPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  // 获取图表数据
  const fetchMetrics = useCallback(async () => {
    try {
      const response = await fetch("/api/metrics");
      if (!response.ok) return;

      const data: MetricsResponse = await response.json();
      if (data.success && data.data) {
        setMetricsData(data.data.metrics || []);
        setTotalCount(data.data.totalCount || 0);
        setLastUpdate(new Date().toLocaleTimeString());
        setLoading(false);
      }
    } catch (err) {
      console.error("Error fetching metrics:", err);
      setLoading(false);
    }
  }, []);

  // 获取价格数据
  const fetchPricing = useCallback(async () => {
    try {
      const response = await fetch("/api/pricing");
      if (!response.ok) return;

      const data: PricingResponse = await response.json();
      if (data.success && data.data.pricing) {
        setPricing(data.data.pricing);
      }
    } catch (err) {
      console.error("Error fetching pricing:", err);
    }
  }, []);

  useEffect(() => {
    // 初始加载
    fetchMetrics();
    fetchPricing();

    const metricsInterval = setInterval(fetchMetrics, 10000);

    const pricingInterval = setInterval(fetchPricing, 10000);

    return () => {
      clearInterval(metricsInterval);
      clearInterval(pricingInterval);
    };
  }, [fetchMetrics, fetchPricing]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Animated background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative max-w-[1600px] mx-auto p-4 md:p-8 space-y-4">
        {/* Premium Header */}
        

        {/* Premium Navigation */}
        <div className="flex gap-6 border-b border-border/50">
          <button className="group relative pb-2 px-2">
            <span className="text-sm font-bold tracking-wide bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              LIVE
            </span>
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full shadow-lg shadow-blue-500/50" />
          </button>
        </div>

        {/* Premium Crypto Ticker */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {pricing ? (
            <>
              <CryptoCard
                symbol="BTC"
                name="Bitcoin"
                price={`$${pricing.btc.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="ETH"
                name="Ethereum"
                price={`$${pricing.eth.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="SOL"
                name="Solana"
                price={`$${pricing.sol.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="BNB"
                name="BNB"
                price={`$${pricing.bnb.current_price.toLocaleString()}`}
              />
              <CryptoCard
                symbol="DOGE"
                name="Dogecoin"
                price={`$${pricing.doge.current_price.toFixed(4)}`}
              />
            </>
          ) : (
            // Premium loading skeleton
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 p-5 border border-border/50">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer" />
                <div className="space-y-3">
                  <div className="h-8 w-8 bg-muted rounded-xl animate-pulse" />
                  <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                  <div className="h-6 w-32 bg-muted rounded animate-pulse" />
                </div>
              </div>
            ))
          )}

          {lastUpdate && (
            <div className="text-right space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">Last Sync</div>
              <div className="text-xl font-black font-mono bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                {lastUpdate}
              </div>

              {process.env.NEXT_PUBLIC_TRADING_MODE === 'dry-run' && (
                <div className="relative group">
                 
                  <span className="relative inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg">
                  
                    Virtual Mode
                  </span>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Main Content - Chart and Models Side by Side */}
        <div className="flex flex-row gap-6">
          {/* Left: Chart */}
          <div className="flex-[2]">
            <MetricsChart
              metricsData={metricsData}
              loading={loading}
              lastUpdate={lastUpdate}
              totalCount={totalCount}
            />
          </div>

          {/* Right: Models View */}
          <div className="flex-1">
            <ModelsView />
          </div>
        </div>

        {/* Premium Footer */}
        <div className="relative mt-12 pt-8 border-t border-border/50">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-amber-500/10 border border-amber-500/20">
              <svg className="w-6 h-6 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span className="text-sm font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">
                TOP PERFORMER: DEEPSEEK R1
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/80">
              <span className="font-semibold">Super Nof1.ai</span>
              <span>•</span>
              <span>Autonomous AI Trading Platform</span>
              <span>•</span>
              <span>Built with ❤️</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
