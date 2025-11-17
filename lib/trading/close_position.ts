import "@/lib/utils/logger";
import { getBinanceInstance, ensureTimeSync } from "./binance-official";
import { fetchPositions } from "./positions";
import { getPositionMode } from "./buy"; // 导入持仓模式函数

export interface SellParams {
    symbol: string; // e.g., "BTC/USDT"
    percentage?: number; // Percentage of position to close (0-100)
    amount?: number; // Absolute amount to sell (overrides percentage)
    price?: number; // Optional limit price, omit for market order
}

export interface SellResult {
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
    "BTCUSDT": { quantity: 3, price: 1, minNotional: 100 },   // 0.001 BTC, 最小$100
    "ETHUSDT": { quantity: 2, price: 2, minNotional: 100 },   // 0.01 ETH, 最小$100
    "BNBUSDT": { quantity: 1, price: 2, minNotional: 100 },   // 0.1 BNB, 最小$100
    "SOLUSDT": { quantity: 2, price: 3, minNotional: 100 },   // 0.01 SOL, 最小$100
    "ADAUSDT": { quantity: 0, price: 4, minNotional: 100 },   // 1 ADA, 最小$100
    "DOGEUSDT": { quantity: 0, price: 5, minNotional: 100 },  // 1 DOGE, 最小$100
};

/**
 * 调整数量精度
 */
function adjustPrecision(amount: number, symbol: string): number {
    const config = SYMBOL_PRECISION[symbol] || { quantity: 3, price: 2, minNotional: 100 };
    const factor = Math.pow(10, config.quantity);
    let adjusted = Math.floor(amount * factor) / factor;

    // 🛠️ 关键修复：防止调整后为0的情况
    if (adjusted === 0 && amount > 0) {
        adjusted = Math.pow(10, -config.quantity); // 使用最小精度单位
        console.log(`🛠️ Precision safety adjustment: ${amount} → ${adjusted} (was 0, using min unit)`);
    } else if (adjusted !== amount) {
        console.log(`⚙️ Precision adjusted: ${amount} → ${adjusted} (${config.quantity} decimals)`);
    }

    return adjusted;
}

/**
 * 智能调整卖出数量以避免精度问题
 */
function smartAdjustSellAmount(amount: number, symbol: string, positionSize: number): { 
    adjustedAmount: number; 
    adjustmentType: 'min' | 'all' | 'percentage' | 'none'; 
    reason?: string 
} {
    const binanceSymbol = symbol.replace("/", "");
    const config = SYMBOL_PRECISION[binanceSymbol] || { quantity: 3, price: 2, minNotional: 100 };
    const minAmount = Math.pow(10, -config.quantity);
    
    let adjustedAmount = adjustPrecision(amount, binanceSymbol);
    
    // 如果调整后为0或小于最小交易量
    if (adjustedAmount === 0 || adjustedAmount < minAmount) {
        console.log(`⚠️ Sell amount ${amount} too small (min: ${minAmount}, position: ${positionSize})`);
        
        // 方案1: 如果持仓数量大于最小交易量，卖出最小交易量
        if (positionSize >= minAmount) {
            adjustedAmount = minAmount;
            const sellPercentage = (adjustedAmount / positionSize) * 100;
            console.log(`✅ Adjusting to minimum sell amount: ${adjustedAmount} (${sellPercentage.toFixed(1)}% of position)`);
            return {
                adjustedAmount,
                adjustmentType: 'min',
                reason: `Adjusted to minimum trade size ${minAmount} (${sellPercentage.toFixed(1)}% of position)`
            };
        } 
        // 方案2: 如果持仓本身就小于最小交易量，卖出全部
        else if (positionSize > 0) {
            adjustedAmount = adjustPrecision(positionSize, binanceSymbol);
            // 再次检查防止为0
            if (adjustedAmount === 0) {
                adjustedAmount = positionSize; // 直接使用原始持仓数量
            }
            console.log(`✅ Selling entire position: ${adjustedAmount} (position below minimum trade size)`);
            return {
                adjustedAmount,
                adjustmentType: 'all',
                reason: `Selling entire position as it's below minimum trade size`
            };
        }
    }
    
    // 确保卖出数量不超过持仓数量
    if (adjustedAmount > positionSize) {
        adjustedAmount = adjustPrecision(positionSize, binanceSymbol);
        console.log(`✅ Adjusting sell amount to position size: ${adjustedAmount}`);
        return {
            adjustedAmount,
            adjustmentType: 'percentage',
            reason: `Adjusted to maximum position size`
        };
    }
    
    return {
        adjustedAmount,
        adjustmentType: 'none'
    };
}

/**
 * Execute a sell order on Binance Futures to close position using official SDK
 * @param params Sell order parameters
 * @returns Sell result with order details or error
 */
export async function sell(params: SellParams): Promise<SellResult> {
    const { symbol, percentage = 100, amount, price } = params;

    // Validate parameters
    if (!symbol || !symbol.includes("/")) {
        return { success: false, error: "Invalid symbol format. Use 'BTC/USDT'" };
    }

    if (percentage <= 0 || percentage > 100) {
        return {
            success: false,
            error: "Percentage must be between 0 and 100",
        };
    }

    try {
        // 🔄 每次交易前先同步服务器时间
        await ensureTimeSync();

        const client = await getBinanceInstance();

        // Convert symbol format: "BTC/USDT" -> "BTCUSDT"
        const binanceSymbol = symbol.replace("/", "");

        // If amount not provided, calculate from current position
        let sellAmount = amount;
        let positionSide = "LONG"; // 默认平多仓
        let positionSize = 0; // 记录持仓数量

        if (!sellAmount) {
            // Fetch current position
            try {
                console.log(`🔍 Fetching position for ${symbol}...`);
                const positions = await fetchPositions();
                console.log(`✅ Found ${positions.length} total positions`);

                // 过滤出活跃持仓
                const activePositions = positions.filter(p => p.contracts !== 0);
                console.log(`📊 Active positions: ${activePositions.length}`);

                if (activePositions.length > 0) {
                    console.log(`📋 Active positions list:`);
                    activePositions.forEach(p => {
                        console.log(`   - ${p.symbol}: ${p.contracts > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.contracts)} @ $${p.entryPrice}`);
                    });
                }

                // 🔧 修复：使用 binanceSymbol（无斜杠）进行匹配
                const position = positions.find((p) => p.symbol === binanceSymbol && p.contracts !== 0);

                if (!position || !position.contracts || position.contracts === 0) {
                    console.warn(`⚠️ No open position found for ${symbol}`);
                    console.warn(`   Available positions: ${activePositions.map(p => p.symbol).join(', ') || 'None'}`);
                    return {
                        success: false,
                        error: `No open position found for ${symbol}. Available: ${activePositions.map(p => p.symbol).join(', ') || 'None'}`,
                    };
                }

                console.log([`📊 Position details:`,
                    `symbol: ${position.symbol}`,
                    `side: ${position.side}`,
                    `contracts: ${position.contracts}`,
                    `entryPrice: ${position.entryPrice}`,
                    `markPrice: ${position.markPrice}`,
                    `unrealizedPnl: ${position.unrealizedPnl}`
                ].join(' '));

                // 确定持仓方向
                positionSide = position.side === "long" ? "LONG" : "SHORT";
                console.log(`📍 Position side: ${positionSide}`);

                // Calculate sell amount based on percentage
                positionSize = Math.abs(position.contracts); // 记录持仓数量
                sellAmount = positionSize * (percentage / 100);
                console.log(`💰 Calculated sell amount: ${sellAmount} (${percentage}% of ${positionSize})`);
                
                // 🛠️ 关键修复：应用智能调整
                const adjustment = smartAdjustSellAmount(sellAmount, symbol, positionSize);
                sellAmount = adjustment.adjustedAmount;
                
                if (adjustment.adjustmentType !== 'none') {
                    console.log(`📝 Sell adjustment type: ${adjustment.adjustmentType}`);
                    if (adjustment.reason) {
                        console.log(`📋 Adjustment reason: ${adjustment.reason}`);
                    }
                }
                
            } catch (positionError: any) {
                console.error("❌ Failed to fetch positions:", positionError.message);
                return {
                    success: false,
                    error: `Failed to fetch position for ${symbol}: ${positionError.message}`,
                };
            }
        }

        if (sellAmount <= 0) {
            return { success: false, error: "Sell amount must be greater than 0" };
        }

        // 🛠️ 最终精度调整（使用修复后的函数）
        const adjustedAmount = adjustPrecision(sellAmount, binanceSymbol);

        // 🛠️ 最终验证
        const minAmount = Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3));
        if (adjustedAmount <= 0 || adjustedAmount < minAmount) {
            return {
                success: false,
                error: `Amount ${sellAmount} too small. Minimum for ${symbol} is ${minAmount}. Position size: ${positionSize}`
            };
        }

        // 🛠️ 确保卖出数量不超过持仓数量
        let finalSellAmount = adjustedAmount;
        if (positionSize > 0 && finalSellAmount > positionSize) {
            console.warn(`⚠️ Sell amount ${finalSellAmount} exceeds position size ${positionSize}, adjusting...`);
            finalSellAmount = adjustPrecision(positionSize, binanceSymbol);
            console.log(`✅ Adjusted sell amount to: ${finalSellAmount}`);
        }

        console.log(`✅ Final sell amount: ${finalSellAmount} ${symbol}`);

        // Get position mode to determine if we need positionSide parameter
        const positionMode = await getPositionMode();

        // Prepare order parameters
        const orderType = price ? "LIMIT" : "MARKET";
        const side = positionSide === "LONG" ? "SELL" : "BUY"; // 平多用SELL，平空用BUY

        // 🔧 根据持仓模式设置订单参数
        const orderParams: any = {
            quantity: finalSellAmount.toString(),
        };

        // 双向持仓模式下必须设置 positionSide
        if (positionMode === "DUAL_SIDE") {
            orderParams.positionSide = positionSide;
            console.log(`📍 Using DUAL_SIDE mode with positionSide: ${positionSide}`);
        } else {
            // 单向持仓模式下使用 reduceOnly
            orderParams.reduceOnly = true;
            console.log(`📍 Using ONE_WAY mode with reduceOnly: true`);
        }

        if (price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = "GTC"; // Good Till Cancelled
        }

        console.log(`📝 Creating ${orderType} sell order: ${finalSellAmount} ${symbol} at ${price || 'market price'}`);

        let orderResult;
        let lastError;

        // Retry up to 3 times
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Sell order attempt ${attempt}/3...`);

                // Binance SDK requires: newOrder(symbol, side, type, options)
                const response = await (client as any).newOrder(
                    binanceSymbol,
                    side,
                    orderType,
                    orderParams
                );

                // Response is an axios response with data property
                orderResult = response.data;
                console.log(`✅ Sell order created successfully on attempt ${attempt}`);
                break; // Success, exit loop
            } catch (orderError: any) {
                lastError = orderError;
                const errorMsg = orderError?.response?.data?.msg || orderError.message;
                console.warn(`⚠️ Sell order attempt ${attempt} failed: ${errorMsg}`);

                // 🛠️ 如果是持仓方向错误，尝试调整参数
                if (errorMsg.includes("position side does not match") && attempt === 1) {
                    console.log(`🔄 Position side error detected, adjusting order parameters...`);
                    
                    // 清除持仓模式缓存，重新获取
                    const client = await getBinanceInstance();
                    const positionModeResponse = await (client as any).positionMode();
                    const dualSidePosition = positionModeResponse.data?.dualSidePosition ?? positionModeResponse?.dualSidePosition ?? false;
                    const currentPositionMode = dualSidePosition ? "DUAL_SIDE" : "ONE_WAY";
                    
                    console.log(`🔄 Current position mode: ${currentPositionMode}`);
                    
                    // 根据实际持仓模式调整参数
                    if (currentPositionMode === "DUAL_SIDE") {
                        orderParams.positionSide = positionSide;
                        delete orderParams.reduceOnly;
                        console.log(`✅ Adjusted to DUAL_SIDE mode with positionSide: ${positionSide}`);
                    } else {
                        orderParams.reduceOnly = true;
                        delete orderParams.positionSide;
                        console.log(`✅ Adjusted to ONE_WAY mode with reduceOnly: true`);
                    }
                }

                if (attempt < 3) {
                    const delay = attempt * 2000; // Increasing delay: 2s, 4s
                    console.log(`⏳ Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw orderError; // Last attempt failed, throw error
                }
            }
        }

        if (!orderResult) {
            throw lastError || new Error("Failed to create sell order after 3 attempts");
        }

        console.log(`✅ Sell order created successfully:`, orderResult);

        // Extract order details from Binance response
        return {
            success: true,
            orderId: orderResult.orderId?.toString(),
            executedPrice: orderResult.avgPrice ? parseFloat(orderResult.avgPrice) : (orderResult.price ? parseFloat(orderResult.price) : 0),
            executedAmount: orderResult.executedQty ? parseFloat(orderResult.executedQty) : (orderResult.origQty ? parseFloat(orderResult.origQty) : 0),
        };
    } catch (error: any) {
        const errorMessage = error?.response?.data?.msg || error.message || "Unknown error occurred during sell";
        console.error("❌ Sell order failed:", errorMessage);
        console.error("📋 Error details:", {
            symbol,
            percentage,
            amount,
            price,
            errorType: error.constructor?.name,
            errorCode: error.code,
            responseData: error?.response?.data
        });
        return {
            success: false,
            error: errorMessage,
        };
    }
}