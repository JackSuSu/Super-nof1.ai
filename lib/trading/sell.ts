import "@/lib/utils/logger";
import { getBinanceInstance, ensureTimeSync } from "./binance-official";
import { fetchPositions } from "./positions";
import { getPositionMode } from "./buy";

export interface ClosePositionParams {
    symbol: string; // e.g., "BTC/USDT"
    percentage?: number; // Percentage of position to close (0-100)
    amount?: number; // Absolute amount to close (overrides percentage)
    price?: number; // Optional limit price, omit for market order
}

export interface ShortSellParams {
    symbol: string; // e.g., "BTC/USDT"
    amount: number; // 开空仓的数量
    price?: number; // Optional limit price, omit for market order
    leverage?: number; // 杠杆倍数
}

export interface TradeResult {
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
    "BNBUSDT": { quantity: 1, price: 2, minNotional: 100 },
    "SOLUSDT": { quantity: 2, price: 3, minNotional: 100 },
    "ADAUSDT": { quantity: 0, price: 4, minNotional: 100 },
    "DOGEUSDT": { quantity: 0, price: 5, minNotional: 100 },
};

/**
 * 调整数量精度
 */
function adjustPrecision(amount: number, symbol: string): number {
    const config = SYMBOL_PRECISION[symbol] || { quantity: 3, price: 2, minNotional: 100 };
    const factor = Math.pow(10, config.quantity);
    let adjusted = Math.floor(amount * factor) / factor;

    if (adjusted === 0 && amount > 0) {
        adjusted = Math.pow(10, -config.quantity);
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
    }
}

/**
 * 智能调整卖出数量以避免精度问题
 */
function smartAdjustAmount(amount: number, symbol: string, positionSize: number): { 
    adjustedAmount: number; 
    adjustmentType: 'min' | 'all' | 'percentage' | 'none'; 
    reason?: string 
} {
    const binanceSymbol = symbol.replace("/", "");
    const config = SYMBOL_PRECISION[binanceSymbol] || { quantity: 3, price: 2, minNotional: 100 };
    const minAmount = Math.pow(10, -config.quantity);
    
    let adjustedAmount = adjustPrecision(amount, binanceSymbol);
    
    if (adjustedAmount === 0 || adjustedAmount < minAmount) {
        console.log(`⚠️ Amount ${amount} too small (min: ${minAmount}, position: ${positionSize})`);
        
        if (positionSize >= minAmount) {
            adjustedAmount = minAmount;
            const percentage = (adjustedAmount / positionSize) * 100;
            console.log(`✅ Adjusting to minimum amount: ${adjustedAmount} (${percentage.toFixed(1)}% of position)`);
            return {
                adjustedAmount,
                adjustmentType: 'min',
                reason: `Adjusted to minimum trade size ${minAmount} (${percentage.toFixed(1)}% of position)`
            };
        } else if (positionSize > 0) {
            adjustedAmount = adjustPrecision(positionSize, binanceSymbol);
            if (adjustedAmount === 0) {
                adjustedAmount = positionSize;
            }
            console.log(`✅ Using entire position: ${adjustedAmount} (position below minimum trade size)`);
            return {
                adjustedAmount,
                adjustmentType: 'all',
                reason: `Using entire position as it's below minimum trade size`
            };
        }
    }
    
    if (adjustedAmount > positionSize) {
        adjustedAmount = adjustPrecision(positionSize, binanceSymbol);
        console.log(`✅ Adjusting amount to position size: ${adjustedAmount}`);
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
 * 平仓函数 - 关闭现有持仓
 */
export async function closePosition(params: ClosePositionParams): Promise<TradeResult> {
    const { symbol, percentage = 100, amount, price } = params;

    if (!symbol || !symbol.includes("/")) {
        return { success: false, error: "Invalid symbol format. Use 'BTC/USDT'" };
    }

    if (percentage <= 0 || percentage > 100) {
        return { success: false, error: "Percentage must be between 0 and 100" };
    }

    try {
        await ensureTimeSync();
        const client = await getBinanceInstance();
        const binanceSymbol = symbol.replace("/", "");

        let closeAmount = amount;
        let positionSide = "LONG";
        let positionSize = 0;

        if (!closeAmount) {
            try {
                console.log(`🔍 Fetching position for ${symbol}...`);
                const positions = await fetchPositions();
                const activePositions = positions.filter(p => p.contracts !== 0);

                if (activePositions.length > 0) {
                    console.log(`📋 Active positions list:`);
                    activePositions.forEach(p => {
                        console.log(`   - ${p.symbol}: ${p.contracts > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.contracts)} @ $${p.entryPrice}`);
                    });
                }

                const position = positions.find((p) => p.symbol === binanceSymbol && p.contracts !== 0);

                if (!position || !position.contracts || position.contracts === 0) {
                    console.warn(`⚠️ No open position found for ${symbol}`);
                    return {
                        success: false,
                        error: `No open position found for ${symbol}`,
                    };
                }

                positionSide = position.side === "long" ? "LONG" : "SHORT";
                positionSize = Math.abs(position.contracts);
                closeAmount = positionSize * (percentage / 100);
                console.log(`💰 Calculated close amount: ${closeAmount} (${percentage}% of ${positionSize})`);
                
                const adjustment = smartAdjustAmount(closeAmount, symbol, positionSize);
                closeAmount = adjustment.adjustedAmount;
                
            } catch (positionError: any) {
                console.error("❌ Failed to fetch positions:", positionError.message);
                return { success: false, error: `Failed to fetch position: ${positionError.message}` };
            }
        }

        if (closeAmount <= 0) {
            return { success: false, error: "Close amount must be greater than 0" };
        }

        const adjustedAmount = adjustPrecision(closeAmount, binanceSymbol);
        const minAmount = Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3));
        
        if (adjustedAmount <= 0 || adjustedAmount < minAmount) {
            return { success: false, error: `Amount too small. Minimum for ${symbol} is ${minAmount}` };
        }

        let finalAmount = adjustedAmount;
        if (positionSize > 0 && finalAmount > positionSize) {
            console.warn(`⚠️ Close amount ${finalAmount} exceeds position size ${positionSize}, adjusting...`);
            finalAmount = adjustPrecision(positionSize, binanceSymbol);
        }

        console.log(`✅ Final close amount: ${finalAmount} ${symbol}`);

        const positionMode = await getPositionMode();
        const orderType = price ? "LIMIT" : "MARKET";
        const side = positionSide === "LONG" ? "SELL" : "BUY";

        const orderParams: any = { quantity: finalAmount.toString() };

        if (positionMode === "DUAL_SIDE") {
            orderParams.positionSide = positionSide;
            console.log(`📍 Using DUAL_SIDE mode with positionSide: ${positionSide}`);
        } else {
            orderParams.reduceOnly = true;
            console.log(`📍 Using ONE_WAY mode with reduceOnly: true`);
        }

        if (price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = "GTC";
        }

        console.log(`📝 Creating ${orderType} close order: ${finalAmount} ${symbol} at ${price || 'market price'}`);

        let orderResult;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Close order attempt ${attempt}/3...`);
                const response = await (client as any).newOrder(binanceSymbol, side, orderType, orderParams);
                orderResult = response.data;
                console.log(`✅ Close order created successfully on attempt ${attempt}`);
                break;
            } catch (orderError: any) {
                console.warn(`⚠️ Close order attempt ${attempt} failed: ${orderError.message}`);
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                } else {
                    throw orderError;
                }
            }
        }

        console.log(`✅ Close order created successfully`);
        return {
            success: true,
            orderId: orderResult.orderId?.toString(),
            executedPrice: orderResult.avgPrice ? parseFloat(orderResult.avgPrice) : (orderResult.price ? parseFloat(orderResult.price) : 0),
            executedAmount: orderResult.executedQty ? parseFloat(orderResult.executedQty) : (orderResult.origQty ? parseFloat(orderResult.origQty) : 0),
        };
    } catch (error: any) {
        const errorMessage = error?.response?.data?.msg || error.message || "Unknown error during close";
        console.error("❌ Close order failed:", errorMessage);
        return { success: false, error: errorMessage };
    }
}

/**
 * 开空仓函数 - 建立空头持仓
 */
export async function shortSell(params: ShortSellParams): Promise<TradeResult> {
    const { symbol, amount, price, leverage } = params;

    if (!symbol || !symbol.includes("/")) {
        return { success: false, error: "Invalid symbol format. Use 'BTC/USDT'" };
    }

    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        console.error(`❌ Invalid amount: ${amount}, type: ${typeof amount}`);
        return { success: false, error: "Amount must be a valid number greater than 0" };
    }

    try {
        await ensureTimeSync();
        const client = await getBinanceInstance();
        const binanceSymbol = symbol.replace("/", "");

        if (leverage) {
            await setLeverage(binanceSymbol, leverage);
        }

        const adjustedAmount = adjustPrecision(amount, binanceSymbol);
        const minAmount = Math.pow(10, -(SYMBOL_PRECISION[binanceSymbol]?.quantity || 3));
        
        if (adjustedAmount <= 0 || adjustedAmount < minAmount) {
            return { success: false, error: `Amount ${amount} too small. Minimum for ${symbol} is ${minAmount}` };
        }

        console.log(`✅ Final short sell amount: ${adjustedAmount} ${symbol} (original: ${amount})`);

        const positionMode = await getPositionMode();
        const orderType = price ? "LIMIT" : "MARKET";
        const side = "SELL";

        const orderParams: any = { quantity: adjustedAmount.toString() };

        if (positionMode === "DUAL_SIDE") {
            orderParams.positionSide = "SHORT";
            console.log(`📍 Using DUAL_SIDE mode with positionSide: SHORT`);
        } else {
            console.log(`📍 Using ONE_WAY mode: SELL opens short position`);
        }

        if (price) {
            orderParams.price = price.toString();
            orderParams.timeInForce = "GTC";
        }

        console.log(`📝 Creating ${orderType} SHORT order: ${adjustedAmount} ${symbol} at ${price || 'market price'}`);

        let orderResult;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`🔄 Short sell order attempt ${attempt}/3...`);
                const response = await (client as any).newOrder(binanceSymbol, side, orderType, orderParams);
                orderResult = response.data;
                console.log(`✅ Short sell order created successfully on attempt ${attempt}`);
                break;
            } catch (orderError: any) {
                console.warn(`⚠️ Short sell order attempt ${attempt} failed: ${orderError.message}`);
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                } else {
                    throw orderError;
                }
            }
        }

        console.log(`✅ Short sell order created successfully`);
        return {
            success: true,
            orderId: orderResult.orderId?.toString(),
            executedPrice: orderResult.avgPrice ? parseFloat(orderResult.avgPrice) : (orderResult.price ? parseFloat(orderResult.price) : 0),
            executedAmount: orderResult.executedQty ? parseFloat(orderResult.executedQty) : (orderResult.origQty ? parseFloat(orderResult.origQty) : 0),
        };
    } catch (error: any) {
        const errorMessage = error?.response?.data?.msg || error.message || "Unknown error during short sell";
        console.error("❌ Short sell order failed:", errorMessage);
        return { success: false, error: errorMessage };
    }
}

// 保持向后兼容性
export async function sell(params: any): Promise<TradeResult> {
    console.warn("⚠️ DEPRECATED: 'sell' function is deprecated. Use 'closePosition' for closing or 'shortSell' for short selling.");
    
    // 根据参数判断是平仓还是开空仓
    if (params.percentage !== undefined) {
        return closePosition(params);
    } else if (params.amount !== undefined) {
        return shortSell(params);
    } else {
        return { success: false, error: "Invalid parameters: must specify either percentage or amount" };
    }
}