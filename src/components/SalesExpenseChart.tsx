import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type TrendRow = {
  month: string;
  sales: number;
  expenses: number;
};

export default function SalesExpenseChart({
  data,
  formatMoney,
}: {
  data: TrendRow[];
  formatMoney: (value: number) => string;
}) {
  return (
    <div
      className="dashboard-chart"
      role="img"
      aria-label="Bar chart comparing completed sales value and recorded expenses over the past twelve months"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 12, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="rgba(198, 211, 226, 0.12)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: '#c6d3e2', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(198, 211, 226, 0.2)' }}
          />
          <YAxis
            width={72}
            tick={{ fill: '#c6d3e2', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => Number(value).toLocaleString()}
          />
          <Tooltip
            formatter={(value, name) => [formatMoney(Number(value ?? 0)), name]}
            contentStyle={{ background: '#0b1829', border: '1px solid rgba(148, 183, 217, 0.3)', borderRadius: 12 }}
            labelStyle={{ color: '#f3f7fc' }}
          />
          <Legend wrapperStyle={{ color: '#c6d3e2', fontSize: 12 }} />
          <Bar dataKey="sales" name="Completed sale value" fill="#d9b86c" radius={[5, 5, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expenses" name="Recorded expenses" fill="#75b9dc" radius={[5, 5, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
