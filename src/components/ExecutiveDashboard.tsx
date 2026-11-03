import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LucideIcon } from 'lucide-react';
import { CarFront, CircleDollarSign, CreditCard, HandCoins, PackageCheck, ReceiptText, TrendingUp, Wallet } from 'lucide-react';
import DashboardVisualCharts, { type DashboardChartPoint, type InventoryChartSlice } from './DashboardVisualCharts';
import { supabase } from '../lib/supabase';

type UserRole = 'pending' | 'super_admin' | 'partner' | 'investor';
type UserProfile = { full_name: string | null; role: UserRole; is_active: boolean };
type DateRangePreset = 'today' | 'this_week' | 'this_month' | 'previous_month' | 'last_3_months' | 'this_year' | 'all_time' | 'custom';
type DateBounds = { from?: string; to?: string };
type Vehicle = {
  id: string;
  business_category: string;
  make: string;
  model: string;
  manufacturing_year: number | null;
  registration_number: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  expected_sale_price: number | null;
  status: string;
};
type Sale = { id: string; vehicle_id: string; sale_date: string; selling_price: number; remaining_balance: number | null; customer_name: string; status: string };
type SalePayment = { id: string; sale_id: string; amount: number; payment_date: string; payment_method: string | null; reference_number: string | null };
type Expense = { id: string; vehicle_id?: string | null; expense_type?: string; category?: string; amount: number; expense_date: string; notes: string | null };
type Funding = { id: string; vehicle_id: string; partner_id: string | null; investor_id: string | null; amount: number; contribution_date: string };
type Party = { id: string; name: string; status?: string };
type Distribution = { id: string; vehicle_id: string; recipient_type: string; recipient_id: string | null; amount: number; rule_name: string; approval_status: string; created_at: string };
type DistributionPayment = { id: string; distribution_id: string; paid_amount: number; payment_date: string };
type Calculation = { id: string; sale_id: string | null; net_profit: number; status: string };
type DashboardData = {
  vehicles: Vehicle[];
  sales: Sale[];
  payments: SalePayment[];
  vehicleExpenses: Expense[];
  generalExpenses: Expense[];
  funding: Funding[];
  partners: Party[];
  investors: Party[];
  distributions: Distribution[];
  distributionPayments: DistributionPayment[];
  calculations: Calculation[];
  investorFunding: Funding[];
};
type TableColumn<Row> = { title: string; value: (row: Row) => React.ReactNode };

const EMPTY_DATA: DashboardData = {
  vehicles: [], sales: [], payments: [], vehicleExpenses: [], generalExpenses: [], funding: [],
  partners: [], investors: [], distributions: [], distributionPayments: [], calculations: [], investorFunding: [],
};
const today = new Date();
const defaultStart = localDateString(new Date(today.getFullYear(), today.getMonth(), 1));
const defaultEnd = localDateString(today);
const currency = import.meta.env.VITE_DEFAULT_CURRENCY || 'PKR';

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTimestampDate(value: string): string {
  return localDateString(new Date(value));
}

function getBounds(preset: DateRangePreset, customStart: string, customEnd: string, now: Date): DateBounds | null {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endAfter = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  if (preset === 'all_time') return {};
  if (preset === 'custom') {
    if (!customStart || !customEnd || customStart > customEnd) return null;
    return { from: customStart, to: localDateString(endAfter(new Date(`${customEnd}T00:00:00`))) };
  }
  if (preset === 'today') return { from: localDateString(startOfDay), to: localDateString(endAfter(startOfDay)) };
  if (preset === 'this_week') {
    const weekStart = new Date(startOfDay);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    return { from: localDateString(weekStart), to: localDateString(endAfter(startOfDay)) };
  }
  if (preset === 'this_month') return { from: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 1)) };
  if (preset === 'previous_month') return { from: localDateString(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)) };
  if (preset === 'last_3_months') {
    const targetMonth = now.getMonth() - 3;
    const targetYear = now.getFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDayOfMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
    const start = new Date(targetYear, normalizedMonth, Math.min(now.getDate(), lastDayOfMonth));
    return { from: localDateString(start), to: localDateString(endAfter(startOfDay)) };
  }
  return { from: localDateString(new Date(now.getFullYear(), 0, 1)), to: localDateString(new Date(now.getFullYear() + 1, 0, 1)) };
}

function previousBounds(bounds: DateBounds | null): DateBounds | null {
  if (!bounds?.from || !bounds.to) return null;
  const start = new Date(`${bounds.from}T00:00:00`);
  const end = new Date(`${bounds.to}T00:00:00`);
  const duration = end.getTime() - start.getTime();
  return { from: localDateString(new Date(start.getTime() - duration)), to: bounds.from };
}

async function fetchPagedRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function inRange(date: string, bounds: DateBounds | null): boolean {
  return (!bounds?.from || date >= bounds.from) && (!bounds?.to || date < bounds.to);
}

function money(value: number): string {
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

function moneyForRecords(value: number, recordCount: number, emptyValue: string): string {
  return recordCount > 0 ? money(value) : emptyValue;
}

function comparePeriod(current: number, previous: number, currentCount: number, previousCount: number, formatAsMoney = true): string {
  if (currentCount === 0 && previousCount === 0) return 'No activity in either period';
  if (previousCount === 0) return 'New activity vs previous period';
  const difference = current - previous;
  if (difference === 0) return 'No change vs previous period';
  const amount = formatAsMoney ? money(Math.abs(difference)) : Math.abs(difference).toLocaleString();
  return `${amount} ${difference > 0 ? 'higher' : 'lower'} vs previous period`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Dashboard data could not be loaded.';
}

function downloadCsv(fileName: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map((field) => {
    const safeField = /^[\s]*[=+\-@]/.test(field) ? `'${field}` : field;
    return `"${safeField.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ExecutiveDashboard({ profile }: { profile: UserProfile }) {
  const [preset, setPreset] = useState<DateRangePreset>('this_month');
  const [customStart, setCustomStart] = useState(defaultStart);
  const [customEnd, setCustomEnd] = useState(defaultEnd);
  const [dashboardNow, setDashboardNow] = useState(() => new Date());
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [reportType, setReportType] = useState('sales');
  const [mainChart, setMainChart] = useState<'sales' | 'funding' | null>(null);
  const lastSyncAt = useRef(0);
  const realtimeRefreshTimer = useRef<number | null>(null);
  const bounds = useMemo(() => getBounds(preset, customStart, customEnd, dashboardNow), [preset, customStart, customEnd, dashboardNow]);
  const previous = useMemo(() => previousBounds(bounds), [bounds]);
  const isInvestor = profile.role === 'investor';
  const refreshDashboard = () => {
    setDashboardNow(new Date());
    setRefresh((value) => value + 1);
  };

  useEffect(() => {
    const client = supabase;
    if (!client || !profile.is_active || profile.role === 'pending') {
      setLiveStatus('offline');
      return;
    }

    setLiveStatus('connecting');
    const relevantTables = profile.role === 'investor'
      ? ['funding_contributions', 'profit_distributions', 'distribution_payments', 'vehicles']
      : ['vehicles', 'sales', 'sale_payments', 'vehicle_expenses', 'general_expenses', 'funding_contributions', 'profit_calculations', 'profit_distributions', 'distribution_payments'];
    const requestRefresh = () => {
      if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = window.setTimeout(() => {
        realtimeRefreshTimer.current = null;
        setDashboardNow(new Date());
        setRefresh((value) => value + 1);
      }, 700);
    };
    let channel = client.channel(`dashboard-live-${profile.role}`);
    for (const table of relevantTables) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, requestRefresh);
    }
    channel = channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setLiveStatus('live');
      } else {
        setLiveStatus(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'offline' : 'connecting');
      }
    });
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncAt.current > 60_000) requestRefresh();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      void client.removeChannel(channel);
    };
  }, [profile.is_active, profile.role]);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      setError('Supabase is unavailable.');
      return;
    }
    if (!bounds) {
      setLoading(false);
      setError('Choose a valid custom date range.');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        if (isInvestor) {
          const [funding, distributions, payments] = await Promise.all([
            fetchPagedRows<Funding>((from, to) => client.from('funding_contributions')
              .select('id, vehicle_id, partner_id, investor_id, amount, contribution_date')
              .order('contribution_date', { ascending: false })
              .range(from, to)),
            fetchPagedRows<Distribution>((from, to) => client.from('profit_distributions')
              .select('id, vehicle_id, recipient_type, recipient_id, amount, rule_name, approval_status, created_at')
              .eq('recipient_type', 'investor')
              .order('created_at', { ascending: false })
              .range(from, to)),
            fetchPagedRows<DistributionPayment>((from, to) => client.from('distribution_payments')
              .select('id, distribution_id, paid_amount, payment_date')
              .order('payment_date', { ascending: false })
              .range(from, to)),
          ]);
          const ownVehicleIds = [...new Set(funding.map((item) => item.vehicle_id))];
          const ownVehicles = ownVehicleIds.length
            ? await fetchPagedRows<Vehicle>((from, to) => client.from('vehicles')
              .select('id, business_category, make, model, manufacturing_year, registration_number, purchase_date, purchase_price, expected_sale_price, status')
              .in('id', ownVehicleIds)
              .range(from, to))
            : [];
          if (active) {
            setData({ ...EMPTY_DATA, vehicles: ownVehicles, investorFunding: funding, distributions, distributionPayments: payments });
            lastSyncAt.current = Date.now();
            setLastUpdatedAt(new Date(lastSyncAt.current));
          }
          return;
        }

        const allPeriods = [...[bounds, previous].filter((value): value is DateBounds => Boolean(value?.from))]
          .sort((left, right) => (left.from ?? '').localeCompare(right.from ?? ''));
        const queryStart = allPeriods[0]?.from;
        const queryEnd = bounds.to;
        const baseQueries: Promise<unknown>[] = [
          fetchPagedRows<Vehicle>((from, to) => client.from('vehicles')
            .select('id, business_category, make, model, manufacturing_year, registration_number, purchase_date, purchase_price, expected_sale_price, status')
            .neq('business_category', 'consignment')
            .order('purchase_date', { ascending: false })
            .range(from, to)),
          fetchPagedRows<Sale>((from, to) => {
            let query = client.from('sales').select('id, vehicle_id, sale_date, selling_price, remaining_balance, customer_name, status').order('sale_date', { ascending: false }).range(from, to);
            if (queryStart) query = query.gte('sale_date', queryStart);
            if (queryEnd) query = query.lt('sale_date', queryEnd);
            return query;
          }),
          fetchPagedRows<SalePayment>((from, to) => {
            let query = client.from('sale_payments').select('id, sale_id, amount, payment_date, payment_method, reference_number').order('payment_date', { ascending: false }).range(from, to);
            if (queryStart) query = query.gte('payment_date', queryStart);
            if (queryEnd) query = query.lt('payment_date', queryEnd);
            return query;
          }),
          fetchPagedRows<Expense>((from, to) => {
            let query = client.from('vehicle_expenses').select('id, vehicle_id, expense_type, amount, expense_date, notes').order('expense_date', { ascending: false }).range(from, to);
            if (queryStart) query = query.gte('expense_date', queryStart);
            if (queryEnd) query = query.lt('expense_date', queryEnd);
            return query;
          }),
          fetchPagedRows<Expense>((from, to) => {
            let query = client.from('general_expenses').select('id, category, amount, expense_date, notes').order('expense_date', { ascending: false }).range(from, to);
            if (queryStart) query = query.gte('expense_date', queryStart);
            if (queryEnd) query = query.lt('expense_date', queryEnd);
            return query;
          }),
          fetchPagedRows<Distribution>((from, to) => client.from('profit_distributions')
            .select('id, vehicle_id, recipient_type, recipient_id, amount, rule_name, approval_status, created_at')
            .order('created_at', { ascending: false })
            .range(from, to)),
          fetchPagedRows<DistributionPayment>((from, to) => client.from('distribution_payments')
            .select('id, distribution_id, paid_amount, payment_date')
            .order('payment_date', { ascending: false })
            .range(from, to)),
          fetchPagedRows<Calculation>((from, to) => client.from('profit_calculations')
            .select('id, sale_id, net_profit, status')
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .range(from, to)),
          fetchPagedRows<Funding>((from, to) => client.from('funding_contributions')
            .select('id, vehicle_id, partner_id, investor_id, amount, contribution_date')
            .order('contribution_date', { ascending: false })
            .range(from, to)),
        ];
        if (profile.role === 'super_admin') {
          baseQueries.push(
            Promise.resolve(client.from('partners').select('id, name, status').order('name')),
            Promise.resolve(client.from('investors').select('id, name, status').order('name')),
          );
        } else {
          baseQueries.push(Promise.resolve(client.from('partners').select('id, name, status').order('name')));
        }

        const results = await Promise.all(baseQueries);
        const queryError = results.find((result) => typeof result === 'object' && result !== null && 'error' in result && (result as { error?: unknown }).error);
        if (queryError) throw new Error(errorText((queryError as { error: unknown }).error));
        if (!active) return;
        const vehicles = results[0] as Vehicle[];
        const sales = results[1] as Sale[];
        const payments = results[2] as SalePayment[];
        const vehicleExpenses = results[3] as Expense[];
        const generalExpenses = results[4] as Expense[];
        const distributions = results[5] as Distribution[];
        const distributionPayments = results[6] as DistributionPayment[];
        const calculations = results[7] as Calculation[];
        const funding = results[8] as Funding[];
        const partiesResult = results[9] as { data: Party[] | null };
        const investorsResult = profile.role === 'super_admin' ? results[10] as { data: Party[] | null } : undefined;
        setData({
          vehicles,
          sales,
          payments,
          vehicleExpenses,
          generalExpenses,
          distributions,
          distributionPayments,
          calculations,
          funding,
          partners: partiesResult.data ?? [],
          investors: investorsResult?.data ?? [],
          investorFunding: [],
        });
        lastSyncAt.current = Date.now();
        setLastUpdatedAt(new Date(lastSyncAt.current));
      } catch (loadError) {
        if (active) setError(errorText(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [bounds, isInvestor, previous, profile.role, refresh]);

  const selectedSales = useMemo(() => data.sales.filter((sale) => inRange(sale.sale_date, bounds)), [data.sales, bounds]);
  const priorSales = useMemo(() => data.sales.filter((sale) => inRange(sale.sale_date, previous)), [data.sales, previous]);
  const completedSales = useMemo(() => selectedSales.filter((sale) => sale.status === 'completed'), [selectedSales]);
  const priorCompletedSales = useMemo(() => priorSales.filter((sale) => sale.status === 'completed'), [priorSales]);
  const selectedPayments = useMemo(() => data.payments.filter((payment) => inRange(payment.payment_date, bounds)), [data.payments, bounds]);
  const priorPayments = useMemo(() => data.payments.filter((payment) => inRange(payment.payment_date, previous)), [data.payments, previous]);
  const totalRevenue = completedSales.reduce((sum, sale) => sum + Number(sale.selling_price), 0);
  const priorRevenue = priorCompletedSales.reduce((sum, sale) => sum + Number(sale.selling_price), 0);
  const cashReceived = selectedPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const priorCashReceived = priorPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const selectedOutstanding = selectedSales.filter((sale) => Number(sale.remaining_balance ?? 0) > 0);
  const outstandingTotal = selectedOutstanding.reduce((sum, sale) => sum + Number(sale.remaining_balance), 0);
  const currentInventory = data.vehicles.filter((vehicle) => ['available', 'reserved', 'repair'].includes(vehicle.status));
  const availableVehicles = currentInventory.filter((vehicle) => vehicle.status === 'available');
  const reservedVehicles = currentInventory.filter((vehicle) => vehicle.status === 'reserved');
  const currentUnsoldPurchaseValue = currentInventory.reduce((sum, vehicle) => sum + Number(vehicle.purchase_price ?? 0), 0);
  const purchaseRecords = data.vehicles.filter((vehicle) => preset === 'all_time' || (vehicle.purchase_date && inRange(vehicle.purchase_date, bounds)));
  const purchaseDatesMissing = preset !== 'all_time' && data.vehicles.some((vehicle) => !vehicle.purchase_date);
  const purchaseSpend = purchaseRecords.reduce((sum, vehicle) => sum + Number(vehicle.purchase_price ?? 0), 0);
  const revenuePerSale = totalRevenue / Math.max(completedSales.length, 1);
  const previousRevenuePerSale = priorRevenue / Math.max(priorCompletedSales.length, 1);
  const missingPurchasePrices = purchaseRecords.some((vehicle) => vehicle.purchase_price === null);
  const missingUnsoldPrices = currentInventory.some((vehicle) => vehicle.purchase_price === null);
  const outstandingUnavailable = selectedSales.length === 0
    ? 'No sales in this date range'
    : selectedSales.some((sale) => sale.remaining_balance === null)
      ? 'Not available — some sales have no stored balance'
      : money(outstandingTotal);
  const approvedBySale = new Map<string, Calculation[]>();
  for (const calculation of data.calculations) {
    if (!calculation.sale_id) continue;
    const rows = approvedBySale.get(calculation.sale_id) ?? [];
    rows.push(calculation);
    approvedBySale.set(calculation.sale_id, rows);
  }
  const netIsReliable = completedSales.length > 0 && completedSales.every((sale) => approvedBySale.get(sale.id)?.length === 1);
  const netProfit = netIsReliable ? completedSales.reduce((sum, sale) => sum + Number(approvedBySale.get(sale.id)?.[0].net_profit), 0) : null;

  const chartData = useMemo(() => {
    const first = bounds?.from
      ? new Date(`${bounds.from}T00:00:00`)
      : new Date(dashboardNow.getFullYear(), dashboardNow.getMonth() - 11, 1);
    const endExclusive = bounds?.to
      ? new Date(`${bounds.to}T00:00:00`)
      : new Date(dashboardNow.getFullYear(), dashboardNow.getMonth(), dashboardNow.getDate() + 1);
    const daySpan = Math.max(1, Math.ceil((endExclusive.getTime() - first.getTime()) / 86_400_000));
    const daily = daySpan <= 62;
    const bucket = (date: string) => {
      const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
      return daily ? localDateString(parsed) : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    };
    const totals = new Map<string, DashboardChartPoint>();
    const add = (key: string) => totals.get(key) ?? {
      key, label: '', revenue: 0, units: 0, cash: 0, vehicleExpenses: 0, showroomExpenses: 0,
      partnerFunding: 0, investorFunding: 0, investorContributions: 0, investorAllocations: 0, investorPaid: 0,
    };
    const pointStart = daily ? new Date(first) : new Date(first.getFullYear(), first.getMonth(), 1);
    for (const cursor = new Date(pointStart); cursor < endExclusive; daily ? cursor.setDate(cursor.getDate() + 1) : cursor.setMonth(cursor.getMonth() + 1)) {
      const key = daily ? localDateString(cursor) : `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const item = add(key);
      item.label = daily
        ? cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      totals.set(key, item);
    }
    for (const sale of selectedSales) {
      const key = bucket(sale.sale_date);
      const item = totals.get(key);
      if (!item) continue;
      if (sale.status === 'completed') {
        item.revenue += Number(sale.selling_price);
        item.units += 1;
      }
    }
    for (const payment of selectedPayments) {
      const key = bucket(payment.payment_date);
      const item = totals.get(key);
      if (!item) continue;
      item.cash += Number(payment.amount);
    }
    for (const expense of [...data.vehicleExpenses, ...data.generalExpenses]) {
      if (!inRange(expense.expense_date, bounds)) continue;
      const item = totals.get(bucket(expense.expense_date));
      if (!item) continue;
      if (expense.vehicle_id) item.vehicleExpenses += Number(expense.amount);
      else item.showroomExpenses += Number(expense.amount);
    }
    for (const contribution of data.funding) {
      if (!inRange(contribution.contribution_date, bounds)) continue;
      const item = totals.get(bucket(contribution.contribution_date));
      if (!item) continue;
      if (contribution.partner_id) item.partnerFunding += Number(contribution.amount);
      if (contribution.investor_id) item.investorFunding += Number(contribution.amount);
    }
    return [...totals.values()];
  }, [bounds, dashboardNow, data.funding, data.generalExpenses, data.vehicleExpenses, selectedPayments, selectedSales]);

  const periodLabel = bounds?.from
    ? `${bounds.from} – ${bounds.to ? localDateString(new Date(new Date(`${bounds.to}T00:00:00`).getTime() - 86_400_000)) : 'present'}`
    : 'All time';
  const chartPeriodLabel = preset === 'all_time' ? 'Last 12 months' : periodLabel;
  const investorFunding = data.investorFunding.filter((item) => inRange(item.contribution_date, bounds));
  const ownApprovedDistributions = data.distributions.filter((item) => item.recipient_type === 'investor' && item.approval_status === 'approved' && inRange(localTimestampDate(item.created_at), bounds));
  const allOwnApprovedDistributions = data.distributions.filter((item) => item.recipient_type === 'investor' && item.approval_status === 'approved');
  const ownDistributionIds = new Set(ownApprovedDistributions.map((item) => item.id));
  const ownDistributionPayments = data.distributionPayments.filter((item) => ownDistributionIds.has(item.distribution_id));
  const investorActivityData = useMemo(() => {
    const points = new Map(chartData.map((item) => [item.key, { ...item, investorContributions: 0, investorAllocations: 0, investorPaid: 0 }]));
    const daily = chartData[0]?.key.length === 10;
    const addTo = (date: string, field: 'investorContributions' | 'investorAllocations' | 'investorPaid', amount: number) => {
      if (!inRange(date, bounds)) return;
      const key = daily ? date.slice(0, 10) : date.slice(0, 7);
      const point = points.get(key);
      if (point) point[field] += Number(amount);
    };
    for (const contribution of data.investorFunding) addTo(contribution.contribution_date, 'investorContributions', contribution.amount);
    for (const distribution of allOwnApprovedDistributions) addTo(localTimestampDate(distribution.created_at), 'investorAllocations', distribution.amount);
    const approvedIds = new Set(allOwnApprovedDistributions.map((distribution) => distribution.id));
    for (const payment of data.distributionPayments) {
      if (approvedIds.has(payment.distribution_id)) addTo(payment.payment_date, 'investorPaid', payment.paid_amount);
    }
    return [...points.values()];
  }, [allOwnApprovedDistributions, bounds, chartData, data.distributionPayments, data.investorFunding]);
  const ownDistributed = ownApprovedDistributions.reduce((sum, item) => sum + Number(item.amount), 0);
  const ownPaid = ownDistributionPayments.reduce((sum, item) => sum + Number(item.paid_amount), 0);
  const investorVehicleIds = new Set(investorFunding.map((item) => item.vehicle_id));
  const allInvestorVehicleIds = new Set(data.investorFunding.map((item) => item.vehicle_id));
  const investorVehicles = data.vehicles.filter((item) => allInvestorVehicleIds.has(item.id));
  const investorCapital = investorFunding.reduce((sum, item) => sum + Number(item.amount), 0);
  const investorTiedCapital = data.investorFunding
    .filter((funding) => investorVehicles.some((vehicle) => vehicle.id === funding.vehicle_id && ['available', 'reserved', 'repair'].includes(vehicle.status)))
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const investorTiedRecords = data.investorFunding.filter((funding) => investorVehicles.some((vehicle) => vehicle.id === funding.vehicle_id && ['available', 'reserved', 'repair'].includes(vehicle.status))).length;
  const inventoryBreakdown = (vehicles: Vehicle[]): InventoryChartSlice[] => [
    { name: 'Available', value: vehicles.filter((vehicle) => vehicle.status === 'available').length, color: '#a855f7' },
    { name: 'Reserved', value: vehicles.filter((vehicle) => vehicle.status === 'reserved').length, color: '#258bff' },
    { name: 'Repair', value: vehicles.filter((vehicle) => vehicle.status === 'repair').length, color: '#f0a267' },
  ].filter((item) => item.value > 0);

  const selectedFunding = data.funding.filter((item) => inRange(item.contribution_date, bounds));
  const partyOptions = profile.role === 'super_admin' ? [...data.partners, ...data.investors] : data.partners;
  const partnerStats = data.partners.map((partner) => {
    const contributions = selectedFunding.filter((item) => item.partner_id === partner.id);
    const lifetimeFundedIds = new Set(data.funding.filter((item) => item.partner_id === partner.id).map((item) => item.vehicle_id));
    const tiedCapital = data.funding.filter((item) => item.partner_id === partner.id && data.vehicles.some((vehicle) => vehicle.id === item.vehicle_id && ['available', 'reserved', 'repair'].includes(vehicle.status)))
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const associatedSales = completedSales.filter((sale) => lifetimeFundedIds.has(sale.vehicle_id));
    const associatedRevenue = associatedSales.reduce((sum, sale) => sum + Number(sale.selling_price), 0);
    const allocations = data.distributions.filter((item) => item.recipient_type === 'partner' && item.recipient_id === partner.id && item.approval_status === 'approved' && inRange(localTimestampDate(item.created_at), bounds));
    const allocationIds = new Set(allocations.map((item) => item.id));
    const payments = data.distributionPayments.filter((item) => allocationIds.has(item.distribution_id));
    const paid = payments.reduce((sum, item) => sum + Number(item.paid_amount), 0);
    const allocated = allocations.reduce((sum, item) => sum + Number(item.amount), 0);
    return { ...partner, vehiclesFunded: lifetimeFundedIds.size, contributed: contributions.reduce((sum, item) => sum + Number(item.amount), 0), contributionCount: contributions.length, tiedCapital, associatedRevenue, associatedSaleCount: associatedSales.length, allocated, allocationCount: allocations.length, paid, paymentCount: payments.length, payable: allocated - paid };
  });
  const investorStats = data.investors.map((investor) => {
    const contributions = selectedFunding.filter((item) => item.investor_id === investor.id);
    const lifetimeFundedIds = new Set(data.funding.filter((item) => item.investor_id === investor.id).map((item) => item.vehicle_id));
    const tiedCapital = data.funding.filter((item) => item.investor_id === investor.id && data.vehicles.some((vehicle) => vehicle.id === item.vehicle_id && ['available', 'reserved', 'repair'].includes(vehicle.status)))
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const associatedSales = completedSales.filter((sale) => lifetimeFundedIds.has(sale.vehicle_id));
    const associatedRevenue = associatedSales.reduce((sum, sale) => sum + Number(sale.selling_price), 0);
    const allocations = data.distributions.filter((item) => item.recipient_type === 'investor' && item.recipient_id === investor.id && item.approval_status === 'approved' && inRange(localTimestampDate(item.created_at), bounds));
    const allocationIds = new Set(allocations.map((item) => item.id));
    const payments = data.distributionPayments.filter((item) => allocationIds.has(item.distribution_id));
    const paid = payments.reduce((sum, item) => sum + Number(item.paid_amount), 0);
    const allocated = allocations.reduce((sum, item) => sum + Number(item.amount), 0);
    return { ...investor, vehiclesFunded: lifetimeFundedIds.size, contributed: contributions.reduce((sum, item) => sum + Number(item.amount), 0), contributionCount: contributions.length, tiedCapital, associatedRevenue, associatedSaleCount: associatedSales.length, allocated, allocationCount: allocations.length, paid, paymentCount: payments.length, payable: allocated - paid };
  });

  const [inventoryPage, setInventoryPage] = useState(0);
  const [reportFilter, setReportFilter] = useState('');
  const [partyFilterValue, setPartyFilterValue] = useState('');
  const inventorySearch = reportFilter.trim().toLowerCase();
  const agedInventory = currentInventory.filter((vehicle) => vehicle.purchase_date);
  const ageDays = (vehicle: Vehicle) => Math.max(0, Math.floor((dashboardNow.getTime() - new Date(`${vehicle.purchase_date}T00:00:00`).getTime()) / 86_400_000));
  const ageGroups = [
    { label: '0–30 days', count: agedInventory.filter((item) => ageDays(item) <= 30).length },
    { label: '31–60 days', count: agedInventory.filter((item) => ageDays(item) > 30 && ageDays(item) <= 60).length },
    { label: '61–90 days', count: agedInventory.filter((item) => ageDays(item) > 60 && ageDays(item) <= 90).length },
    { label: 'Over 90 days', count: agedInventory.filter((item) => ageDays(item) > 90).length },
  ];
  const inventoryRows = currentInventory.filter((vehicle) => !inventorySearch || `${vehicle.make} ${vehicle.model} ${vehicle.registration_number ?? ''}`.toLowerCase().includes(inventorySearch));
  const pageSize = 8;
  const currentInventoryRows = inventoryRows.slice(inventoryPage * pageSize, (inventoryPage + 1) * pageSize);
  const allVehiclesById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const salesById = new Map(data.sales.map((sale) => [sale.id, sale]));
  const expenseRows = selectedExpensesFor(data, bounds, allVehiclesById);
  const recentPurchases = data.vehicles.filter((vehicle) => vehicle.purchase_date && inRange(vehicle.purchase_date, bounds)).sort((a, b) => (b.purchase_date ?? '').localeCompare(a.purchase_date ?? ''));
  const recentSales = selectedSales.filter((sale) => sale.status === 'completed').sort((a, b) => b.sale_date.localeCompare(a.sale_date));
  const recentPayments = selectedPayments.slice().sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const recentOutstanding = selectedOutstanding.slice().sort((a, b) => Number(b.remaining_balance) - Number(a.remaining_balance));
  const recentExpenses = expenseRows.sort((a, b) => b.date.localeCompare(a.date));
  const recentDistributions = data.distributions.filter((item) => item.approval_status === 'approved' && inRange(localTimestampDate(item.created_at), bounds)).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const exportReport = (requestedReport = reportType) => {
    const filterParty = (partyId: string | null) => !partyFilterValue || partyId === partyFilterValue;
    const matchesPerson = (vehicleId: string) => !partyFilterValue || data.funding.some((funding) =>
      funding.vehicle_id === vehicleId
      && (funding.partner_id === partyFilterValue || (profile.role === 'super_admin' && funding.investor_id === partyFilterValue)),
    );
    const rows: string[][] = [];
    if (isInvestor && requestedReport === 'investors') {
      rows.push(['Record type', 'Date', 'Vehicle', 'Amount', 'Status']);
      investorFunding.forEach((item) => rows.push(['Contribution', item.contribution_date, vehicleLabel(allVehiclesById.get(item.vehicle_id)), String(item.amount), 'Recorded']));
      ownApprovedDistributions.forEach((item) => rows.push(['Approved distribution', localTimestampDate(item.created_at), vehicleLabel(allVehiclesById.get(item.vehicle_id)), String(item.amount), item.approval_status]));
      ownDistributionPayments.forEach((item) => {
        const distribution = ownApprovedDistributions.find((record) => record.id === item.distribution_id);
        rows.push(['Distribution payment', item.payment_date, vehicleLabel(distribution ? allVehiclesById.get(distribution.vehicle_id) : undefined), String(item.paid_amount), `Paid · ${item.distribution_id}`]);
      });
    } else if (requestedReport === 'inventory' || requestedReport === 'aging') {
      rows.push(['Vehicle', 'Registration', 'Purchase date', 'Purchase price', 'Expected sale', 'Status', 'Days in inventory']);
      for (const vehicle of currentInventory.filter((item) =>
        matchesPerson(item.id)
        && (requestedReport === 'aging' || (item.purchase_date && inRange(item.purchase_date, bounds))))) {
        rows.push([[vehicle.manufacturing_year, vehicle.make, vehicle.model].filter(Boolean).join(' '), vehicle.registration_number ?? '', vehicle.purchase_date ?? '', String(vehicle.purchase_price ?? ''), String(vehicle.expected_sale_price ?? ''), vehicle.status, vehicle.purchase_date ? String(ageDays(vehicle)) : 'Not recorded']);
      }
    } else if (requestedReport === 'purchases') {
      rows.push(['Vehicle', 'Purchase date', 'Purchase price']);
      recentPurchases.filter((vehicle) => matchesPerson(vehicle.id)).forEach((vehicle) => rows.push([[vehicle.manufacturing_year, vehicle.make, vehicle.model].filter(Boolean).join(' '), vehicle.purchase_date ?? '', String(vehicle.purchase_price ?? '')]));
    } else if (requestedReport === 'payments') {
      rows.push(['Payment date', 'Vehicle', 'Amount', 'Method', 'Reference']);
      recentPayments.forEach((payment) => {
        const sale = salesById.get(payment.sale_id);
        if (sale && matchesPerson(sale.vehicle_id)) rows.push([payment.payment_date, vehicleLabel(allVehiclesById.get(sale.vehicle_id)), String(payment.amount), payment.payment_method ?? '', payment.reference_number ?? '']);
      });
    } else if (requestedReport === 'outstanding') {
      rows.push(['Sale date', 'Customer', 'Vehicle', 'Stored outstanding balance']);
      recentOutstanding.filter((sale) => matchesPerson(sale.vehicle_id)).forEach((sale) => rows.push([sale.sale_date, sale.customer_name, vehicleLabel(allVehiclesById.get(sale.vehicle_id)), String(sale.remaining_balance ?? '')]));
    } else if (requestedReport === 'partners') {
      rows.push(['Partner', 'Vehicles funded', 'Recorded contributions', 'Associated vehicle sale revenue', 'Approved profit allocated', 'Profit paid', 'Profit payable', 'Capital tied in unsold vehicles']);
      partnerStats.filter((item) => filterParty(item.id)).forEach((item) => rows.push([item.name, String(item.vehiclesFunded), item.contributionCount ? String(item.contributed) : '', item.associatedSaleCount ? String(item.associatedRevenue) : '', item.allocationCount ? String(item.allocated) : '', item.paymentCount ? String(item.paid) : '', item.allocationCount ? String(item.payable) : '', item.vehiclesFunded ? String(item.tiedCapital) : '']));
    } else if (requestedReport === 'investors') {
      rows.push(['Investor', 'Vehicles funded', 'Recorded contributions', 'Associated vehicle sale revenue', 'Approved profit allocated', 'Profit paid', 'Profit payable', 'Capital tied in unsold vehicles']);
      investorStats.filter((item) => filterParty(item.id)).forEach((item) => rows.push([item.name, String(item.vehiclesFunded), item.contributionCount ? String(item.contributed) : '', item.associatedSaleCount ? String(item.associatedRevenue) : '', item.allocationCount ? String(item.allocated) : '', item.paymentCount ? String(item.paid) : '', item.allocationCount ? String(item.payable) : '', item.vehiclesFunded ? String(item.tiedCapital) : '']));
    } else if (requestedReport === 'expenses') {
      rows.push(['Date', 'Vehicle', 'Expense', 'Amount']);
      recentExpenses.filter((expense) => !partyFilterValue || (expense.vehicleId !== null && matchesPerson(expense.vehicleId))).forEach((expense) => rows.push([expense.date, expense.vehicle, expense.type, String(expense.amount)]));
    } else {
      rows.push(['Sale date', 'Customer', 'Vehicle', 'Sale amount']);
      recentSales.filter((sale) => matchesPerson(sale.vehicle_id)).forEach((sale) => rows.push([sale.sale_date, sale.customer_name, vehicleLabel(allVehiclesById.get(sale.vehicle_id)), String(sale.selling_price)]));
    }
    if (rows.length === 1) {
      setError('No rows are available for this report and date range.');
      return;
    }
    downloadCsv(`trueline-${requestedReport}-${periodLabel.replaceAll(' ', '_')}.csv`, rows);
  };

  if (error) {
    return <div className="page-shell"><div className="page-header"><div><p className="eyebrow">Executive insights</p><h2>Dashboard</h2></div><button type="button" className="ghost-button" onClick={refreshDashboard}>Retry</button></div><p role="alert" className="auth-feedback error">{error}</p></div>;
  }
  if (!bounds) {
    return <div className="page-shell"><p role="alert" className="auth-feedback error">Select a valid custom date range.</p></div>;
  }

  if (isInvestor) {
    const distributionById = new Map(ownApprovedDistributions.map((item) => [item.id, item]));
    const ownRows = [
      ...investorFunding.map((item) => ({ id: `funding-${item.id}`, date: item.contribution_date, type: 'Contribution', vehicleId: item.vehicle_id, amount: Number(item.amount), status: 'Recorded' })),
      ...ownApprovedDistributions.map((item) => ({ id: `distribution-${item.id}`, date: localTimestampDate(item.created_at), type: 'Approved distribution', vehicleId: item.vehicle_id, amount: Number(item.amount), status: item.approval_status })),
      ...ownDistributionPayments.map((item) => {
        const distribution = distributionById.get(item.distribution_id);
        return { id: `payment-${item.id}`, date: item.payment_date, type: 'Distribution payment', vehicleId: distribution?.vehicle_id ?? null, amount: Number(item.paid_amount), status: `Paid · ${item.distribution_id}` };
      }),
    ].sort((left, right) => right.date.localeCompare(left.date));
    return (
      <div className="page-shell executive-dashboard">
        <DashboardHeader profile={profile} preset={preset} setPreset={setPreset} customStart={customStart} setCustomStart={setCustomStart} customEnd={customEnd} setCustomEnd={setCustomEnd} loading={loading} refresh={refreshDashboard} periodLabel={periodLabel} liveStatus={liveStatus} lastUpdatedAt={lastUpdatedAt} />
        {error && <p role="alert" className="auth-feedback error">{error}</p>}
        <section className="executive-kpi-grid executive-primary-kpis">
          <KpiCard icon={Wallet} label="Your contributions" value={moneyForRecords(investorCapital, investorFunding.length, 'No recorded contributions')} loading={loading} />
          <KpiCard icon={CarFront} label="Vehicles funded" value={String(investorVehicleIds.size)} loading={loading} />
          <KpiCard icon={CircleDollarSign} label="Approved profit allocated" value={moneyForRecords(ownDistributed, ownApprovedDistributions.length, 'Not yet available')} loading={loading} />
          <KpiCard icon={HandCoins} label="Profit payable" value={moneyForRecords(ownDistributed - ownPaid, ownApprovedDistributions.length, 'Not yet available')} loading={loading} />
        </section>
        <DashboardVisualCharts data={investorActivityData} inventory={inventoryBreakdown(currentInventory)} role="investor" periodLabel={chartPeriodLabel} />
        <details className="executive-secondary-metrics">
          <summary>Your investment details <span>Additional recorded metrics</span></summary>
          <div className="executive-secondary-kpi-grid">
            <KpiCard icon={CreditCard} label="Profit paid" value={moneyForRecords(ownPaid, ownDistributionPayments.length, 'No recorded payments')} loading={loading} compact />
            <KpiCard icon={PackageCheck} label="Capital tied in unsold vehicles" value={moneyForRecords(investorTiedCapital, investorTiedRecords, 'No recorded capital tied in unsold vehicles')} loading={loading} compact />
          </div>
          <p className="executive-data-note">Your investor-linked funding and distributions created in the selected period only. Payments are recorded disbursements linked to your distributions. Sale revenue, customer records, vehicle expenses, and other investors’ financial records are not accessible under this role. {periodLabel}</p>
        </details>
        <section className="glass-panel panel-section">
          <div className="section-head"><h3>Your investor statement</h3><button type="button" className="primary-button" onClick={() => exportReport('investors')}>Export CSV</button></div>
          <DashboardTable title="Investor contributions" columns={[
            { title: 'Date', value: (item: (typeof ownRows)[number]) => item.date },
            { title: 'Record', value: (item: (typeof ownRows)[number]) => item.type },
            { title: 'Vehicle', value: (item: (typeof ownRows)[number]) => item.vehicleId ? <Link to={`/inventory/${item.vehicleId}`}>View vehicle</Link> : 'Investor distribution' },
            { title: 'Amount', value: (item: (typeof ownRows)[number]) => money(item.amount) },
            { title: 'Status', value: (item: (typeof ownRows)[number]) => item.status },
          ]} rows={ownRows} loading={loading} search="" />
        </section>
      </div>
    );
  }

  const tableFilter = tableSearch.trim().toLowerCase();
  const revenueTrendExists = chartData.some((item) => item.revenue || item.cash || item.units);
  const fundingTrendExists = chartData.some((item) => item.partnerFunding || item.investorFunding);
  const activeMainChart = mainChart ?? (!revenueTrendExists && fundingTrendExists ? 'funding' : 'sales');
  const fundingTotal = chartData.reduce((sum, item) => sum + item.partnerFunding + item.investorFunding, 0);
  const profitStatus = netProfit === null ? 'Not yet available — each completed sale needs exactly one approved calculation.' : money(netProfit);
  const dashboardKpis = [
    { icon: TrendingUp, label: 'Sales revenue', value: moneyForRecords(totalRevenue, completedSales.length, 'No recorded sales'), sub: 'Completed recorded sales', comparison: previous ? comparePeriod(totalRevenue, priorRevenue, completedSales.length, priorCompletedSales.length) : 'Comparison unavailable for All time' },
    { icon: CreditCard, label: 'Cash received', value: moneyForRecords(cashReceived, selectedPayments.length, 'No recorded customer payments'), sub: 'Recorded customer payments', comparison: previous ? comparePeriod(cashReceived, priorCashReceived, selectedPayments.length, priorPayments.length) : 'Comparison unavailable for All time' },
    { icon: ReceiptText, label: 'Outstanding balances', value: outstandingUnavailable, sub: 'Stored sales balance field' },
    { icon: CarFront, label: 'Vehicles in inventory', value: String(currentInventory.length), sub: 'Current snapshot' },
  ];
  const additionalKpis = [
    { icon: PackageCheck, label: 'Vehicles sold', value: String(completedSales.length), sub: periodLabel, comparison: previous ? comparePeriod(completedSales.length, priorCompletedSales.length, completedSales.length, priorCompletedSales.length, false) : 'Comparison unavailable for All time' },
    { icon: CircleDollarSign, label: 'Net profit', value: profitStatus, sub: 'Approved stored calculations only' },
    { icon: CarFront, label: 'Available for sale', value: String(availableVehicles.length), sub: 'Current snapshot' },
    { icon: PackageCheck, label: 'Reserved', value: String(reservedVehicles.length), sub: 'Current snapshot' },
    { icon: Wallet, label: 'Purchase capital acquired', value: purchaseDatesMissing ? 'Not available — a purchase date is missing' : missingPurchasePrices ? 'Not available — a purchase price is missing' : moneyForRecords(purchaseSpend, purchaseRecords.length, 'No recorded purchases'), sub: 'Recorded purchase value' },
    { icon: HandCoins, label: 'Capital tied in unsold vehicles', value: currentInventory.length === 0 ? 'No unsold inventory' : missingUnsoldPrices ? 'Not available — a purchase price is missing' : money(currentUnsoldPurchaseValue), sub: 'Current purchase-price value' },
    { icon: CircleDollarSign, label: 'Gross profit', value: 'Not yet available', sub: 'No defined gross-profit field' },
  ];
  const priorComparison = previous
    ? `Previous period: ${moneyForRecords(priorRevenue, priorCompletedSales.length, 'No recorded sales')} revenue · ${priorCompletedSales.length} completed sales · ${moneyForRecords(priorCashReceived, priorPayments.length, 'No recorded customer payments')}`
    : 'Previous-period comparison is not defined for All time.';

  return (
    <div className="page-shell executive-dashboard">
      <DashboardHeader profile={profile} preset={preset} setPreset={setPreset} customStart={customStart} setCustomStart={setCustomStart} customEnd={customEnd} setCustomEnd={setCustomEnd} loading={loading} refresh={refreshDashboard} periodLabel={periodLabel} liveStatus={liveStatus} lastUpdatedAt={lastUpdatedAt} />
      {error && <p role="alert" className="auth-feedback error">{error}</p>}
      <div className="executive-kpi-grid executive-primary-kpis">
        {dashboardKpis.map((item) => <KpiCard key={item.label} {...item} loading={loading} />)}
      </div>
      <section className="glass-panel panel-section executive-main-chart">
        <div className="executive-main-chart-heading">
          <div>
            <p className="eyebrow">{activeMainChart === 'sales' ? 'Showroom performance' : 'Recorded capital activity'}</p>
            <h3>{activeMainChart === 'sales' ? 'Sales & customer payments' : 'Partner & investor funding'}</h3>
            <p className="muted">{activeMainChart === 'sales' ? `Completed sale value and actual customer payments · ${chartPeriodLabel}` : `Recorded contributions only; funding is capital, not revenue or profit · ${chartPeriodLabel}`}</p>
          </div>
          <div className="executive-chart-tabs" role="group" aria-label="Choose dashboard chart">
            <button type="button" className={activeMainChart === 'sales' ? 'active' : ''} aria-pressed={activeMainChart === 'sales'} onClick={() => setMainChart('sales')}>Sales</button>
            <button type="button" className={activeMainChart === 'funding' ? 'active' : ''} aria-pressed={activeMainChart === 'funding'} onClick={() => setMainChart('funding')}>Funding</button>
          </div>
        </div>
        <div className="executive-main-chart-stats">
          {activeMainChart === 'sales' ? <>
            <div><span>Sales revenue</span><strong>{moneyForRecords(totalRevenue, completedSales.length, 'No recorded sales')}</strong></div>
            <div><span>Customer cash received</span><strong>{moneyForRecords(cashReceived, selectedPayments.length, 'No recorded payments')}</strong></div>
            <div><span>Completed sales</span><strong>{completedSales.length.toLocaleString()}</strong></div>
          </> : <>
            <div><span>Partner contributions</span><strong>{moneyForRecords(chartData.reduce((sum, item) => sum + item.partnerFunding, 0), chartData.filter((item) => item.partnerFunding > 0).length, 'No recorded contributions')}</strong></div>
            <div><span>Investor contributions</span><strong>{moneyForRecords(chartData.reduce((sum, item) => sum + item.investorFunding, 0), chartData.filter((item) => item.investorFunding > 0).length, 'No recorded contributions')}</strong></div>
            <div><span>Total recorded funding</span><strong>{moneyForRecords(fundingTotal, chartData.filter((item) => item.partnerFunding + item.investorFunding > 0).length, 'No recorded funding')}</strong></div>
          </>}
        </div>
        {loading ? <div className="executive-main-chart-canvas executive-chart-skeleton" role="status" aria-label="Loading dashboard chart" /> : (
          activeMainChart === 'sales' ? !revenueTrendExists ? <p className="dashboard-visual-empty">No sales or customer payment records exist in this date range.</p> : (
            <div className="executive-main-chart-canvas" role="img" aria-label={`Sales revenue and customer payments chart, ${chartPeriodLabel}`}>
              <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 16, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="rgba(220, 224, 232, 0.08)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#9296a0', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} minTickGap={20} />
                <YAxis yAxisId="money" width={76} tick={{ fill: '#9296a0', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toLocaleString()} />
                <YAxis yAxisId="units" orientation="right" width={32} tick={{ fill: '#9296a0', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip formatter={(value, name) => [name === 'Vehicles sold' ? Number(value ?? 0) : money(Number(value ?? 0)), name]} contentStyle={{ background: '#202127', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#f5f5f7' }} labelStyle={{ color: '#f5f5f7' }} />
                <Legend wrapperStyle={{ color: '#c4c6cc', fontSize: 12 }} />
                <Area yAxisId="money" type="monotone" dataKey="revenue" name="Sales revenue" fill="rgba(157, 91, 255, 0.15)" stroke="#a855f7" strokeWidth={3} activeDot={{ r: 5, fill: '#c084fc' }} />
                <Line yAxisId="money" type="monotone" dataKey="cash" name="Customer payments received" stroke="#258bff" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                <Line yAxisId="units" type="monotone" dataKey="units" name="Vehicles sold" stroke="#4cc89a" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </ComposedChart></ResponsiveContainer>
            </div>
          ) : !fundingTrendExists ? <p className="dashboard-visual-empty">No funding contributions exist in this date range.</p> : (
            <div className="executive-main-chart-canvas" role="img" aria-label={`Partner and investor contribution chart, ${chartPeriodLabel}`}>
              <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 16, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="rgba(220, 224, 232, 0.08)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#9296a0', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} minTickGap={20} />
                <YAxis width={76} tick={{ fill: '#9296a0', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toLocaleString()} />
                <Tooltip formatter={(value, name) => [money(Number(value ?? 0)), name]} contentStyle={{ background: '#202127', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#f5f5f7' }} labelStyle={{ color: '#f5f5f7' }} />
                <Legend wrapperStyle={{ color: '#c4c6cc', fontSize: 12 }} />
                <Area type="monotone" dataKey="partnerFunding" name="Partner contributions" stroke="#a855f7" fill="rgba(168, 85, 247, 0.18)" strokeWidth={3} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="investorFunding" name="Investor contributions" stroke="#258bff" fill="rgba(37, 139, 255, 0.12)" strokeWidth={2.5} activeDot={{ r: 4 }} />
              </AreaChart></ResponsiveContainer>
            </div>
          )
        )}
        {activeMainChart === 'sales' && <p className="executive-main-chart-footnote">Profit is shown only when supported by a unique approved calculation. {priorComparison}</p>}
      </section>
      <DashboardVisualCharts data={chartData} inventory={inventoryBreakdown(currentInventory)} role={profile.role === 'partner' ? 'partner' : 'super_admin'} periodLabel={chartPeriodLabel} showCapitalActivity={activeMainChart !== 'funding'} />
      <details className="executive-secondary-metrics">
        <summary>Inventory and financial context <span>Additional recorded metrics</span></summary>
        <div className="executive-secondary-kpi-grid">
          {additionalKpis.map((item) => <KpiCard key={item.label} {...item} loading={loading} compact />)}
        </div>
      </details>
      <details className="executive-secondary-metrics executive-data-methodology">
        <summary>How dashboard figures are calculated <span>Definitions and data limitations</span></summary>
        <p className="executive-data-note">Cash received uses sale payment records. Outstanding uses the stored sales balance and is not reconciled against payment rows because the schema does not define whether advances are duplicated in those rows. Purchase capital acquired is recorded vehicle purchase value, not profit or additional funding. Current inventory and tied-up purchase value are snapshot metrics. Profit is shown only from exactly one approved stored calculation per completed sale; gross profit has no defined source field. Average completed sale price: {completedSales.length ? money(revenuePerSale) : 'Not available — no completed sales in this range.'} Previous period: {priorCompletedSales.length ? money(previousRevenuePerSale) : 'No completed sales'}.</p>
      </details>

      <section className="glass-panel panel-section">
        <div className="section-head"><div><h3>Inventory performance</h3><p className="muted">Current unsold showroom vehicles; age uses recorded purchase date.</p></div></div>
        <div className="executive-aging-grid">{ageGroups.map((group) => <div className="executive-aging-item" key={group.label}><span>{group.label}</span><strong>{group.count}</strong></div>)}<div className="executive-aging-item"><span>Purchase date missing</span><strong>{currentInventory.filter((item) => !item.purchase_date).length}</strong></div></div>
        <label className="executive-table-search">Search inventory<input type="search" value={reportFilter} onChange={(event) => { setReportFilter(event.target.value); setInventoryPage(0); }} placeholder="Vehicle or registration" /></label>
        <div className="table-scroll"><table className="data-table executive-table"><thead><tr><th>Vehicle</th><th>Registration</th><th>Purchase date</th><th>Purchase price</th><th>Expected sale</th><th>Status</th><th>Days in inventory</th></tr></thead><tbody>
          {currentInventoryRows.map((vehicle) => <tr key={vehicle.id}><td><Link to={`/inventory/${vehicle.id}`}>{vehicleLabel(vehicle)}</Link></td><td>{vehicle.registration_number || 'Not recorded'}</td><td>{vehicle.purchase_date || 'Not recorded'}</td><td>{vehicle.purchase_price === null ? 'Not recorded' : money(Number(vehicle.purchase_price))}</td><td>{vehicle.expected_sale_price === null ? 'Not recorded' : money(Number(vehicle.expected_sale_price))}</td><td>{vehicle.status}</td><td>{vehicle.purchase_date ? `${ageDays(vehicle)} days` : 'Not available'}</td></tr>)}
          {!loading && !currentInventoryRows.length && <tr><td colSpan={7}>No matching unsold inventory.</td></tr>}
        </tbody></table></div>
        <Pagination page={inventoryPage} pageCount={Math.max(1, Math.ceil(inventoryRows.length / pageSize))} setPage={setInventoryPage} />
      </section>

      {(profile.role === 'super_admin' || profile.role === 'partner') && (
        <section className="glass-panel panel-section">
          <div className="section-head"><div><h3>Partner performance</h3><p className="muted">Vehicle-linked sales revenue is association only; it is not allocated or shared by funding percentage. Contributions and approved allocations use the selected period; paid and payable amounts include all payout records linked to those allocations.</p></div></div>
          <div className="table-scroll"><table className="data-table executive-table"><thead><tr><th>Partner</th><th>Vehicles funded</th><th>Contributions in range</th><th>Associated sale revenue</th><th>Approved profit allocated</th><th>Paid</th><th>Payable</th><th>Capital tied up</th></tr></thead><tbody>
            {partnerStats.filter((item) => profile.role !== 'super_admin' || !partyFilterValue || item.id === partyFilterValue).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.vehiclesFunded}</td><td>{moneyForRecords(item.contributed, item.contributionCount, 'No recorded contributions')}</td><td>{moneyForRecords(item.associatedRevenue, item.associatedSaleCount, 'No associated sales')}</td><td>{moneyForRecords(item.allocated, item.allocationCount, 'Not yet available')}</td><td>{moneyForRecords(item.paid, item.paymentCount, 'No recorded payments')}</td><td>{moneyForRecords(item.payable, item.allocationCount, 'Not yet available')}</td><td>{moneyForRecords(item.tiedCapital, item.vehiclesFunded, 'No recorded funding')}</td></tr>)}
            {!loading && !partnerStats.length && <tr><td colSpan={8}>No partner funding records are visible.</td></tr>}
          </tbody></table></div>
        </section>
      )}
      {profile.role === 'super_admin' && (
        <section className="glass-panel panel-section">
          <div className="section-head"><div><h3>Investor performance</h3><p className="muted">Investor rows are limited to administrators; allocations use approved distribution records.</p></div></div>
          <div className="table-scroll"><table className="data-table executive-table"><thead><tr><th>Investor</th><th>Vehicles funded</th><th>Contributions in range</th><th>Associated sale revenue</th><th>Approved profit allocated</th><th>Paid</th><th>Payable</th><th>Capital tied up</th></tr></thead><tbody>
            {investorStats.filter((item) => !partyFilterValue || item.id === partyFilterValue).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.vehiclesFunded}</td><td>{moneyForRecords(item.contributed, item.contributionCount, 'No recorded contributions')}</td><td>{moneyForRecords(item.associatedRevenue, item.associatedSaleCount, 'No associated sales')}</td><td>{moneyForRecords(item.allocated, item.allocationCount, 'Not yet available')}</td><td>{moneyForRecords(item.paid, item.paymentCount, 'No recorded payments')}</td><td>{moneyForRecords(item.payable, item.allocationCount, 'Not yet available')}</td><td>{moneyForRecords(item.tiedCapital, item.vehiclesFunded, 'No recorded funding')}</td></tr>)}
            {!loading && !investorStats.length && <tr><td colSpan={8}>No investor funding records are visible.</td></tr>}
          </tbody></table></div>
        </section>
      )}

      <section className="glass-panel panel-section">
        <div className="section-head"><div><h3>Financial summaries</h3><p className="muted">Search and page through records in the selected date range.</p></div></div>
        <label className="executive-table-search">Search financial records<input type="search" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Search customer, vehicle, payment, expense" /></label>
        <div className="executive-summary-grid">
          <DashboardTable title="Recent vehicle purchases" columns={[
            { title: 'Vehicle', value: (item: Vehicle) => <Link to={`/inventory/${item.id}`}>{vehicleLabel(item)}</Link> },
            { title: 'Date', value: (item: Vehicle) => item.purchase_date ?? 'Not recorded' },
            { title: 'Purchase price', value: (item: Vehicle) => item.purchase_price === null ? 'Not recorded' : money(Number(item.purchase_price)) },
          ]} rows={recentPurchases} loading={loading} search={tableFilter} />
          <DashboardTable title="Recent vehicle sales" columns={[
            { title: 'Vehicle', value: (item: Sale) => <Link to={`/inventory/${item.vehicle_id}`}>{vehicleLabel(allVehiclesById.get(item.vehicle_id))}</Link> },
            { title: 'Customer', value: (item: Sale) => item.customer_name },
            { title: 'Date', value: (item: Sale) => item.sale_date },
            { title: 'Sale price', value: (item: Sale) => money(Number(item.selling_price)) },
          ]} rows={recentSales} loading={loading} search={tableFilter} />
          <DashboardTable title="Recent customer payments" columns={[
            { title: 'Vehicle', value: (item: SalePayment) => <Link to={`/inventory/${salesById.get(item.sale_id)?.vehicle_id ?? ''}`}>{vehicleLabel(allVehiclesById.get(salesById.get(item.sale_id)?.vehicle_id ?? ''))}</Link> },
            { title: 'Date', value: (item: SalePayment) => item.payment_date },
            { title: 'Amount', value: (item: SalePayment) => money(Number(item.amount)) },
            { title: 'Method', value: (item: SalePayment) => item.payment_method || 'Not recorded' },
          ]} rows={recentPayments} loading={loading} search={tableFilter} />
          <DashboardTable title="Outstanding customer balances" columns={[
            { title: 'Customer', value: (item: Sale) => item.customer_name },
            { title: 'Vehicle', value: (item: Sale) => <Link to={`/inventory/${item.vehicle_id}`}>{vehicleLabel(allVehiclesById.get(item.vehicle_id))}</Link> },
            { title: 'Sale date', value: (item: Sale) => item.sale_date },
            { title: 'Stored balance', value: (item: Sale) => item.remaining_balance === null ? 'Not recorded' : money(Number(item.remaining_balance)) },
          ]} rows={recentOutstanding} loading={loading} search={tableFilter} />
          <DashboardTable title="Recent vehicle expenses" columns={[
            { title: 'Vehicle', value: (item: ExpenseRow) => item.vehicleId ? <Link to={`/inventory/${item.vehicleId}`}>{item.vehicle}</Link> : item.vehicle },
            { title: 'Type', value: (item: ExpenseRow) => item.type },
            { title: 'Date', value: (item: ExpenseRow) => item.date },
            { title: 'Amount', value: (item: ExpenseRow) => money(Number(item.amount)) },
          ]} rows={recentExpenses} loading={loading} search={tableFilter} />
          <DashboardTable title="Recent approved distributions" columns={[
            { title: 'Vehicle', value: (item: Distribution) => <Link to={`/inventory/${item.vehicle_id}`}>{vehicleLabel(allVehiclesById.get(item.vehicle_id))}</Link> },
            { title: 'Type', value: (item: Distribution) => `${item.recipient_type} · ${item.rule_name}` },
            { title: 'Date', value: (item: Distribution) => localTimestampDate(item.created_at) },
            { title: 'Amount', value: (item: Distribution) => money(Number(item.amount)) },
          ]} rows={recentDistributions} loading={loading} search={tableFilter} />
        </div>
      </section>

      <section className="glass-panel panel-section">
        <div className="section-head"><div><h3>Reports & exports</h3><p className="muted">CSV exports use current permissions and selected date range. PDF export is not configured.</p></div></div>
        <div className="executive-report-controls">
          <label>Report<select value={reportType} onChange={(event) => setReportType(event.target.value)}>
            <option value="sales">Sales report</option><option value="inventory">Inventory report</option><option value="purchases">Purchase report</option><option value="payments">Customer payment report</option><option value="outstanding">Outstanding balance report</option><option value="aging">Vehicle aging report</option><option value="expenses">Vehicle expense report</option>
            {(profile.role === 'super_admin' || profile.role === 'partner') && <option value="partners">Partner performance report</option>}
            {profile.role === 'super_admin' && <option value="investors">Investor statement</option>}
          </select></label>
          {profile.role === 'super_admin' && <label>Person filter<select value={partyFilterValue} onChange={(event) => setPartyFilterValue(event.target.value)}><option value="">All people</option>{partyOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
          <button type="button" className="primary-button" onClick={() => exportReport()}>Export CSV</button>
        </div>
      </section>
    </div>
  );
}

type ExpenseRow = { vehicleId: string | null; vehicle: string; type: string; date: string; amount: number };
function selectedExpensesFor(data: DashboardData, bounds: DateBounds | null, vehicles: Map<string, Vehicle>): ExpenseRow[] {
  return [...data.vehicleExpenses, ...data.generalExpenses]
    .filter((item) => inRange(item.expense_date, bounds))
    .map((item) => ({ vehicleId: item.vehicle_id ?? null, vehicle: item.vehicle_id ? vehicleLabel(vehicles.get(item.vehicle_id)) : 'Showroom expense', type: item.expense_type ?? item.category ?? 'Expense', date: item.expense_date, amount: Number(item.amount) }));
}

function vehicleLabel(vehicle: Vehicle | undefined): string {
  return vehicle ? [vehicle.manufacturing_year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : 'Vehicle not recorded';
}

function DashboardHeader({
  profile, preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, loading, refresh, periodLabel, liveStatus, lastUpdatedAt,
}: {
  profile: UserProfile;
  preset: DateRangePreset;
  setPreset: (value: DateRangePreset) => void;
  customStart: string;
  setCustomStart: (value: string) => void;
  customEnd: string;
  setCustomEnd: (value: string) => void;
  loading: boolean;
  refresh: () => void;
  periodLabel: string;
  liveStatus: 'connecting' | 'live' | 'offline';
  lastUpdatedAt: Date | null;
}) {
  return (
    <header className="executive-dashboard-header">
      <div><p className="eyebrow">Executive insights · {periodLabel}</p><h2>Welcome back, {profile.full_name?.trim().split(/\s+/)[0] || 'team'}</h2><div className={`dashboard-live-status ${liveStatus}`} role="status" title="Supabase table events refresh this dashboard when Realtime is enabled for the tracked tables."><i />{liveStatus === 'live' ? 'Live channel connected' : liveStatus === 'connecting' ? 'Connecting live channel…' : 'Live channel unavailable'}{lastUpdatedAt && <span>Last synced {lastUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</div></div>
      <div className="executive-controls">
        <div className="executive-range-tabs" role="group" aria-label="Quick date range">
          {([
            ['today', 'Today'],
            ['this_week', 'Week'],
            ['this_month', 'Month'],
          ] as const).map(([value, label]) => <button key={value} type="button" className={preset === value ? 'active' : ''} aria-pressed={preset === value} onClick={() => setPreset(value)}>{label}</button>)}
        </div>
        <label className="executive-period-select">More periods<select aria-label="Dashboard date range" value={['today', 'this_week', 'this_month'].includes(preset) ? '' : preset} onChange={(event) => setPreset(event.target.value as DateRangePreset)}>
          <option value="" disabled>More periods</option><option value="previous_month">Previous month</option><option value="last_3_months">Last 3 months</option><option value="this_year">This year</option><option value="all_time">All time</option><option value="custom">Custom range</option>
        </select></label>
        {preset === 'custom' && <><label>From<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>To<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></>}
        <button type="button" className="ghost-button" disabled={loading} onClick={refresh}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
    </header>
  );
}

function KpiCard({ icon: Icon, label, value, sub, comparison, loading, compact = false }: {
  icon?: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  comparison?: string;
  loading: boolean;
  compact?: boolean;
}) {
  return (
    <article className={`executive-kpi glass-panel${compact ? ' compact' : ''}`}>
      <div className="executive-kpi-top"><span>{label}</span>{Icon && <i className="executive-kpi-icon"><Icon size={18} aria-hidden="true" /></i>}</div>
      <strong>{loading ? <span className="executive-skeleton" aria-label="Loading" /> : value}</strong>
      {sub && <small>{sub}</small>}
      {comparison && !loading && <small className="executive-kpi-comparison">{comparison}</small>}
    </article>
  );
}

function DashboardTable<Row extends object>({ title, columns, rows, loading, search }: { title: string; columns: TableColumn<Row>[]; rows: Row[]; loading: boolean; search: string }) {
  const [page, setPage] = useState(0);
  const pageSize = 5;
  const filtered = search ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search)) : rows;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => setPage(0), [search]);
  return (
    <section className="executive-summary-table">
      <h4>{title}</h4>
      <div className="table-scroll"><table className="data-table executive-table"><thead><tr>{columns.map((column) => <th key={column.title}>{column.title}</th>)}</tr></thead><tbody>
        {filtered.slice(page * pageSize, (page + 1) * pageSize).map((row, index) => <tr key={`${title}-${index}`}>{columns.map((column) => <td key={column.title}>{column.value(row)}</td>)}</tr>)}
        {!loading && !filtered.length && <tr><td colSpan={columns.length}>No records in this range.</td></tr>}
        {loading && <tr><td colSpan={columns.length}><span className="executive-skeleton executive-row-skeleton" aria-label="Loading records" /></td></tr>}
      </tbody></table></div>
      <Pagination page={page} pageCount={pageCount} setPage={setPage} />
    </section>
  );
}

function Pagination({ page, pageCount, setPage }: { page: number; pageCount: number; setPage: (value: number) => void }) {
  return <div className="pagination-controls executive-pagination"><span className="muted">Page {page + 1} of {pageCount}</span><div><button type="button" className="ghost-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="ghost-button" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Next</button></div></div>;
}
