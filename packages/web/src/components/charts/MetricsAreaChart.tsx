import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useTheme } from '../../context/ThemeContext.js';

export interface MetricDataPoint {
  readonly time: string | number;
  readonly [key: string]: string | number;
}

export interface MetricSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly unit?: string;
}

interface MetricsAreaChartProps {
  data: MetricDataPoint[];
  series: MetricSeries[];
  height?: number;
  yAxisUnit?: string;
  className?: string;
}

export const MetricsAreaChart: React.FC<MetricsAreaChartProps> = ({
  data,
  series,
  height = 240,
  yAxisUnit = '%',
  className = '',
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const gridColor = isDark ? '#27272a' : '#e4e4e7';
  const textColor = isDark ? '#a1a1aa' : '#71717a';
  const tooltipBg = isDark ? '#18181b' : '#ffffff';
  const tooltipBorder = isDark ? '#27272a' : '#e4e4e7';

  if (!data || data.length === 0) {
    return (
      <div
        style={{ height }}
        className={`w-full flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/80 text-xs text-zinc-400 ${className}`}
      >
        No historical metric data recorded for selected range.
      </div>
    );
  }

  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`gradient-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0.0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="time"
            stroke={textColor}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
          />
          <YAxis
            stroke={textColor}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            unit={yAxisUnit}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              borderRadius: '8px',
              fontSize: '12px',
              color: isDark ? '#f4f4f5' : '#18181b',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            formatter={(val: any, name: string) => {
              const matched = series.find((s) => s.key === name || s.label === name);
              const unit = matched?.unit || yAxisUnit;
              const formattedVal = typeof val === 'number' ? val.toFixed(1) : val;
              return [`${formattedVal} ${unit}`, matched?.label || name];
            }}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#gradient-${s.key})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
