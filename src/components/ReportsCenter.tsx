import { useCallback, useEffect, useMemo, useState } from 'react';
import type { jsPDF as JsPDFDocument } from 'jspdf';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { supabase, supabaseConfigError } from '../lib/supabase';
import { escapeCsvField, formatLocalDate, localDateText, localTimestampBoundary, reportDateBounds } from '../lib/reportFormatting';

type Role = 'pending' | 'super_admin' | 'partner' | 'investor';
type Profile = { role: Role; full_name: string | null; is_active: boolean };
type DbRow = Record<string, unknown>;
type ReportRecord = { id: string; fields: Record<string, string>; filters: Record<string, string> };
type SummaryItem = { label: string; value: string; note?: string };
type ReportData = { columns: string[]; rows: ReportRecord[]; summary: SummaryItem[]; limitations: string[]; subjectName?: string; generatedAt?: string };
type ReportId =
  | 'sales' | 'inventory' | 'purchases' | 'payments' | 'balances' | 'vehicle-expenses'
  | 'showroom-expenses' | 'partner' | 'investor' | 'profit' | 'aging' | 'transactions'
  | 'monthly' | 'custom';

type ReportDefinition = { id: ReportId; title: string; description: string };
const definitions: ReportDefinition[] = [
  { id: 'sales', title: 'Sales Report', description: 'Recorded vehicle sales, customer, status, and sale price.' },
  { id: 'inventory', title: 'Inventory Report', description: 'Current vehicle inventory and recorded purchase details.' },
  { id: 'purchases', title: 'Purchase Report', description: 'Vehicle purchase records and linked recorded funding.' },
  { id: 'payments', title: 'Customer Payment Report', description: 'Actual customer payment rows by payment date.' },
  { id: 'balances', title: 'Outstanding Balance Report', description: 'Stored balances for non-cancelled sales.' },
  { id: 'vehicle-expenses', title: 'Vehicle Expense Report', description: 'Vehicle-specific expenses by recorded expense date.' },
  { id: 'showroom-expenses', title: 'Showroom Expense Report', description: 'General showroom expenses by recorded expense date.' },
  { id: 'partner', title: 'Partner Performance Report', description: 'Partner-linked contributions, sales associations, and approved allocations.' },
  { id: 'investor', title: 'Investor Statement', description: 'Investor-owned contributions, permitted transactions, and approved distributions.' },
  { id: 'profit', title: 'Profit and Distribution Report', description: 'Approved profit calculations and recorded distribution activity.' },
  { id: 'aging', title: 'Vehicle Aging Report', description: 'Current unsold inventory age using recorded purchase dates.' },
  { id: 'transactions', title: 'Finance Transaction Report', description: 'Recorded financial transactions by creation date and type.' },
  { id: 'monthly', title: 'Monthly Business Summary', description: 'Monthly recorded activity, with a prior-month comparison where available.' },
  { id: 'custom', title: 'Custom Business Report', description: 'Choose a report dataset, columns, filters, and sort order.' },
];

const dateRanges = ['Today', 'Yesterday', 'This week', 'This month', 'Previous month', 'Last 3 months', 'Last 6 months', 'This year', 'Previous year', 'All time', 'Custom range'];
const currency = import.meta.env.VITE_DEFAULT_CURRENCY || 'PKR';
const pageSize = 25;
const fetchBatchSize = 500;

function text(value: unknown): string {
  return value == null || value === '' ? 'Not recorded' : String(value);
}

function money(value: unknown): string {
  if (value == null || value === '') return 'Not recorded';
  return `${currency} ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyNumber(value: string | undefined): number | null {
  if (!value || !/^[A-Z]{3}\s[\d,]+(?:\.\d{2})?$/.test(value)) return null;
  return Number(value.replace(/[^\d.-]/g, ''));
}

function amountSum(rows: DbRow[], key: string): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function recordedTotal(rows: DbRow[], key: string, emptyLabel = 'No records'): string {
  const hasAmount = rows.some((row) => row[key] != null && row[key] !== '' && Number.isFinite(Number(row[key])));
  return hasAmount ? money(amountSum(rows, key)) : rows.length ? 'Not recorded' : emptyLabel;
}

function vehicleLabel(row: DbRow | undefined): string {
  if (!row) return 'Vehicle not available';
  return [row.manufacturing_year, row.make, row.model, row.variant].filter(Boolean).join(' ');
}

function record(id: string, values: Record<string, string>, filters: Record<string, string> = {}): ReportRecord {
  return { id, fields: values, filters };
}

function isCancelled(row: DbRow): boolean {
  return String(row.status ?? '').toLowerCase() === 'cancelled';
}

function dateLabel(from: string, to: string): string {
  if (!from && !to) return 'All time';
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  return `Through ${to}`;
}

function canAccessReport(id: ReportId, role: Role): boolean {
  if (role === 'super_admin') return true;
  if (role === 'partner') return id !== 'investor';
  if (role === 'investor') return id === 'investor' || id === 'inventory' || id === 'aging' || id === 'custom';
  return false;
}

export default function ReportsCenter({ profile }: { profile: Profile }) {
  const isAdmin = profile.role === 'super_admin' && profile.is_active;
  const isInvestor = profile.role === 'investor' && profile.is_active;
  const [selected, setSelected] = useState<ReportId>(profile.role === 'investor' ? 'investor' : 'sales');
  const [customCategory, setCustomCategory] = useState<Exclude<ReportId, 'custom'>>(profile.role === 'investor' ? 'investor' : 'sales');
  const [range, setRange] = useState('This month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [month, setMonth] = useState(() => formatLocalDate(new Date()).slice(0, 7));
  const [subjectId, setSubjectId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [customer, setCustomer] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [sortOrder, setSortOrder] = useState('date-desc');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ReportData>({ columns: [], rows: [], summary: [], limitations: [] });
  const [parties, setParties] = useState<{ id: string; name: string; kind: 'partner' | 'investor' }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dateRange = useMemo(() => reportDateBounds(range, customFrom, customTo), [range, customFrom, customTo]);
  const effectiveReport: Exclude<ReportId, 'custom'> = selected === 'custom' ? customCategory : selected;

  const loadAll = useCallback(async (
    table: string,
    columns: string,
    dateColumn?: string,
    from = '',
    to = '',
    filters: { column: string; value: string }[] = [],
    listFilters: { column: string; values: string[] }[] = [],
  ): Promise<DbRow[]> => {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase is unavailable.');
    const client = supabase;
    const fetchRows = async (queryFilters: { column: string; value: string }[], queryListFilters: { column: string; values: string[] }[]) => {
      const output: DbRow[] = [];
      let offset = 0;
      let totalCount: number | null = null;
      while (true) {
        let query = client.from(table).select(columns, offset === 0 ? { count: 'exact' } : {});
        if (dateColumn === 'created_at') {
          if (from) query = query.gte(dateColumn, localTimestampBoundary(from));
          if (to) query = query.lt(dateColumn, localTimestampBoundary(to, true));
        } else {
          if (dateColumn && from) query = query.gte(dateColumn, from);
          if (dateColumn && to) query = query.lte(dateColumn, to);
        }
        for (const filter of queryFilters) query = query.eq(filter.column, filter.value);
        for (const filter of queryListFilters) {
          if (filter.values.length) query = query.in(filter.column, filter.values);
        }
        query = query.order(dateColumn ?? 'created_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + fetchBatchSize - 1);
        const { data: batch, error: queryError, count } = await query;
        if (queryError) throw queryError;
        const rows = (batch ?? []) as unknown as DbRow[];
        output.push(...rows);
        if (offset === 0) totalCount = count;
        if (rows.length === 0 || (totalCount != null && offset + rows.length >= totalCount) || (totalCount == null && rows.length < fetchBatchSize)) break;
        offset += rows.length;
      }
      return output;
    };
    const oversizedFilterIndex = listFilters.findIndex((filter) => filter.values.length > 100);
    if (oversizedFilterIndex !== -1) {
      const filter = listFilters[oversizedFilterIndex];
      const otherFilters = listFilters.filter((_, index) => index !== oversizedFilterIndex);
      const batches: DbRow[][] = [];
      for (let start = 0; start < filter.values.length; start += 100) {
        batches.push(await fetchRows(filters, [
          ...otherFilters,
          { column: filter.column, values: filter.values.slice(start, start + 100) },
        ]));
      }
      return batches.flat();
    }
    return fetchRows(filters, listFilters);
  }, []);

  const loadParties = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    const [partnerRows, investorRows] = await Promise.all([
      loadAll('partners', 'id,name,status', 'created_at'),
      loadAll('investors', 'id,name,status', 'created_at'),
    ]);
    setParties([
      ...partnerRows.map((row) => ({ id: String(row.id), name: String(row.name), kind: 'partner' as const })),
      ...investorRows.map((row) => ({ id: String(row.id), name: String(row.name), kind: 'investor' as const })),
    ]);
  }, [isAdmin, loadAll]);

  useEffect(() => {
    let active = true;
    if (!isAdmin) return () => { active = false; };
    void loadParties().catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load report filter options.');
    });
    return () => { active = false; };
  }, [isAdmin, loadParties]);

  const buildReport = useCallback(async (): Promise<ReportData> => {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase is unavailable.');
    if (effectiveReport === 'monthly' && !/^\d{4}-\d{2}$/.test(month)) throw new Error('Select a valid report month.');
    const [from, to] = effectiveReport === 'monthly'
      ? (() => {
        const [yearText, monthText] = month.split('-');
        const year = Number(yearText);
        const monthNumber = Number(monthText) - 1;
        return [formatLocalDate(new Date(year, monthNumber, 1)), formatLocalDate(new Date(year, monthNumber + 1, 0))];
      })()
      : dateRange;
    if (from && to && from > to) throw new Error('The report start date must be on or before its end date.');
    const rows = async (table: string, columns: string, dateColumn?: string, specificFilters: { column: string; value: string }[] = []) =>
      loadAll(table, columns, dateColumn, from, to, specificFilters);
    const rowsIn = async (table: string, columns: string, dateColumn: string | undefined, specificFilters: { column: string; value: string }[], listFilters: { column: string; values: string[] }[]) =>
      loadAll(table, columns, dateColumn, from, to, specificFilters, listFilters);
    const cars = async () => rows('vehicles', 'id,make,model,variant,manufacturing_year,registration_number,business_category,status,purchase_date,purchase_price,total_additional_costs,expected_sale_price');
    let result: ReportData = { columns: [], rows: [], summary: [], limitations: [] };

    if (effectiveReport === 'sales' || effectiveReport === 'balances') {
      const [sales, vehicles] = await Promise.all([
        rows('sales', 'id,vehicle_id,customer_name,sale_date,selling_price,advance_payment,remaining_balance,status', 'sale_date'),
        cars(),
      ]);
      const carMap = new Map(vehicles.map((row) => [String(row.id), row]));
      const chosen = effectiveReport === 'balances' ? sales.filter((sale) => !isCancelled(sale)) : sales;
      result = {
        columns: ['Date', 'Vehicle', 'Registration', 'Customer', 'Sale price', 'Stored outstanding balance', 'Status'],
        rows: chosen.map((sale) => {
          const car = carMap.get(String(sale.vehicle_id));
          return record(String(sale.id), {
            Date: text(sale.sale_date), Vehicle: vehicleLabel(car), Registration: text(car?.registration_number),
            Customer: text(sale.customer_name), 'Sale price': money(sale.selling_price),
            'Stored outstanding balance': money(sale.remaining_balance), Status: text(sale.status),
          }, {
            vehicle_id: String(sale.vehicle_id), make: String(car?.make ?? ''), model: String(car?.model ?? ''),
            category: String(car?.business_category ?? ''), status: String(sale.status ?? ''),
            customer: String(sale.customer_name ?? ''),
          });
        }),
        summary: effectiveReport === 'sales'
          ? [{ label: 'Completed recorded sales revenue', value: chosen.some((sale) => sale.status === 'completed') ? money(amountSum(chosen.filter((sale) => sale.status === 'completed'), 'selling_price')) : 'No completed sales records', note: 'Cancelled and pending sales are excluded.' }]
          : [{ label: 'Stored outstanding balances', value: chosen.length ? money(chosen.reduce((sum, sale) => sum + Number(sale.remaining_balance ?? 0), 0)) : 'No outstanding sale records', note: 'Based on the current stored balance field; payment rows are not recomputed to avoid legacy duplication.' }],
        limitations: ['Sale revenue includes only completed records; pending records remain visible but are not included in the revenue total.'],
      };
    } else if (['inventory', 'purchases', 'aging'].includes(effectiveReport)) {
      const vehicles = await cars();
      const vehicleInRange = (vehicle: DbRow) => {
        const purchaseDate = String(vehicle.purchase_date ?? '');
        return (!from || purchaseDate >= from) && (!to || purchaseDate <= to);
      };
      const vehicleRows = effectiveReport === 'purchases'
        ? vehicles.filter((vehicle) => vehicle.purchase_date && vehicle.business_category !== 'consignment' && vehicleInRange(vehicle))
        : effectiveReport === 'aging'
          ? vehicles.filter((vehicle) => vehicle.business_category !== 'consignment' && ['available', 'reserved', 'repair'].includes(String(vehicle.status)) && vehicleInRange(vehicle))
          : vehicles.filter(vehicleInRange);
      let funding: DbRow[] = [];
      let partnerRows: DbRow[] = [];
      let investorRows: DbRow[] = [];
      if ((effectiveReport === 'purchases' || effectiveReport === 'inventory') && !isInvestor) {
        [funding, partnerRows, investorRows] = await Promise.all([
          loadAll('funding_contributions', 'id,vehicle_id,partner_id,investor_id,amount,contribution_date,payment_method,reference_number'),
          rows('partners', 'id,name,status'),
          rows('investors', 'id,name,status'),
        ]);
      }
      const fundingByVehicle = new Map<string, DbRow[]>();
      for (const item of funding) {
        const id = String(item.vehicle_id);
        fundingByVehicle.set(id, [...(fundingByVehicle.get(id) ?? []), item]);
      }
      const partnerNames = new Map(partnerRows.map((party) => [String(party.id), String(party.name)]));
      const investorNames = new Map(investorRows.map((party) => [String(party.id), String(party.name)]));
      const showFunding = !isInvestor && (effectiveReport === 'purchases' || effectiveReport === 'inventory');
      const fundingColumns = showFunding ? ['Recorded linked funding', 'Recorded contributors'] : [];
      const dayCount = (date: string) => Math.max(0, Math.floor((new Date(`${formatLocalDate(new Date())}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86400000));
      result = {
        columns: ['Vehicle', 'Registration', 'Category', 'Status', 'Purchase date', 'Purchase price', 'Recorded additional costs', 'Expected sale price', ...fundingColumns, 'Days in inventory'],
        rows: vehicleRows.map((car) => {
          const linked = fundingByVehicle.get(String(car.id)) ?? [];
          const days = car.purchase_date ? dayCount(String(car.purchase_date)) : null;
          const partnerIds = [...new Set(linked.map((item) => String(item.partner_id ?? '')).filter(Boolean))];
          const investorIds = [...new Set(linked.map((item) => String(item.investor_id ?? '')).filter(Boolean))];
          const contributorNames = [...partnerIds.map((id) => partnerNames.get(id)), ...investorIds.map((id) => investorNames.get(id))].filter(Boolean).join(', ');
          return record(String(car.id), {
            Vehicle: vehicleLabel(car), Registration: text(car.registration_number), Category: text(car.business_category),
            Status: text(car.status), 'Purchase date': text(car.purchase_date), 'Purchase price': money(car.purchase_price),
            'Recorded additional costs': money(car.total_additional_costs),
            'Expected sale price': money(car.expected_sale_price),
            ...(showFunding ? {
              'Recorded linked funding': linked.length ? money(amountSum(linked, 'amount')) : 'No linked contribution rows',
              'Recorded contributors': contributorNames || 'No linked contributors',
            } : {}),
            'Days in inventory': days == null ? 'Not available — purchase date missing' : String(days),
          }, {
            vehicle_id: String(car.id), make: String(car.make ?? ''), model: String(car.model ?? ''),
            category: String(car.business_category ?? ''), status: String(car.status ?? ''),
            partner: partnerIds.join(','), investor: investorIds.join(','),
            person: contributorNames.toLowerCase(),
          });
        }),
        summary: [
          { label: effectiveReport === 'aging' ? 'Current unsold vehicles' : 'Vehicles in report', value: String(vehicleRows.length) },
          { label: 'Recorded purchase value', value: vehicleRows.some((car) => car.purchase_price != null) ? money(vehicleRows.reduce((sum, car) => sum + Number(car.purchase_price ?? 0), 0)) : 'Not recorded', note: 'Missing purchase prices are not included in this total.' },
        ],
        limitations: effectiveReport === 'aging'
          ? ['Age uses recorded purchase date and current unsold showroom-vehicle status. Consignment intake dates and historical status snapshots are not stored.']
          : effectiveReport === 'inventory'
            ? ['This is a current inventory view; the date filter, when used, applies to recorded purchase date, not historical status.']
            : ['Customer consignments are excluded from purchases. Funding totals include only linked partner/investor contribution rows; third-party and mixed funding are not represented in the existing workflow.'],
      };
    } else if (effectiveReport === 'payments') {
      const [payments, sales, vehicles] = await Promise.all([
        rows('sale_payments', 'id,sale_id,amount,payment_method,payment_date,reference_number', 'payment_date'),
        rows('sales', 'id,vehicle_id,customer_name,status'),
        cars(),
      ]);
      const salesMap = new Map(sales.map((sale) => [String(sale.id), sale]));
      const vehicleMap = new Map(vehicles.map((car) => [String(car.id), car]));
      result = {
        columns: ['Payment date', 'Vehicle', 'Customer', 'Amount received', 'Payment method', 'Reference'],
        rows: payments.map((payment) => {
          const sale = salesMap.get(String(payment.sale_id));
          const car = sale ? vehicleMap.get(String(sale.vehicle_id)) : undefined;
          return record(String(payment.id), {
            'Payment date': text(payment.payment_date), Vehicle: vehicleLabel(car), Customer: text(sale?.customer_name),
            'Amount received': money(payment.amount), 'Payment method': text(payment.payment_method), Reference: text(payment.reference_number),
          }, { vehicle_id: String(sale?.vehicle_id ?? ''), make: String(car?.make ?? ''), model: String(car?.model ?? ''), category: String(car?.business_category ?? ''), customer: String(sale?.customer_name ?? ''), payment_method: String(payment.payment_method ?? '') });
        }),
        summary: [{ label: 'Actual recorded customer payments', value: payments.length ? money(amountSum(payments, 'amount')) : 'No payment rows', note: 'Payment rows only; advance_payment is not added.' }],
        limitations: ['Historical advance fields are not combined with payment rows because the schema does not define whether they duplicate earlier payment records.'],
      };
    } else if (effectiveReport === 'vehicle-expenses' || effectiveReport === 'showroom-expenses') {
      const vehicleScope = effectiveReport === 'vehicle-expenses';
      const [expenses, vehicles] = await Promise.all([
        vehicleScope
          ? rows('vehicle_expenses', 'id,vehicle_id,expense_type,amount,expense_date,payment_method,notes', 'expense_date')
          : rows('general_expenses', 'id,category,amount,expense_date,payment_method,notes', 'expense_date'),
        vehicleScope ? cars() : Promise.resolve([] as DbRow[]),
      ]);
      const vehicleMap = new Map(vehicles.map((car) => [String(car.id), car]));
      result = {
        columns: ['Expense date', ...(vehicleScope ? ['Vehicle'] : []), 'Category', 'Amount', 'Payment method', 'Description'],
        rows: expenses.map((item) => {
          const car = vehicleScope ? vehicleMap.get(String(item.vehicle_id)) : undefined;
          const categoryValue = vehicleScope ? item.expense_type : item.category;
          return record(String(item.id), {
            'Expense date': text(item.expense_date), ...(vehicleScope ? { Vehicle: vehicleLabel(car) } : {}),
            Category: text(categoryValue), Amount: money(item.amount), 'Payment method': text(item.payment_method), Description: text(item.notes),
          }, { vehicle_id: String(item.vehicle_id ?? ''), make: String(car?.make ?? ''), model: String(car?.model ?? ''), category: String(car?.business_category ?? ''), expense_category: String(categoryValue ?? ''), payment_method: String(item.payment_method ?? '') });
        }),
        summary: [{ label: vehicleScope ? 'Recorded vehicle expenses' : 'Recorded showroom expenses', value: expenses.length ? money(amountSum(expenses, 'amount')) : 'No expense rows' }],
        limitations: ['Responsible person and payment status are not stored in the existing expense schema.'],
      };
    } else if (effectiveReport === 'transactions') {
      const transactions = await rows('financial_transactions', 'id,transaction_type,amount,currency,related_vehicle_id,related_partner_id,related_investor_id,status,created_at,notes', 'created_at');
      const [vehicles, partnerRows, investorRows] = await Promise.all([
        !isInvestor ? cars() : Promise.resolve([] as DbRow[]),
        !isInvestor ? rows('partners', 'id,name,status') : Promise.resolve([] as DbRow[]),
        !isInvestor ? rows('investors', 'id,name,status') : Promise.resolve([] as DbRow[]),
      ]);
      const vehicleMap = new Map(vehicles.map((car) => [String(car.id), car]));
      const partnerMap = new Map(partnerRows.map((party) => [String(party.id), String(party.name)]));
      const investorMap = new Map(investorRows.map((party) => [String(party.id), String(party.name)]));
      result = {
        columns: ['Created date', 'Transaction type', 'Amount', 'Currency', 'Status', 'Vehicle', 'Person', 'Notes'],
        rows: transactions.map((item) => record(String(item.id), {
          'Created date': localDateText(item.created_at), 'Transaction type': text(item.transaction_type),
          Amount: money(item.amount), Currency: text(item.currency), Status: text(item.status),
          Vehicle: item.related_vehicle_id ? vehicleLabel(vehicleMap.get(String(item.related_vehicle_id))) : 'Not linked',
          Person: partnerMap.get(String(item.related_partner_id ?? '')) ?? investorMap.get(String(item.related_investor_id ?? '')) ?? 'Not linked',
          Notes: text(item.notes),
        }, {
          vehicle_id: String(item.related_vehicle_id ?? ''), transaction_type: String(item.transaction_type ?? ''),
          partner: String(item.related_partner_id ?? ''), investor: String(item.related_investor_id ?? ''),
          person: partnerMap.get(String(item.related_partner_id ?? '')) ?? investorMap.get(String(item.related_investor_id ?? '')) ?? '',
        })),
        summary: [{ label: 'Recorded transaction rows', value: String(transactions.length), note: 'Free-text types are not classified as inflow/outflow.' }],
        limitations: ['Financial transactions are not reconciled against dedicated payments, contributions, or expenses. Do not treat this report as a cash balance.'],
      };
    } else if (effectiveReport === 'partner' || effectiveReport === 'investor') {
      const kind = effectiveReport;
      let selectedId = subjectId;
      if (!isAdmin) {
        const rpc = kind === 'partner' ? 'current_partner_id' : 'current_investor_id';
        const { data: ownId, error: idError } = await supabase.rpc(rpc);
        if (idError) throw idError;
        selectedId = String(ownId ?? '');
        if (!selectedId) throw new Error(`The active ${kind} account is not linked to a ${kind} record.`);
      }
      if (!selectedId && isAdmin) {
        result = { columns: [], rows: [], summary: [], limitations: ['Select a person to generate a statement.'] };
      } else {
        const idColumn = kind === 'partner' ? 'partner_id' : 'investor_id';
        const selectedFilter = [{ column: idColumn, value: selectedId }];
        const [funding, distributions, transactions, subjectRows, lifetimeFunding] = await Promise.all([
          rows('funding_contributions', 'id,vehicle_id,partner_id,investor_id,amount,contribution_date,payment_method,reference_number', 'contribution_date', selectedFilter),
          rows('profit_distributions', 'id,vehicle_id,recipient_type,recipient_id,amount,rule_name,approval_status,created_at', 'created_at', [
            { column: 'recipient_type', value: kind }, { column: 'recipient_id', value: selectedId },
          ]),
          rows('financial_transactions', 'id,transaction_type,amount,currency,related_vehicle_id,related_partner_id,related_investor_id,status,created_at,notes', 'created_at', [
            { column: kind === 'partner' ? 'related_partner_id' : 'related_investor_id', value: selectedId },
          ]),
          rows(kind === 'partner' ? 'partners' : 'investors', 'id,name,status', undefined, [{ column: 'id', value: selectedId }]),
          rowsIn('funding_contributions', 'id,vehicle_id,partner_id,investor_id,amount,contribution_date,payment_method,reference_number', undefined, selectedFilter, []),
        ]);
        const eligibleFunding = funding.filter((item) => item[idColumn] === selectedId);
        const lifetimeEligibleFunding = lifetimeFunding.filter((item) => item[idColumn] === selectedId);
        const fundedVehicleIds = [...new Set(lifetimeEligibleFunding.map((item) => String(item.vehicle_id)))];
        const vehicles = fundedVehicleIds.length
          ? await loadAll('vehicles', 'id,make,model,variant,manufacturing_year,registration_number,business_category,status,purchase_date,purchase_price', undefined, '', '', [], [{ column: 'id', values: fundedVehicleIds }])
          : [];
        const vehicleMap = new Map(vehicles.filter((car) => fundedVehicleIds.includes(String(car.id))).map((car) => [String(car.id), car]));
        let sales: DbRow[] = [];
        let paidRows: DbRow[] = [];
        let lifetimePaidRows: DbRow[] = [];
        if (kind === 'partner') {
          sales = await rowsIn('sales', 'id,vehicle_id,sale_date,selling_price,status', 'sale_date', [], [{ column: 'vehicle_id', values: fundedVehicleIds }]);
        }
        const distributionIds = distributions.map((item) => String(item.id));
        if (distributionIds.length) {
          [paidRows, lifetimePaidRows] = await Promise.all([
            rowsIn('distribution_payments', 'id,distribution_id,paid_amount,payment_date,payment_method', 'payment_date', [], [{ column: 'distribution_id', values: distributionIds }]),
            loadAll('distribution_payments', 'id,distribution_id,paid_amount,payment_date,payment_method', undefined, '', '', [], [{ column: 'distribution_id', values: distributionIds }]),
          ]);
        }
        const relevantSales = kind === 'partner'
          ? sales.filter((sale) => fundedVehicleIds.includes(String(sale.vehicle_id)))
          : [];
        const approvedDistributions = distributions.filter((item) => item.approval_status === 'approved');
        const approvedPaidRows = paidRows.filter((payment) => approvedDistributions.some((distribution) => distribution.id === payment.distribution_id));
        const lifetimeApprovedPaidRows = lifetimePaidRows.filter((payment) => approvedDistributions.some((distribution) => distribution.id === payment.distribution_id));
        const allocated = amountSum(approvedDistributions, 'amount');
        const paid = amountSum(approvedPaidRows, 'paid_amount');
        const lifetimePaid = amountSum(lifetimeApprovedPaidRows, 'paid_amount');
        const unsoldIds = new Set(vehicles.filter((car) => ['available', 'reserved', 'repair'].includes(String(car.status))).map((car) => String(car.id)));
        const tiedRows = lifetimeEligibleFunding.filter((item) => unsoldIds.has(String(item.vehicle_id)));
        const entries: ReportRecord[] = [
          ...eligibleFunding.map((item) => record(String(item.id), {
            Date: text(item.contribution_date), 'Record type': 'Capital contribution', Vehicle: vehicleLabel(vehicleMap.get(String(item.vehicle_id))),
            Description: `${kind === 'partner' ? 'Partner' : 'Investor'} contribution · ${text(item.payment_method)}`,
            Amount: money(item.amount), Status: 'Recorded',
          }, {
            vehicle_id: String(item.vehicle_id), [kind]: selectedId, payment_method: String(item.payment_method ?? ''),
            unsold: String(unsoldIds.has(String(item.vehicle_id))),
          })),
          ...relevantSales.map((item) => record(`sale-${item.id}`, {
            Date: text(item.sale_date), 'Record type': 'Associated vehicle sale', Vehicle: vehicleLabel(vehicleMap.get(String(item.vehicle_id))),
            Description: 'Associated by a funded vehicle; not a personal profit allocation.',
            Amount: item.status === 'completed' ? money(item.selling_price) : 'Not counted — sale not completed',
            Status: text(item.status),
          }, { vehicle_id: String(item.vehicle_id), [kind]: selectedId })),
          ...distributions.map((item) => record(`distribution-${item.id}`, {
            Date: localDateText(item.created_at), 'Record type': 'Profit allocation', Vehicle: vehicleLabel(vehicleMap.get(String(item.vehicle_id))),
            Description: text(item.rule_name), Amount: item.approval_status === 'approved' ? money(item.amount) : 'Not approved',
            Status: text(item.approval_status),
          }, {
            vehicle_id: String(item.vehicle_id), [kind]: selectedId,
            paid_lifetime: String(lifetimeApprovedPaidRows.filter((payment) => payment.distribution_id === item.id).reduce((sum, payment) => sum + Number(payment.paid_amount), 0)),
          })),
          ...approvedPaidRows.map((item) => record(`distribution-payment-${item.id}`, {
            Date: text(item.payment_date), 'Record type': 'Profit paid', Vehicle: vehicleLabel(vehicleMap.get(String(distributions.find((distribution) => distribution.id === item.distribution_id)?.vehicle_id))),
            Description: text(item.payment_method), Amount: money(item.paid_amount), Status: 'Paid',
          }, { [kind]: selectedId, payment_method: String(item.payment_method ?? '') })),
          ...transactions.map((item) => record(`transaction-${item.id}`, {
            Date: localDateText(item.created_at), 'Record type': `Financial transaction · ${text(item.transaction_type)}`,
            Vehicle: item.related_vehicle_id ? vehicleLabel(vehicleMap.get(String(item.related_vehicle_id))) : 'Not linked',
            Description: text(item.notes), Amount: money(item.amount), Status: text(item.status),
          }, { vehicle_id: String(item.related_vehicle_id ?? ''), [kind]: selectedId, transaction_type: String(item.transaction_type ?? '') })),
        ];
        const subjectName = isAdmin
          ? parties.find((party) => party.id === selectedId)?.name ?? `${kind} (name unavailable)`
          : String(subjectRows[0]?.name ?? profile.full_name ?? `${kind} account`);
        result = {
          columns: ['Date', 'Record type', 'Vehicle', 'Description', 'Amount', 'Status'],
          rows: entries.sort((a, b) => b.fields.Date.localeCompare(a.fields.Date)),
          subjectName,
          summary: [
            { label: 'Recorded capital contributions', value: eligibleFunding.length ? money(amountSum(eligibleFunding, 'amount')) : 'No recorded contributions' },
            { label: 'Associated completed sale revenue', value: kind === 'partner' ? (relevantSales.some((sale) => sale.status === 'completed') ? recordedTotal(relevantSales.filter((sale) => sale.status === 'completed'), 'selling_price') : 'No completed associated sales') : 'Not available under investor row permissions' },
            { label: 'Approved profit allocations', value: approvedDistributions.length ? money(allocated) : 'Not yet available' },
            { label: 'Profit paid', value: approvedPaidRows.length ? money(paid) : 'No recorded payments' },
            { label: 'Profit payable', value: approvedDistributions.length ? (allocated < lifetimePaid ? `Overpaid by ${money(lifetimePaid - allocated)}` : money(allocated - lifetimePaid)) : 'Not yet available' },
            { label: 'Lifetime recorded contributions tied to current unsold vehicles', value: tiedRows.length ? money(amountSum(tiedRows, 'amount')) : 'No recorded contributed capital tied up' },
          ],
          limitations: [
            `Statement for ${subjectName}; records are filtered to the selected ${kind} ID and RLS remains authoritative.`,
            ...(kind === 'investor' ? ['Associated sale details are unavailable to investor accounts under the existing RLS policies; no sales or customer data were queried.'] : []),
            'Tied capital uses lifetime recorded contributions on currently unsold linked vehicles, not a historical capital balance.',
            'Profit paid is shown for the selected period; outstanding payable subtracts all recorded payments against the selected approved allocations.',
          ],
        };
      }
    } else if (effectiveReport === 'profit') {
      if (isInvestor) throw new Error('Profit calculation details are restricted under this account’s row permissions.');
      const [calculations, distributions, payments, vehicles, partnerRows, investorRows] = await Promise.all([
        rows('profit_calculations', 'id,vehicle_id,sale_id,purchase_cost,approved_expenses,sale_proceeds,net_profit,status,created_at', 'created_at', [{ column: 'status', value: 'approved' }]),
        rows('profit_distributions', 'id,vehicle_id,recipient_type,recipient_id,amount,rule_name,approval_status,created_at', 'created_at'),
        rows('distribution_payments', 'id,distribution_id,paid_amount,payment_date,payment_method', 'payment_date'),
        cars(),
        isAdmin ? rows('partners', 'id,name,status') : Promise.resolve([] as DbRow[]),
        isAdmin ? rows('investors', 'id,name,status') : Promise.resolve([] as DbRow[]),
      ]);
      const vehicleMap = new Map(vehicles.map((car) => [String(car.id), car]));
      const distMap = new Map(distributions.map((item) => [String(item.id), item]));
      const approvedDistributionIds = new Set(distributions.filter((item) => item.approval_status === 'approved').map((item) => String(item.id)));
      const partyName = (item: DbRow) => {
        const source = item.recipient_type === 'partner' ? partnerRows : investorRows;
        return source.find((party) => party.id === item.recipient_id)?.name;
      };
      result = {
        columns: ['Record date', 'Record type', 'Vehicle', 'Recipient', 'Recipient type', 'Recorded rule', 'Amount', 'Status'],
        rows: [
          ...calculations.map((item) => record(`calculation-${item.id}`, {
            'Record date': localDateText(item.created_at), 'Record type': 'Approved profit calculation', Vehicle: vehicleLabel(vehicleMap.get(String(item.vehicle_id))),
            Recipient: 'Showroom', 'Recipient type': 'Showroom calculation', 'Recorded rule': 'Stored calculation only', Amount: money(item.net_profit), Status: text(item.status),
          }, { vehicle_id: String(item.vehicle_id), category: String(vehicleMap.get(String(item.vehicle_id))?.business_category ?? '') })),
          ...distributions.map((item) => record(`distribution-${item.id}`, {
            'Record date': localDateText(item.created_at), 'Record type': 'Profit distribution', Vehicle: vehicleLabel(vehicleMap.get(String(item.vehicle_id))),
            Recipient: text(partyName(item)), 'Recipient type': text(item.recipient_type), 'Recorded rule': text(item.rule_name), Amount: item.approval_status === 'approved' ? money(item.amount) : 'Not approved', Status: text(item.approval_status),
          }, {
            vehicle_id: String(item.vehicle_id), category: String(vehicleMap.get(String(item.vehicle_id))?.business_category ?? ''),
            ...(item.recipient_type === 'partner' ? { partner: String(item.recipient_id ?? '') } : { investor: String(item.recipient_id ?? '') }),
          })),
          ...payments.map((item) => {
            const distribution = distMap.get(String(item.distribution_id));
            return record(`payment-${item.id}`, {
              'Record date': text(item.payment_date), 'Record type': 'Distribution payment', Vehicle: vehicleLabel(vehicleMap.get(String(distribution?.vehicle_id))),
              Recipient: distribution ? text(partyName(distribution)) : 'Recipient not available', 'Recipient type': text(distribution?.recipient_type), 'Recorded rule': text(distribution?.rule_name),
              Amount: money(item.paid_amount), Status: approvedDistributionIds.has(String(item.distribution_id)) ? 'Paid' : 'Distribution not approved',
            }, {
              vehicle_id: String(distribution?.vehicle_id ?? ''),
              ...(distribution?.recipient_type === 'partner' ? { partner: String(distribution.recipient_id ?? '') } : {}),
              ...(distribution?.recipient_type === 'investor' ? { investor: String(distribution.recipient_id ?? '') } : {}),
            });
          }),
        ],
        summary: [
          { label: 'Approved stored profit calculations', value: calculations.length ? recordedTotal(calculations, 'net_profit') : 'Not yet available' },
          { label: 'Approved distribution allocations', value: recordedTotal(distributions.filter((item) => item.approval_status === 'approved'), 'amount', 'No approved distribution records') },
          { label: 'Payments against approved distributions', value: recordedTotal(payments.filter((item) => approvedDistributionIds.has(String(item.distribution_id))), 'paid_amount', 'No approved distribution payments') },
        ],
        limitations: ['Only stored approved calculations and approved distributions are included. No profit formula is recomputed or inferred.'],
      };
    } else if (effectiveReport === 'monthly') {
      const [priorYear, priorMonth] = (() => {
        const [yearText, monthText] = month.split('-');
        const previous = new Date(Number(yearText), Number(monthText) - 2, 1);
        return [String(previous.getFullYear()), String(previous.getMonth() + 1).padStart(2, '0')];
      })();
      const previousMonth = `${priorYear}-${priorMonth}`;
      const [yearText, monthText] = month.split('-');
      const monthStart = formatLocalDate(new Date(Number(yearText), Number(monthText) - 1, 1));
      const monthEnd = formatLocalDate(new Date(Number(yearText), Number(monthText), 0));
      const prevStart = formatLocalDate(new Date(Number(priorYear), Number(priorMonth) - 1, 1));
      const prevEnd = formatLocalDate(new Date(Number(priorYear), Number(priorMonth), 0));
      const vehicleColumns = 'id,make,model,variant,manufacturing_year,registration_number,business_category,status,purchase_date,purchase_price,total_additional_costs,expected_sale_price';
      const salesColumns = 'id,vehicle_id,customer_name,sale_date,selling_price,remaining_balance,status';
      const dataRequests = (start: string, end: string) => Promise.all([
        loadAll('sales', salesColumns, 'sale_date', start, end),
        loadAll('sale_payments', 'id,sale_id,amount,payment_method,payment_date', 'payment_date', start, end),
        loadAll('vehicle_expenses', 'id,vehicle_id,expense_type,amount,expense_date', 'expense_date', start, end),
        loadAll('general_expenses', 'id,category,amount,expense_date', 'expense_date', start, end),
        loadAll('funding_contributions', 'id,vehicle_id,partner_id,investor_id,amount,contribution_date', 'contribution_date', start, end),
        loadAll('profit_calculations', 'id,vehicle_id,sale_id,net_profit,status,created_at', 'created_at', start, end, [{ column: 'status', value: 'approved' }]),
        loadAll('profit_distributions', 'id,vehicle_id,recipient_type,recipient_id,amount,approval_status,created_at', 'created_at', start, end),
        loadAll('distribution_payments', 'id,distribution_id,paid_amount,payment_date', 'payment_date', start, end),
        loadAll('reserve_transactions', 'id,reserve_id,transaction_type,amount,description,created_at', 'created_at', start, end),
        loadAll('financial_transactions', 'id,transaction_type,amount,currency,status,created_at', 'created_at', start, end),
      ]);
      const [vehicles, currentData, previousData] = await Promise.all([
        loadAll('vehicles', vehicleColumns),
        dataRequests(monthStart, monthEnd),
        dataRequests(prevStart, prevEnd),
      ]);
      const [sales, payments, vehicleExpenses, generalExpenses, funding, calculations, distributions, distributionPayments, reserves, financialTransactions] = currentData;
      const [previousSales, previousPayments, previousVehicleExpenses, previousGeneralExpenses, previousFunding, previousCalculations, previousDistributions, previousDistributionPayments, previousReserves, previousFinancialTransactions] = previousData;
      const paymentDistributionIds = [...new Set([...distributionPayments, ...previousDistributionPayments].map((row) => String(row.distribution_id)))];
      const paymentLinkedDistributions = paymentDistributionIds.length
        ? await loadAll('profit_distributions', 'id,approval_status', undefined, '', '', [], [{ column: 'id', values: paymentDistributionIds }])
        : [];
      const approvedDistributionIds = new Set([
        ...distributions.filter((row) => row.approval_status === 'approved').map((row) => String(row.id)),
        ...previousDistributions.filter((row) => row.approval_status === 'approved').map((row) => String(row.id)),
        ...paymentLinkedDistributions.filter((row) => row.approval_status === 'approved').map((row) => String(row.id)),
      ]);
      const inMonth = (row: DbRow, field: string, start: string, end: string) => localDateText(row[field]) >= start && localDateText(row[field]) <= end;
      const summaryValue = (label: string, currentRows: DbRow[], currentKey: string, previousRows: DbRow[], isCount = false, emptyLabel = 'No records') => ({
        label,
        value: isCount ? String(currentRows.length) : recordedTotal(currentRows, currentKey, emptyLabel),
        note: `Previous month (${previousMonth}): ${isCount ? previousRows.length : recordedTotal(previousRows, currentKey, emptyLabel)}`,
      });
      const currentSales = sales.filter((row) => row.status === 'completed' && inMonth(row, 'sale_date', monthStart, monthEnd));
      const currentPurchases = vehicles.filter((row) => row.purchase_date && row.business_category !== 'consignment' && inMonth(row, 'purchase_date', monthStart, monthEnd));
      const priorPurchases = vehicles.filter((row) => row.purchase_date && row.business_category !== 'consignment' && inMonth(row, 'purchase_date', prevStart, prevEnd));
      const currentBalances = sales.filter((row) => !isCancelled(row));
      const priorActiveSales = previousSales.filter((row) => !isCancelled(row));
      const currentCalcs = calculations.filter((row) => row.status === 'approved');
      const currentDists = distributions.filter((row) => row.approval_status === 'approved');
      const currentTransactions = financialTransactions;
      const priorTransactionRows = previousFinancialTransactions;
      const priorCompletedSales = previousSales.filter((row) => row.status === 'completed');
      const priorApprovedCalculations = previousCalculations.filter((row) => row.status === 'approved');
      const priorApprovedDistributions = previousDistributions.filter((row) => row.approval_status === 'approved');
      result = {
        columns: ['Metric', 'Recorded value', 'Previous month comparison', 'Basis'],
        rows: [],
        summary: [
          summaryValue('Vehicles purchased', currentPurchases, 'id', priorPurchases, true),
          summaryValue('Recorded additional costs on purchases', currentPurchases, 'total_additional_costs', priorPurchases),
          summaryValue('Completed vehicles sold', currentSales, 'id', priorCompletedSales, true),
          summaryValue('Completed sales revenue', currentSales, 'selling_price', priorCompletedSales),
          summaryValue('Actual customer payments received', payments, 'amount', previousPayments),
          summaryValue('Stored outstanding balances', currentBalances, 'remaining_balance', priorActiveSales),
          summaryValue('Vehicle expenses recorded', vehicleExpenses, 'amount', previousVehicleExpenses),
          summaryValue('Showroom expenses recorded', generalExpenses, 'amount', previousGeneralExpenses),
          summaryValue('Partner contributions recorded', funding.filter((row) => row.partner_id), 'amount', previousFunding.filter((row) => row.partner_id)),
          summaryValue('Investor contributions recorded', funding.filter((row) => row.investor_id), 'amount', previousFunding.filter((row) => row.investor_id)),
          summaryValue('Approved profit calculations', currentCalcs, 'net_profit', priorApprovedCalculations, false, 'Not yet available'),
          summaryValue('Approved profit distributions', currentDists, 'amount', priorApprovedDistributions),
          summaryValue('Payments against approved distributions', distributionPayments.filter((row) => approvedDistributionIds.has(String(row.distribution_id))), 'paid_amount', previousDistributionPayments.filter((row) => approvedDistributionIds.has(String(row.distribution_id)))),
          summaryValue('Reserve transactions recorded', reserves, 'amount', previousReserves),
          summaryValue('Financial transactions (recorded types; unclassified)', currentTransactions, 'amount', priorTransactionRows),
          { label: 'Itemized purchase expense records', value: 'Not available — purchase costs are stored only as a vehicle-level aggregate.' },
          { label: 'Inventory at month end', value: 'Not available — historical status snapshots are not stored' },
        ],
        limitations: [
          'Monthly metrics use each source table’s recorded date field. Contributions and loans are not sales revenue or profit.',
          'Outstanding balance is the stored balance on sales in the selected month, not a reconstructed historical balance.',
          'Historical month-end inventory is unavailable because status history is not stored.',
          'Profit payments include only payment rows linked to approved distribution records; approval history is not versioned.',
          'Profit totals include approved stored records only. Current source data has no historical edit snapshots.',
        ],
      };
    }
    if (effectiveReport === 'monthly') {
      result.columns = ['Metric', 'Recorded value', 'Previous month comparison', 'Basis'];
      result.rows = result.summary.map((item, index) => record(`monthly-${index}`, {
        Metric: item.label, 'Recorded value': item.value, 'Previous month comparison': item.note ?? 'Not available', Basis: 'Recorded source data only',
      }));
    }
    result.generatedAt = new Date().toLocaleString();
    return result;
  }, [dateRange, effectiveReport, isAdmin, isInvestor, loadAll, month, parties, profile.full_name, subjectId]);

  useEffect(() => {
    let active = true;
    if (!profile.is_active || profile.role === 'pending') {
      setLoading(false);
      setError('An active account is required to view reports.');
      return () => { active = false; };
    }
    if (!canAccessReport(effectiveReport, profile.role)) {
      setData({ columns: [], rows: [], summary: [], limitations: [] });
      setLoading(false);
      setError('This report is not available for the current role.');
      return () => { active = false; };
    }
    setLoading(true);
    setError('');
    void buildReport().then((report) => {
      if (active) {
        setData(report);
        setSelectedColumns(report.columns);
        setPage(0);
      }
    }).catch((loadError: unknown) => {
      if (active) {
        setData({ columns: [], rows: [], summary: [], limitations: [] });
        setError(loadError instanceof Error ? loadError.message : 'Could not load report data.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [buildReport, effectiveReport, profile.is_active, profile.role]);

  const selectedSubject = isAdmin ? parties.find((party) => party.id === subjectId) : undefined;
  const filterable = (key: string) => [...new Set(data.rows.map((row) => row.filters[key]).filter((value) => Boolean(value)))].sort();
  const filteredRecords = useMemo(() => {
    let matching = data.rows.filter((row) => {
      const f = row.filters;
      return (!vehicleId || f.vehicle_id === vehicleId)
        && (!makeModel || `${f.make ?? ''} ${f.model ?? ''}`.toLowerCase().includes(makeModel.toLowerCase()))
        && (!category || f.category === category)
        && (!status || f.status === status)
        && (!customer || (f.customer ?? '').toLowerCase().includes(customer.toLowerCase()))
        && (!personSearch || (f.person ?? '').toLowerCase().includes(personSearch.toLowerCase()))
        && (!expenseCategory || f.expense_category === expenseCategory)
        && (!paymentMethod || f.payment_method === paymentMethod)
        && (!transactionType || f.transaction_type === transactionType)
        && (!isAdmin || !subjectId || !selectedSubject || String(f[selectedSubject.kind] ?? '').split(',').includes(subjectId));
    });
    const amountField = (row: ReportRecord) => {
      const raw = Object.values(row.fields).find((value) => /^\D+\s[\d,]+\.\d{2}$/.test(value));
      return raw ? Number(raw.replace(/[^\d.-]/g, '')) : 0;
    };
    if (sortOrder === 'date-asc') matching = [...matching].sort((a, b) => (a.fields.Date ?? a.fields['Sale date'] ?? a.fields['Payment date'] ?? a.fields['Expense date'] ?? a.fields['Record date'] ?? a.fields['Created date'] ?? '').localeCompare(b.fields.Date ?? b.fields['Sale date'] ?? b.fields['Payment date'] ?? b.fields['Expense date'] ?? b.fields['Record date'] ?? b.fields['Created date'] ?? ''));
    if (sortOrder === 'amount-desc') matching = [...matching].sort((a, b) => amountField(b) - amountField(a));
    if (sortOrder === 'amount-asc') matching = [...matching].sort((a, b) => amountField(a) - amountField(b));
    return matching;
  }, [category, customer, data.rows, expenseCategory, isAdmin, makeModel, paymentMethod, personSearch, selectedSubject, sortOrder, status, subjectId, transactionType, vehicleId]);
  const displayedRows = useMemo(() => {
    const selectedFields = selected === 'custom' ? selectedColumns : data.columns;
    return filteredRecords.map((row) => selectedFields.reduce<Record<string, string>>((fields, column) => {
      fields[column] = row.fields[column] ?? 'Not recorded';
      return fields;
    }, {}));
  }, [data.columns, filteredRecords, selected, selectedColumns]);
  const filteredSummary = useMemo(() => {
    const hasFilters = Boolean(vehicleId || makeModel || category || status || customer || personSearch || expenseCategory || paymentMethod || transactionType || (isAdmin && subjectId));
    if (!hasFilters || effectiveReport === 'monthly') return data.summary;
    if (!filteredRecords.length) return data.summary.map((item) => ({ ...item, value: 'No matching records' }));
    const total = (rows: ReportRecord[], field: string) => {
      const amounts = rows.map((row) => moneyNumber(row.fields[field])).filter((amount): amount is number => amount !== null);
      return amounts.length ? money(amounts.reduce((sum, amount) => sum + amount, 0)) : rows.length ? 'Not recorded' : 'No records';
    };
    if (effectiveReport === 'sales') {
      const completed = filteredRecords.filter((row) => row.fields.Status === 'completed');
      return [{ label: 'Completed recorded sales revenue', value: completed.length ? total(completed, 'Sale price') : 'No completed sales', note: 'Cancelled and pending sales are excluded.' }];
    }
    if (effectiveReport === 'balances') return [{ label: 'Stored outstanding balances', value: total(filteredRecords.filter((row) => row.fields.Status !== 'cancelled'), 'Stored outstanding balance'), note: 'Based on current stored balances.' }];
    if (effectiveReport === 'payments') return [{ label: 'Actual recorded customer payments', value: total(filteredRecords, 'Amount received'), note: 'Payment rows only; advance_payment is not added.' }];
    if (effectiveReport === 'vehicle-expenses' || effectiveReport === 'showroom-expenses') return [{ label: effectiveReport === 'vehicle-expenses' ? 'Recorded vehicle expenses' : 'Recorded showroom expenses', value: total(filteredRecords, 'Amount') }];
    if (['inventory', 'purchases', 'aging'].includes(effectiveReport)) return [
      { label: effectiveReport === 'aging' ? 'Current unsold vehicles' : 'Vehicles in report', value: String(filteredRecords.length) },
      { label: 'Recorded purchase value', value: total(filteredRecords, 'Purchase price'), note: 'Missing purchase prices are excluded.' },
    ];
    if (effectiveReport === 'transactions') return [{ label: 'Recorded transaction rows', value: String(filteredRecords.length), note: 'Free-text types are not classified as inflow/outflow.' }];
    if (effectiveReport === 'partner' || effectiveReport === 'investor') {
      const allocations = filteredRecords.filter((row) => row.fields['Record type'] === 'Profit allocation' && row.fields.Status === 'approved');
      const paid = filteredRecords.filter((row) => row.fields['Record type'] === 'Profit paid');
      const contributions = filteredRecords.filter((row) => row.fields['Record type'] === 'Capital contribution');
      const completedSales = filteredRecords.filter((row) => row.fields['Record type'] === 'Associated vehicle sale' && row.fields.Status === 'completed');
      const allocated = allocations.reduce((sum, row) => sum + (moneyNumber(row.fields.Amount) ?? 0), 0);
      const lifetimePaid = allocations.reduce((total, row) => total + Number(row.filters.paid_lifetime ?? 0), 0);
      return [
        { label: 'Recorded capital contributions', value: total(contributions, 'Amount') },
        { label: 'Associated completed sale revenue', value: effectiveReport === 'partner' ? (completedSales.length ? total(completedSales, 'Amount') : 'No completed associated sales') : 'Not available under investor row permissions' },
        { label: 'Approved profit allocations', value: allocations.length ? money(allocated) : 'Not yet available' },
        { label: 'Profit paid', value: paid.length ? total(paid, 'Amount') : 'No recorded payments' },
        { label: 'Profit payable', value: allocations.length ? (allocated < lifetimePaid ? `Overpaid by ${money(lifetimePaid - allocated)}` : money(allocated - lifetimePaid)) : 'Not yet available' },
        { label: 'Lifetime recorded contributions tied to current unsold vehicles', value: total(contributions.filter((row) => row.filters.unsold === 'true'), 'Amount') },
      ];
    }
    if (effectiveReport === 'profit') {
      const calculations = filteredRecords.filter((row) => row.fields['Record type'] === 'Approved profit calculation');
      const allocations = filteredRecords.filter((row) => row.fields['Record type'] === 'Profit distribution' && row.fields.Status === 'approved');
      const payments = filteredRecords.filter((row) => row.fields['Record type'] === 'Distribution payment' && row.fields.Status === 'Paid');
      return [
        { label: 'Approved stored profit calculations', value: calculations.length ? total(calculations, 'Amount') : 'Not yet available' },
        { label: 'Approved distribution allocations', value: total(allocations, 'Amount') },
        { label: 'Payments against approved distributions', value: total(payments, 'Amount') },
      ];
    }
    return data.summary;
  }, [category, customer, data.summary, effectiveReport, expenseCategory, filteredRecords, isAdmin, makeModel, paymentMethod, personSearch, status, subjectId, transactionType, vehicleId]);

  const activeDefinition = definitions.find((definition) => definition.id === selected);
  const period = effectiveReport === 'monthly' ? month : dateLabel(...dateRange);
  const appliedFilters = [
    vehicleId && `Vehicle: ${data.rows.find((row) => row.filters.vehicle_id === vehicleId)?.fields.Vehicle ?? vehicleId}`,
    makeModel && `Make/model: ${makeModel}`,
    category && `Category: ${category}`,
    status && `Status: ${status}`,
    customer && `Customer: ${customer}`,
    personSearch && `Person: ${personSearch}`,
    expenseCategory && `Expense category: ${expenseCategory}`,
    paymentMethod && `Payment method: ${paymentMethod}`,
    transactionType && `Transaction type: ${transactionType}`,
    selectedSubject && `${selectedSubject.kind === 'partner' ? 'Partner' : 'Investor'}: ${selectedSubject.name}`,
  ].filter(Boolean) as string[];
  const reportTitle = selected === 'custom'
    ? `Custom Report — ${definitions.find((item) => item.id === customCategory)?.title ?? ''}`
    : ['partner', 'investor'].includes(effectiveReport) && data.subjectName
      ? `${data.subjectName} — ${effectiveReport === 'partner' ? 'Partner Statement' : 'Investor Statement'}`
      : activeDefinition?.title ?? 'Business Report';
  const visibleColumns = selected === 'custom' ? selectedColumns : data.columns;
  const previewRows = displayedRows.slice(page * pageSize, (page + 1) * pageSize);

  const exportCsv = () => {
    const metadata = [
      ['TRUELINE AUTOS'],
      ['Report', reportTitle],
      ['Period', period],
      ['Generated', data.generatedAt ?? new Date().toLocaleString()],
      ['Applied filters', appliedFilters.join(' · ') || 'None'],
      ...data.limitations.map((item) => ['Report note', item]),
    ];
    const csvRows = [
      ...metadata,
      ...(effectiveReport === 'monthly' ? [] : [[], ['Summary', 'Recorded value', 'Context'], ...filteredSummary.map((item) => [item.label, item.value, item.note ?? ''])]),
      [],
      visibleColumns,
      ...displayedRows.map((row) => visibleColumns.map((column) => row[column] ?? '')),
    ];
    const blob = new Blob([`\uFEFF${csvRows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${period.replace(/[^a-z0-9-]+/gi, '-')}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`CSV exported with ${displayedRows.length} matching records.`);
  };

  const exportPdf = async () => {
    if (!visibleColumns.length) {
      setError('There are no report columns available to export.');
      return;
    }
    try {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF({ orientation: visibleColumns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const drawHeader = (pageDoc: JsPDFDocument) => {
      pageDoc.setFillColor(18, 24, 32);
      pageDoc.rect(0, 0, pageWidth, 54, 'F');
      pageDoc.setTextColor(236, 215, 164);
      pageDoc.setFont('helvetica', 'bold');
      pageDoc.setFontSize(15);
      pageDoc.text('TRUELINE AUTOS', 34, 24);
      pageDoc.setTextColor(255, 255, 255);
      pageDoc.setFontSize(10);
      pageDoc.text(reportTitle, 34, 42);
    };
    drawHeader(doc);
    doc.setTextColor(55, 62, 70);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Period: ${period}   Generated: ${data.generatedAt ?? new Date().toLocaleString()}`, 34, 72);
    const filterLines = doc.splitTextToSize(`Filters: ${appliedFilters.length ? appliedFilters.join(' · ') : 'None'}`, pageWidth - 68);
    doc.text(filterLines, 34, 87);
    let summaryY = 95 + filterLines.length * 11;
    if (data.limitations.length) {
      const noteLines = data.limitations.flatMap((note) => doc.splitTextToSize(`Note: ${note}`, pageWidth - 68));
      doc.setFontSize(8);
      doc.text(noteLines, 34, summaryY);
      summaryY += noteLines.length * 10 + 5;
    }
    if (filteredSummary.length && effectiveReport !== 'monthly') {
      autoTable(doc, {
        startY: summaryY,
        head: [['Summary', 'Recorded value', 'Context']],
        body: filteredSummary.map((item) => [item.label, item.value, item.note ?? '']),
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 5, overflow: 'linebreak' },
        headStyles: { fillColor: [34, 43, 52], textColor: [236, 215, 164] },
        margin: { left: 34, right: 34, top: 62, bottom: 40 },
        didDrawPage: () => drawHeader(doc),
      });
      summaryY = (doc as JsPDFDocument & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? summaryY;
    }
    autoTable(doc, {
      startY: Math.max(summaryY + (effectiveReport === 'monthly' ? 8 : 18), 112),
      head: [visibleColumns],
      body: displayedRows.map((row) => visibleColumns.map((column) => row[column] ?? '')),
      theme: 'grid',
      styles: { fontSize: visibleColumns.length > 7 ? 6.5 : 8, cellPadding: 4, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [34, 43, 52], textColor: [236, 215, 164] },
      alternateRowStyles: { fillColor: [247, 245, 239] },
      margin: { left: 34, right: 34, top: 62, bottom: 40 },
      horizontalPageBreak: visibleColumns.length > 8,
      horizontalPageBreakRepeat: [0],
      didDrawPage: () => drawHeader(doc),
    });
    const total = doc.internal.pages.length - 1;
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      doc.setPage(pageNumber);
      doc.setFontSize(8);
      doc.setTextColor(95, 101, 109);
      doc.text(`Page ${pageNumber} of ${total}`, pageWidth - 34, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
    }
    doc.save(`${reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${period.replace(/[^a-z0-9-]+/gi, '-')}.pdf`);
    setNotice(`PDF exported with ${displayedRows.length} matching records.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? `PDF export failed: ${exportError.message}` : 'PDF export failed.');
    }
  };

  const resetFilters = () => {
    setVehicleId(''); setMakeModel(''); setCategory(''); setStatus(''); setCustomer(''); setPersonSearch('');
    setExpenseCategory(''); setPaymentMethod(''); setTransactionType(''); setPage(0);
  };
  const reportChoices = definitions.filter((definition) => canAccessReport(definition.id, profile.role));
  const customChoices = definitions.filter((definition) => definition.id !== 'custom' && canAccessReport(definition.id, profile.role));
  const needsVehicle = ['sales', 'inventory', 'purchases', 'payments', 'balances', 'vehicle-expenses', 'partner', 'profit', 'aging'].includes(effectiveReport);
  const needsCategory = ['inventory', 'purchases', 'vehicle-expenses', 'aging'].includes(effectiveReport);
  const needsStatus = ['sales', 'inventory', 'balances', 'aging'].includes(effectiveReport);
  const needsCustomer = ['sales', 'payments', 'balances'].includes(effectiveReport);
  const needsExpenseCategory = ['vehicle-expenses', 'showroom-expenses'].includes(effectiveReport);
  const needsPaymentMethod = ['payments', 'partner', 'investor'].includes(effectiveReport);
  const needsTransactionType = ['transactions', 'partner', 'investor'].includes(effectiveReport);
  const needsSubject = isAdmin && ['partner', 'investor', 'profit', 'transactions', 'purchases', 'inventory'].includes(effectiveReport);
  const subjectOptions = effectiveReport === 'partner'
    ? parties.filter((party) => party.kind === 'partner')
    : effectiveReport === 'investor'
      ? parties.filter((party) => party.kind === 'investor')
      : parties;
  const needsContributorSearch = profile.role === 'partner' && ['transactions', 'purchases', 'inventory'].includes(effectiveReport);

  return <div className="page-shell reports-center">
    <header className="page-header"><div><p className="eyebrow">Business intelligence</p><h1>Reports & statements</h1><p className="muted">Generate filtered, permission-aware reports from recorded showroom data.</p></div><button type="button" className="ghost-button" disabled={loading} onClick={() => { setError(''); setLoading(true); void buildReport().then(setData).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not refresh report.')).finally(() => setLoading(false)); }}><RefreshCw size={16} /> Refresh</button></header>
    {!profile.is_active || profile.role === 'pending' ? <p className="auth-feedback error" role="alert">An active account is required to view reports.</p> : <>
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {notice && <p className="auth-feedback" role="status">{notice}</p>}
      <section className="report-card-grid" aria-label="Available reports">
        {reportChoices.map((definition) => <button key={definition.id} type="button" className={`report-choice glass-panel${selected === definition.id ? ' is-selected' : ''}`} onClick={() => { setSelected(definition.id); resetFilters(); setError(''); setNotice(''); }}>
          <span className="report-choice-icon"><FileText size={18} /></span><strong>{definition.title}</strong><span>{definition.description}</span>
        </button>)}
      </section>
      <section className="glass-panel panel-section report-controls">
        <div className="section-head"><div><h2>{selected === 'custom' ? 'Build a custom report' : activeDefinition?.title}</h2><p className="muted">{selected === 'custom' ? 'Choose a permitted dataset, columns, and sorting.' : activeDefinition?.description}</p></div></div>
        <div className="report-filter-grid">
          {selected === 'custom' && <label>Report category<select value={customCategory} onChange={(event) => { setCustomCategory(event.target.value as Exclude<ReportId, 'custom'>); resetFilters(); }}>{
            customChoices.map((choice) => <option value={choice.id} key={choice.id}>{choice.title}</option>)
          }</select></label>}
          {effectiveReport === 'monthly'
            ? <label>Report month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
            : <label>Date range<select value={range} onChange={(event) => setRange(event.target.value)}>{dateRanges.map((item) => <option key={item}>{item}</option>)}</select></label>}
          {range === 'Custom range' && effectiveReport !== 'monthly' && <><label>From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></>}
          {needsSubject && <label>{effectiveReport === 'profit' || effectiveReport === 'transactions' ? 'Partner or investor' : effectiveReport === 'partner' ? 'Partner' : 'Investor'}<select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setPage(0); }}><option value="">All recipients</option>{subjectOptions.map((party) => <option value={party.id} key={party.id}>{party.name}</option>)}</select></label>}
          {needsVehicle && <label>Vehicle<select value={vehicleId} onChange={(event) => { setVehicleId(event.target.value); setPage(0); }}><option value="">All vehicles</option>{[...new Map(data.rows.filter((row) => row.filters.vehicle_id).map((row) => [row.filters.vehicle_id, row.fields.Vehicle ?? row.filters.vehicle_id])).entries()].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>}
          {needsVehicle && <label>Make / model<input value={makeModel} onChange={(event) => { setMakeModel(event.target.value); setPage(0); }} placeholder="Search make or model" /></label>}
          {needsCategory && <label>Vehicle category<select value={category} onChange={(event) => { setCategory(event.target.value); setPage(0); }}><option value="">All categories</option>{filterable('category').map((item) => <option key={item}>{item}</option>)}</select></label>}
          {needsStatus && <label>Vehicle / sale status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">All statuses</option>{filterable('status').map((item) => <option key={item}>{item}</option>)}</select></label>}
          {needsCustomer && <label>Customer<input value={customer} onChange={(event) => { setCustomer(event.target.value); setPage(0); }} placeholder="Search customer" /></label>}
          {needsContributorSearch && <label>Partner or investor<input value={personSearch} onChange={(event) => { setPersonSearch(event.target.value); setPage(0); }} placeholder="Search linked person" /></label>}
          {needsExpenseCategory && <label>Expense category<select value={expenseCategory} onChange={(event) => { setExpenseCategory(event.target.value); setPage(0); }}><option value="">All categories</option>{filterable('expense_category').map((item) => <option key={item}>{item}</option>)}</select></label>}
          {needsPaymentMethod && <label>Payment method<select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPage(0); }}><option value="">All methods</option>{filterable('payment_method').map((item) => <option key={item}>{item}</option>)}</select></label>}
          {needsTransactionType && <label>Transaction type<select value={transactionType} onChange={(event) => { setTransactionType(event.target.value); setPage(0); }}><option value="">All types</option>{filterable('transaction_type').map((item) => <option key={item}>{item}</option>)}</select></label>}
          <label>Sort order<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}><option value="date-desc">Date: newest first</option><option value="date-asc">Date: oldest first</option><option value="amount-desc">Amount: high to low</option><option value="amount-asc">Amount: low to high</option></select></label>
        </div>
        {selected === 'custom' && <fieldset className="report-columns"><legend>Columns to include</legend>{data.columns.map((column) => <label key={column}><input type="checkbox" checked={selectedColumns.includes(column)} onChange={(event) => setSelectedColumns(event.target.checked ? [...selectedColumns, column] : selectedColumns.filter((item) => item !== column))} />{column}</label>)}</fieldset>}
        <div className="report-toolbar"><span>{loading ? 'Loading all matching authorized records…' : `${displayedRows.length.toLocaleString()} matching records`}</span><div><button type="button" className="ghost-button" onClick={exportCsv} disabled={loading || !visibleColumns.length}><Download size={15} /> Export CSV</button><button type="button" className="primary-button" onClick={exportPdf} disabled={loading || !visibleColumns.length}><FileText size={15} /> Export PDF</button></div></div>
      </section>
      <section className="glass-panel panel-section report-preview" id="report-preview">
        <div className="report-preview-header"><div><p className="eyebrow">TRUELINE AUTOS · REPORT PREVIEW</p><h2>{reportTitle}</h2><p>Period: {period} · Generated: {data.generatedAt ?? (loading ? 'Preparing report…' : 'Not generated')}</p>{appliedFilters.length > 0 && <p>Filters: {appliedFilters.join(' · ')}</p>}</div></div>
        {filteredSummary.length > 0 && <div className="report-summary-grid">{filteredSummary.map((item) => <article className="report-summary-item" key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.note && <small>{item.note}</small>}</article>)}</div>}
        {data.limitations.length > 0 && <ul className="report-limitations">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul>}
        {selected === 'custom' && !visibleColumns.length && <p className="muted">Select at least one column to preview or export.</p>}
        {loading ? <p className="muted" role="status">Loading report data…</p> : error ? <p className="muted">Report data could not be loaded.</p> : <div className="table-scroll"><table className="data-table"><thead><tr>{visibleColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
          {previewRows.map((row, index) => <tr key={`${row[visibleColumns[0]] ?? 'row'}-${page * pageSize + index}`}>{visibleColumns.map((column) => <td key={column}>{row[column] ?? 'Not recorded'}</td>)}</tr>)}
          {!previewRows.length && <tr><td colSpan={Math.max(1, visibleColumns.length)}>{data.rows.length ? 'No records match the selected filters.' : 'No records are available for this report and period.'}</td></tr>}
        </tbody></table></div>}
        {displayedRows.length > pageSize && <nav className="report-pagination" aria-label="Report preview pages"><button type="button" className="ghost-button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><span>Page {page + 1} of {Math.ceil(displayedRows.length / pageSize)}</span><button type="button" className="ghost-button" disabled={(page + 1) * pageSize >= displayedRows.length} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
      </section>
    </>}
  </div>;
}
