"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis, ReferenceLine, Area, ComposedChart } from "recharts";
import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { MetricData } from "@/lib/types/metrics";
import { ArcticonsDeepseek } from "@/lib/icons";

// 扩展的度量数据，包含处理后的字段
interface ProcessedMetricData extends MetricData {
  id: string;
  displayTime: number;
  originalIndex: number;
}

interface MetricsChartProps {
  metricsData: MetricData[];
  loading: boolean;
  lastUpdate: string;
  totalCount?: number;
}

const chartConfig = {
  totalCashValue: {
    label: "Portfolio Value",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

// 现代化配色方案
const THEME_COLORS = {
  primary: "hsl(217, 91%, 60%)", // 优雅的蓝色
  primaryGlow: "hsl(217, 91%, 60%, 0.15)",
  success: "hsl(142, 76%, 36%)", // 清新的绿色
  danger: "hsl(0, 84%, 60%)", // 醒目的红色
  accent: "hsl(270, 95%, 75%)", // 紫色点缀
  gradient: {
    from: "hsl(217, 91%, 60%, 0.4)",
    to: "hsl(217, 91%, 60%, 0.02)",
  },
};

// 自定义最后一个点的渲染（带动画）
interface CustomDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ProcessedMetricData;
  dataLength: number;
}

const CustomDot = (props: CustomDotProps) => {
  const { cx, cy, index, payload, dataLength } = props;

  // 只在最后一个点显示实时标记
  if (!payload || !cx || !cy || index !== dataLength - 1) {
    return null;
  }

  const price = payload.totalCashValue;
  const priceText = `$${price?.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return (
    <g>
      {/* 外层脉动光环 */}
      <circle
        cx={cx}
        cy={cy}
        r={16}
        fill={THEME_COLORS.primaryGlow}
        className="animate-ping"
        style={{ animationDuration: '2s' }}
      />
      {/* 中层光晕 */}
      <circle
        cx={cx}
        cy={cy}
        r={10}
        fill={THEME_COLORS.primary}
        opacity={0.3}
      />
      {/* 核心点 */}
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={THEME_COLORS.primary}
        stroke="white"
        strokeWidth={2}
        filter="drop-shadow(0 2px 4px rgba(0,0,0,0.2))"
      />

      {/* 实时价格标签 */}
      <foreignObject x={cx + 18} y={cy - 28} width={200} height={56}>
        <div className="flex items-center gap-2.5 bg-gradient-to-br from-background/95 to-background/90 backdrop-blur-xl border border-border/50 rounded-xl px-3.5 py-2.5 shadow-2xl">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
            <ArcticonsDeepseek className="w-5 h-5 text-white drop-shadow" />
          </div>
          <div className="flex flex-col">
            <div className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
              Live • DeepSeek
            </div>
            <div className="text-sm font-bold font-mono whitespace-nowrap bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
              {priceText}
            </div>
          </div>
        </div>
      </foreignObject>
    </g>
  );
};

export function MetricsChart({
  metricsData,
  loading,
  totalCount,
}: MetricsChartProps) {
  // 🔧 修复 Hydration 错误: 只在客户端渲染图表
  const [isClient, setIsClient] = useState(false);
  const [timeRange, setTimeRange] = useState<"1H" | "ALL">("ALL");

  // 🆕 滑动窗口状态
  const [windowSize, setWindowSize] = useState(100); // 默认显示100个数据点
  const [windowEnd, setWindowEnd] = useState<number | null>(null); // null = 显示最新数据

  // 🆕 鼠标拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number>(0);
  const [scrollOffset, setScrollOffset] = useState<number>(0);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // 处理图表数据，使用实际的数据时间，确保时间轴实时更新到当前时间
  const processedData = metricsData.map((item, index) => {
    const dataTime = new Date(item.createdAt);

    return {
      ...item,
      id: `${dataTime.getTime()}-${index}`, // 唯一ID
      createdAt: dataTime.toISOString(),
      displayTime: dataTime.getTime(), // 用于X轴的数值，使用实际时间
      originalIndex: index, // 保留原始索引
    };
  });

  // 去重处理，确保没有重复的时间戳
  const uniqueData = processedData.reduce((acc, current) => {
    const existingIndex = acc.findIndex(item => Math.abs(item.displayTime - current.displayTime) < 1000); // 1秒内的认为是重复
    if (existingIndex === -1) {
      acc.push(current);
    } else {
      // 如果有重复，保留最新的数据
      acc[existingIndex] = current;
    }
    return acc;
  }, [] as typeof processedData);

  // 按时间排序
  uniqueData.sort((a, b) => a.displayTime - b.displayTime);

  // 🆕 滑动窗口数据切片
  const windowedData = useMemo(() => {
    if (uniqueData.length === 0) return [];

    // 🔧 修复：ALL模式显示所有数据
    if (timeRange === "ALL") {
      return uniqueData;
    }

    // 1H模式使用窗口
    const endIndex = windowEnd === null ? uniqueData.length : windowEnd;
    const startIndex = Math.max(0, endIndex - windowSize);

    return uniqueData.slice(startIndex, endIndex);
  }, [uniqueData, windowEnd, windowSize, timeRange]);  // 🆕 鼠标拖拽处理函数
  const handleMouseDown = (e: React.MouseEvent) => {
    if (timeRange === "ALL") return; // ALL模式下不允许拖拽
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || timeRange === "ALL") return;

    const delta = e.clientX - dragStart;
    const sensitivity = 0.5; // 调整拖拽灵敏度
    const scrollDelta = Math.floor(delta * sensitivity);

    if (Math.abs(scrollDelta) > 0) {
      const currentEnd = windowEnd === null ? uniqueData.length : windowEnd;
      const newEnd = currentEnd - scrollDelta;

      // 限制在有效范围内
      if (newEnd >= windowSize && newEnd <= uniqueData.length) {
        setWindowEnd(newEnd === uniqueData.length ? null : newEnd);
        setDragStart(e.clientX);
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // 🆕 触摸事件处理（移动端支持）
  const handleTouchStart = (e: React.TouchEvent) => {
    if (timeRange === "ALL") return;
    setIsDragging(true);
    setDragStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || timeRange === "ALL") return;

    const delta = e.touches[0].clientX - dragStart;
    const sensitivity = 0.5;
    const scrollDelta = Math.floor(delta * sensitivity);

    if (Math.abs(scrollDelta) > 0) {
      const currentEnd = windowEnd === null ? uniqueData.length : windowEnd;
      const newEnd = currentEnd - scrollDelta;

      if (newEnd >= windowSize && newEnd <= uniqueData.length) {
        setWindowEnd(newEnd === uniqueData.length ? null : newEnd);
        setDragStart(e.touches[0].clientX);
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // 🆕 时间范围过滤 - 基于窗口数据的最后一个点往回算
  const filteredData = useMemo(() => {
    if (timeRange === "ALL" || windowedData.length === 0) return windowedData;

    // 🔧 1H模式：从窗口数据的最后一个点往前推1小时
    const referenceTime = windowedData[windowedData.length - 1].displayTime;
    const oneHourInMs = 60 * 60 * 1000;
    const cutoffTime = referenceTime - oneHourInMs;

    return windowedData.filter(d => d.displayTime >= cutoffTime);
  }, [windowedData, timeRange]);

  // 🆕 计算关键统计指标（基于过滤后的数据）
  const stats = useMemo(() => {
    if (filteredData.length === 0) return null;

    const values = filteredData.map(d => d.totalCashValue);

    const initialValue = values[0];
    const currentValue = values[values.length - 1];

    // 🔧 修复：Total Return 计算
    const totalReturn = initialValue > 0 ? ((currentValue - initialValue) / initialValue) * 100 : 0;

    // 🔧 修复：Max Drawdown 计算
    // 需要找到期间内的最高点，然后计算从最高点到最低点的跌幅
    let maxDrawdown = 0;
    let runningMax = values[0];

    for (let i = 1; i < values.length; i++) {
      if (values[i] > runningMax) {
        runningMax = values[i];
      }
      const drawdown = runningMax > 0 ? ((values[i] - runningMax) / runningMax) * 100 : 0;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // 🔧 修复：Sharpe Ratio 计算
    // 计算每个数据点相对于前一个点的收益率
    const returns: number[] = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] > 0) {
        const returnRate = ((values[i] - values[i - 1]) / values[i - 1]) * 100;
        returns.push(returnRate);
      }
    }

    let sharpeRatio = 0;
    if (returns.length > 1) {
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);

      // Sharpe Ratio = (平均收益率 - 无风险利率) / 收益率标准差
      // 假设无风险利率为0，并年化（假设每10秒一个数据点，一年约3,153,600个点）
      // 简化版本：只计算当前时间窗口的风险调整收益
      if (stdDev > 0) {
        sharpeRatio = avgReturn / stdDev;
      }
    }

    return {
      initialValue,
      currentValue,
      totalReturn,
      maxDrawdown,
      sharpeRatio,
      dataPoints: filteredData.length,
    };
  }, [filteredData]);

  // 🆕 固定 Y 轴范围（基于窗口数据，不随时间过滤变化）
  const yAxisDomain = useMemo(() => {
    if (windowedData.length === 0) return [0, 100];

    const allValues = windowedData.map(d => d.totalCashValue);
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);

    // 添加 1% 的上下边距
    return [
      Math.floor(minValue * 0.99),
      Math.ceil(maxValue * 1.01)
    ];
  }, [windowedData]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-[500px]">
          <div className="text-lg">Loading metrics...</div>
        </CardContent>
      </Card>
    );
  }

  // 服务器端渲染时显示占位符
  if (!isClient) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Total Account Value</CardTitle>
              <CardDescription className="text-xs">
                Real-time tracking • Updates every 10s
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:px-4 pb-4">
          <div className="h-[400px] flex items-center justify-center text-muted-foreground">
            Loading chart...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full border-0 shadow-xl bg-gradient-to-br from-background via-background to-muted/20">
      <CardHeader className="pb-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-1 h-8 bg-gradient-to-b from-blue-500 to-indigo-600 rounded-full" />
              <CardTitle className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
                Portfolio Performance
              </CardTitle>
            </div>
            <CardDescription className="text-sm flex items-center gap-2 ml-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="font-medium">Live</span>
              </span>
              <span className="text-muted-foreground">• Refresh 10s</span>
              {timeRange === "1H" && (
                <span className="text-muted-foreground/80 ml-2">
                  • �️ Drag to navigate
                </span>
              )}
            </CardDescription>
          </div>

          {/* 精致的时间范围选择器 */}
          <div className="flex gap-1.5 bg-muted/50 backdrop-blur-sm rounded-xl p-1.5 border border-border/50">
            {(["ALL", "1H"] as const).map((range) => (
              <button
                key={range}
                onClick={() => {
                  setTimeRange(range);
                  if (range === "ALL") {
                    setWindowEnd(null);
                  }
                }}
                className={`relative px-5 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${timeRange === range
                  ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30"
                  : "hover:bg-background/80 text-muted-foreground hover:text-foreground"
                  }`}
              >
                {range}
                {timeRange === range && (
                  <span className="absolute inset-0 rounded-lg bg-white/20 animate-pulse" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 精美的统计指标面板 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3  pt-6 border-t border-border/50">
            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/10 via-background to-background p-4 hover:shadow-lg transition-all duration-300 border border-blue-500/20">
              <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-colors" />
              <div className="relative space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span className="text-[10px] font-bold text-muted-foreground/90 uppercase tracking-widest">Value</span>
                </div>
                <span className="text-2xl font-black font-mono block bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">
                  ${stats.currentValue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-500/10 via-background to-background p-4 hover:shadow-lg transition-all duration-300 border border-green-500/20">
              <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/10 rounded-full blur-2xl group-hover:bg-green-500/20 transition-colors" />
              <div className="relative space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-[10px] font-bold text-muted-foreground/90 uppercase tracking-widest">Return</span>
                </div>
                <span className={`text-2xl font-black font-mono block ${stats.totalReturn >= 0
                  ? "bg-gradient-to-br from-green-500 to-emerald-600 bg-clip-text text-transparent"
                  : "bg-gradient-to-br from-red-500 to-rose-600 bg-clip-text text-transparent"
                  }`}>
                  {stats.totalReturn >= 0 ? "+" : ""}{stats.totalReturn.toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-500/10 via-background to-background p-4 hover:shadow-lg transition-all duration-300 border border-red-500/20">
              <div className="absolute top-0 right-0 w-20 h-20 bg-red-500/10 rounded-full blur-2xl group-hover:bg-red-500/20 transition-colors" />
              <div className="relative space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span className="text-[10px] font-bold text-muted-foreground/90 uppercase tracking-widest">Drawdown</span>
                </div>
                <span className="text-2xl font-black font-mono block bg-gradient-to-br from-red-500 to-rose-600 bg-clip-text text-transparent">
                  {stats.maxDrawdown.toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-500/10 via-background to-background p-4 hover:shadow-lg transition-all duration-300 border border-purple-500/20">
              <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-colors" />
              <div className="relative space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  <span className="text-[10px] font-bold text-muted-foreground/90 uppercase tracking-widest">Sharpe</span>
                </div>
                <span className="text-2xl font-black font-mono block bg-gradient-to-br from-purple-500 to-violet-600 bg-clip-text text-transparent">
                  {stats.sharpeRatio.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/10 via-background to-background p-4 hover:shadow-lg transition-all duration-300 border border-amber-500/20">
              <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-colors" />
              <div className="relative space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[10px] font-bold text-muted-foreground/90 uppercase tracking-widest">Points</span>
                </div>
                <span className="text-2xl font-black font-mono block bg-gradient-to-br from-amber-500 to-orange-600 bg-clip-text text-transparent">
                  {stats.dataPoints.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="px-2 sm:px-4 pb-4">
        {filteredData.length > 0 ? (
          <div
            className={`relative ${timeRange === "1H" && !isDragging ? "cursor-grab" : ""
              } ${isDragging ? "cursor-grabbing select-none" : ""}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* 优雅的拖拽提示 */}
            {timeRange === "1H" && !isDragging && windowEnd !== null && (
              <div className="absolute top-4 right-4 z-10 bg-gradient-to-r from-background/95 to-background/90 backdrop-blur-xl border border-border/50 rounded-xl px-4 py-2.5 shadow-2xl">
                <div className="text-xs font-semibold flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Drag to explore
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-600 dark:text-blue-400 font-mono text-[10px]">
                    -{uniqueData.length - (windowEnd || uniqueData.length)} pts
                  </span>
                </div>
              </div>
            )}

            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[450px] w-full"
            >
              <ComposedChart
                accessibilityLayer
                data={filteredData}
                margin={{
                  left: 8,
                  right: 8,
                  top: 8,
                  bottom: 8,
                }}
              >
                {/* 精致渐变定义 */}
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={THEME_COLORS.gradient.from} />
                    <stop offset="100%" stopColor={THEME_COLORS.gradient.to} />
                  </linearGradient>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="hsl(217, 91%, 60%)" />
                    <stop offset="50%" stopColor="hsl(250, 95%, 70%)" />
                    <stop offset="100%" stopColor="hsl(217, 91%, 60%)" />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  vertical={false}
                  strokeDasharray="4 4"
                  opacity={0.15}
                  stroke="hsl(var(--muted-foreground))"
                />

                {/* 优雅的初始资金参考线 */}
                {stats && (
                  <ReferenceLine
                    y={stats.initialValue}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="6 4"
                    strokeWidth={1.5}
                    opacity={0.5}
                    label={{
                      value: `Initial • $${stats.initialValue.toFixed(0)}`,
                      position: "insideTopRight",
                      fontSize: 11,
                      fontWeight: 600,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                  />
                )}

                <XAxis
                  dataKey="displayTime"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={80}
                  tick={{ fontSize: 10 }}
                  domain={['dataMin', 'dataMax']}
                  type="number"
                  scale="time"
                  interval="preserveStartEnd"
                  tickCount={6}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    const now = new Date();
                    const isToday = date.toDateString() === now.toDateString();

                    if (isToday) {
                      // 今天的数据只显示时间
                      return date.toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                    } else {
                      // 其他日期显示月/日 时:分
                      return date.toLocaleString("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                    }
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={85}
                  tick={{ fontSize: 10 }}
                  domain={yAxisDomain}
                  tickCount={6}
                  interval="preserveStartEnd"
                  tickFormatter={(value) => {
                    if (value >= 1000) {
                      return `$${(value / 1000).toFixed(1)}k`;
                    } else if (value >= 100) {
                      return `$${value.toFixed(0)}`;
                    } else if (value >= 10) {
                      return `$${value.toFixed(1)}`;
                    } else {
                      return `$${value.toFixed(2)}`;
                    }
                  }}
                />

                {/* 精美的提示框 */}
                <ChartTooltip
                  cursor={{
                    stroke: THEME_COLORS.primary,
                    strokeWidth: 2,
                    strokeDasharray: "6 4",
                    opacity: 0.3
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) {
                      return null;
                    }

                    const data = payload[0].payload as ProcessedMetricData;
                    const date = new Date(data.createdAt);

                    const initialValue = filteredData[0]?.totalCashValue || data.totalCashValue;
                    const currentValue = data.totalCashValue;
                    const relativeReturn = initialValue > 0
                      ? ((currentValue - initialValue) / initialValue) * 100
                      : 0;

                    return (
                      <div className="rounded-2xl border border-border/50 bg-gradient-to-br from-background/98 to-background/95 backdrop-blur-xl p-4 shadow-2xl min-w-[280px]">
                        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border/50">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                            <ArcticonsDeepseek className="w-6 h-6 text-white drop-shadow" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-foreground">DeepSeek R1</div>
                            <div className="text-[10px] text-muted-foreground font-medium">
                              {date.toLocaleString("zh-CN", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-6">
                            <span className="text-xs font-semibold text-muted-foreground">Portfolio</span>
                            <span className="text-sm font-black font-mono bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                              ${data.totalCashValue?.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-6">
                            <span className="text-xs font-semibold text-muted-foreground">Change</span>
                            <span
                              className={`text-sm font-black font-mono ${relativeReturn >= 0
                                  ? "bg-gradient-to-r from-green-500 to-emerald-600 bg-clip-text text-transparent"
                                  : "bg-gradient-to-r from-red-500 to-rose-600 bg-clip-text text-transparent"
                                }`}
                            >
                              {relativeReturn >= 0 ? "+" : ""}{relativeReturn.toFixed(3)}%
                            </span>
                          </div>
                          {data.sharpeRatio !== null && data.sharpeRatio !== 0 && (
                            <div className="flex items-center justify-between gap-6">
                              <span className="text-xs font-semibold text-muted-foreground">Sharpe</span>
                              <span className="text-sm font-black font-mono bg-gradient-to-r from-purple-500 to-violet-600 bg-clip-text text-transparent">
                                {data.sharpeRatio.toFixed(2)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-6 pt-2 border-t border-border/30">
                            <span className="text-xs font-semibold text-muted-foreground">Positions</span>
                            <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-bold">
                              {data.positions?.length || 0}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />

                {/* 🆕 渐变填充区域 */}
                <Area
                  type="monotone"
                  dataKey="totalCashValue"
                  fill="url(#colorValue)"
                  stroke="none"
                />

                {/* 优雅的主线条 */}
                <Line
                  dataKey="totalCashValue"
                  type="monotone"
                  stroke="url(#lineGradient)"
                  strokeWidth={3}
                  dot={(props) => {
                    const anyProps = props as any;
                    const { key: elementKey, payload, index, ...rest } = anyProps || {};
                    const uniqueKey = payload?.id || `dot-${index}-${Date.now()}`;
                    return (
                      <CustomDot
                        key={uniqueKey}
                        {...rest}
                        payload={payload}
                        index={index}
                        dataLength={filteredData.length}
                      />
                    );
                  }}
                  activeDot={{
                    r: 8,
                    fill: THEME_COLORS.primary,
                    stroke: "#fff",
                    strokeWidth: 3,
                    filter: "drop-shadow(0 4px 8px rgba(59, 130, 246, 0.4))",
                  }}
                />
              </ComposedChart>
            </ChartContainer>
          </div>
        ) : (
          <div className="h-[450px] flex items-center justify-center text-muted-foreground">
            No metrics data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
