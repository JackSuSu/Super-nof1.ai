import "@/lib/utils/logger";
import { getBinanceInstance, ensureTimeSync } from "./binance-official";
import { fetchPositions } from "./positions";

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
    "BTCUSDT": { quantity: 3, price: 1, minNotional: 5 },   // 0.001 BTC, 最小$5
    "ETHUSDT": { quantity: 2, price: 2, minNotional: 5 },   // 0.01 ETH, 最小$5
    "BNBUSDT": { quantity: 1, price: 2, minNotional: 5 },   // 0.1 BNB, 最小$5
    "SOLUSDT": { quantity: 1, price: 3, minNotional: 5 },   // 0.1 SOL, 最小$5
    "ADAUSDT": { quantity: 0, price: 4, minNotional: 5 },   // 1 ADA, 最小$5
    "DOGEUSDT": { quantity: 0, price: 5, minNotional: 5 },  // 1 DOGE, 最小$5 🐕
};

/**
 * 调整数量精度
 */
function adjustPrecision(amount: number, symbol: string): number {
    const config = SYMBOL_PRECISION[symbol] || { quantity: 3, price: 2, minNotional: 5 };
    const factor = Math.pow(10, config.quantity);
    const adjusted = Math.floor(amount * factor) / factor;

    if (adjusted !== amount) {
        console.log(`⚙️ Precision adjusted: ${amount} → ${adjusted} (${config.quantity} decimals)`);
    }

    return adjusted;
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

                console.log(`📊 Position details:`, {
                    symbol: position.symbol,
                    side: position.side,
                    contracts: position.contracts,
                    entryPrice: position.entryPrice,
                    markPrice: position.markPrice,
                    unrealizedPnl: position.unrealizedPnl
                });

                // 确定持仓方向
                positionSide = position.side === "long" ? "LONG" : "SHORT";
                console.log(`📍 Position side: ${positionSide}`);

                // Calculate sell amount based on percentage
                sellAmount = Math.abs(position.contracts) * (percentage / 100);
                console.log(`💰 Calculated sell amount: ${sellAmount} (${percentage}% of ${Math.abs(position.contracts)})`);
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

        // 调整数量精度
        const adjustedAmount = adjustPrecision(sellAmount, binanceSymbol);

        if (adjustedAmount === 0) {
            return {
                success: false,
                error: `Amount ${sellAmount} too small. Minimum for ${symbol} is ${Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3))}`
            };
        }

        // Prepare order parameters
        const orderType = price ? "LIMIT" : "MARKET";
        const side = positionSide === "LONG" ? "SELL" : "BUY"; // 平多用SELL，平空用BUY

        // 🔧 orderParams 只包含额外参数，不包含 symbol/side/type（这些通过函数参数传递）
        // Do NOT send positionSide unless account is in HEDGE mode. Instead, use reduceOnly=true
        // to ensure the order only reduces existing positions in ONE-WAY mode.
        const orderParams: any = {
            quantity: adjustedAmount.toString(),
            reduceOnly: true,
        };

        if (price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = "GTC"; // Good Till Cancelled
        }

        console.log(`📝 Creating ${orderType} sell order: ${adjustedAmount} ${symbol} at ${price || 'market price'}`);

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
