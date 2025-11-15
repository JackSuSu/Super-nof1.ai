"use client";

import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/animated-number";
import { SiBitcoin, SiEthereum, SiBinance, SiDogecoin } from "react-icons/si";
import { TbCurrencySolana } from "react-icons/tb";

interface CryptoCardProps {
  symbol: string;
  name: string;
  price: string;
  change?: string;
}

const iconMap = {
  BTC: SiBitcoin,
  ETH: SiEthereum,
  SOL: TbCurrencySolana,
  BNB: SiBinance,
  DOGE: SiDogecoin,
};

const colorMap = {
  BTC: "text-orange-500",
  ETH: "text-blue-500",
  SOL: "text-purple-500",
  BNB: "text-yellow-500",
  DOGE: "text-amber-500",
};

const gradientMap = {
  BTC: "from-orange-500/20 via-background to-background",
  ETH: "from-blue-500/20 via-background to-background",
  SOL: "from-purple-500/20 via-background to-background",
  BNB: "from-yellow-500/20 via-background to-background",
  DOGE: "from-amber-500/20 via-background to-background",
};

const glowMap = {
  BTC: "group-hover:shadow-orange-500/20",
  ETH: "group-hover:shadow-blue-500/20",
  SOL: "group-hover:shadow-purple-500/20",
  BNB: "group-hover:shadow-yellow-500/20",
  DOGE: "group-hover:shadow-amber-500/20",
};

export function CryptoCard({ symbol, name, price, change }: CryptoCardProps) {
  const Icon = iconMap[symbol as keyof typeof iconMap];
  const iconColor = colorMap[symbol as keyof typeof colorMap];
  const gradient = gradientMap[symbol as keyof typeof gradientMap];
  const glow = glowMap[symbol as keyof typeof glowMap];

  return (
    <Card className={`group relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 bg-gradient-to-br ${gradient} ${glow}`}>
      {/* Animated glow effect */}
      <div className="absolute top-0 right-0 w-24 h-20 bg-gradient-to-br from-white/5 to-transparent rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative p-1 pl-5 space-y-1">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className={`p-1 rounded-xl bg-gradient-to-br ${iconColor.replace('text-', 'from-')}/20 to-background border border-${iconColor.replace('text-', '')}/20`}>
              <Icon className={`text-2xl ${iconColor} drop-shadow-lg`} />
            </div>
          )}
          <div className="flex-1">
            <div className="font-black text-sm tracking-wide">{symbol}</div>
            <div className="text-[10px] text-muted-foreground/80 font-semibold uppercase tracking-wider">{name}</div>
          </div>
        </div>

        <div className="space-y-1">
          <AnimatedNumber
            value={price}
            className="font-mono text-xl font-black block bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent"
          />
          {change && (
            <div
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md ${change.startsWith("+")
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-red-500/20 text-red-600 dark:text-red-400"
                }`}
            >
              {change.startsWith("+") ? "↗" : "↘"}
              {change}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
