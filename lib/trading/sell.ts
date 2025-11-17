import "@/lib/utils/logger";
import { getBinanceInstance, ensureTimeSync } from "./binance-official";
import { getPositionMode } from "./buy"; // 导入持仓模式函数

export interface SellParams {
    symbol: string; // e.g., "BTC/USDT"
    amount: number; // 开空仓的数量
    price?: number; // Optional limit price, omit for market order
    leverage?: number; // 杠杆倍数
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
 * 设置杠杆
 */
async function setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
        const client = await getBinanceInstance();
        await (client as any).leverage(symbol, leverage);
        console.log(`✅ Leverage set to ${leverage}x for ${symbol}`);
    } catch (error: any) {
        console.warn(`⚠️ Failed to set leverage: ${error.message}`);
        // 继续执行，杠杆设置失败不一定影响开仓
    }
}

/**
 * Execute a short sell order on Binance Futures to open SHORT position
 * @param params Sell order parameters for opening short position
 * @returns Sell result with order details or error
 */
export async function sell(params: SellParams): Promise<SellResult> {
    const { symbol, amount, price, leverage } = params;

    // Validate parameters
    if (!symbol || !symbol.includes("/")) {
        return { success: false, error: "Invalid symbol format. Use 'BTC/USDT'" };
    }

    if (!amount || amount <= 0) {
        return { success: false, error: "Amount must be greater than 0" };
    }

    try {
        // 🔄 每次交易前先同步服务器时间
        await ensureTimeSync();

        const client = await getBinanceInstance();

        // Convert symbol format: "BTC/USDT" -> "BTCUSDT"
        const binanceSymbol = symbol.replace("/", "");

        // 设置杠杆（如果提供了的话）
        if (leverage) {
            await setLeverage(binanceSymbol, leverage);
        }

        // 🛠️ 精度调整
        const adjustedAmount = adjustPrecision(amount, binanceSymbol);

        // 🛠️ 最终验证
        const minAmount = Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3));
        if (adjustedAmount <= 0 || adjustedAmount < minAmount) {
            return {
                success: false,
                error: `Amount ${amount} too small. Minimum for ${symbol} is ${minAmount}`
            };
        }

        console.log(`✅ Final short sell amount: ${adjustedAmount} ${symbol}`);

        // Get position mode to determine order parameters
        const positionMode = await getPositionMode();

        // Prepare order parameters for SHORT position
        const orderType = price ? "LIMIT" : "MARKET";
        const side = "SELL"; // 开空仓使用 SELL

        // 🔧 根据持仓模式设置订单参数
        const orderParams: any = {
            quantity: adjustedAmount.toString(),
        };

        // 双向持仓模式下必须设置 positionSide 为 SHORT
        if (positionMode === "DUAL_SIDE") {
            orderParams.positionSide = "SHORT";
            console.log(`📍 Using DUAL_SIDE mode with positionSide: SHORT`);
        } else {
            // 单向持仓模式下不需要设置 positionSide，SELL 就是开空仓
            console.log(`📍 Using ONE_WAY mode: SELL opens short position`);
        }

        if (price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = "GTC"; // Good Till Cancelled
        }

        console.log(`📝 Creating ${orderType} SHORT order: ${adjustedAmount} ${symbol} at ${price || 'market price'}`);

        let orderResult;
        let lastError;

        // Retry up to 3 times
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Short sell order attempt ${attempt}/3...`);

                // Binance SDK requires: newOrder(symbol, side, type, options)
                const response = await (client as any).newOrder(
                    binanceSymbol,
                    side,
                    orderType,
                    orderParams
                );

                // Response is an axios response with data property
                orderResult = response.data;
                console.log(`✅ Short sell order created successfully on attempt ${attempt}`);
                break; // Success, exit loop
            } catch (orderError: any) {
                lastError = orderError;
                const errorMsg = orderError?.response?.data?.msg || orderError.message;
                console.warn(`⚠️ Short sell order attempt ${attempt} failed: ${errorMsg}`);

                // 🛠️ 处理特定的错误情况
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
                        orderParams.positionSide = "SHORT";
                        console.log(`✅ Adjusted to DUAL_SIDE mode with positionSide: SHORT`);
                    } else {
                        delete orderParams.positionSide;
                        console.log(`✅ Adjusted to ONE_WAY mode without positionSide`);
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
            throw lastError || new Error("Failed to create short sell order after 3 attempts");
        }

        console.log(`✅ Short sell order created successfully:`, orderResult);

        // Extract order details from Binance response
        return {
            success: true,
            orderId: orderResult.orderId?.toString(),
            executedPrice: orderResult.avgPrice ? parseFloat(orderResult.avgPrice) : (orderResult.price ? parseFloat(orderResult.price) : 0),
            executedAmount: orderResult.executedQty ? parseFloat(orderResult.executedQty) : (orderResult.origQty ? parseFloat(orderResult.origQty) : 0),
        };
    } catch (error: any) {
        const errorMessage = error?.response?.data?.msg || error.message || "Unknown error occurred during short sell";
        console.error("❌ Short sell order failed:", errorMessage);
        console.error("📋 Error details:", {
            symbol,
            amount,
            price,
            leverage,
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

/**
 * 便捷函数：市价开空仓
 */
export async function shortSellMarket(symbol: string, amount: number, leverage?: number): Promise<SellResult> {
    return sell({ symbol, amount, leverage });
}

/**
 * 便捷函数：限价开空仓
 */
export async function shortSellLimit(symbol: string, amount: number, price: number, leverage?: number): Promise<SellResult> {
    return sell({ symbol, amount, price, leverage });
}