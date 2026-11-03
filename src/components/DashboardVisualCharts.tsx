import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type DashboardChartPoint = {
  key: string;
  label: string;
  revenue: number;
  units: number;
  cash: number;
  vehicleExpenses: number;
  showroomExpenses: number;
  partnerFunding: number;
  investorFunding: number;
  investorContributions: number;
  investorAllocations: number;
  investorPaid: number;
};

export type InventoryChartSlice = { name: string; value: number; color: string };

function money(value: unknown): string {
  return `PKR ${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function DashboardVisualCharts({
  data,
  inventory,
  role,
  periodLabel,
  showCapitalActivity = true,
}: {
  data: DashboardChartPoint[];
  inventory: InventoryChartSlice[];
  role: 'super_admin' | 'partner' | 'investor';
  periodLabel: string;
  showCapitalActivity?: boolean;
}) {
  const inventoryTotal = inventory.reduce((sum, item) => sum + item.value, 0);
  const expenseTotal = data.reduce((sum, item) => sum + item.vehicleExpenses + item.showroomExpenses, 0);
  const fundingTotal = role === 'investor'
    ? data.reduce((sum, item) => sum + item.investorContributions, 0)
    : data.reduce((sum, item) => sum + item.partnerFunding + item.investorFunding, 0);
  const capitalActivityExists = data.some((item) => role === 'investor'
    ? item.investorContributions + item.investorAllocations + item.investorPaid > 0
    : item.partnerFunding + item.investorFunding > 0);
  const contributionsExist = data.some((item) => role === 'investor'
    ? item.investorContributions > 0
    : item.partnerFunding + item.investorFunding > 0);

  return (
    <div className="dashboard-visual-grid">
      {role !== 'investor' && (
        <section className="glass-panel dashboard-visual-card">
          <div className="dashboard-visual-heading">
            <div><p className="eyebrow">Operating costs</p><h3>Expense trends</h3></div>
            <strong>{money(expenseTotal)}</strong>
          </div>
          <p className="muted">Recorded vehicle and showroom expenses by date · {periodLabel}. Expenses are not netted against sales.</p>
          {expenseTotal === 0 ? <p className="dashboard-visual-empty">No recorded expenses in this period.</p> : (
            <div className="dashboard-visual-chart" role="img" aria-label={`Stacked bar chart of vehicle and showroom expenses, ${periodLabel}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 12, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(198, 211, 226, 0.1)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#c6d3e2', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(217, 184, 108, 0.2)' }} minTickGap={20} />
                  <YAxis width={72} tick={{ fill: '#c6d3e2', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toLocaleString()} />
                  <Tooltip formatter={(value, name) => [money(value), name]} contentStyle={{ background: '#202127', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} labelStyle={{ color: '#f5f5f7' }} />
                  <Legend wrapperStyle={{ color: '#c4c6cc', fontSize: 11 }} />
                  <Bar dataKey="vehicleExpenses" name="Vehicle expenses" stackId="expenses" fill="#a855f7" radius={[0, 0, 0, 0]} maxBarSize={28} isAnimationActive />
                  <Bar dataKey="showroomExpenses" name="Showroom expenses" stackId="expenses" fill="#258bff" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}

      <section className="glass-panel dashboard-visual-card">
        <div className="dashboard-visual-heading">
          <div><p className="eyebrow">Current snapshot</p><h3>{role === 'investor' ? 'Your vehicle portfolio' : 'Inventory mix'}</h3></div>
          <strong>{inventoryTotal} vehicles</strong>
        </div>
        <p className="muted">{role === 'investor' ? 'Unsold vehicles linked to your recorded funding, by current status.' : 'Unsold showroom vehicles by current status.'} Historical status changes are not stored.</p>
        {inventoryTotal === 0 ? <p className="dashboard-visual-empty">No unsold showroom vehicles recorded.</p> : (
          <div className="dashboard-inventory-chart">
            <div className="dashboard-donut" role="img" aria-label={`${inventoryTotal} unsold vehicles by current status`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={inventory} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="88%" paddingAngle={3} stroke="none" isAnimationActive>
                    {inventory.map((item) => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${Number(value)} vehicles`, name]} contentStyle={{ background: '#202127', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} />
                  <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="#f3e5bd" fontSize="27" fontWeight="700">{inventoryTotal}</text>
                  <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" fill="#aab9ca" fontSize="11">vehicles</text>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="dashboard-donut-legend">
              {inventory.map((item) => <div key={item.name}><span><i style={{ backgroundColor: item.color }} />{item.name}</span><strong>{item.value}</strong></div>)}
            </div>
          </div>
        )}
      </section>

      {showCapitalActivity && <section className="glass-panel dashboard-visual-card dashboard-visual-wide">
        <div className="dashboard-visual-heading">
          <div><p className="eyebrow">{role === 'investor' ? 'Your account only' : 'Recorded capital activity'}</p><h3>{role === 'investor' ? 'Your investment activity' : 'Funding contributions'}</h3></div>
          <strong>{contributionsExist ? money(fundingTotal) : 'No contributions'}</strong>
        </div>
        <p className="muted">{role === 'investor'
          ? `Your recorded contributions, approved allocations, and payments · ${periodLabel}. This is not sales revenue or a cash balance.`
          : `Partner and investor contributions shown separately · ${periodLabel}. Contributions are capital, not sales revenue or profit.`}</p>
        {!capitalActivityExists ? <p className="dashboard-visual-empty">No recorded capital activity in this period.</p> : (
          <div className="dashboard-visual-chart dashboard-capital-chart" role="img" aria-label={role === 'investor' ? 'Area chart of your contributions, approved allocations, and payments' : 'Area chart comparing partner and investor contributions'}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 12, right: 14, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="rgba(198, 211, 226, 0.1)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#c6d3e2', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(217, 184, 108, 0.2)' }} minTickGap={20} />
                <YAxis width={76} tick={{ fill: '#c6d3e2', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toLocaleString()} />
                <Tooltip formatter={(value, name) => [money(value), name]} contentStyle={{ background: '#202127', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} labelStyle={{ color: '#f5f5f7' }} />
                <Legend wrapperStyle={{ color: '#c4c6cc', fontSize: 11 }} />
                {role === 'investor' ? <>
                  <Area type="monotone" dataKey="investorContributions" name="Your contributions" stroke="#a855f7" fill="rgba(168, 85, 247, 0.2)" strokeWidth={2.5} isAnimationActive />
                  <Area type="monotone" dataKey="investorAllocations" name="Approved allocations" stroke="#258bff" fill="rgba(37, 139, 255, 0.14)" strokeWidth={2} isAnimationActive />
                  <Area type="monotone" dataKey="investorPaid" name="Profit paid" stroke="#4cc89a" fill="rgba(76, 200, 154, 0.1)" strokeWidth={2} isAnimationActive />
                </> : <>
                  <Area type="monotone" dataKey="partnerFunding" name="Partner contributions" stroke="#a855f7" fill="rgba(168, 85, 247, 0.2)" strokeWidth={2.5} isAnimationActive />
                  <Area type="monotone" dataKey="investorFunding" name="Investor contributions" stroke="#258bff" fill="rgba(37, 139, 255, 0.14)" strokeWidth={2} isAnimationActive />
                </>}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>}
    </div>
  );
}
