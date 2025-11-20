import "@/lib/utils/logger";
import { getBinanceInstance, ensureTimeSync, getBinanceBaseUrl } from "./binance-official";
import { setStopLossTakeProfit } from "./stop-loss-take-profit-official";
import crypto from 'crypto';

// Cache for position mode (dual side or one-way)
let positionModeCache: "ONE_WAY" | "DUAL_SIDE" | null = null;

/**
 * Get position mode setting from Binance
 * Returns "ONE_WAY" (单向持仓) or "DUAL_SIDE" (双向持仓)
 */
export async function getPositionMode(): Promise<"ONE_WAY" | "DUAL_SIDE"> {
    if (positionModeCache) {
        return positionModeCache;
    }

    try {
        const client = await getBinanceInstance();
        await ensureTimeSync();
        
        // Try SDK methods first
        try {
            if (typeof (client as any).positionMode === 'function') {
                const resp = await (client as any).positionMode();
                const dualSidePosition = resp.data?.dualSidePosition ?? resp?.dualSidePosition ?? false;
                positionModeCache = dualSidePosition ? "DUAL_SIDE" : "ONE_WAY";
                console.log(`📋 Position mode: ${positionModeCache} (dualSidePosition: ${dualSidePosition})`);
                return positionModeCache;
            }
            if (typeof (client as any).getPositionMode === 'function') {
                const resp = await (client as any).getPositionMode();
                const dualSidePosition = resp.data?.dualSidePosition ?? resp?.dualSidePosition ?? false;
                positionModeCache = dualSidePosition ? "DUAL_SIDE" : "ONE_WAY";
                console.log(`📋 Position mode: ${positionModeCache} (dualSidePosition: ${dualSidePosition})`);
                return positionModeCache;
            }
        } catch (e) {
            // ignore and fallback to REST
        }

        // REST fallback
        try {
            const tradingMode = process.env.TRADING_MODE || "dry-run";
            const isDryRun = tradingMode === "dry-run";
            const apiKey = isDryRun ? (process.env.BINANCE_TESTNET_API_KEY || '') : (process.env.BINANCE_LIVE_API_KEY || '');
            const apiSecret = isDryRun ? (process.env.BINANCE_TESTNET_API_SECRET || '') : (process.env.BINANCE_LIVE_API_SECRET || '');
            const baseUrl = getBinanceBaseUrl().replace(/\/$/, '');
            const timestamp = Date.now();
            const query = `timestamp=${timestamp}`;
            const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
            const url = `${baseUrl}/fapi/v1/positionSide/dual?${query}&signature=${signature}`;
            const resp = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
            if (resp.ok) {
                const data = await resp.json();
                const dualSidePosition = data?.dualSidePosition ?? false;
                positionModeCache = dualSidePosition ? "DUAL_SIDE" : "ONE_WAY";
                console.log(`📋 Position mode (REST): ${positionModeCache} (dualSidePosition: ${dualSidePosition})`);
                return positionModeCache;
            }
        } catch (e) {
            // ignore and fall through to default
        }

        positionModeCache = "ONE_WAY";
        return positionModeCache;
    } catch (error: any) {
        console.warn(`⚠️ Failed to get position mode, defaulting to ONE_WAY:`, error.message);
        positionModeCache = "ONE_WAY";
        return positionModeCache;
    }
}

export interface BuyParams {
    symbol: string; // e.g., "BTC/USDT"
    amount: number; // Amount in base currency (BTC)
    leverage?: number; // 1-125, default 10
    price?: number; // Optional limit price, omit for market order
    autoSetStopLoss?: boolean; // 自动设置止损，默认 true
    stopLossPercent?: number; // 止损百分比，默认 3%
    takeProfitPercent?: number; // 止盈百分比，默认 10%
}

export interface BuyResult {
    success: boolean;
    orderId?: string;
    executedPrice?: number;
    executedAmount?: number;
    error?: string;
}

/**
 * Binance Futures 合约的精度配置
 */
const SYMBOL_PRECISION: Record<string, { quantity: number; price: number; minNotional: number }> = {
    "BTCUSDT": { quantity: 3, price: 1, minNotional: 100 },
    "ETHUSDT": { quantity: 2, price: 2, minNotional: 100 },
    "BNBUSDT": { quantity: 2, price: 2, minNotional: 100 },
    "SOLUSDT": { quantity: 2, price: 3, minNotional: 100 },
    "ADAUSDT": { quantity: 0, price: 4, minNotional: 100 },
    "DOGEUSDT": { quantity: 0, price: 5, minNotional: 100 },
};

class BuyOrderExecutor {
    private client: any;
    private binanceSymbol: string;
    private currentPrice: number = 0;
    private adjustedAmount: number = 0;
    private effectiveLeverage: number = 10;

    constructor(
        private params: BuyParams,
        private symbolConfig: { quantity: number; price: number; minNotional: number }
    ) {
        this.binanceSymbol = params.symbol.replace("/", "");
        this.adjustedAmount = params.amount;
        this.effectiveLeverage = params.leverage || 10;
    }

    async execute(): Promise<BuyResult> {
        console.log(`🚀 Starting buy order execution for ${this.params.symbol}...`);
        console.log(`📝 Input: amount=${this.params.amount}, leverage=${this.params.leverage || 10}, price=${this.params.price || 'market'}`);

        try {
            // 初始化客户端和时间同步
            await this.initializeClient();
            
            // 获取当前价格
            await this.fetchCurrentPrice();
            
            // 调整订单参数
            await this.adjustOrderParameters();
            
            // 设置杠杆
            await this.setLeverage();
            
            // 创建订单
            const orderResult = await this.createOrder();
            
            // 设置止盈止损
            if (this.params.autoSetStopLoss) {
                await this.setStopLossTakeProfit();
            }

            console.log(`✅ Buy order completed successfully`);
            return orderResult;

        } catch (error: any) {
            const errorMessage = error.message || "Unknown error occurred during buy";
            console.error("❌ Buy order failed:", errorMessage);
            console.error("📋 Error details:", {
                symbol: this.params.symbol,
                amount: this.params.amount,
                leverage: this.params.leverage,
                price: this.params.price,
                errorType: error.constructor?.name,
                errorCode: error.code
            });
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    private async initializeClient(): Promise<void> {
        console.log(`🔧 Initializing Binance client...`);
        this.client = await getBinanceInstance();
        await ensureTimeSync();
        console.log(`✅ Client initialized successfully`);
    }

    private async fetchCurrentPrice(): Promise<void> {
        console.log(`📊 Fetching current price for ${this.params.symbol}...`);
        
        if (this.params.price) {
            this.currentPrice = this.params.price;
            console.log(`✅ Using provided price: $${this.currentPrice.toFixed(2)}`);
            return;
        }

        try {
            const ticker = await this.client.markPrice({ symbol: this.binanceSymbol });
            this.currentPrice = parseFloat(ticker.markPrice);
            console.log(`✅ Current mark price: $${this.currentPrice.toFixed(2)}`);
        } catch (e: any) {
            console.warn(`⚠️ Failed to fetch price, using fallback`);
            const fallbackPrices: Record<string, number> = {
                "BTCUSDT": 50000,
                "ETHUSDT": 3000,
                "BNBUSDT": 500,
                "SOLUSDT": 100,
                "ADAUSDT": 0.5,
                "DOGEUSDT": 0.1
            };
            this.currentPrice = fallbackPrices[this.binanceSymbol] || 1;
            console.log(`✅ Using fallback price: $${this.currentPrice.toFixed(2)}`);
        }
    }

    private adjustPrecision(amount: number): number {
        const factor = Math.pow(10, this.symbolConfig.quantity);
        const adjusted = Math.floor(amount * factor) / factor;

        if (adjusted !== amount) {
            console.log(`⚙️ Precision adjusted: ${amount} → ${adjusted} (${this.symbolConfig.quantity} decimals)`);
        }

        return adjusted;
    }

    private checkMinNotional(amount: number): { valid: boolean; reason?: string; requiredAmount?: number } {
        const notional = amount * this.currentPrice;
        if (notional < this.symbolConfig.minNotional) {
            const requiredAmount = this.symbolConfig.minNotional / this.currentPrice;
            const adjustedRequiredAmount = this.adjustPrecision(requiredAmount);
            
            return {
                valid: false,
                reason: `Order value $${notional.toFixed(2)} below minimum $${this.symbolConfig.minNotional}. Need at least ${adjustedRequiredAmount} ${this.params.symbol}`,
                requiredAmount: adjustedRequiredAmount
            };
        }

        return { valid: true };
    }

    private smartAdjustOrderForMinNotional(): { 
        adjustedAmount: number; 
        adjustedLeverage: number; 
        adjustmentType: 'amount' | 'leverage' | 'both' | 'none'; 
        reason?: string 
    } {
        const currentNotional = this.adjustedAmount * this.currentPrice;
        
        if (currentNotional >= this.symbolConfig.minNotional) {
            return { 
                adjustedAmount: this.adjustedAmount, 
                adjustedLeverage: this.effectiveLeverage, 
                adjustmentType: 'none' 
            };
        }
        
        console.log(`💰 Order value $${currentNotional.toFixed(2)} below minimum $${this.symbolConfig.minNotional}`);
        
        const requiredMinAmount = this.symbolConfig.minNotional / this.currentPrice;
        const adjustedRequiredAmount = this.adjustPrecision(requiredMinAmount);
        const newNotional = adjustedRequiredAmount * this.currentPrice;
        
        if (newNotional < this.symbolConfig.minNotional) {
            const minIncrement = Math.pow(10, -this.symbolConfig.quantity);
            const finalAdjustedAmount = adjustedRequiredAmount + minIncrement;
            
            console.log(`✅ Final adjustment: ${this.adjustedAmount} → ${finalAdjustedAmount}`);
            return { 
                adjustedAmount: finalAdjustedAmount, 
                adjustedLeverage: this.effectiveLeverage, 
                adjustmentType: 'amount',
                reason: `Adjusted to meet minimum notional $${this.symbolConfig.minNotional}`
            };
        }
        
        console.log(`✅ Choosing amount adjustment: ${this.adjustedAmount} → ${adjustedRequiredAmount}`);
        return { 
            adjustedAmount: adjustedRequiredAmount, 
            adjustedLeverage: this.effectiveLeverage, 
            adjustmentType: 'amount',
            reason: `Adjusted to meet minimum notional $${this.symbolConfig.minNotional}`
        };
    }

    private handleSmallAmount(): void {
        const minAmount = Math.pow(10, -this.symbolConfig.quantity);
        
        if (this.adjustedAmount === 0 || this.adjustedAmount < minAmount) {
            console.log(`⚠️ Amount ${this.adjustedAmount} too small (min: ${minAmount})`);

            const currentPositionValue = this.adjustedAmount * this.currentPrice;
            const minPositionValue = minAmount * this.currentPrice;
            const suggestedMultiplier = Math.ceil(minPositionValue / currentPositionValue);
            const suggestedLeverage = Math.min(this.effectiveLeverage * suggestedMultiplier, 30);

            console.log(`💡 Smart Order Suggestion:`);
            console.log(`   Current: ${this.adjustedAmount} ${this.params.symbol} @ ${this.effectiveLeverage}x = $${currentPositionValue.toFixed(2)}`);
            console.log(`   Minimum: ${minAmount} ${this.params.symbol} = $${minPositionValue.toFixed(2)}`);
            console.log(`   Option: Increase to ${suggestedLeverage}x leverage`);

            const MAX_SAFE_LEVERAGE = 30;
            const MAX_POSITION_MULTIPLIER = 20;

            if (suggestedLeverage <= MAX_SAFE_LEVERAGE && suggestedMultiplier <= MAX_POSITION_MULTIPLIER) {
                this.adjustedAmount = minAmount;
                this.effectiveLeverage = suggestedLeverage;
                console.log(`✅ Auto-adjusting: amount → ${this.adjustedAmount} ${this.params.symbol}`);
                console.log(`📈 Effective leverage increased to ${this.effectiveLeverage}x`);
            } else {
                throw new Error(`Amount ${this.adjustedAmount} too small. Minimum for ${this.params.symbol} is ${minAmount}. Suggested leverage ${suggestedLeverage}x exceeds safe limit.`);
            }
        }
    }

    private async adjustOrderParameters(): Promise<void> {
        console.log(`🔄 Adjusting order parameters...`);
        
        // 初始精度调整
        this.adjustedAmount = this.adjustPrecision(this.params.amount);
        
        // 第一步：检查并调整以满足最小名义价值要求
        const notionalCheck = this.checkMinNotional(this.adjustedAmount);
        if (!notionalCheck.valid) {
            console.log(`🔄 Adjusting order to meet minimum notional requirement...`);
            
            const adjustment = this.smartAdjustOrderForMinNotional();
            this.adjustedAmount = adjustment.adjustedAmount;
            this.effectiveLeverage = adjustment.adjustedLeverage;
            
            console.log(`✅ Adjusted: amount=${this.adjustedAmount}, leverage=${this.effectiveLeverage}x, type=${adjustment.adjustmentType}`);
            if (adjustment.reason) {
                console.log(`📝 Reason: ${adjustment.reason}`);
            }
        }

        // 第二步：智能处理小订单
        this.handleSmallAmount();

        // 最终安全检查
        const minAmount = Math.pow(10, -this.symbolConfig.quantity);
        if (this.adjustedAmount <= 0 || this.adjustedAmount < minAmount) {
            throw new Error(`Invalid adjusted amount ${this.adjustedAmount} ${this.params.symbol} (min: ${minAmount}). Original amount: ${this.params.amount}`);
        }

        const finalNotionalCheck = this.checkMinNotional(this.adjustedAmount);
        if (!finalNotionalCheck.valid) {
            throw new Error(finalNotionalCheck.reason || "Order value too small after adjustments");
        }

        console.log(`✅ Final order: ${this.adjustedAmount} ${this.params.symbol} @ $${this.currentPrice.toFixed(2)} = $${(this.adjustedAmount * this.currentPrice).toFixed(2)} (leverage: ${this.effectiveLeverage}x)`);
    }

    private async setLeverage(): Promise<void> {
        console.log(`🔧 Setting leverage to ${this.effectiveLeverage}x for ${this.params.symbol}...`);
        
        try {
            await this.client.changeInitialLeverage(this.binanceSymbol, {
                leverage: this.effectiveLeverage,
            });
            console.log(`✅ Leverage set successfully: ${this.effectiveLeverage}x`);
        } catch (leverageError: any) {
            const errorMsg = leverageError?.response?.data?.msg || leverageError.message;
            console.warn(`⚠️ Failed to set leverage: ${errorMsg}`);
            console.warn(`   ℹ️ Continuing with platform default leverage...`);
        }
    }

    private async createOrder(): Promise<BuyResult> {
        console.log(`📝 Creating order...`);
        
        const orderType = this.params.price ? "LIMIT" : "MARKET";
        const positionMode = await getPositionMode();

        const orderParams: any = {
            quantity: this.adjustedAmount.toString(),
        };

        if (positionMode === "DUAL_SIDE") {
            orderParams.positionSide = "LONG";
            console.log(`📍 Using DUAL_SIDE mode with positionSide: LONG`);
        } else {
            console.log(`📍 Using ONE_WAY mode (no positionSide parameter)`);
        }

        if (this.params.price) {
            orderParams.price = this.params.price.toString();
            orderParams.timeInForce = "GTC";
        }

        console.log(`🎯 Creating ${orderType} buy order: ${this.adjustedAmount} ${this.params.symbol} at ${this.params.price || 'market price'} with ${this.effectiveLeverage}x leverage`);

        let orderResult;
        let lastError;

        // Retry up to 3 times with increasing delays
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Buy order attempt ${attempt}/3...`);

                const response = await this.client.newOrder(
                    this.binanceSymbol,
                    "BUY",
                    orderType,
                    orderParams
                );

                orderResult = response.data;
                console.log(`✅ Buy order created successfully on attempt ${attempt}`);
                break;
            } catch (orderError: any) {
                lastError = orderError;
                const errorMsg = orderError?.response?.data?.msg || orderError.message;
                console.warn(`⚠️ Buy order attempt ${attempt} failed: ${errorMsg}`);

                // 如果是精度问题，尝试重新调整
                if (errorMsg.includes('Precision') && attempt === 1) {
                    console.log(`🔄 Precision error detected, re-adjusting amount...`);
                    this.adjustedAmount = this.adjustPrecision(this.adjustedAmount + Math.pow(10, -this.symbolConfig.quantity));
                    orderParams.quantity = this.adjustedAmount.toString();
                    console.log(`✅ Re-adjusted amount to: ${this.adjustedAmount}`);
                }

                if (attempt < 3) {
                    const delay = attempt * 3000;
                    console.log(`⏳ Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw orderError;
                }
            }
        }

        if (!orderResult) {
            throw lastError || new Error("Failed to create order after 3 attempts");
        }

        console.log(`✅ Buy order created successfully:`, {
            orderId: orderResult.orderId,
            executedPrice: orderResult.avgPrice || orderResult.price,
            executedAmount: orderResult.executedQty || orderResult.origQty
        });

        return {
            success: true,
            orderId: orderResult.orderId?.toString(),
            executedPrice: orderResult.avgPrice ? parseFloat(orderResult.avgPrice) : (orderResult.price ? parseFloat(orderResult.price) : 0),
            executedAmount: orderResult.executedQty ? parseFloat(orderResult.executedQty) : (orderResult.origQty ? parseFloat(orderResult.origQty) : 0),
        };
    }

    private async setStopLossTakeProfit(): Promise<void> {
        console.log(`\n🛡️ Setting automatic stop loss and take profit...`);
        console.log(`⏳ Waiting 8 seconds for position to sync and orders to settle...`);
        await new Promise(resolve => setTimeout(resolve, 8000));

        let slTpSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`📍 Attempt ${attempt}/3 to set SL/TP...`);

                const slTpResult = await setStopLossTakeProfit({
                    symbol: this.params.symbol,
                    ...(typeof this.params.stopLossPercent === 'number' ? { stopLossPercent: this.params.stopLossPercent } : {}),
                    ...(typeof this.params.takeProfitPercent === 'number' ? { takeProfitPercent: this.params.takeProfitPercent } : {}),
                });

                if (slTpResult.success) {
                    console.log(`✅ SL/TP set successfully on attempt ${attempt}`);
                    slTpSuccess = true;
                    break;
                } else {
                    console.warn(`⚠️ Attempt ${attempt} failed: ${slTpResult.error}`);

                    if (attempt < 3) {
                        const delay = attempt === 1 ? 3000 : 5000;
                        console.log(`⏳ Waiting ${delay / 1000} seconds before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            } catch (slTpError: any) {
                console.warn(`⚠️ Attempt ${attempt} error:`, slTpError.message);

                if (attempt < 3) {
                    const delay = attempt === 1 ? 3000 : 5000;
                    console.log(`⏳ Waiting ${delay / 1000} seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        if (!slTpSuccess) {
            console.warn(`❌ Failed to set SL/TP after 3 attempts`);
        }
    }
}

/**
 * Execute a buy order on Binance Futures
 */
export async function buyLong(params: BuyParams): Promise<BuyResult> {
    console.log(`🎯 Starting buy order process...`);
    console.log(`📋 Input parameters:`, {
        symbol: params.symbol,
        amount: params.amount,
        leverage: params.leverage,
        price: params.price,
        autoSetStopLoss: params.autoSetStopLoss,
        stopLossPercent: params.stopLossPercent,
        takeProfitPercent: params.takeProfitPercent
    });

    // Validate parameters
    if (!params.symbol || !params.symbol.includes("/")) {
        console.error(`❌ Invalid symbol format: ${params.symbol}`);
        return { success: false, error: "Invalid symbol format. Use 'BTC/USDT'" };
    }

    if (params.amount <= 0) {
        console.error(`❌ Invalid amount: ${params.amount}`);
        return { success: false, error: "Amount must be greater than 0" };
    }

    if (params.leverage && (params.leverage < 1 || params.leverage > 30)) {
        console.error(`❌ Invalid leverage: ${params.leverage}`);
        return { success: false, error: "Leverage must be between 1 and 30" };
    }

    const binanceSymbol = params.symbol.replace("/", "");
    const symbolConfig = SYMBOL_PRECISION[binanceSymbol] || { quantity: 3, price: 2, minNotional: 100 };

    const executor = new BuyOrderExecutor(params, symbolConfig);
    return await executor.execute();
}