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
 * 数量精度 (quantity) 决定最小可交易数量
 * 注意: 测试网精度要求与实盘可能不同，这里使用测试网实际要求
 */
const SYMBOL_PRECISION: Record<string, { quantity: number; price: number; minNotional: number }> = {
    "BTCUSDT": { quantity: 3, price: 1, minNotional: 100 },   // 0.001 BTC, 最小100 USDT
    "ETHUSDT": { quantity: 2, price: 2, minNotional: 100 },   // 0.01 ETH, 最小100 USDT
    "BNBUSDT": { quantity: 2, price: 2, minNotional: 100 },   // 0.01 BNB, 最小100 USDT
    "SOLUSDT": { quantity: 2, price: 3, minNotional: 100 },   // 0.01 SOL, 最小100 USDT - 修正精度
    "ADAUSDT": { quantity: 0, price: 4, minNotional: 100 },   // 1 ADA, 最小100 USDT
    "DOGEUSDT": { quantity: 0, price: 5, minNotional: 100 },  // 1 DOGE, 最小100 USDT
};

/**
 * 调整数量精度以符合 Binance 要求
 */
function adjustPrecision(amount: number, symbol: string): number {
    const config = SYMBOL_PRECISION[symbol] || { quantity: 3, price: 2, minNotional: 100 };
    const factor = Math.pow(10, config.quantity);
    const adjusted = Math.floor(amount * factor) / factor;

    if (adjusted !== amount) {
        console.log(`⚙️ Precision adjusted: ${amount} → ${adjusted} (${config.quantity} decimals)`);
    }

    return adjusted;
}

/**
 * 检查订单是否满足最小名义价值要求
 */
function checkMinNotional(amount: number, symbol: string, price: number): { valid: boolean; reason?: string; requiredAmount?: number } {
    const config = SYMBOL_PRECISION[symbol] || { quantity: 3, price: 2, minNotional: 100 };

    const notional = amount * price;
    if (notional < config.minNotional) {
        const requiredAmount = config.minNotional / price;
        const adjustedRequiredAmount = adjustPrecision(requiredAmount, symbol);
        
        return {
            valid: false,
            reason: `Order value $${notional.toFixed(2)} below minimum $${config.minNotional}. Need at least ${adjustedRequiredAmount} ${symbol}`,
            requiredAmount: adjustedRequiredAmount
        };
    }

    return { valid: true };
}

/**
 * 智能调整订单以满足最小名义价值要求
 */
function smartAdjustOrderForMinNotional(
    amount: number, 
    symbol: string, 
    currentPrice: number, 
    leverage: number
): { adjustedAmount: number; adjustedLeverage: number; adjustmentType: 'amount' | 'leverage' | 'both' | 'none'; reason?: string } {
    const binanceSymbol = symbol.replace("/", "");
    const config = SYMBOL_PRECISION[binanceSymbol] || { quantity: 3, price: 2, minNotional: 100 };
    
    const currentNotional = amount * currentPrice;
    
    // 如果当前名义价值已经满足要求，不需要调整
    if (currentNotional >= config.minNotional) {
        return { 
            adjustedAmount: amount, 
            adjustedLeverage: leverage, 
            adjustmentType: 'none' 
        };
    }
    
    console.log(`💰 Order value $${currentNotional.toFixed(2)} below minimum $${config.minNotional}`);
    
    // 计算需要的最小数量
    const requiredMinAmount = config.minNotional / currentPrice;
    const adjustedRequiredAmount = adjustPrecision(requiredMinAmount, binanceSymbol);
    
    // 重新计算调整后的名义价值
    const newNotional = adjustedRequiredAmount * currentPrice;
    
    // 确保调整后的数量满足最小名义价值
    if (newNotional < config.minNotional) {
        // 如果仍然不满足，增加一个最小精度单位
        const minIncrement = Math.pow(10, -config.quantity);
        const finalAdjustedAmount = adjustedRequiredAmount + minIncrement;
        
        console.log(`✅ Final adjustment: ${amount} → ${finalAdjustedAmount} ${symbol}`);
        return { 
            adjustedAmount: finalAdjustedAmount, 
            adjustedLeverage: leverage, 
            adjustmentType: 'amount',
            reason: `Adjusted to meet minimum notional $${config.minNotional}`
        };
    }
    
    console.log(`✅ Choosing amount adjustment: ${amount} → ${adjustedRequiredAmount}`);
    return { 
        adjustedAmount: adjustedRequiredAmount, 
        adjustedLeverage: leverage, 
        adjustmentType: 'amount',
        reason: `Adjusted to meet minimum notional $${config.minNotional}`
    };
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
        // 🔄 每次交易前先同步服务器时间
        await ensureTimeSync();

        const client = await getBinanceInstance();

        // Convert symbol format: "BTC/USDT" -> "BTCUSDT"
        const binanceSymbol = symbol.replace("/", "");

        // 🔍 如果是市价单，先获取当前价格用于订单价值计算
        let currentPrice = price;
        if (!currentPrice) {
            try {
                const ticker = await (client as any).markPrice({ symbol: binanceSymbol });
                currentPrice = parseFloat(ticker.markPrice);
                console.log(`📊 Current ${symbol} mark price: $${currentPrice.toFixed(2)}`);
            } catch (e: any) {
                console.warn(`⚠️ Failed to fetch price, using fallback`);
                // 使用更合理的后备价格，避免计算错误
                const fallbackPrices: Record<string, number> = {
                    "BTCUSDT": 50000,
                    "ETHUSDT": 3000,
                    "BNBUSDT": 500,
                    "SOLUSDT": 100,
                    "ADAUSDT": 0.5,
                    "DOGEUSDT": 0.1
                };
                currentPrice = fallbackPrices[binanceSymbol] || 1;
                console.log(`📊 Using fallback price: $${currentPrice.toFixed(2)}`);
            }
        }

        // 调整数量精度
        let adjustedAmount = adjustPrecision(amount, binanceSymbol);
        const minAmount = Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3));
        let effectiveLeverage = leverage;

        // 🆕 第一步：检查并调整以满足最小名义价值要求
        const notionalCheck = checkMinNotional(adjustedAmount, binanceSymbol, currentPrice);
        if (!notionalCheck.valid) {
            console.log(`🔄 Adjusting order to meet minimum notional requirement...`);
            
            const adjustment = smartAdjustOrderForMinNotional(adjustedAmount, symbol, currentPrice, effectiveLeverage);
            adjustedAmount = adjustment.adjustedAmount;
            effectiveLeverage = adjustment.adjustedLeverage;
            
            console.log(`✅ Adjusted: amount=${adjustedAmount}, leverage=${effectiveLeverage}x, type=${adjustment.adjustmentType}`);
            if (adjustment.reason) {
                console.log(`📝 Reason: ${adjustment.reason}`);
            }
            
            // 验证调整后的名义价值
            const finalNotional = adjustedAmount * currentPrice;
            console.log(`💰 Final order value: $${finalNotional.toFixed(2)}`);
            
            if (finalNotional < SYMBOL_PRECISION[binanceSymbol].minNotional) {
                return {
                    success: false,
                    error: `Cannot meet minimum notional $${SYMBOL_PRECISION[binanceSymbol].minNotional} for ${symbol}. Adjusted value: $${finalNotional.toFixed(2)}`
                };
            }
        }

        // 🎯 第二步：智能处理小订单（数量精度不足）
        if (adjustedAmount === 0 || adjustedAmount < minAmount) {
            console.log(`⚠️ Amount ${adjustedAmount} too small (min: ${minAmount})`);

            // 计算需要的最小数量和对应的杠杆
            const currentPositionValue = adjustedAmount * currentPrice;
            const minPositionValue = minAmount * currentPrice;
            const suggestedMultiplier = Math.ceil(minPositionValue / currentPositionValue);
            const suggestedLeverage = Math.min(effectiveLeverage * suggestedMultiplier, 30);

            console.log(`💡 Smart Order Suggestion:`);
            console.log(`   Current: ${adjustedAmount} ${symbol} @ ${effectiveLeverage}x = $${currentPositionValue.toFixed(2)}`);
            console.log(`   Minimum: ${minAmount} ${symbol} = $${minPositionValue.toFixed(2)}`);
            console.log(`   Option: Increase to ${suggestedLeverage}x leverage`);

            const MAX_SAFE_LEVERAGE = 30;
            const MAX_POSITION_MULTIPLIER = 20;

            if (suggestedLeverage <= MAX_SAFE_LEVERAGE && suggestedMultiplier <= MAX_POSITION_MULTIPLIER) {
                adjustedAmount = minAmount;
                effectiveLeverage = suggestedLeverage;
                console.log(`✅ Auto-adjusting: amount → ${adjustedAmount} ${symbol}`);
                console.log(`📈 Effective leverage increased to ${effectiveLeverage}x`);
                
                // 再次检查名义价值
                const newNotionalCheck = checkMinNotional(adjustedAmount, binanceSymbol, currentPrice);
                if (!newNotionalCheck.valid) {
                    console.log(`🔄 Re-adjusting for minimum notional after precision fix...`);
                    const readjustment = smartAdjustOrderForMinNotional(adjustedAmount, symbol, currentPrice, effectiveLeverage);
                    adjustedAmount = readjustment.adjustedAmount;
                    effectiveLeverage = readjustment.adjustedLeverage;
                }
            } else {
                return {
                    success: false,
                    error: `Amount ${adjustedAmount} too small. Minimum for ${symbol} is ${minAmount}. Suggested leverage ${suggestedLeverage}x exceeds safe limit.`
                };
            }
        }

        // 🛡️ 最终安全检查：确保调整后的数量有效
        if (adjustedAmount <= 0 || adjustedAmount < minAmount) {
            return {
                success: false,
                error: `Invalid adjusted amount ${adjustedAmount} ${symbol} (min: ${minAmount}). Original amount: ${amount}`
            };
        }

        // 🛡️ 最终名义价值检查
        const finalNotionalCheck = checkMinNotional(adjustedAmount, binanceSymbol, currentPrice);
        if (!finalNotionalCheck.valid) {
            return {
                success: false,
                error: finalNotionalCheck.reason || "Order value too small after adjustments"
            };
        }

        console.log(`✅ Final order: ${adjustedAmount} ${symbol} @ $${currentPrice.toFixed(2)} = $${(adjustedAmount * currentPrice).toFixed(2)} (leverage: ${effectiveLeverage}x)`);

        // 🎯 设置杠杆
        try {
            console.log(`🔧 Setting leverage to ${effectiveLeverage}x for ${symbol}...`);
            await (client as any).changeInitialLeverage(binanceSymbol, {
                leverage: effectiveLeverage,
            });
            console.log(`✅ Leverage set successfully: ${effectiveLeverage}x`);
        } catch (leverageError: any) {
            const errorMsg = leverageError?.response?.data?.msg || leverageError.message;
            console.warn(`⚠️ Failed to set leverage: ${errorMsg}`);
            console.warn(`   ℹ️ Continuing with platform default leverage...`);
        }

        // Get position mode to determine if we need positionSide parameter
        const positionMode = await getPositionMode();

        // Prepare order parameters
        const orderType = price ? "LIMIT" : "MARKET";

        // 🔧 orderParams 只包含额外参数，不包含symbol/side/type（这些通过函数参数传递）
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

        console.log(`📝 Creating ${orderType} buy order: ${adjustedAmount} ${symbol} at ${price || 'market price'} with ${effectiveLeverage}x leverage`);

        let orderResult;
        let lastError;

        // Retry up to 3 times with increasing delays
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Buy order attempt ${attempt}/3...`);

                // Binance SDK requires: newOrder(symbol, side, type, options)
                const response = await (client as any).newOrder(
                    binanceSymbol,
                    "BUY",
                    orderType,
                    orderParams
                );

                orderResult = response.data;
                console.log(`✅ Buy order created successfully on attempt ${attempt}`);
                break; // Success, exit loop
            } catch (orderError: any) {
                lastError = orderError;
                const errorMsg = orderError?.response?.data?.msg || orderError.message;
                console.warn(`⚠️ Buy order attempt ${attempt} failed: ${errorMsg}`);

                // 如果是精度问题，尝试重新调整
                if (errorMsg.includes('Precision') && attempt === 1) {
                    console.log(`🔄 Precision error detected, re-adjusting amount...`);
                    // 获取更精确的精度信息并重新调整
                    adjustedAmount = adjustPrecision(adjustedAmount + Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3)), binanceSymbol);
                    orderParams.quantity = adjustedAmount.toString();
                    console.log(`✅ Re-adjusted amount to: ${adjustedAmount}`);
                }

                if (attempt < 3) {
                    const delay = attempt * 3000; // Increasing delay: 3s, 6s
                    console.log(`⏳ Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw orderError; // Last attempt failed, throw error
                }
            }
        }

        if (!orderResult) {
            throw lastError || new Error("Failed to create order after 3 attempts");
        }

        console.log(`✅ Buy order created successfully:`, orderResult);

        // 🛡️ 自动设置止盈止损
        if (autoSetStopLoss) {
            console.log(`\n🛡️ Setting automatic stop loss and take profit...`);

            // 等待更长时间确保订单完全执行并同步到API
            console.log(`⏳ Waiting 8 seconds for position to sync and orders to settle...`);
            await new Promise(resolve => setTimeout(resolve, 8000));

            // 重试逻辑：最多尝试3次
            let slTpSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    console.log(`📍 Attempt ${attempt}/3 to set SL/TP...`);

                    const slTpResult = await setStopLossTakeProfit({
                        symbol,
                        ...(typeof stopLossPercent === 'number' ? { stopLossPercent } : {}),
                        ...(typeof takeProfitPercent === 'number' ? { takeProfitPercent } : {}),
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

        // Extract order details from Binance response
        return {
            success: true,
            orderId: orderResult.orderId?.toString(),
            executedPrice: orderResult.avgPrice ? parseFloat(orderResult.avgPrice) : (orderResult.price ? parseFloat(orderResult.price) : 0),
            executedAmount: orderResult.executedQty ? parseFloat(orderResult.executedQty) : (orderResult.origQty ? parseFloat(orderResult.origQty) : 0),
        };
    } catch (error: any) {
        const errorMessage = error.message || "Unknown error occurred during buy";
        console.error("❌ Buy order failed:", errorMessage);
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