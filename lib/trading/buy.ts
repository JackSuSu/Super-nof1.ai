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
async function getPositionMode(): Promise<"ONE_WAY" | "DUAL_SIDE"> {
    if (positionModeCache) {
        return positionModeCache;
    }

    try {
        const client = await getBinanceInstance();
        await ensureTimeSync();
        // Try SDK methods first (different SDKs expose different method names)
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

        // REST fallback: /fapi/v1/positionSide/dual (signed)
        try {
            // 🔧 根据 TRADING_MODE 自动选择 API 配置
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
} export interface BuyParams {
    symbol: string; // e.g., "BTC/USDT"
    amount: number; // Amount in base currency (BTC)
    leverage?: number; // 1-125, default 10
    price?: number; // Optional limit price, omit for market order
    autoSetStopLoss?: boolean; // 自动设置止损，默�?true
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
 * Binance Futures 合约的精度配�?
 * 数量精度 (quantity) 决定最小可交易数量
 * 注意:测试网精度可能与实盘不同
 */
const SYMBOL_PRECISION: Record<string, { quantity: number; price: number; minNotional: number }> = {
    "BTCUSDT": { quantity: 3, price: 1, minNotional: 100 },   // 0.001 BTC, 最�?5
    "ETHUSDT": { quantity: 2, price: 2, minNotional: 5 },   // 0.01 ETH, 最�?5
    "BNBUSDT": { quantity: 1, price: 2, minNotional: 5 },   // 0.1 BNB, 最�?5
    "SOLUSDT": { quantity: 0, price: 3, minNotional: 5 },   // 1 SOL (整数), 最�?5 - 测试网精�?
    "ADAUSDT": { quantity: 0, price: 4, minNotional: 5 },   // 1 ADA, 最�?5
    "DOGEUSDT": { quantity: 0, price: 5, minNotional: 5 },  // 1 DOGE, 最�?5 🐕
};

/**
 * 调整数量精度以符�?Binance 要求
 */
function adjustPrecision(amount: number, symbol: string): number {
    const config = SYMBOL_PRECISION[symbol] || { quantity: 3, price: 2, minNotional: 5 };
    const factor = Math.pow(10, config.quantity);
    const adjusted = Math.floor(amount * factor) / factor;

    if (adjusted !== amount) {
        console.log(`⚙️ Precision adjusted: ${amount} �?${adjusted} (${config.quantity} decimals)`);
    }

    return adjusted;
}

/**
 * 检查订单是否满足最小名义价值要�?
 */
function checkMinNotional(amount: number, symbol: string, price?: number): { valid: boolean; reason?: string } {
    const config = SYMBOL_PRECISION[symbol] || { quantity: 3, price: 2, minNotional: 5 };

    // 如果没有提供价格,跳过检�?市价单在执行时会检�?
    if (!price) {
        return { valid: true };
    }

    const notional = amount * price;
    if (notional < config.minNotional) {
        return {
            valid: false,
            reason: `Order value $${notional.toFixed(2)} below minimum $${config.minNotional}`
        };
    }

    return { valid: true };
}

/**
 * Execute a buy order on Binance Futures
 * @param params Buy order parameters
 * @returns Buy result with order details or error
 */
export async function buy(params: BuyParams): Promise<BuyResult> {
    const {
        symbol,
        amount,
        leverage = 10,
        price,
        autoSetStopLoss = true,
        stopLossPercent,
        takeProfitPercent
    } = params;

    // Validate parameters
    if (!symbol || !symbol.includes("/")) {
        return { success: false, error: "Invalid symbol format. Use 'BTC/USDT'" };
    }

    if (amount <= 0) {
        return { success: false, error: "Amount must be greater than 0" };
    }

    if (leverage < 1 || leverage > 30) {
        return { success: false, error: "Leverage must be between 1 and 30" };
    }

    try {
        // 🔄 每次交易前先同步服务器时�?
        await ensureTimeSync();

        const client = await getBinanceInstance();

        // Convert symbol format: "BTC/USDT" -> "BTCUSDT"
        const binanceSymbol = symbol.replace("/", "");

        // 🔍 如果是市价单，先获取当前价格用于订单价值计�?
        let currentPrice = price;
        if (!currentPrice) {
            try {
                const ticker = await (client as any).markPrice({ symbol: binanceSymbol });
                currentPrice = parseFloat(ticker.markPrice);
                console.log(`📊 Current ${symbol} mark price: $${currentPrice.toFixed(2)}`);
            } catch (e: any) {
                console.warn(`⚠️ Failed to fetch price, using fallback`);
                currentPrice = 1; // 后备方案
            }
        }

        // 调整数量精度
        let adjustedAmount = adjustPrecision(amount, binanceSymbol);
        const minAmount = Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3));

        // 🎯 智能处理小订�? 自动放大杠杆或建议放�?
        let effectiveLeverage = leverage; // 实际使用的杠�?
        if (adjustedAmount === 0 || adjustedAmount < minAmount) {
            console.log(`⚠️ Amount ${amount} too small (min: ${minAmount})`);

            // 计算需要的最小数量和对应的杠杆（使用实际价格�?
            const currentPositionValue = amount * currentPrice;
            const minPositionValue = minAmount * currentPrice;
            const suggestedMultiplier = Math.ceil(minPositionValue / currentPositionValue);
            const suggestedLeverage = Math.min(leverage * suggestedMultiplier, 30);

            // 建议策略
            console.log(`💡 Smart Order Suggestion:`);
            console.log(`   Current: ${amount} ${symbol} @ ${leverage}x = $${currentPositionValue.toFixed(2)}`);
            console.log(`   Minimum: ${minAmount} ${symbol} = $${minPositionValue.toFixed(2)}`);
            console.log(`   Option 1: 🚀 Increase to ${suggestedLeverage}x leverage (${suggestedMultiplier}x position)`);
            console.log(`   Option 2: ⏭️  Skip this trade (signal too weak)`);

            // 🔥 激进策�? 允许最�?0x杠杆，最�?0倍位置放�?
            const MAX_SAFE_LEVERAGE = 30;
            const MAX_POSITION_MULTIPLIER = 20;

            // 🛡�?保证金安全检查：考虑账户余额
            // 假设需要至�?2% 的账户余额作为保证金（考虑维持保证金和手续费）
            const MARGIN_SAFETY_FACTOR = 0.02; // 2% 的账户用于单笔交�?
            const estimatedAccountBalance = minPositionValue / MARGIN_SAFETY_FACTOR; // 反推需要的账户余额

            if (suggestedLeverage <= MAX_SAFE_LEVERAGE && suggestedMultiplier <= MAX_POSITION_MULTIPLIER) {
                adjustedAmount = minAmount;
                effectiveLeverage = suggestedLeverage; // 🔥 更新实际杠杆�?
                console.log(`�?Auto-adjusting: ${amount} �?${adjustedAmount} ${symbol}`);
                console.log(`📈 Effective leverage increased to ${effectiveLeverage}x (within ${MAX_SAFE_LEVERAGE}x limit)`);
                console.log(`💰 Estimated required account balance: $${estimatedAccountBalance.toFixed(2)}`);
                console.log(`   ⚠️ WARNING: This assumes you have sufficient margin. If "Margin is insufficient" error occurs, the AI will skip this trade.`);
            } else {
                return {
                    success: false,
                    error: `Amount ${amount} too small. Minimum for ${symbol} is ${minAmount}. Suggested leverage ${suggestedLeverage}x exceeds safe limit ${MAX_SAFE_LEVERAGE}x - SKIP THIS TRADE.`
                };
            }
        }

        // 🛡�?最终安全检查：确保调整后的数量有效
        if (adjustedAmount <= 0 || adjustedAmount < minAmount) {
            return {
                success: false,
                error: `Invalid adjusted amount ${adjustedAmount} ${symbol} (min: ${minAmount}). Original amount: ${amount}`
            };
        }

        console.log(`�?Final order amount: ${adjustedAmount} ${symbol} (original: ${amount})`);

        // 检查最小订单价�?限价�?
        if (price) {
            const notionalCheck = checkMinNotional(adjustedAmount, binanceSymbol, price);
            if (!notionalCheck.valid) {
                return {
                    success: false,
                    error: notionalCheck.reason || "Order value too small"
                };
            }
        }

        // 🎯 设置杠杆（如果自动放大了倍数，需要使用更高的杠杆�?
        try {
            console.log(`🔧 Setting leverage to ${effectiveLeverage}x for ${symbol}...`);
            await (client as any).changeInitialLeverage(binanceSymbol, {
                leverage: effectiveLeverage,
            });
            console.log(`�?Leverage set successfully: ${effectiveLeverage}x`);
        } catch (leverageError: any) {
            const errorMsg = leverageError?.response?.data?.msg || leverageError.message;
            console.warn(`⚠️ Failed to set leverage: ${errorMsg}`);
            console.warn(`   ℹ️ Continuing with platform default leverage...`);
        }

        // Get position mode to determine if we need positionSide parameter
        const positionMode = await getPositionMode();

        // Prepare order parameters
        const orderType = price ? "LIMIT" : "MARKET";

        // 🔧 orderParams 只包含额外参数，不包�?symbol/side/type（这些通过函数参数传递）
        const orderParams: any = {
            quantity: adjustedAmount.toString(),
        };

        // Only set positionSide for DUAL_SIDE mode (双向持仓)
        if (positionMode === "DUAL_SIDE") {
            orderParams.positionSide = "LONG";
            console.log(`📍 Using DUAL_SIDE mode with positionSide: LONG`);
        } else {
            // In ONE_WAY mode, don't set positionSide (or set to "BOTH")
            console.log(`📍 Using ONE_WAY mode (no positionSide parameter)`);
        }

        if (price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = "GTC"; // Good Till Cancelled
        }

        console.log(`📝 Creating ${orderType} buy order: ${adjustedAmount} ${symbol} (original: ${amount}) at ${price || 'market price'} with ${effectiveLeverage}x leverage`);

        let orderResult;
        let lastError;

        // Retry up to 3 times with increasing delays
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Buy order attempt ${attempt}/3...`);

                // Binance SDK requires: newOrder(symbol, side, type, options)
                // Not just newOrder(options)!
                const response = await (client as any).newOrder(
                    binanceSymbol,
                    "BUY",
                    orderType,
                    orderParams
                );

                orderResult = response.data;
                console.log(`�?Buy order created successfully on attempt ${attempt}`);
                break; // Success, exit loop
            } catch (orderError: any) {
                lastError = orderError;
                const errorMsg = orderError?.response?.data?.msg || orderError.message;
                console.warn(`⚠️ Buy order attempt ${attempt} failed: ${errorMsg}`);

                if (attempt < 3) {
                    const delay = attempt * 3000; // Increasing delay: 3s, 6s
                    console.log(`�?Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw orderError; // Last attempt failed, throw error
                }
            }
        }

        if (!orderResult) {
            throw lastError || new Error("Failed to create order after 3 attempts");
        }

        console.log(`�?Buy order created successfully:`, orderResult);

        // 🛡�?自动设置止盈止损
        if (autoSetStopLoss) {
            console.log(`\n🛡�?Setting automatic stop loss and take profit...`);

            // 等待更长时间确保订单完全执行并同步到API
            // 市价单通常需�?3-5 秒才能在持仓列表中显�?
            console.log(`�?Waiting 8 seconds for position to sync and orders to settle...`);
            await new Promise(resolve => setTimeout(resolve, 8000));

            // 重试逻辑：最多尝�?3 �?每次等待更长时间让旧订单清理完成
            let slTpSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    console.log(`📍 Attempt ${attempt}/3 to set SL/TP...`);

                    const slTpResult = await setStopLossTakeProfit({
                        symbol,
                        // 若未提供百分比，将在模块内基于ATR动态计�?
                        ...(typeof stopLossPercent === 'number' ? { stopLossPercent } : {}),
                        ...(typeof takeProfitPercent === 'number' ? { takeProfitPercent } : {}),
                    });

                    if (slTpResult.success) {
                        console.log(`�?SL/TP set successfully on attempt ${attempt}:`);
                        if (typeof stopLossPercent === 'number') {
                            console.log(`   🛑 Stop Loss: ${stopLossPercent}% (Order ID: ${slTpResult.stopLossOrderId})`);
                        } else {
                            console.log(`   🛑 Stop Loss: dynamic (ATR‑based) (Order ID: ${slTpResult.stopLossOrderId})`);
                        }
                        if (typeof takeProfitPercent === 'number') {
                            console.log(`   🎯 Take Profit: ${takeProfitPercent}% (Order ID: ${slTpResult.takeProfitOrderId})`);
                        } else {
                            console.log(`   🎯 Take Profit: dynamic (ATR‑based) (Order ID: ${slTpResult.takeProfitOrderId})`);
                        }
                        slTpSuccess = true;
                        break;
                    } else {
                        console.warn(`⚠️ Attempt ${attempt} failed: ${slTpResult.error}`);

                        if (attempt < 3) {
                            // 逐渐增加等待时间: 3s, 5s
                            const delay = attempt === 1 ? 3000 : 5000;
                            console.log(`�?Waiting ${delay / 1000} seconds before retry...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }
                } catch (slTpError: any) {
                    console.warn(`⚠️ Attempt ${attempt} error:`, slTpError.message);

                    if (attempt < 3) {
                        const delay = attempt === 1 ? 3000 : 5000;
                        console.log(`�?Waiting ${delay / 1000} seconds before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }

            if (!slTpSuccess) {
                console.warn(`�?Failed to set SL/TP after 3 attempts`);
                console.warn(`   ℹ️ You can set it manually using: tsx manage-sltp.ts set ${symbol}`);
            }
        }

        // Extract order details from Binance response
        return {
            success: true,
            orderId: orderResult.orderId?.toString(),
            executedPrice: orderResult.avgPrice ? parseFloat(orderResult.avgPrice) : (orderResult.price ? parseFloat(orderResult.price) : 0),
            executedAmount: orderResult.executedQty ? parseFloat(orderResult.executedQty) : (orderResult.origQty ? parseFloat(orderResult.origQty) : 0),
        };
    } catch (error: any) {
        const errorMessage = error.message || "Unknown error occurred during buy";
        console.error("�?Buy order failed:", errorMessage);
        console.error("📋 Error details:", {
            symbol,
            amount,
            leverage,
            price,
            errorType: error.constructor?.name,
            errorCode: error.code
        });
        return {
            success: false,
            error: errorMessage,
        };
    }
}