"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts"

interface CostData {
  month: string;
  storage: number;
  requests: number;
  transfer: number;
  total: number;
}

interface CostChartProps {
  data: CostData[];
}

export function CostChart({ data }: CostChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient
            id="colorStorage"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="5%"
              stopColor="var(--color-chart-1)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="var(--color-chart-1)"
              stopOpacity={0}
            />
          </linearGradient>
          <linearGradient
            id="colorRequests"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="5%"
              stopColor="var(--color-chart-2)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="var(--color-chart-2)"
              stopOpacity={0}
            />
          </linearGradient>
          <linearGradient
            id="colorTransfer"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="5%"
              stopColor="var(--color-chart-5)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="var(--color-chart-5)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          vertical={false}
        />
        <XAxis
          dataKey="month"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          stroke="var(--color-muted-foreground)"
        />
        <YAxis
          fontSize={12}
          tickLine={false}
          axisLine={false}
          stroke="var(--color-muted-foreground)"
          tickFormatter={(value) => `$${value}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-popover-foreground)",
            fontSize: 12,
          }}
          formatter={(value: number, name: string) => [
            `$${value}`,
            name.charAt(0).toUpperCase() + name.slice(1),
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value: string) =>
            value.charAt(0).toUpperCase() + value.slice(1)
          }
        />
        <Area
          type="monotone"
          dataKey="storage"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#colorStorage)"
        />
        <Area
          type="monotone"
          dataKey="requests"
          stroke="var(--color-chart-2)"
          strokeWidth={2}
          fill="url(#colorRequests)"
        />
        <Area
          type="monotone"
          dataKey="transfer"
          stroke="var(--color-chart-5)"
          strokeWidth={2}
          fill="url(#colorTransfer)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
