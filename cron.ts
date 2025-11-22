import cron from "node-cron";
import jwt from "jsonwebtoken";

const runMetricsInterval = async () => {
  const token = jwt.sign(
    {
      sub: "cron-token",
    },
    process.env.CRON_SECRET_KEY || ""
  );

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_URL}/api/cron/20-seconds-metrics-interval?token=${token}`,
      {
        method: "GET",
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[cron:metrics] Failed (${response.status}): ${errorText}`
      );
    }
  } catch (error) {
    console.error("[cron:metrics] Error:", error);
  }
};

// every 30 seconds
cron.schedule("*/30 * * * * *", async () => {
  await runMetricsInterval();
});

// 🔒 添加锁机制，防止并发执行
let isRunningChat = false;

const runChatInterval = async () => {
  // 如果已经在运行中，跳过本次执行
  if (isRunningChat) {
    console.log("⏭️ Trading analysis already running, skipping...");
    return;
  }

  isRunningChat = true;
  console.log("🤖 Trading analysis starting...");
  const token = jwt.sign(
    {
      sub: "cron-token",
    },
    process.env.CRON_SECRET_KEY || ""
  );

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_URL}/api/cron/3-minutes-run-interval?token=${token}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(900000), // 15分钟超时
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[cron:chat] Failed (${response.status}): ${errorText}`
      );
    } else {
      console.log("✅ Trading analysis completed");
    }
  } catch (error) {
    console.error("[cron:chat] Error:", error);
  } finally {
    // 无论成功还是失败，都要释放锁
    isRunningChat = false;
  }
};

// every 3 minutes - optimized for active trading
cron.schedule("*/3 * * * *", async () => {
  // await runChatInterval();
});

await runChatInterval();
