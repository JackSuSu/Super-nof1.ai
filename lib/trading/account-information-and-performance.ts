import { Position } from "@/lib/types/position";
import {
  ensureTimeSync,
  getAdjustedTimestamp,
  getBinanceBaseUrl,
} from "./binance-official";
import { fetchPositions } from "./positions";
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

class AccountInfoService {
  private apiKey!: string;
  private apiSecret!: string;
  private baseUrl!: string;
  private disableProxy!: boolean;
  private proxyUrl?: string;

  constructor() {
    this.initializeConfig();
  }

  private initializeConfig(): void {
    console.log(`🔧 Initializing account info service...`);

    const tradingMode = process.env.TRADING_MODE || "dry-run";
    const isDryRun = tradingMode === "dry-run";

    if (isDryRun) {
      this.apiKey = process.env.BINANCE_TESTNET_API_KEY || "";
      this.apiSecret = process.env.BINANCE_TESTNET_API_SECRET || "";
      console.log(`🎮 Using TESTNET configuration`);
    } else {
      this.apiKey = process.env.BINANCE_LIVE_API_KEY || "";
      this.apiSecret = process.env.BINANCE_LIVE_API_SECRET || "";
      console.log(`⚠️ Using LIVE configuration`);
    }

    if (!this.apiKey || !this.apiSecret) {
      const configType = isDryRun ? "TESTNET" : "LIVE";
      throw new Error(
        `BINANCE_${configType}_API_KEY or BINANCE_${configType}_API_SECRET not configured. ` +
          `Please set them in .env file for ${
            isDryRun ? "virtual" : "live"
          } trading.`
      );
    }

    this.baseUrl = getBinanceBaseUrl();
    this.disableProxy =
      String(process.env.BINANCE_DISABLE_PROXY || "").toLowerCase() === "true";
    this.proxyUrl =
      process.env.BINANCE_HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY;

    console.log(`✅ Account info service initialized`);
  }

  /**
   * 创建带签名的 API 请求
   */
  private async makeSignedApiRequest(endpoint: string): Promise<any> {
    console.log(`🔐 Making signed API request to: ${endpoint}`);

    await ensureTimeSync();
    const timestamp = getAdjustedTimestamp();
    const queryString = `timestamp=${timestamp}&recvWindow=60000`;
    const signature = crypto
      .createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");

    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    const fetchOptions: any = {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Connection: "keep-alive",
      },
      signal: AbortSignal.timeout(25000),
    };

    if (this.proxyUrl && !this.disableProxy) {
      fetchOptions.dispatcher = new ProxyAgent(this.proxyUrl);
      console.log(`🔌 Using proxy for API request`);
    }

    return { url, fetchOptions };
  }

  /**
   * 带重试机制的 API 调用
   */
  private async callApiWithRetry(
    apiName: string,
    url: string,
    fetchOptions: any
  ): Promise<any> {
    console.log(`🔄 Starting ${apiName} API call...`);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📡 ${apiName} attempt ${attempt}/3...`);
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `❌ ${apiName} API error: ${response.status} ${response.statusText}`
          );
          throw new Error(
            `Failed to fetch ${apiName}: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        console.log(`✅ ${apiName} fetch successful on attempt ${attempt}`);
        return await response.json();
      } catch (error: any) {
        lastError = error;
        console.warn(
          `⚠️ ${apiName} fetch attempt ${attempt} failed:`,
          error.message
        );

        if (attempt < 3) {
          const delay = attempt * 2000;
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error(`Failed to fetch ${apiName} after 3 attempts`);
  }

  /**
   * 获取余额信息
   */
  async fetchBalance() {
    console.log(`💰 Fetching balance information...`);

    const { url, fetchOptions } = await this.makeSignedApiRequest(
      "/fapi/v2/balance"
    );
    const balances = await this.callApiWithRetry("balance", url, fetchOptions);

    const usdtBalance = balances.find((b: any) => b.asset === "USDT");
    const result = {
      USDT: {
        total: parseFloat(usdtBalance?.balance || "0"),
        free: parseFloat(usdtBalance?.balance || "0"),
        used: 0,
      },
    };

    console.log(`✅ Balance fetched: $${result.USDT.total.toFixed(4)} USDT`);
    return result;
  }

  /**
   * 获取账户信息
   */
  async fetchAccountInfo() {
    console.log(`📊 Fetching account information...`);

    const { url, fetchOptions } = await this.makeSignedApiRequest(
      "/fapi/v2/account"
    );
    const accountInfo = await this.callApiWithRetry(
      "account info",
      url,
      fetchOptions
    );

    const result = {
      totalWalletBalance: parseFloat(accountInfo.totalWalletBalance || "0"),
      totalUnrealizedProfit: parseFloat(
        accountInfo.totalUnrealizedProfit || "0"
      ),
      totalMarginBalance: parseFloat(accountInfo.totalMarginBalance || "0"),
      totalPositionInitialMargin: parseFloat(
        accountInfo.totalPositionInitialMargin || "0"
      ),
      totalOpenOrderInitialMargin: parseFloat(
        accountInfo.totalOpenOrderInitialMargin || "0"
      ),
      availableBalance: parseFloat(accountInfo.availableBalance || "0"),
      maxWithdrawAmount: parseFloat(accountInfo.maxWithdrawAmount || "0"),
    };

    console.log(
      `✅ Account info fetched - Wallet: $${result.totalWalletBalance.toFixed(
        4
      )}, Available: $${result.availableBalance.toFixed(4)}`
    );
    return result;
  }

  /**
   * 计算账户指标
   */
  private calculateAccountMetrics(
    positions: any[],
    accountInfo: any,
    initialCapital?: number
  ) {
    console.log(`📈 Calculating account metrics...`);

    const currentPositionsValue = positions.reduce(
      (acc: number, position: any) => {
        return (
          acc + (position.initialMargin || 0) + (position.unrealizedPnl || 0)
        );
      },
      0
    );

    const contractValue = positions.reduce((acc: number, position: any) => {
      return acc + (position.contracts || 0);
    }, 0);

    const totalAccountValue = accountInfo.totalWalletBalance;
    const availableCash = accountInfo.availableBalance;
    const baseCapital = initialCapital ?? totalAccountValue;
    const currentTotalReturn =
      baseCapital > 0 ? (totalAccountValue - baseCapital) / baseCapital : 0;
    const totalUnrealizedPnl = accountInfo.totalUnrealizedProfit;

    const sharpeRatio =
      baseCapital > 0 && Math.abs(totalUnrealizedPnl) > 0.001
        ? currentTotalReturn / Math.abs(totalUnrealizedPnl / baseCapital)
        : 0;

    console.log(
      `📊Metrics-calculated - TV: $${totalAccountValue.toFixed(4)}, RT: ${(currentTotalReturn * 100).toFixed(2)}%, AC: $${availableCash.toFixed(4)},CPV: $${currentPositionsValue.toFixed(4)}, SR: ${sharpeRatio.toFixed(4)},CV: $${contractValue.toFixed(4)}`);

    return {
      currentPositionsValue,
      contractValue,
      totalCashValue: totalAccountValue,
      availableCash,
      currentTotalReturn,
      sharpeRatio,
    };
  }

  /**
   * 打印账户概览
   */
  private printAccountOverview(metrics: any, positions: any[]) {
    const {
      totalCashValue,
      availableCash,
      currentTotalReturn,
      currentPositionsValue,
    } = metrics;
    const totalUnrealizedPnl = positions.reduce(
      (acc: number, position: any) => {
        return acc + (position.unrealizedPnl || 0);
      },
      0
    );
    console.log(`📊 AO: TWB: $${totalCashValue.toFixed(4)} AB: $${availableCash.toFixed(4)}  UPnL: $${totalUnrealizedPnl.toFixed(4)} TR: ${(currentTotalReturn * 100).toFixed(2)}% AP: ${positions.length} PV: $${currentPositionsValue.toFixed(4)}`);


    if (positions.length > 0) {
      console.log(`\n📋 Current Active Positions:`);
      positions.forEach((p: any) => {
        const side = p.contracts > 0 ? "LONG" : "SHORT";
        const pnl =
          p.unrealizedPnl >= 0
            ? `+$${p.unrealizedPnl.toFixed(2)}`
            : `-$${Math.abs(p.unrealizedPnl).toFixed(2)}`;
        console.log(
          `   • ${p.symbol}: ${side} ${Math.abs(p.contracts)} @ $${
            p.entryPrice
          } (PnL: ${pnl})`
        );
      });
    }
  }

  /**
   * 获取完整的账户信息和性能指标
   */
  async getAccountInformationAndPerformance(
    initialCapital?: number
  ): Promise<AccountInformationAndPerformance> {
    console.log(`🚀 Starting account information and performance analysis...`);
    console.log(`📝 Input: initialCapital=${initialCapital || "auto"}`);

    try {
      // 获取持仓数据
      console.log(`📊 Fetching positions data...`);
      const allPositions = await fetchPositions();
       console.log(
        `✅ Positions before filtered: ${allPositions.length} active out of ${allPositions.length} total`
      );
      const positions = allPositions.filter((p: any) => p.contracts !== 0);
      console.log(
        `✅ Positions after filtered: ${positions.length} active out of ${allPositions.length} total`
      );

      // 获取账户信息
      const [accountInfo, balanceInfo] = await Promise.all([
        this.fetchAccountInfo(),
        this.fetchBalance(),
      ]);

      // 计算指标
      const metrics = this.calculateAccountMetrics(
        positions,
        accountInfo,
        initialCapital
      );

      // 打印概览
      this.printAccountOverview(metrics, positions);

      console.log(`✅ Account information and performance analysis completed`);

      return {
        ...metrics,
        positions,
      };
    } catch (error) {
      console.error(
        `❌ Account information and performance analysis failed:`,
        error
      );
      throw error;
    }
  }
}

// 创建单例实例
const accountInfoService = new AccountInfoService();

/**
 * 获取账户信息和性能指标
 */
export async function getAccountInformationAndPerformance(
  initialCapital?: number
): Promise<AccountInformationAndPerformance> {
  return await accountInfoService.getAccountInformationAndPerformance(
    initialCapital
  );
}

/**
 * 格式化账户性能信息
 */
export function formatAccountPerformance(
  accountPerformance: AccountInformationAndPerformance
): string {
  console.log(`📝 Formatting account performance...`);

  const {
    currentTotalReturn,
    availableCash,
    totalCashValue,
    positions,
    currentPositionsValue,
  } = accountPerformance;

  const totalUnrealizedPnl = positions.reduce((acc: number, position: any) => {
    return acc + (position.unrealizedPnl || 0);
  }, 0);

  const sharpeRatio =
    currentTotalReturn > 0 ? (currentTotalReturn / 0.1).toFixed(2) : "N/A";

  let output = `Current Total Return (percent): ${(
    currentTotalReturn * 100
  ).toFixed(2)}%
Available Cash: $${availableCash.toFixed(4)}
Current Account Value: $${totalCashValue.toFixed(4)}
Sharpe Ratio (risk-adjusted returns): ${sharpeRatio}
Unrealized PnL: $${totalUnrealizedPnl.toFixed(4)}
Positions Value: $${currentPositionsValue.toFixed(4)}

## CURRENT POSITION INFORMATION

Total Active Positions: ${positions.length}
`;

  if (positions.length > 0) {
    output += "\nDetailed Position Breakdown:\n";
    positions.forEach((position: any, index: number) => {
      output += `
Position ${index + 1}:
  symbol: ${position.symbol}
  quantity: ${position.contracts}
  entry_price: $${position.entryPrice?.toFixed(4) || "N/A"}
  current_price: $${position.markPrice?.toFixed(4) || "N/A"}
  unrealized_pnl: $${position.unrealizedPnl?.toFixed(4) || "N/A"}
  leverage: ${position.leverage}x
  liquidation_price: $${position.liquidationPrice?.toFixed(4) || "N/A"}
  notional_usd: $${position.notional?.toFixed(4) || "N/A"}
  side: ${position.side}
  exit_plan:
  {
      invalidation_condition: ${position.invalidation_condition || "Not Set"}
      profit_target: ${position.profit_target || "Not Set"}
      stop_loss: ${position.stop_loss || "Not Set"}
  }
`;
    });
  } else {
    output += "\nNo active positions currently.\n";
  }

  console.log(`✅ Account performance formatted`);
  return output;
}
