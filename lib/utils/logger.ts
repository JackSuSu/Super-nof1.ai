// ...existing code...
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import util from "util";

const DEFAULT_LOG_DIR = "logs";
const DEFAULT_LEVEL = "info";
const DEFAULT_RETENTION_DAYS = 30;

const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.cwd(), process.env.LOG_DIR)
  : path.resolve(process.cwd(), DEFAULT_LOG_DIR);

const LOG_LEVEL = (process.env.LOG_LEVEL || DEFAULT_LEVEL).toLowerCase();
const RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10) || DEFAULT_RETENTION_DAYS;

const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  log: 1,
};

function pad(n: number, width = 2) {
  return String(n).padStart(width, "0");
}

function formatDateTime(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function ensureLogDir() {
  try {
    await fsPromises.mkdir(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function cleanupOldLogs(retentionDays: number) {
  try {
    await ensureLogDir();
    const files = await fsPromises.readdir(LOG_DIR);
    const now = Date.now();
    const keepMs = retentionDays * 24 * 60 * 60 * 1000;
    await Promise.all(
      files.map(async (f) => {
        try {
          if (!f.endsWith(".log")) return;
          // Expect filename like YYYY-MM-DD.log
          const name = path.basename(f, ".log");
          const parts = name.split("-");
          if (parts.length !== 3) return;
          const year = Number(parts[0]);
          const month = Number(parts[1]) - 1;
          const day = Number(parts[2]);
          if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return;
          const fileDate = new Date(year, month, day).getTime();
          if (now - fileDate > keepMs) {
            await fsPromises.unlink(path.join(LOG_DIR, f)).catch(() => {});
          }
        } catch {
          // ignore per-file errors
        }
      })
    );
  } catch {
    // ignore cleanup errors
  }
}

// run cleanup asynchronously but don't block init
cleanupOldLogs(RETENTION_DAYS).catch(() => {});

async function writeLine(level: string, msg: string) {
  try {
    if (LEVELS[level] < (LEVELS[LOG_LEVEL] ?? LEVELS[DEFAULT_LEVEL])) return;
    await ensureLogDir();
    const now = new Date();
    const line = `[${formatDateTime(now)}] [${level.toUpperCase()}] ${msg}\n`;
    const file = path.join(LOG_DIR, `${formatDate(now)}.log`);
    fsPromises.appendFile(file, line).catch(() => {});
  } catch {
    // ignore file errors to avoid crashing app
  }
}

function formatArgsToString(args: any[]) {
  if (!args || !args.length) return "";
  try {
    return util.format.apply(null, args as any);
  } catch {
    try {
      return args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    } catch {
      return String(args);
    }
  }
}

export const logger = {
  info: (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["info"] ?? 1) < (LEVELS[LOG_LEVEL] ?? 1)) return;
    console.info(`[${formatDateTime(new Date())}]`, ...args);
    writeLine("info", msg);
  },
  warn: (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["warn"] ?? 2) < (LEVELS[LOG_LEVEL] ?? 1)) return;
    console.warn(`[${formatDateTime(new Date())}]`, ...args);
    writeLine("warn", msg);
  },
  error: (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["error"] ?? 3) < (LEVELS[LOG_LEVEL] ?? 1)) return;
    console.error(`[${formatDateTime(new Date())}]`, ...args);
    writeLine("error", msg);
  },
  debug: (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["debug"] ?? 0) < (LEVELS[LOG_LEVEL] ?? 1)) return;
    console.debug(`[${formatDateTime(new Date())}]`, ...args);
    writeLine("debug", msg);
  },
  rawWrite: (level: string, ...args: any[]) => {
    const msg = formatArgsToString(args);
    writeLine(level, msg);
  },
};

// 自动替换全局 console 方法（只需在应用入口 import 一次）
(function patchConsole() {
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origDebug = console.debug ? console.debug.bind(console) : origInfo;

  console.log = (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["log"] ?? 1) >= (LEVELS[LOG_LEVEL] ?? 1)) {
      origLog(`[${formatDateTime(new Date())}]`, ...args);
      writeLine("log", msg);
    }
  };
  console.info = (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["info"] ?? 1) >= (LEVELS[LOG_LEVEL] ?? 1)) {
      origInfo(`[${formatDateTime(new Date())}]`, ...args);
      writeLine("info", msg);
    }
  };
  console.warn = (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["warn"] ?? 2) >= (LEVELS[LOG_LEVEL] ?? 1)) {
      origWarn(`[${formatDateTime(new Date())}]`, ...args);
      writeLine("warn", msg);
    }
  };
  console.error = (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["error"] ?? 3) >= (LEVELS[LOG_LEVEL] ?? 1)) {
      origError(`[${formatDateTime(new Date())}]`, ...args);
      writeLine("error", msg);
    }
  };
  console.debug = (...args: any[]) => {
    const msg = formatArgsToString(args);
    if ((LEVELS["debug"] ?? 0) >= (LEVELS[LOG_LEVEL] ?? 1)) {
      origDebug(`[${formatDateTime(new Date())}]`, ...args);
      writeLine("debug", msg);
    }
  };
})();