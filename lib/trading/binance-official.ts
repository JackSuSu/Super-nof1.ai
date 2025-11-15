/**
 * 币安官方连接器实现
 * 使用 @binance/futures-connector 替代 CCXT
 * 优势：更好的代理支持，专为币安API设计
 */
import "@/lib/utils/logger";
import { UMFutures } from '@binance/futures-connector';
import tunnel from 'tunnel';
import { ProxyAgent } from 'undici';

// Prefer per-service proxy. Do NOT rely on system/global proxy so DeepSeek remains unaffected.
const disableProxy = String(process.env.BINANCE_DISABLE_PROXY || "").toLowerCase() === "true";

// 服务器时间同步
let serverTimeOffset = 0;

/**
 * 根据 TRADING_MODE 获取正确的 Binance API URL
 * @returns Binance API 基础 URL
 */
export function getBinanceBaseUrl(): string {
    const tradingMode = process.env.TRADING_MODE || "dry-run";
    const isDryRun = tradingMode === "dry-run";

    if (isDryRun) {
        return process.env.BINANCE_TESTNET_BASE_URL || "https://demo-fapi.binance.com";
    } else {
        return process.env.BINANCE_LIVE_BASE_URL || "https://fapi.binance.com";
    }
}

/**
 * 同步服务器时间 - 每次都实时同步，不缓存
 * 直接使用REST API而不是SDK，避免方法调用问题
 */
async function syncServerTime(client: UMFutures): Promise<void> {
    // 🔧 添加重试逻辑，处理网络不稳定
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const startTime = Date.now();

            // 获取代理配置
            const envProxy = process.env.BINANCE_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
            const useProxy = !!envProxy && !disableProxy;

            const fetchOptions: any = {
                method: 'GET',
                signal: AbortSignal.timeout(15000), // 增加到15秒，适应代理延迟
            };

            // 如果配置了代理，使用 ProxyAgent
            if (useProxy && envProxy) {
                fetchOptions.dispatcher = new ProxyAgent(envProxy);
                console.log(`🔄 Time sync attempt ${attempt}/3 via proxy: ${envProxy}`);
            } else {
                console.log(`🔄 Time sync attempt ${attempt}/3 (direct connection)`);
            }

            // 直接使用fetch调用Binance API获取服务器时间
            const baseUrl = getBinanceBaseUrl();
            const response = await fetch(`${baseUrl}/fapi/v1/time`, fetchOptions);

            const latency = Date.now() - startTime;

            if (response.ok) {
                const data = await response.json() as { serverTime: number };
                serverTimeOffset = Math.floor(data.serverTime - (Date.now() + latency / 2));
                console.log(`⏰ Server time synced on attempt ${attempt}. Offset: ${serverTimeOffset}ms, Latency: ${latency}ms`);
                return; // ✅ 成功，退出重试循环
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error: any) {
            lastError = error;
            console.warn(`⚠️ Time sync attempt ${attempt}/3 failed:`, error.message);

            if (attempt < 3) {
                const delay = attempt * 1000; // 1s, 2s
                console.log(`⏳ Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // 如果3次都失败，使用本地时间（offset = 0）
    console.error(`❌ Failed to sync server time after 3 attempts. Using local time (offset = 0)`);
    serverTimeOffset = 0;
}

// 1. 创建一个 Promise 来处理一次性初始化
let initializationPromise: Promise<UMFutures> | null = null;

// 2. 导出一个异步函数来获取实例
export function getBinanceInstance(): Promise<UMFutures> {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            // 🔧 根据 TRADING_MODE 自动选择 API 配置
            const tradingMode = process.env.TRADING_MODE || "dry-run";
            const isDryRun = tradingMode === "dry-run";

            let apiKey: string | undefined;
            let apiSecret: string | undefined;
            let baseURL: string;

            if (isDryRun) {
                // 虚拟盘配置
                apiKey = process.env.BINANCE_TESTNET_API_KEY;
                apiSecret = process.env.BINANCE_TESTNET_API_SECRET;
                baseURL = process.env.BINANCE_TESTNET_BASE_URL || "https://demo-fapi.binance.com";
                console.log("🎮 Trading Mode: DRY-RUN (Virtual Trading)");
                console.log(`   - Using Testnet API: ${baseURL}`);
            } else {
                // 实盘配置
                apiKey = process.env.BINANCE_LIVE_API_KEY;
                apiSecret = process.env.BINANCE_LIVE_API_SECRET;
                baseURL = process.env.BINANCE_LIVE_BASE_URL || "https://fapi.binance.com";
                console.log("⚠️  Trading Mode: LIVE (Real Money Trading)");
                console.log(`   - Using Live API: ${baseURL}`);
            }

            if (!apiKey || !apiSecret) {
                const configType = isDryRun ? "TESTNET" : "LIVE";
                throw new Error(
                    `BINANCE_${configType}_API_KEY or BINANCE_${configType}_API_SECRET not configured. ` +
                    `Please set them in .env file for ${isDryRun ? 'virtual' : 'live'} trading.`
                );
            }

            console.log(`   - API Key: ${apiKey.substring(0, 10)}...`);


            // 仅针对 Binance 按需使用代理，避免影响 DeepSeek 等其他出网请求
            const envProxy = process.env.BINANCE_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
            const useProxy = !!envProxy && !disableProxy;

            // 解析代理URL
            let proxyConfig: any = null;
            let httpsAgent: any = null;

            if (useProxy && envProxy) {
                console.log("🔄 Using per-service proxy for Binance");
                console.log(`   - Proxy URL: ${envProxy}`);

                try {
                    const proxyUrl = new URL(envProxy);
                    const proxyHost = proxyUrl.hostname;
                    const proxyPort = parseInt(proxyUrl.port || '80');
                    const proxyProtocol = proxyUrl.protocol.replace(':', '');

                    console.log(`   - Proxy Host: ${proxyHost}`);
                    console.log(`   - Proxy Port: ${proxyPort}`);
                    console.log(`   - Proxy Protocol: ${proxyProtocol}`);

                    // 创建 HTTPS-over-HTTP 隧道（推荐方式）
                    httpsAgent = tunnel.httpsOverHttp({
                        proxy: {
                            host: proxyHost,
                            port: proxyPort,
                            // 如果需要认证，从 URL 中提取
                            ...(proxyUrl.username && proxyUrl.password ? {
                                proxyAuth: `${proxyUrl.username}:${proxyUrl.password}`
                            } : {})
                        }
                    });

                    console.log("✅ HTTPS-over-HTTP tunnel created successfully");
                } catch (error: any) {
                    console.error("⚠️ Failed to parse proxy URL or create tunnel:", error.message);
                    console.log("   - Proceeding without proxy");
                }
            } else {
                console.log("🔄 Not using proxy for Binance (either BINANCE_DISABLE_PROXY=true or no proxy env provided)");
            }

            // 创建基础实例配置
            // 根据 TRADING_MODE 自动使用对应的 baseURL
            let binanceClient: UMFutures | null = null;
            let lastErr: any = null;

            try {
                console.log(`\n🔧 Attempting to connect to: ${baseURL}`);

                // 创建币安官方客户端
                const clientOptions: any = {
                    baseURL,
                    timeout: 60000,
                    ...(httpsAgent ? { httpsAgent } : {})
                };

                binanceClient = new UMFutures(apiKey, apiSecret, clientOptions);

                console.log("📦 Binance official client created");
                console.log(`   - Proxy enabled: ${useProxy}`);
                console.log(`   - Agent configured: ${!!httpsAgent}`);
                console.log(`   - Base URL: ${baseURL}`);

                // 测试连接 - 使用 ping
                for (let attempt = 1; attempt <= 5; attempt++) {
                    try {
                        console.log(`🔄 Testing connection (attempt ${attempt}/5)...`);
                        const startTime = Date.now();

                        // 使用 ping 测试连接（最简单可靠的方式）
                        await binanceClient.ping();
                        const duration = Date.now() - startTime;

                        console.log(`✅ Connection successful in ${duration}ms`);

                        // 同步服务器时间
                        await syncServerTime(binanceClient);

                        console.log("✅ Binance official client configured and connected");

                        return binanceClient;
                    } catch (testError: any) {
                        lastErr = testError;
                        console.error(`⚠️ Connection test attempt ${attempt} failed:`, testError.message);

                        // 输出详细的错误信息
                        if (testError.response) {
                            console.error(`   - HTTP Status: ${testError.response.status}`);
                            console.error(`   - Response data:`, testError.response.data);
                        }

                        if (testError.code) {
                            console.error(`   - Error code: ${testError.code}`);
                        }

                        if (attempt < 5) {
                            const delay = attempt * 5000; // 5s, 10s, 15s, 20s
                            console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        } else {
                            console.error("❌ Failed to connect after 5 attempts");
                        }
                    }
                }

                // 连接失败
                console.error(`❌ FATAL: Failed to initialize Binance: ${baseURL}`);
                throw new Error(`Failed to connect to Binance. Last error: ${lastErr?.message || lastErr}`);
            } catch (clientError: any) {
                lastErr = clientError;
                console.error(`❌ Failed to create client for ${baseURL}:`, clientError.message);
                throw new Error(`Failed to connect to Binance. Last error: ${lastErr?.message || lastErr}`);
            }
        })();
    }
    return initializationPromise;
}

// 导出类型以便其他文件使用
export type BinanceClient = UMFutures;

/**
 * 导出的同步函数 - 在每次交易前调用
 */
export async function ensureTimeSync(): Promise<void> {
    const client = await getBinanceInstance();    
    await syncServerTime(client);
}


// export async function ensureTimeSync(): Promise<void> {
//     try {
//         const client = await getBinanceInstance();
        
//         // 方法1: 使用 time() 方法获取服务器时间
//         let serverTime: number;
//         try {
//             // 尝试调用 time() 方法
//             const timeResponse = await (client as any).time();
//             serverTime = timeResponse.serverTime;
//         } catch (e) {
//             // 方法2: 备用方案 - 直接调用REST API
//             console.log('🕐 Using fallback time sync method...');
//             const tradingMode = process.env.TRADING_MODE || "dry-run";
//             const isDryRun = tradingMode === "dry-run";
//             const baseUrl = getBinanceBaseUrl().replace(/\/$/, '');
            
//             const timeUrl = `${baseUrl}/fapi/v1/time`;
//             const response = await fetch(timeUrl);
//             const data = await response.json();
//             serverTime = data.serverTime;
//         }

//         const localTime = Date.now();
//         const timeDiff = localTime - serverTime;
        
//         console.log(`⏰ Time sync - Local: ${new Date(localTime).toISOString()}, Diff: ${timeDiff}ms`);
        
//         // 如果时间差超过安全阈值，进行处理
//         if (Math.abs(timeDiff) > 500) {
//             console.warn(`⚠️ Time difference ${timeDiff}ms exceeds safe threshold`);
            
//             // 对于本地时间过快的情况，添加延迟
//             if (timeDiff > 0) {
//                 const delayTime = Math.min(timeDiff, 1000);
//                 console.log(`⏳ Delaying request by ${delayTime}ms to sync with server time`);
//                 await new Promise(resolve => setTimeout(resolve, delayTime));
//             }
//         } else {
//             console.log(`✅ Time sync within safe range: ${timeDiff}ms`);
//         }
        
//     } catch (error: any) {
//         console.warn('⚠️ Time sync failed, proceeding with local time:', error.message);
//     }
// }

/**
 * 获取调整后的时间戳
 */
export function getAdjustedTimestamp(): number {
    return Math.floor(Date.now() + serverTimeOffset);
}
