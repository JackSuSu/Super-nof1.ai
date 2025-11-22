/**
 * 直接通过 REST API 获取 Binance 持仓信息
 * 避免 ccxt 的 exchangeInfo bootstrap 问题
 */

import crypto from "crypto";
import { ProxyAgent } from "undici";
import {
  ensureTimeSync,
  getAdjustedTimestamp,
  getBinanceBaseUrl,
} from "./binance-official";

interface BinancePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  notional: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  maxNotionalValue: string;
  updateTime: number;
}

export interface Position {
  symbol: string;
  side: string; // "long" | "short"
  contracts: number;
  contractSize: number;
  entryPrice: number;
  markPrice: number;
  notional: number;
  leverage: number;
  unrealizedPnl: number;
  percentage: number;
  marginType: string;
  liquidationPrice: number;
  initialMargin: number;
  maintenanceMargin: number;
  invalidation_condition?: string;
  stop_loss?: number;
  profit_target?: number;
}

class PositionFetcher {
  private apiKey!: string;
  private apiSecret!: string;
  private baseUrls!: string[];
  private timeout!: number;
  private disableProxy!: boolean;
  private proxyUrl?: string;

  constructor() {
    this.initializeConfig();
  }

  private initializeConfig(): void {
    console.log(`🔧 Initializing position fetcher configuration...`);

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

    this.baseUrls = getBinanceBaseUrl().split(",");
    this.timeout = Number(process.env.BINANCE_FETCH_TIMEOUT_MS || 30000);
    this.disableProxy =
      String(process.env.BINANCE_DISABLE_PROXY || "").toLowerCase() === "true";
    this.proxyUrl =
      process.env.BINANCE_HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY;

    console.log(
      `✅ Configuration loaded: ${this.baseUrls.length} base URLs, timeout: ${this.timeout}ms`
    );
  }

  /**
   * 生成带签名的 API URL
   */
  private generateSignedUrl(): string {
    console.log(`🔐 Generating signed URL...`);

    const timestamp = getAdjustedTimestamp();
    const queryString = `timestamp=${timestamp}&recvWindow=60000`;
    const signature = crypto
      .createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");

    const url = `/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
    console.log(`✅ Signed URL generated with timestamp: ${timestamp}`);

    return url;
  }

  /**
   * 创建 fetch 请求配置
   */
  private createFetchOptions(): RequestInit {
    console.log(`🔧 Creating fetch options...`);

    const fetchOptions: RequestInit = {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(this.timeout),
    };

    // 添加代理配置
    if (this.proxyUrl && !this.disableProxy) {
      (fetchOptions as any).dispatcher = new ProxyAgent(this.proxyUrl);
      console.log(`🔌 Proxy enabled: ${this.proxyUrl}`);
    } else {
      console.log(`🌐 Direct connection (no proxy)`);
    }

    return fetchOptions;
  }

  /**
   * 处理 API 响应
   */
  private async handleApiResponse(
    response: Response
  ): Promise<BinancePosition[]> {
    console.log(`📥 Handling API response...`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Binance API error: ${response.status} ${errorText}`);
    }

    const responseText = await response.text();
    console.log(
      `📄 Response received, length: ${responseText.length} characters`
    );

    if (!responseText || responseText.trim() === "") {
      throw new Error(`Empty response from server`);
    }

    try {
      const positions = JSON.parse(responseText);
      console.log(
        `✅ JSON parsed successfully, found ${
          Array.isArray(positions) ? positions.length : "non-array"
        } items`
      );

      if (!Array.isArray(positions)) {
        throw new Error(`Expected array response, got: ${typeof positions}`);
      }

      return positions;
    } catch (jsonError) {
      console.error(`❌ JSON parsing failed:`, jsonError);
      throw new Error(
        `Invalid JSON response: ${responseText.substring(0, 100)}...`
      );
    }
  }

  /**
   * 转换 Binance 持仓数据为标准格式
   */
  private async transformPositionData(
    binancePosition: BinancePosition
  ): Promise<Position> {
    const contracts = Math.abs(parseFloat(binancePosition.positionAmt));
    const entryPrice = parseFloat(binancePosition.entryPrice);
    const markPrice = parseFloat(binancePosition.markPrice);
    const notional = Math.abs(parseFloat(binancePosition.notional));
    const leverage = parseFloat(binancePosition.leverage);
    const unrealizedPnl = parseFloat(binancePosition.unRealizedProfit);
    const liquidationPrice = parseFloat(binancePosition.liquidationPrice);

    // 计算保证金和收益
    const initialMargin = notional / leverage;
    const maintenanceMargin = notional * 0.004; // 简化计算
    const percentage =
      entryPrice > 0
        ? ((markPrice - entryPrice) / entryPrice) *
          100 *
          (parseFloat(binancePosition.positionAmt) > 0 ? 1 : -1)
        : 0;

    // 获取数据库中的交易记录
    const tradingRecord = await this.getLatestTradingRecord(
      binancePosition.symbol
    );

    const invalidation_condition = tradingRecord
      ? tradingRecord.invalidation_condition
      : undefined;
    const stop_loss = tradingRecord ? tradingRecord.stopLoss : undefined;
    const profit_target = tradingRecord ? tradingRecord.takeProfit : undefined;

    return {
      symbol: binancePosition.symbol,
      side: parseFloat(binancePosition.positionAmt) > 0 ? "long" : "short",
      contracts,
      contractSize: 1,
      entryPrice,
      markPrice,
      notional,
      leverage,
      unrealizedPnl,
      percentage,
      marginType: binancePosition.marginType.toLowerCase(),
      liquidationPrice,
      initialMargin,
      maintenanceMargin,
      invalidation_condition,
      stop_loss,
      profit_target,
    };
  }

  /**
   * 根据仓位获取最新的数据库交易记录
   */
  private async getLatestTradingRecord(symbol: string): Promise<any> {
    console.log(`📊 Fetching latest trading record for ${symbol}...`);

    try {
      // 导入 Prisma 客户端
      const { prisma } = await import("../prisma");

      // 将字符串 symbol 转换为枚举值

      const enumSymbol = this.convertSymbolToEnum(symbol.replace("/USDT", ""));

      if (!enumSymbol) {
        console.warn(`⚠️ Cannot convert symbol ${symbol} to enum value`);
        return null;
      }

      // 根据 createdAt 时间倒序，获取最新的一条数据
      // 条件：匹配 symbol 且 trade_status > 0
      const tradingRecord = await prisma.trading.findFirst({
        where: {
          symbol: enumSymbol, // 使用转换后的枚举值
          trade_status: {
            gt: 0,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {       
          symbol: true,
          opeartion: true,
          pricing: true,
          amount: true,
          leverage: true,
          stopLoss: true,
          takeProfit: true,
          trade_status: true,
          invalidation_condition: true,
        },
      });

      if (tradingRecord) {
        console.log(
          `✅ Found trading record for ${symbol}: ${tradingRecord.opeartion} @ $${tradingRecord.pricing}`
        );
        console.log(
          `   📝 Details: ID=${tradingRecord.id}, Status=${tradingRecord.trade_status}, Time=${tradingRecord.createdAt}`
        );

        // 如果有止损止盈信息，也打印出来
        if (tradingRecord.stopLoss || tradingRecord.takeProfit) {
          console.log(
            `   🎯 SL/TP: ${
              tradingRecord.stopLoss ? `SL=$${tradingRecord.stopLoss}` : ""
            } ${
              tradingRecord.takeProfit ? `TP=$${tradingRecord.takeProfit}` : ""
            }`
          );
        }
      } else {
        console.log(
          `ℹ️ No trading record found for ${symbol} with trade_status > 0`
        );
      }

      return tradingRecord;
    } catch (error: any) {
      console.error(
        `❌ Failed to fetch trading record for ${symbol}:`,
        error.message
      );
      // 不抛出错误，避免影响主要功能
      return null;
    }
  }

  /**
   * 将字符串 symbol 转换为 Prisma 枚举值
   */
  private convertSymbolToEnum(symbol: string): any {
    // 移除交易对中的 "/USDT" 部分，只保留基础货币
    const baseSymbol = symbol.replace("/USDT", "").replace("USDT", "");

    // 根据你的 Prisma Schema 中的枚举定义进行映射
    // 假设你的枚举定义类似：enum Symbol { BTC, ETH, BNB, SOL, DOGE }
    const symbolMap: Record<string, any> = {
      BTC: "BTC",
      ETH: "ETH",
      BNB: "BNB",
      SOL: "SOL",
      DOGE: "DOGE",
      ADA: "ADA",
      // 添加其他需要的映射
    };

    const enumValue = symbolMap[baseSymbol];

    if (!enumValue) {
      console.warn(
        `⚠️ No enum mapping found for symbol: ${symbol} (base: ${baseSymbol})`
      );
      return null;
    }

    console.log(`🔤 Symbol converted: ${symbol} -> ${enumValue}`);
    return enumValue;
  }

  //在此处创建新方法： 根据 createdAt 时间倒叙，获取从数据库表Trading读取最新的一条数据 条件是 binancePosition.symbol，trade_status>0

  /**
   * 从单个 URL 获取持仓数据
   */
  private async fetchFromSingleUrl(
    baseUrl: string,
    url: string,
    fetchOptions: RequestInit
  ): Promise<Position[]> {
    const fullUrl = `${baseUrl.trim()}${url}`;
    console.log(`🔄 Fetching from: ${baseUrl.trim()}`);

    const response = await fetch(fullUrl, fetchOptions);
    const binancePositions = await this.handleApiResponse(response);

    // 过滤并转换持仓数据
    const activePositions = await Promise.all(
      binancePositions
        .filter((p) => parseFloat(p.positionAmt) !== 0)
        .map((p) => this.transformPositionData(p))
    );

    // console.log(`✅ Fetched active positions json result:`, activePositions);

    console.log(
      `✅ Fetched ${
        activePositions.length
      } active positions from ${baseUrl.trim()}`
    );
    return activePositions;
  }

  /**
   * 处理请求错误
   */
  private handleRequestError(
    error: any,
    baseUrl: string,
    attempt: number,
    totalAttempts: number
  ): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    let errorType = "Unknown";

    if (errorMsg.includes("429")) errorType = "Rate Limit";
    else if (errorMsg.includes("401")) errorType = "Auth Failed";
    else if (errorMsg.includes("Empty response")) errorType = "Empty Response";
    else if (errorMsg.includes("Invalid JSON")) errorType = "Invalid JSON";
    else if (errorMsg.includes("timeout")) errorType = "Timeout";

    console.error(
      `❌ Failed [${attempt}/${totalAttempts}] ${baseUrl}: [${errorType}] ${errorMsg}`
    );

    if (attempt < totalAttempts) {
      console.log(`⏭️ Trying next domain...`);
    }
  }

  /**
   * 主方法：获取所有持仓
   */
  async fetchPositions(): Promise<Position[]> {
    console.log(`🚀 Starting positions fetch process...`);

    // 同步服务器时间
    await ensureTimeSync();
    console.log(`✅ Server time synchronized`);

    const url = this.generateSignedUrl();
    const fetchOptions = this.createFetchOptions();

    let lastError: Error | null = null;

    // 尝试多个域名
    for (let i = 0; i < this.baseUrls.length; i++) {
      const baseUrl = this.baseUrls[i];
      try {
        console.log(`📍 Attempt ${i + 1}/${this.baseUrls.length}`);
        const positions = await this.fetchFromSingleUrl(
          baseUrl,
          url,
          fetchOptions
        );
        return positions;
      } catch (error) {
        lastError = error as Error;
        this.handleRequestError(error, baseUrl, i + 1, this.baseUrls.length);
      }
    }

    // 所有域名都失败
    console.error(`💥 All ${this.baseUrls.length} attempts failed`);
    throw new Error(
      `Failed to fetch positions from all domains: ${
        lastError?.message || "Unknown error"
      }`
    );
  }
}

// 创建单例实例
const positionFetcher = new PositionFetcher();

/**
 * 使用 REST API 直接获取持仓
 */
export async function fetchPositions(): Promise<Position[]> {
  return await positionFetcher.fetchPositions();
}
