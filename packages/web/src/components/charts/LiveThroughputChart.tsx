import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { useTheme } from '../../context/ThemeContext.js';

export interface ThroughputDataPoint {
  readonly time: string;
  readonly rps: number;
  readonly latencyMs: number;
}

interface LiveThroughputChartProps {
  data: ThroughputDataPoint[];
  height?: number;
  className?: string;
}

export const LiveThroughputChart: React.FC<LiveThroughputChartProps> = ({
  data,
  height = 240,
  className = '',
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const gridColor = isDark ? '#27272a' : '#e4e4e7';
  const textColor = isDark ? '#a1a1aa' : '#71717a';
  const tooltipBg = isDark ? '#18181b' : '#ffffff';
  const tooltipBorder = isDark ? '#27272a' : '#e4e4e7';

  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="time"
            stroke={textColor}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
          />
          {/* Left Axis: Throughput (Req/min) */}
          <YAxis
            yAxisId="left"
            stroke={textColor}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            unit=" req/min"
            domain={[0, 'auto']}
          />
          {/* Right Axis: Latency */}
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke={textColor}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            unit=" ms"
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
          />
          <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="rps"
            name="Throughput (Req/min)"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="latencyMs"
            name="Mean Latency (ms)"
            stroke="#f43f5e"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
