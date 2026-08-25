import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { useTheme } from '../../context/ThemeContext.js';

interface StatusDistributionDonutProps {
  online: number;
  stopped: number;
  errored: number;
  height?: number;
}

const COLORS: Record<string, string> = {
  Online: '#10b981',
  Stopped: '#71717a',
  Errored: '#f43f5e',
};

export const StatusDistributionDonut: React.FC<StatusDistributionDonutProps> = ({
  online,
  stopped,
  errored,
  height = 140,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const data = [
    { name: 'Online', value: online },
    { name: 'Stopped', value: stopped },
    { name: 'Errored', value: errored },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-zinc-400">
        No active processes
      </div>
    );
  }

  const tooltipBg = isDark ? '#18181b' : '#ffffff';
  const tooltipBorder = isDark ? '#27272a' : '#e4e4e7';

  return (
    <div style={{ height }} className="w-full relative flex items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            innerRadius={36}
            outerRadius={55}
            paddingAngle={3}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={`cell-${entry.name}`} fill={COLORS[entry.name] || '#a1a1aa'} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              borderRadius: '8px',
              fontSize: '12px',
              color: isDark ? '#f4f4f5' : '#18181b',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};
