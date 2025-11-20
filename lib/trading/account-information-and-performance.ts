import { Position } from "@/lib/types/position";
import { ensureTimeSync, getAdjustedTimestamp, getBinanceBaseUrl } from "./binance-official";
import { fetchPositions } from "./positions"; // Import the direct fetchPositions
import crypto from "crypto";
import { ProxyAgent } from "undici";

export interface AccountInformationAndPerformance {
  currentPositionsValue: number;
  contractValue: number;
  totalCashValue: number;
  availableCash: number;
  currentTotalReturn: number;
  positions: any[];
  sharpeRatio: number;
}

// Direct fetch balance function with proxy support
async function fetchBalance() {
  // 🔧 根据 TRADING_MODE 自动选择 API 配置
  const tradingMode = process.env.TRADING_MODE || "dry-run";
  const isDryRun = tradingMode === "dry-run";

  let apiKey: string | undefined;
  let apiSecret: string | undefined;

  if (isDryRun) {
    apiKey = process.env.BINANCE_TESTNET_API_KEY;
    apiSecret = process.env.BINANCE_TESTNET_API_SECRET;
  } else {
    apiKey = process.env.BINANCE_LIVE_API_KEY;
    apiSecret = process.env.BINANCE_LIVE_API_SECRET;
  }

  const disableProxy = String(process.env.BINANCE_DISABLE_PROXY || "").toLowerCase() === "true";
  const proxyUrl = process.env.BINANCE_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  if (!apiKey || !apiSecret) {
    const configType = isDryRun ? "TESTNET" : "LIVE";
    throw new Error(
      `BINANCE_${configType}_API_KEY or BINANCE_${configType}_API_SECRET not configured. ` +
      `Please set them in .env file for ${isDryRun ? 'virtual' : 'live'} trading.`
    );
  }

  // 🔄 先同步时�?
  await ensureTimeSync();

  const timestamp = getAdjustedTimestamp();
  const queryString = `timestamp=${timestamp}&recvWindow=60000`; // 60秒窗�?

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");

  const baseUrl = getBinanceBaseUrl();
  const url = `${baseUrl}/fapi/v2/balance?${queryString}&signature=${signature}`;

  const fetchOptions: any = {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": apiKey,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Connection": "keep-alive",
    },
    signal: AbortSignal.timeout(25000), // 25秒超�?
  };

  if (proxyUrl && !disableProxy) {
    fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
  }

  // 实现重试机制
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🔄 Fetching balance (attempt ${attempt}/3) from Binance Futures`);
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        // 获取详细错误信息
        const errorText = await response.text();
        console.error(`�?Balance API error: ${response.status} ${response.statusText}`);
        console.error(`   Response body: ${errorText}`);
        throw new Error(`Failed to fetch balance: ${response.status} ${response.statusText} - ${errorText}`);
      }

      console.log(`�?Balance fetch successful on attempt ${attempt}`);
      const balances = await response.json();
      const usdtBalance = balances.find((b: any) => b.asset === "USDT");

      return {
        USDT: {
          total: parseFloat(usdtBalance?.balance || "0"),
          free: parseFloat(usdtBalance?.balance || "0"),
          used: 0,
        },
      };
    } catch (error: any) {
      lastError = error;
      console.warn(`⚠️ Balance fetch attempt ${attempt} failed:`, error.message);

      if (attempt < 3) {
        const delay = attempt * 2000; // 递增延迟: 2s, 4s
        console.log(`�?Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Failed to fetch balance after 3 attempts");
}

// 获取账户信息，包括总资产净值
async function fetchAccountInfo() {
  // 🔧 根据 TRADING_MODE 自动选择 API 配置
  const tradingMode = process.env.TRADING_MODE || "dry-run";
  const isDryRun = tradingMode === "dry-run";

  let apiKey: string | undefined;
  let apiSecret: string | undefined;

  if (isDryRun) {
    apiKey = process.env.BINANCE_TESTNET_API_KEY;
    apiSecret = process.env.BINANCE_TESTNET_API_SECRET;
  } else {
    apiKey = process.env.BINANCE_LIVE_API_KEY;
    apiSecret = process.env.BINANCE_LIVE_API_SECRET;
  }

  const disableProxy = String(process.env.BINANCE_DISABLE_PROXY || "").toLowerCase() === "true";
  const proxyUrl = process.env.BINANCE_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  if (!apiKey || !apiSecret) {
    const configType = isDryRun ? "TESTNET" : "LIVE";
    throw new Error(
      `BINANCE_${configType}_API_KEY or BINANCE_${configType}_API_SECRET not configured. ` +
      `Please set them in .env file for ${isDryRun ? 'virtual' : 'live'} trading.`
    );
  }

  // 🔄 先同步时�?
  await ensureTimeSync();

  const timestamp = getAdjustedTimestamp();
  const queryString = `timestamp=${timestamp}&recvWindow=60000`; // 60秒窗�?

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryString)
    .digest("hex");

  const baseUrl = getBinanceBaseUrl();
  const url = `${baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`;

  const fetchOptions: any = {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": apiKey,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Connection": "keep-alive",
    },
    signal: AbortSignal.timeout(25000), // 25秒超�?
  };

  if (proxyUrl && !disableProxy) {
    fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
  }

  // 实现重试机制
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`💰  Fetching account info (attempt ${attempt}/3) from Binance Futures`);
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        // 获取详细错误信息
        const errorText = await response.text();
        console.error(`�?Account info API error: ${response.status} ${response.statusText}`);
        console.error(`   Response body: ${errorText}`);
        throw new Error(`Failed to fetch account info: ${response.status} ${response.statusText} - ${errorText}`);
      }

      console.log(`�?Account info fetch successful on attempt ${attempt}`);
      const accountInfo = await response.json();

      return {
        totalWalletBalance: parseFloat(accountInfo.totalWalletBalance || "0"), // 钱包总余�?
        totalUnrealizedProfit: parseFloat(accountInfo.totalUnrealizedProfit || "0"), // 总未实现盈亏
        totalMarginBalance: parseFloat(accountInfo.totalMarginBalance || "0"), // 保证金余�?
        totalPositionInitialMargin: parseFloat(accountInfo.totalPositionInitialMargin || "0"), // 持仓初始保证�?
        totalOpenOrderInitialMargin: parseFloat(accountInfo.totalOpenOrderInitialMargin || "0"), // 挂单初始保证�?
        availableBalance: parseFloat(accountInfo.availableBalance || "0"), // 可用余额
        maxWithdrawAmount: parseFloat(accountInfo.maxWithdrawAmount || "0"), // 最大可转出余额
      };
    } catch (error: any) {
      lastError = error;
      console.warn(`⚠️ Account info fetch attempt ${attempt} failed:`, error.message);

      if (attempt < 3) {
        const delay = attempt * 2000; // 递增延迟: 2s, 4s
        console.log(`�?Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Failed to fetch account info after 3 attempts");
}

export async function getAccountInformationAndPerformance(
  initialCapital?: number
): Promise<AccountInformationAndPerformance> {
  // Use the direct, proxy-aware fetchPositions for reliability
  const allPositions = await fetchPositions();

  // 🔧 只保留活跃持仓（contracts !== 0），这样 AI 就知道哪些币有持�?
  const positions = allPositions.filter((p: any) => p.contracts !== 0);

  console.log(`📊 Filtered positions: ${positions.length} active out of ${allPositions.length} total`);

  // 计算持仓价值：初始保证�?+ 未实现盈�?
  const currentPositionsValue = positions.reduce((acc: number, position: any) => {
    return acc + (position.initialMargin || 0) + (position.unrealizedPnl || 0);
  }, 0);

  const contractValue = positions.reduce((acc: number, position: any) => {
    return acc + (position.contracts || 0);
  }, 0);

  // 获取完整的账户信�?
  const accountInfo = await fetchAccountInfo();
  const balanceInfo = await fetchBalance();

  // 账户总价�?= 钱包总余额（这是币安官方计算的包含所有资产和盈亏的总价值）
  // totalWalletBalance 已经包含了：
  // 1. 所有币种的余额转换为USDT
  // 2. 所有未实现盈亏
  // 3. 已实现盈�?
  const totalAccountValue = accountInfo.totalWalletBalance;

  // 可用余额 = 可以用于新交易的余额
  const availableCash = accountInfo.availableBalance;

  // 如果没有传入 initialCapital，首次运行时将当前账户价值作为基�?
  const baseCapital = initialCapital ?? totalAccountValue;
  const currentTotalReturn = baseCapital > 0 ? (totalAccountValue - baseCapital) / baseCapital : 0;

  // 总未实现盈亏（从账户信息获取，更准确�?
  const totalUnrealizedPnl = accountInfo.totalUnrealizedProfit;

  const sharpeRatio = baseCapital > 0 && Math.abs(totalUnrealizedPnl) > 0.001
    ? currentTotalReturn / Math.abs(totalUnrealizedPnl / baseCapital)
    : 0;


  console.log([
    ``,
    `📊 TWB: $${totalAccountValue.toFixed(4)}`,
    `💵 AB: $${availableCash.toFixed(4)}`,
    `📈 UPnL: $${totalUnrealizedPnl.toFixed(4)}`,
    `🎯 TReturn: ${(currentTotalReturn * 100).toFixed(2)}%`,
    `📍 AtPs: ${positions.length}`,
    `💼 Positions: $${currentPositionsValue.toFixed(4)}`
].join(' '));


  // 🔍 列出活跃持仓，方�?AI 和用户查�?
  if (positions.length > 0) {
    console.log(`\n📋 Current Active Positions:`);
    positions.forEach((p: any) => {
      const side = p.contracts > 0 ? 'LONG' : 'SHORT';
      const pnl = p.unrealizedPnl >= 0 ? `+$${p.unrealizedPnl.toFixed(2)}` : `-$${Math.abs(p.unrealizedPnl).toFixed(2)}`;
      console.log(`   �?${p.symbol}: ${side} ${Math.abs(p.contracts)} @ $${p.entryPrice} (PnL: ${pnl})`);
    });
  }

  return {
    currentPositionsValue,
    contractValue,
    totalCashValue: totalAccountValue, // 使用币安官方的钱包总余�?
    availableCash,
    currentTotalReturn,
    positions,
    sharpeRatio,
  };
} export function formatAccountPerformance(
  accountPerformance: AccountInformationAndPerformance
) {
  const { currentTotalReturn, availableCash, totalCashValue, positions, currentPositionsValue } =
    accountPerformance;

  const totalUnrealizedPnl = positions.reduce((acc: number, position: any) => {
    return acc + (position.unrealizedPnl || 0);
  }, 0);

  // Calculate Sharpe Ratio (simplified approximation)
  // Note: For accurate Sharpe ratio, you'd need historical returns data
  const sharpeRatio = currentTotalReturn > 0 ? (currentTotalReturn / 0.1).toFixed(2) : "N/A";

  let output = `Current Total Return (percent): ${(currentTotalReturn * 100).toFixed(2)}%
Available Cash: $${availableCash.toFixed(4)}
Current Account Value: $${totalCashValue.toFixed(4)}
Sharpe Ratio (risk-adjusted returns): ${sharpeRatio}
Unrealized PnL: $${totalUnrealizedPnl.toFixed(4)}
Positions Value: $${currentPositionsValue.toFixed(4)}

## CURRENT POSITION INFORMATION

Total Active Positions: ${positions.length}
`;

  if (positions.length > 0) {
    output += '\nDetailed Position Breakdown:\n';
    positions.forEach((position: any, index: number) => {
      output += `
Position ${index + 1}:
  symbol: ${position.symbol}
  quantity: ${position.contracts}
  entry_price: $${position.entryPrice?.toFixed(4) || 'N/A'}
  current_price: $${position.markPrice?.toFixed(4) || 'N/A'}
  unrealized_pnl: $${position.unrealizedPnl?.toFixed(4) || 'N/A'}
  leverage: ${position.leverage}x
  liquidation_price: $${position.liquidationPrice?.toFixed(4) || 'N/A'}
  notional_usd: $${position.notional?.toFixed(4) || 'N/A'}
  side: ${position.side}
  profit_target (takeProfit): ${position.takeProfitPrice ? '$' + position.takeProfitPrice.toFixed(4) : 'Not Set'}
  stop_loss: ${position.stopLossPrice ? '$' + position.stopLossPrice.toFixed(4) : 'Not Set'}
`;
    });
  } else {
    output += '\nNo active positions currently.\n';
  }

  return output;
}
