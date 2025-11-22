import "@/lib/utils/logger";
import { generateObject } from "ai";
import { generateUserPrompt, getTradingPrompt } from "./prompt";
import { getCurrentMarketState } from "../trading/current-market-state";
import { z } from "zod";
import { deepseek } from "./model";
import { getAccountInformationAndPerformance } from "../trading/account-information-and-performance";
import { prisma } from "../prisma";
import { Opeartion, Symbol } from "@prisma/client";
import { buyLong } from "../trading/buy";
import {
  getRiskConfig,
  checkBuyRisk,
  checkDailyLossLimit,
  logTrade,
} from "../trading/risk-control";
import { setStopLossTakeProfit } from "../trading/stop-loss-take-profit-official";
import { buyShort } from "../trading/sell";
import { closePosition } from "../trading/close_position";

class TradingExecutor {
  private riskConfig = getRiskConfig();
  private supportedSymbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "DOGE/USDT"];
  private remainingAvailableCash = 0;
  private allTradingRecords: any[] = [];
  private allChatMessages: string[] = [];

  constructor(private initialCapital?: number) {}

  async run() {
    try {
      this.logTradingMode();
      
      const [marketStates, accountInfo] = await Promise.all([
        this.fetchMarketStates(),
        this.getAccountInfo()
      ]);

      if (!this.checkDailyLossLimit(accountInfo)) return;

      const aiDecision = await this.getAIDecision(marketStates, accountInfo);


      await this.processTradingDecisions(aiDecision, accountInfo);
      await this.saveTradingResults(aiDecision.justification, aiDecision.userPrompt);
      
      console.log(`✅ Saved ${this.allTradingRecords.length} trading decision(s) to database`);
    } catch (error) {
      console.error("❌ Trading error:", error);
      throw error;
    }
  }

  private logTradingMode() {
    const modeLabel = this.riskConfig.tradingMode === 'live' ? '⚠️ LIVE (REAL MONEY)' : '🎮 VIRTUAL';
    console.log(`🤖 Mode: ${modeLabel}`);
  }

  private async fetchMarketStates() {
    console.log("📊 Fetching market states...");
    
    const marketStates = await Promise.all(
      this.supportedSymbols.map(async (symbol) => {
        try {
          const state = await getCurrentMarketState(symbol);
          return { symbol, state };
        } catch (error) {
          console.warn(`⚠️ ${symbol}: fetch failed`);
          return null;
        }
      })
    );

    const validMarketStates = marketStates.filter(item => item !== null);
    console.log(`📊 Analyzed ${validMarketStates.length}/${this.supportedSymbols.length} symbols`);
    
    return validMarketStates;
  }

  private async getAccountInfo() {
    console.log("💰 Run Fetching account information...");
    const accountInfo = await getAccountInformationAndPerformance(this.initialCapital);
    this.remainingAvailableCash = accountInfo.availableCash;
    return accountInfo;
  }

  private checkDailyLossLimit(accountInfo: any) {
    const totalUnrealizedPnl = accountInfo.positions.reduce(
      (sum: number, pos: any) => sum + (pos.unrealizedPnl || 0), 0
    );

    const dailyLossCheck = checkDailyLossLimit({
      todayPnL: totalUnrealizedPnl,
      initialCapital: accountInfo.totalCashValue,
      config: this.riskConfig,
    });

    if (!dailyLossCheck.allowed) {
      console.error(`🚫 Daily loss limit: ${dailyLossCheck.reason}`);
      return false;
    }
    return true;
  }





  //调用AI
  private async getAIDecision(marketStates: any[], accountInfo: any) {
    console.log("🤖 Generating AI decision...");
    
    const chatCount:number = await prisma.chat.count();

    const userPrompt = await generateUserPrompt({
      marketStates,
      accountInformationAndPerformance: accountInfo,
      startTime: new Date(process.env.START_TIME || '2025-11-22T06:21:00Z'),
      invocationCount: chatCount,
    });

    const supportedSymbolEnums = [Symbol.BTC, Symbol.ETH, Symbol.SOL, Symbol.BNB, Symbol.DOGE];
    const tradingPrompt = getTradingPrompt(supportedSymbolEnums);

    const aiCallConfig: any = {
      model: deepseek,
      system: tradingPrompt,
      prompt: userPrompt,
      output: "object",
      mode: "json",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "trading-decision",
      },
      schema: z.object({
        signal: z.enum(["buy_to_enter", "sell_to_enter", "hold", "close_position"]).describe("Trading signal"),
        coin: z.enum(["BTC", "ETH", "BNB", "SOL", "DOGE"]).describe("Coin symbol"),
        quantity: z.number().describe("Quantity to trade (float)"),
        leverage: z.number().int().min(1).max(20).describe("Leverage (integer 1-20)"),
        profit_target: z.number().describe("Profit target (float)"),
        stop_loss: z.number().describe("Stop loss (float)"),
        invalidation_condition: z.string().describe("String describing invalidation condition"),
        confidence: z.number().min(0).max(1).describe("Confidence (0-1)"),
        risk_usd: z.number().describe("Risk in USD (float)"),
        justification: z.string().describe("Human-readable justification for the signal"),
      })
    };

    const startTime = Date.now();
    console.log(`🤖 AI processing...`);

    const result = await generateObject(aiCallConfig);
    const duration = Date.now() - startTime;
    
    // console.log("🕒 AI call completed:", result);
    console.log(`✅AI call completed， AI processing time: ${duration}ms, result:`, JSON.stringify(result.object));


    // Map to legacy format
    const decisions = this.mapAIDecisionsToLegacyFormat([result.object]);

    console.log(`🔄 Mapped decisions to legacy format action:【${ decisions[0]?.signal}】`);
    console.log(`🔄 Mapped decisions to legacy format justification:【${ decisions[0]?.justification}】`);

    return { decisions, justification: result?.object?.justification ?? "no reason provided", userPrompt };
  }



  //转化映射
  private mapAIDecisionsToLegacyFormat(decisions: any[]) {
    console.log("🔄 Mapping new schema to legacy format...");

    return decisions.map((d: any) => {
      if (!d) return d;
      if (d.opeartion && d.symbol) return d;

      const opMap: any = {
        buy_to_enter: Opeartion.Buy,
        sell_to_enter: Opeartion.Sell,
        hold: Opeartion.Hold,
        close_position: Opeartion.Close,
      };

      const mapped: any = {
        ...d,
        opeartion: opMap[d.signal] || Opeartion.Hold,
        symbol: d.coin,
        amount: d.quantity,
        stopLoss: d.stop_loss ?? null,
        leverage: d.leverage ?? null,
        takeProfit: d.profit_target ?? null,
        chat: d.justification || undefined,
        prediction: JSON.stringify(d)||null,
      };

      // Structure for different operation types
      // if (d.signal === "buy_to_enter") {
      //   mapped.buy = {
      //     amount: d.quantity,
      //     pricing: d.pricing ?? null,
      //     leverage: d.leverage ?? null,
      //     stopLossPercent: d.stop_loss ?? null,
      //     takeProfitPercent: d.profit_target ?? null,
      //   };
      // }

      // if (d.signal === "sell_to_enter") {
      //   mapped.sell = {
      //     amount: d.quantity,
      //     pricing: d.pricing ?? null,
      //     leverage: d.leverage ?? null,
      //     stopLossPercent: d.stop_loss ?? null,
      //     takeProfitPercent: d.profit_target ?? null,
      //   };
      // }

      // if (d.signal === "close_position") {
      //   mapped.sell = {
      //     percentage: (d.sell_percentage ?? d.percentage ?? 100),
      //   };
      // }

      // if (d.signal === "hold") {
      //   mapped.adjustProfit = {};
      //   if (d.stop_loss != null) mapped.adjustProfit.stopLoss = d.stop_loss;
      //   if (d.profit_target != null) mapped.adjustProfit.takeProfit = d.profit_target;
      //   if (Object.keys(mapped.adjustProfit).length === 0) delete mapped.adjustProfit;
      // }

      return mapped;
    });
  }
  


  private async processTradingDecisions(aiDecision: any, accountInfo: any) {
    console.log(`🔍 Processing ${aiDecision.decisions.length} decision(s)...`);

    for (const decision of aiDecision.decisions) {
      await this.processSingleDecision(decision);
    }
  }

  private async processSingleDecision(decision: any) {
    console.log(`\n📌 Processing ${decision.opeartion} ${decision.symbol}`);

    // Add decision explanation to messages
    if (decision.chat) {
      this.allChatMessages.push(`[${decision.symbol}] ${decision.chat}`);
    }

    try {
      switch (decision.opeartion) {
        case Opeartion.Buy:
          await this.processBuyLongDecision(decision);
          break;
        case Opeartion.Sell:
          await this.processBuyShortDecision(decision);
          break;
        case Opeartion.Hold:
          await this.processHoldDecision(decision);
          break;
        case Opeartion.Close:
          await this.processCloseDecision(decision);
          break;
        default:
          console.warn(`⚠️ Unknown operation: ${decision.opeartion}`);
         
      }

      console.log(`✅ Processed ${decision.opeartion} for ${decision.symbol}`);

      this.recordTradingData(decision);

    } catch (error) {
      console.error(`❌ Error processing ${decision.opeartion} for ${decision.symbol}:`, error);
      this.recordFailedDecision(decision);
    }

     
  }

  private async processBuyLongDecision(decision: any) {
    console.log("💰 Processing BUY decision...");
    
    if (!decision || decision.amount == null || decision.leverage == null) {
      console.warn("⚠️ Buy: missing required fields");
      this.recordFailedDecision(decision);
      return;
    }

    const requiredMargin = (decision.amount * decision.pricing) / decision.leverage;
    console.log(`  Amount: ${decision.amount} | Price: ${decision.pricing} | Lev: ${decision.leverage}x`);
    console.log(`  Margin: $${requiredMargin.toFixed(2)} | Available: $${this.remainingAvailableCash.toFixed(2)}`);

    // Risk check
    const riskCheck = checkBuyRisk({
      amount: decision.amount,
      price: decision.pricing,
      leverage: decision.leverage,
      currentBalance: this.remainingAvailableCash,
      config: this.riskConfig,
    });

    if (!riskCheck.allowed) {
      console.error(`🚫 Risk control: ${riskCheck.reason}`);
      this.allChatMessages.push(`[${decision.symbol} BLOCKED] ${riskCheck.reason}`);
      this.recordFailedDecision(decision);
      return;
    }

    if (requiredMargin > this.remainingAvailableCash) {
      const reason = `Insufficient remaining margin: need $${requiredMargin.toFixed(2)} but have $${this.remainingAvailableCash.toFixed(2)}`;
      console.warn(`🚫 ${reason}`);
      this.allChatMessages.push(`[${decision.symbol} BLOCKED] ${reason}`);
      this.recordFailedDecision(decision);
      return;
    }

    // Execute buy
    const tradingSymbol = `${decision.symbol}/USDT`;
    console.log(`💰 Executing buy long ${decision.symbol} (Mode: ${this.riskConfig.tradingMode})...`);

    const buyResult = await buyLong({
      symbol: tradingSymbol,
      amount: decision.amount,
      price: 0,
      leverage: decision.leverage,
      autoSetStopLoss: false,
      stopLossPercent: decision.stopLossPercent,
      takeProfitPercent: decision.takeProfitPercent,
    });

    if (buyResult?.success) {      
      this.remainingAvailableCash -= requiredMargin;
      decision.trade_status=1000;
    }

    console.log(`💰 Buy long ${decision.symbol} processed.`,buyResult,decision);

    // this.logTradeResult(buyResult, "buy", tradingSymbol, decision.amount, buyResult.executedPrice);



    // this.recordTradingData(decision);
  }

  private async processBuyShortDecision(decision: any) {
    console.log("💸 Processing SHORT decision...");
    
    if (!decision || decision.amount == null || decision.leverage == null) {
      console.warn("⚠️ Short: missing required fields");
      this.recordFailedDecision(decision);
      return;
    }

    const tradingSymbol = `${decision.symbol}/USDT`;
    
    // Get position info for logging
    const positionInfo = await this.getPositionInfo(tradingSymbol);

    console.log(`💸 Executing SHORT ${decision.symbol} (Mode: ${this.riskConfig.tradingMode})...`);
    const sellResult = await buyShort({
      symbol: tradingSymbol,
      amount: decision.amount,
      price: 0,
      leverage: decision.leverage,
    });

    if(sellResult?.success)
    {
      decision.trade_status=2000
    }



    // this.logTradeResult(sellResult, "sell", tradingSymbol, sellResult.executedAmount || 0, sellResult.executedPrice);


    // this.recordTradingData(decision, {
    //   pricing: sellResult.executedPrice,
    //   stopLoss: decision.stopLoss,
    //   takeProfit: decision.takeProfit,
    //   amount: sellResult.executedAmount || 0,
    //   leverage: positionInfo?.leverage || null,
    // });
  }

  private async processHoldDecision(decision: any) {
    console.log("⏸️ Processed HOLD decision...");
    decision.trade_status = -1;
    // const shouldAdjustProfit = decision.adjustProfit != null &&
    //   (decision.stopLoss != null || decision.takeProfit != null);

    // if (shouldAdjustProfit) {
    //   console.log(`🎯 Setting SL/TP for ${decision.symbol} (Mode: ${this.riskConfig.tradingMode})...`);
    //   const tradingSymbol = `${decision.symbol}/USDT`;
      
    //   const slTpResult = await setStopLossTakeProfit({
    //     symbol: tradingSymbol,
    //     stopLoss: decision.adjustProfit!.stopLoss,
    //     takeProfit: decision.adjustProfit!.takeProfit,
    //   });

    //   if (slTpResult.success) {
    //     console.log(`✅ SL/TP set successfully`);
    //     if (slTpResult.stopLossOrderId) console.log(`   Stop Loss Order ID: ${slTpResult.stopLossOrderId}`);
    //     if (slTpResult.takeProfitOrderId) console.log(`   Take Profit Order ID: ${slTpResult.takeProfitOrderId}`);
    //   } else {
    //     console.error(`❌ Failed to set SL/TP: ${slTpResult.error}`);
    //   }
    // }

    

    // this.recordTradingData(decision, {
    //   stopLoss: decision.adjustProfit?.stopLoss || null,
    //   takeProfit: decision.adjustProfit?.takeProfit || null,
    // });
  }

  private async processCloseDecision(decision: any) {
    console.log("🛑 Processing CLOSE decision...");   
    const tradingSymbol = `${decision.symbol}/USDT`;
    const closeResult = await closePosition({
      symbol: tradingSymbol,
      percentage: 100,
    });

    if (closeResult.success) {
      console.log(`✅ Position closed successfully`);
      console.log(`   Order ID: ${closeResult.orderId}`);
      console.log(`   Price: $${closeResult.executedPrice}`);
      console.log(`   Amount: ${closeResult.executedAmount}`);
      decision.trade_status = -1000;
    }
  }

  private async getPositionInfo(symbol: string) {
    try {
      const { fetchPositions } = await import("@/lib/trading/positions");
      const positions = await fetchPositions();
      const binanceSymbol = symbol.replace("/", "");
      const positionInfo = positions.find((p: any) => p.symbol === binanceSymbol && p.contracts !== 0);
      if (positionInfo) {
        console.log(`📊 Current position: ${Math.abs(positionInfo.contracts)} contracts @ ${positionInfo.leverage}x leverage`);
      }
      return positionInfo;
    } catch (err) {
      console.warn("⚠️ Failed to fetch position info:", err);
      return null;
    }
  }

  // private logTradeResult(result: any, action: string, symbol: string, amount: number, price: number) {
  //   if (result.success) {
  //     console.log(`✅ ${action.charAt(0).toUpperCase() + action.slice(1)} executed successfully`);
  //     console.log(`   Order ID: ${result.orderId}`);
  //     console.log(`   Price: $${result.executedPrice}`);
  //     console.log(`   Amount: ${result.executedAmount}`);
  //   } else {
  //     console.error(`❌ ${action.charAt(0).toUpperCase() + action.slice(1)} failed: ${result.error}`);
  //     if (result.error?.includes("No open position")) {
  //       console.warn(`⚠️ Position already closed or doesn't exist`);
  //     }
  //   }

  //   logTrade({
  //     action: this.riskConfig.tradingMode === "live" ? action : `dry-run-${action}`,
  //     symbol,
  //     amount,
  //     price,
  //     orderId: result.orderId,
  //     reason: result.success ? "Success" : result.error,
  //   });
  // }

  private createTradingData(decision: any, overrides: any = {}) {
    return {
      symbol: decision.symbol,
      opeartion: decision.opeartion,
      stopLoss: overrides.stopLoss || decision.stopLoss || null,
      takeProfit: overrides.takeProfit || decision.takeProfit || null,
      pricing: overrides.pricing || decision.buy?.pricing || decision.pricing || 0,
      amount: overrides.amount || decision.buy?.amount || decision.amount || null,
      invalidation_condition: decision.invalidation_condition || 'Not Set',
      leverage: decision.leverage || 0,
      trade_status: decision.trade_status || 0,
      prediction: decision.prediction ? JSON.parse(JSON.stringify(decision.prediction)) : null,
      ...overrides,
    } as any;
  }

  private recordTradingData(decision: any, overrides: any = {}) {
    this.allTradingRecords.push(this.createTradingData(decision, overrides));
  }

  private recordFailedDecision(decision: any) {
    this.recordTradingData(decision, { opeartion: Opeartion.Failed });
  }

  private async saveTradingResults(reasoning: string, userPrompt: string) {
    const combinedChat = this.allChatMessages.length > 0
      ? this.allChatMessages.join("\n\n")
      : "<no chat>";

    await prisma.chat.create({
      data: {
        reasoning: reasoning || "<no reasoning>",
        chat: combinedChat,
        userPrompt,
        tradings: {
          create: this.allTradingRecords,
        },
      },
    });
  }
}

/**
 * Interval trading using cron job
 */
export async function run(initialCapital?: number) {
  const executor = new TradingExecutor(initialCapital);
  await executor.run();
}