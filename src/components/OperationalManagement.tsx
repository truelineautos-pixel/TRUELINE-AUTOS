import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, supabaseConfigError } from '../lib/supabase';

type Role = 'pending' | 'super_admin' | 'partner' | 'investor';
type Profile = { role: Role; full_name: string | null; is_active: boolean };
type Section = 'purchases' | 'sales' | 'expenses' | 'finance' | 'profit';
type Vehicle = {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  manufacturing_year: number | null;
  registration_number: string | null;
  business_category: string;
  status: string;
  purchase_date: string | null;
  purchase_price: number | null;
  expected_sale_price: number | null;
  customer_name: string | null;
  customer_contact: string | null;
};
type Party = { id: string; name: string; status: string };
type Funding = { id: string; vehicle_id: string; partner_id: string | null; investor_id: string | null; amount: number; contribution_date: string; payment_method: string | null; reference_number: string | null };
type Sale = { id: string; vehicle_id: string; customer_name: string; customer_contact: string | null; sale_date: string; selling_price: number; advance_payment: number | null; remaining_balance: number | null; status: string };
type SalePayment = { id: string; sale_id: string; amount: number; payment_method: string | null; payment_date: string; reference_number: string | null };
type VehicleExpense = { id: string; vehicle_id: string; expense_type: string; amount: number; expense_date: string; payment_method: string | null; receipt_url: string | null; notes: string | null };
type GeneralExpense = { id: string; category: string; amount: number; expense_date: string; payment_method: string | null; receipt_url: string | null; notes: string | null };
type FinancialTransaction = { id: string; transaction_type: string; amount: number; currency: string; related_vehicle_id: string | null; related_partner_id: string | null; related_investor_id: string | null; status: string; created_at: string; notes: string | null };
type ReserveTransaction = { id: string; reserve_id: string; transaction_type: string; amount: number; description: string | null; created_at: string };
type Reserve = { id: string; reserve_name: string; current_balance: number };
type Distribution = { id: string; vehicle_id: string; recipient_type: string; recipient_id: string | null; amount: number; rule_name: string; approval_status: string; created_at: string };
type DistributionPayment = { id: string; distribution_id: string; paid_amount: number; payment_date: string; payment_method: string | null };
type Calculation = { id: string; vehicle_id: string; sale_id: string | null; purchase_cost: number; approved_expenses: number; sale_proceeds: number; net_profit: number; status: string; created_at: string };
type Data = {
  vehicles: Vehicle[];
  partners: Party[];
  investors: Party[];
  funding: Funding[];
  sales: Sale[];
  salePayments: SalePayment[];
  vehicleExpenses: VehicleExpense[];
  generalExpenses: GeneralExpense[];
  transactions: FinancialTransaction[];
  reserveTransactions: ReserveTransaction[];
  reserves: Reserve[];
  distributions: Distribution[];
  distributionPayments: DistributionPayment[];
  calculations: Calculation[];
};

const EMPTY: Data = {
  vehicles: [], partners: [], investors: [], funding: [], sales: [], salePayments: [],
  vehicleExpenses: [], generalExpenses: [], transactions: [], reserveTransactions: [], reserves: [],
  distributions: [], distributionPayments: [], calculations: [],
};
const expenseCategories = ['Repairs', 'Maintenance', 'Transport', 'Registration', 'Documentation', 'Marketing', 'Rent', 'Salaries', 'Utilities', 'Other'];
const currency = import.meta.env.VITE_DEFAULT_CURRENCY || 'PKR';
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function amount(value: number | null | undefined): string {
  return value == null ? 'Not recorded' : `${currency} ${Number(value).toLocaleString()}`;
}

function vehicleName(vehicle: Vehicle | undefined): string {
  return vehicle
    ? [vehicle.manufacturing_year, vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(' ')
    : 'Vehicle not available';
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The operation failed. Please retry.';
}

export default function OperationalManagement({ section, profile, userId }: { section: Section; profile: Profile; userId: string }) {
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selectedSale, setSelectedSale] = useState('');
  const [purchase, setPurchase] = useState({ make: '', model: '', variant: '', year: '', registration: '', date: today, price: '', category: 'partner', notes: '', customer_name: '', customer_contact: '' });
  const [fundingDrafts, setFundingDrafts] = useState([{ partyId: '', amount: '', date: today }]);
  const [saleDraft, setSaleDraft] = useState({ vehicleId: '', date: today, price: '', customer: '', contact: '' });
  const [paymentDraft, setPaymentDraft] = useState({ amount: '', date: today, method: '', reference: '' });
  const [expenseDraft, setExpenseDraft] = useState({ kind: 'vehicle', vehicleId: '', category: 'Repairs', amount: '', date: today, method: '', notes: '', receipt: null as File | null });
  const [transactionType, setTransactionType] = useState('all');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('all');

  const isAdmin = profile.role === 'super_admin' && profile.is_active;
  const accessError = !supabase
    ? supabaseConfigError ?? 'Supabase is unavailable.'
    : !profile.is_active || profile.role === 'pending'
      ? 'An active account is required to view operational data.'
      : '';
  const refreshData = () => {
    setLoading(true);
    setRefresh((value) => value + 1);
  };
  const load = useCallback(async () => {
    if (!supabase || !profile.is_active || profile.role === 'pending') return;
    try {
      const client = supabase;
      const investorOnly = profile.role === 'investor';
      const requests: Record<string, PromiseLike<{ data: unknown; error: { message: string } | null }>> = {};
      if (section === 'purchases') {
        if (investorOnly) throw new Error('Purchase history is restricted to Super Admins and Partners; this account can view its permitted vehicle-linked records in the vehicle profile.');
        requests.vehicles = client.from('vehicles').select('id, make, model, variant, manufacturing_year, registration_number, business_category, status, purchase_date, purchase_price, expected_sale_price, customer_name, customer_contact').not('purchase_date', 'is', null).order('purchase_date', { ascending: false });
        requests.funding = client.from('funding_contributions').select('id, vehicle_id, partner_id, investor_id, amount, contribution_date, payment_method, reference_number').order('contribution_date', { ascending: false });
        requests.partners = client.from('partners').select('id, name, status').order('name');
        if (isAdmin) requests.investors = client.from('investors').select('id, name, status').order('name');
      } else if (section === 'sales') {
        if (investorOnly) throw new Error('Sales and customer records are not available under this account’s data permissions.');
        requests.vehicles = client.from('vehicles').select('id, make, model, variant, manufacturing_year, registration_number, business_category, status, purchase_date, purchase_price, expected_sale_price, customer_name, customer_contact').order('purchase_date', { ascending: false });
        requests.sales = client.from('sales').select('id, vehicle_id, customer_name, customer_contact, sale_date, selling_price, advance_payment, remaining_balance, status').order('sale_date', { ascending: false });
        requests.salePayments = client.from('sale_payments').select('id, sale_id, amount, payment_method, payment_date, reference_number').order('payment_date', { ascending: false });
      } else if (section === 'expenses') {
        if (investorOnly) throw new Error('Expense records are not available under this account’s data permissions.');
        requests.vehicles = client.from('vehicles').select('id, make, model, variant, manufacturing_year, registration_number, business_category, status, purchase_date, purchase_price, expected_sale_price, customer_name, customer_contact').order('purchase_date', { ascending: false });
        requests.vehicleExpenses = client.from('vehicle_expenses').select('id, vehicle_id, expense_type, amount, expense_date, payment_method, receipt_url, notes').order('expense_date', { ascending: false });
        requests.generalExpenses = client.from('general_expenses').select('id, category, amount, expense_date, payment_method, receipt_url, notes').order('expense_date', { ascending: false });
      } else if (section === 'finance') {
        requests.funding = client.from('funding_contributions').select('id, vehicle_id, partner_id, investor_id, amount, contribution_date, payment_method, reference_number').order('contribution_date', { ascending: false });
        requests.transactions = client.from('financial_transactions').select('id, transaction_type, amount, currency, related_vehicle_id, related_partner_id, related_investor_id, status, created_at, notes').order('created_at', { ascending: false });
        requests.distributions = client.from('profit_distributions').select('id, vehicle_id, recipient_type, recipient_id, amount, rule_name, approval_status, created_at').order('created_at', { ascending: false });
        requests.distributionPayments = client.from('distribution_payments').select('id, distribution_id, paid_amount, payment_date, payment_method').order('payment_date', { ascending: false });
        if (!investorOnly) {
          requests.vehicles = client.from('vehicles').select('id, make, model, variant, manufacturing_year, registration_number, business_category, status, purchase_date, purchase_price, expected_sale_price, customer_name, customer_contact');
          requests.partners = client.from('partners').select('id, name, status');
          requests.investors = client.from('investors').select('id, name, status');
          requests.sales = client.from('sales').select('id, vehicle_id, customer_name, customer_contact, sale_date, selling_price, advance_payment, remaining_balance, status').order('sale_date', { ascending: false });
          requests.salePayments = client.from('sale_payments').select('id, sale_id, amount, payment_method, payment_date, reference_number').order('payment_date', { ascending: false });
          requests.vehicleExpenses = client.from('vehicle_expenses').select('id, vehicle_id, expense_type, amount, expense_date, payment_method, receipt_url, notes').order('expense_date', { ascending: false });
          requests.generalExpenses = client.from('general_expenses').select('id, category, amount, expense_date, payment_method, receipt_url, notes').order('expense_date', { ascending: false });
          requests.reserveTransactions = client.from('reserve_transactions').select('id, reserve_id, transaction_type, amount, description, created_at').order('created_at', { ascending: false });
          requests.reserves = client.from('showroom_reserves').select('id, reserve_name, current_balance').order('reserve_name');
        }
      } else {
        requests.funding = client.from('funding_contributions').select('id, vehicle_id, partner_id, investor_id, amount, contribution_date, payment_method, reference_number').order('contribution_date', { ascending: false });
        requests.distributions = client.from('profit_distributions').select('id, vehicle_id, recipient_type, recipient_id, amount, rule_name, approval_status, created_at').order('created_at', { ascending: false });
        requests.distributionPayments = client.from('distribution_payments').select('id, distribution_id, paid_amount, payment_date, payment_method').order('payment_date', { ascending: false });
        if (!investorOnly) {
          requests.vehicles = client.from('vehicles').select('id, make, model, variant, manufacturing_year, registration_number, business_category, status, purchase_date, purchase_price, expected_sale_price, customer_name, customer_contact');
          requests.sales = client.from('sales').select('id, vehicle_id, customer_name, customer_contact, sale_date, selling_price, advance_payment, remaining_balance, status').order('sale_date', { ascending: false });
          requests.vehicleExpenses = client.from('vehicle_expenses').select('id, vehicle_id, expense_type, amount, expense_date, payment_method, receipt_url, notes').order('expense_date', { ascending: false });
          requests.calculations = client.from('profit_calculations').select('id, vehicle_id, sale_id, purchase_cost, approved_expenses, sale_proceeds, net_profit, status, created_at').eq('status', 'approved').order('created_at', { ascending: false });
          requests.transactions = client.from('financial_transactions').select('id, transaction_type, amount, currency, related_vehicle_id, related_partner_id, related_investor_id, status, created_at, notes').order('created_at', { ascending: false });
          requests.partners = client.from('partners').select('id, name, status');
          requests.investors = client.from('investors').select('id, name, status');
        }
      }
      const entries = await Promise.all(Object.entries(requests).map(async ([key, request]) => [key, await request] as const));
      const failed = entries.find(([, result]) => result.error);
      if (failed) throw new Error(failed[1].error?.message ?? 'Could not load operational data.');
      setError('');
      const next = { ...EMPTY } as Data;
      for (const [key, result] of entries) {
        (next as unknown as Record<string, unknown>)[key] = result.data ?? [];
      }
      if (investorOnly && ['finance', 'profit'].includes(section)) {
        const ownVehicleIds = [...new Set([
          ...next.funding.map((item) => item.vehicle_id),
          ...next.distributions.map((item) => item.vehicle_id),
        ])];
        if (ownVehicleIds.length) {
          const { data: ownVehicles, error: ownVehiclesError } = await client.from('vehicles')
            .select('id, make, model, variant, manufacturing_year, registration_number, business_category, status, purchase_date, purchase_price, expected_sale_price, customer_name, customer_contact')
            .in('id', ownVehicleIds);
          if (ownVehiclesError) throw ownVehiclesError;
          next.vehicles = ownVehicles ?? [];
        }
      }
      setData(next);
    } catch (loadError) {
      setError(messageOf(loadError));
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, profile.is_active, profile.role, section]);

  useEffect(() => {
    if (accessError) return;
    void load();
  }, [accessError, load, refresh]);

  const vehicleMap = useMemo(() => new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle])), [data.vehicles]);
  const partnerMap = useMemo(() => new Map(data.partners.map((party) => [party.id, party.name])), [data.partners]);
  const investorMap = useMemo(() => new Map(data.investors.map((party) => [party.id, party.name])), [data.investors]);
  const filtered = <T extends object>(rows: T[], haystack: (row: T) => string, date: (row: T) => string) => rows.filter((row) =>
    (!search || haystack(row).toLowerCase().includes(search.toLowerCase()))
    && (!from || date(row) >= from)
    && (!to || date(row) <= to),
  );
  const purchaseRows = filtered(data.vehicles.filter((vehicle) => vehicle.purchase_date), (vehicle) => `${vehicleName(vehicle)} ${vehicle.registration_number ?? ''}`, (vehicle) => vehicle.purchase_date ?? '');
  const salesRows = filtered(data.sales, (sale) => `${sale.customer_name} ${vehicleName(vehicleMap.get(sale.vehicle_id))} ${sale.status}`, (sale) => sale.sale_date);
  const vehicleExpenseRows = filtered(data.vehicleExpenses, (expense) => `${expense.expense_type} ${vehicleName(vehicleMap.get(expense.vehicle_id))} ${expense.notes ?? ''}`, (expense) => expense.expense_date)
    .filter((expense) => expenseCategoryFilter === 'all' || expense.expense_type === expenseCategoryFilter);
  const generalExpenseRows = filtered(data.generalExpenses, (expense) => `${expense.category} ${expense.notes ?? ''}`, (expense) => expense.expense_date)
    .filter((expense) => expenseCategoryFilter === 'all' || expense.category === expenseCategoryFilter);
  const selectedSaleRecord = data.sales.find((sale) => sale.id === selectedSale);

  const savePurchase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !isAdmin) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const price = purchase.category === 'consignment' ? '' : purchase.price;
      const totalFunding = fundingDrafts.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (purchase.category !== 'consignment' && (!price || totalFunding > Number(price))) {
        throw new Error('Recorded partner/investor funding must not exceed the purchase price.');
      }
      if (purchase.category !== 'consignment' && fundingDrafts.some((item) => !item.partyId || Number(item.amount) <= 0 || !item.date)) {
        throw new Error('Each showroom funding contribution needs a contributor, positive amount, and date.');
      }
      if (purchase.category === 'consignment' && (fundingDrafts.some((item) => Number(item.amount) > 0) || !purchase.customer_name)) {
        throw new Error('Consignment vehicles cannot have showroom funding or purchase price and need a customer name.');
      }
      const contributions = purchase.category === 'consignment' ? [] : fundingDrafts.map((item) => ({
        partner_id: purchase.category === 'partner' ? item.partyId : null,
        investor_id: purchase.category === 'investor' ? item.partyId : null,
        amount: Number(item.amount),
        contribution_date: item.date,
      }));
      const payload = {
        business_category: purchase.category,
        make: purchase.make,
        model: purchase.model,
        variant: purchase.variant,
        manufacturing_year: purchase.year,
        registration_number: purchase.registration,
        purchase_date: purchase.date,
        purchase_price: price,
        expected_sale_price: '',
        total_additional_costs: 0,
        notes: purchase.notes,
        status: 'available',
        customer_name: purchase.category === 'consignment' ? purchase.customer_name : '',
        customer_contact: purchase.category === 'consignment' ? purchase.customer_contact : '',
      };
      const { error: rpcError } = await supabase.rpc('save_vehicle_with_contributions', {
        p_vehicle_id: null,
        p_vehicle: payload,
        p_contributions: contributions,
      });
      if (rpcError) throw rpcError;
      setNotice('Purchase vehicle and recorded contributions saved.');
      setPurchase({ make: '', model: '', variant: '', year: '', registration: '', date: today, price: '', category: 'partner', notes: '', customer_name: '', customer_contact: '' });
      setFundingDrafts([{ partyId: '', amount: '', date: today }]);
      refreshData();
    } catch (saveError) {
      setError(messageOf(saveError));
    } finally {
      setSaving(false);
    }
  };

  const saveSale = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !isAdmin) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const vehicle = vehicleMap.get(saleDraft.vehicleId);
      if (!vehicle || vehicle.status !== 'available') throw new Error('Select an available vehicle.');
      if (!saleDraft.customer.trim() || Number(saleDraft.price) <= 0) throw new Error('Customer name and a positive agreed sale price are required.');
      const { data: savedSale, error: insertError } = await supabase.from('sales').insert({
        vehicle_id: vehicle.id,
        customer_name: saleDraft.customer.trim(),
        customer_contact: saleDraft.contact || null,
        sale_date: saleDraft.date,
        selling_price: Number(saleDraft.price),
        advance_payment: 0,
        remaining_balance: Number(saleDraft.price),
        status: 'pending',
      }).select('id').single();
      if (insertError) throw insertError;
      const { error: auditError } = await supabase.from('audit_logs').insert({
        actor_id: userId, action_type: 'sale_recorded', entity_type: 'sale', entity_id: savedSale.id,
        details: { vehicle_id: vehicle.id, sale_date: saleDraft.date, selling_price: Number(saleDraft.price), status: 'pending' },
      });
      if (auditError) throw new Error(`Sale was recorded, but its audit entry could not be saved: ${auditError.message}`);
      setNotice('Sale recorded as pending. Record customer payments separately; an advance does not complete the sale.');
      setSaleDraft({ vehicleId: '', date: today, price: '', customer: '', contact: '' });
      refreshData();
    } catch (saveError) {
      setError(messageOf(saveError));
    } finally {
      setSaving(false);
    }
  };

  const addPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !isAdmin || !selectedSaleRecord) return;
    if (selectedSaleRecord.remaining_balance === null) {
      setError('This sale has no stored balance; a payment cannot be safely validated.');
      return;
    }
    const balance = Number(selectedSaleRecord.remaining_balance);
    const paymentAmount = Number(paymentDraft.amount);
    if (paymentAmount <= 0 || paymentAmount > balance) {
      setError(`Payment must be positive and no greater than the stored outstanding balance (${amount(balance)}).`);
      return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const { data: savedPayment, error: paymentError } = await supabase.from('sale_payments').insert({
        sale_id: selectedSaleRecord.id,
        amount: paymentAmount,
        payment_method: paymentDraft.method || null,
        payment_date: paymentDraft.date,
        reference_number: paymentDraft.reference || null,
      }).select('id').single();
      if (paymentError) throw paymentError;
      const remaining = balance - paymentAmount;
      const { error: balanceError } = await supabase.from('sales').update({ remaining_balance: remaining }).eq('id', selectedSaleRecord.id);
      if (balanceError) throw new Error(`Payment was recorded, but the sale balance could not be updated: ${balanceError.message}`);
      const { error: auditError } = await supabase.from('audit_logs').insert({
        actor_id: userId, action_type: 'customer_payment_recorded', entity_type: 'sale_payment', entity_id: savedPayment.id,
        details: { sale_id: selectedSaleRecord.id, amount: paymentAmount, remaining_balance: remaining },
      });
      if (auditError) throw new Error(`Payment and sale balance were recorded, but its audit entry could not be saved: ${auditError.message}`);
      setNotice('Customer payment recorded and stored balance updated. Sale status was not changed.');
      setPaymentDraft({ amount: '', date: today, method: '', reference: '' });
      refreshData();
    } catch (saveError) {
      setError(messageOf(saveError));
      refreshData();
    } finally {
      setSaving(false);
    }
  };

  const updateSaleStatus = async (sale: Sale, status: string) => {
    if (!supabase || !isAdmin) return;
    if (sale.status !== 'pending') {
      setError('Only pending sales can change status through this workflow. Completed or cancelled sales need an authorized reversal workflow.');
      return;
    }
    if (status === 'completed' && Number(sale.remaining_balance ?? 0) > 0) {
      setError('A sale cannot be completed while its stored balance is outstanding.');
      return;
    }
    if (status === 'completed' && sale.remaining_balance === null) {
      setError('A sale cannot be completed while its stored balance is unavailable.');
      return;
    }
    if (status === 'cancelled' && !window.confirm('Cancel this sale? The existing record and payment history will remain unchanged.')) return;
    setSaving(true); setError(''); setNotice('');
    const { error: updateError } = await supabase.from('sales').update({ status }).eq('id', sale.id);
    if (updateError) setError(updateError.message);
    else {
      if (status === 'completed') {
        const { error: vehicleError } = await supabase.from('vehicles').update({ status: 'sold' }).eq('id', sale.vehicle_id);
        if (vehicleError) {
          setError(`Sale was marked completed, but the vehicle could not be marked sold: ${vehicleError.message}`);
          refreshData();
          setSaving(false);
          return;
        }
      }
      const { error: auditError } = await supabase.from('audit_logs').insert({
        actor_id: userId, action_type: 'sale_status_updated', entity_type: 'sale', entity_id: sale.id,
        details: { previous_status: sale.status, status },
      });
      if (auditError) setError(`Sale status updated, but its audit entry could not be saved: ${auditError.message}`);
      else setNotice(`Sale status updated to ${status}.`);
      refreshData();
    }
    setSaving(false);
  };

  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !isAdmin) return;
    const expenseAmount = Number(expenseDraft.amount);
    if (expenseAmount <= 0 || (expenseDraft.kind === 'vehicle' && !expenseDraft.vehicleId)) {
      setError('Select a vehicle when required and enter a positive expense amount.');
      return;
    }
    setSaving(true); setError(''); setNotice('');
    let uploadedPath: string | null = null;
    try {
      if (expenseDraft.receipt) {
        if (expenseDraft.receipt.type !== 'application/pdf' || expenseDraft.receipt.size > 20 * 1024 * 1024) {
          throw new Error('Receipt must be a PDF no larger than 20 MB.');
        }
        uploadedPath = `expenses/${crypto.randomUUID()}-${expenseDraft.receipt.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage.from('vehicle-documents').upload(uploadedPath, expenseDraft.receipt, { upsert: false });
        if (uploadError) throw uploadError;
      }
      const table = expenseDraft.kind === 'vehicle' ? 'vehicle_expenses' : 'general_expenses';
      const expenseInsert = expenseDraft.kind === 'vehicle'
        ? await supabase.from('vehicle_expenses').insert({
          vehicle_id: expenseDraft.vehicleId,
          expense_type: expenseDraft.category,
          amount: expenseAmount,
          expense_date: expenseDraft.date,
          payment_method: expenseDraft.method || null,
          receipt_url: uploadedPath,
          notes: expenseDraft.notes || null,
        }).select('id').single()
        : await supabase.from('general_expenses').insert({
          category: expenseDraft.category,
          amount: expenseAmount,
          expense_date: expenseDraft.date,
          payment_method: expenseDraft.method || null,
          receipt_url: uploadedPath,
          notes: expenseDraft.notes || null,
        }).select('id').single();
      const { data: savedExpense, error: insertError } = expenseInsert;
      if (insertError) {
        if (uploadedPath) await supabase.storage.from('vehicle-documents').remove([uploadedPath]);
        throw insertError;
      }
      const { error: auditError } = await supabase.from('audit_logs').insert({
        actor_id: userId, action_type: 'expense_recorded', entity_type: table, entity_id: savedExpense.id,
        details: { expense_kind: expenseDraft.kind, category: expenseDraft.category, amount: expenseAmount, expense_date: expenseDraft.date, vehicle_id: expenseDraft.vehicleId || null },
      });
      if (auditError) throw new Error(`Expense was recorded, but its audit entry could not be saved: ${auditError.message}`);
      setNotice('Expense recorded.');
      setExpenseDraft({ kind: 'vehicle', vehicleId: '', category: 'Repairs', amount: '', date: today, method: '', notes: '', receipt: null });
      refreshData();
    } catch (saveError) {
      setError(messageOf(saveError));
    } finally {
      setSaving(false);
    }
  };

  const title: Record<Section, string> = {
    purchases: 'Purchase management', sales: 'Sales management', expenses: 'Expenses',
    finance: 'Finance ledger', profit: 'Profit management',
  };
  const subtitles: Record<Section, string> = {
    purchases: 'Recorded vehicle purchases and partner or investor contributions.',
    sales: 'Recorded vehicle sales, customer payments, and balances.',
    expenses: 'Vehicle-specific and general showroom expenses.',
    finance: 'Separate recorded cash movement sources. This is not a reconciled cash balance.',
    profit: 'Approved calculations and distribution records only; no profit is calculated or posted here.',
  };

  if (accessError) {
    return <div className="page-shell"><header className="page-header"><div><h1>{title[section]}</h1><p className="muted">{subtitles[section]}</p></div></header><p className="auth-feedback error" role="alert">{accessError}</p></div>;
  }

  if (error && !data.vehicles.length && !data.sales.length && !data.funding.length && !data.transactions.length && !data.vehicleExpenses.length && !data.generalExpenses.length && !data.distributions.length) {
    return <div className="page-shell"><PageHeading title={title[section]} subtitle={subtitles[section]} onRefresh={refreshData} loading={loading} /><p className="auth-feedback error" role="alert">{error}</p></div>;
  }

  return (
    <div className="page-shell operational-page">
      <PageHeading title={title[section]} subtitle={subtitles[section]} onRefresh={refreshData} loading={loading} />
      {error && <p className="auth-feedback error" role="alert">{error}</p>}
      {notice && <p className="auth-feedback" role="status">{notice}</p>}
      {section !== 'purchases' && section !== 'sales' && section !== 'expenses' && <p className="operational-note">{subtitles[section]}</p>}

      {section === 'purchases' && <>
        {isAdmin && <section className="glass-panel panel-section operational-form-panel">
          <h3>Record purchase vehicle</h3>
          <p className="operational-note">Uses the existing audited vehicle-and-contributions RPC. Mixed contributor types and third-party funding are not supported by the current database function.</p>
          <form className="operational-form" onSubmit={(event) => void savePurchase(event)}>
            <label>Vehicle category<select value={purchase.category} onChange={(event) => { setPurchase({ ...purchase, category: event.target.value, customer_name: '' }); setFundingDrafts([{ partyId: '', amount: '', date: today }]); }}><option value="partner">TrueLine Partner Car</option><option value="investor">TrueLine Investor Car</option><option value="consignment">Customer Consignment Car</option></select></label>
            <label>Make<input required value={purchase.make} onChange={(event) => setPurchase({ ...purchase, make: event.target.value })} /></label>
            <label>Model<input required value={purchase.model} onChange={(event) => setPurchase({ ...purchase, model: event.target.value })} /></label>
            <label>Variant<input value={purchase.variant} onChange={(event) => setPurchase({ ...purchase, variant: event.target.value })} /></label>
            <label>Manufacturing year<input type="number" min="1900" max="2100" value={purchase.year} onChange={(event) => setPurchase({ ...purchase, year: event.target.value })} /></label>
            <label>Registration<input value={purchase.registration} onChange={(event) => setPurchase({ ...purchase, registration: event.target.value })} /></label>
            <label>Purchase date<input type="date" required value={purchase.date} onChange={(event) => setPurchase({ ...purchase, date: event.target.value })} /></label>
            {purchase.category !== 'consignment' && <label>Purchase price<input type="number" min="0.01" step="0.01" required value={purchase.price} onChange={(event) => setPurchase({ ...purchase, price: event.target.value })} /></label>}
            {purchase.category === 'consignment' && <><label>Customer name<input required value={purchase.customer_name} onChange={(event) => setPurchase({ ...purchase, customer_name: event.target.value })} /></label><label>Customer contact<input value={purchase.customer_contact} onChange={(event) => setPurchase({ ...purchase, customer_contact: event.target.value })} /></label></>}
            {purchase.category !== 'consignment' && <div className="operational-form-wide">
              <h4>Funding contributions</h4>
              {fundingDrafts.map((draft, index) => {
                const parties = purchase.category === 'partner' ? data.partners : data.investors;
                return <div className="operational-funding-row" key={`funding-${index}`}>
                  <label>{purchase.category === 'partner' ? 'Partner' : 'Investor'}<select required value={draft.partyId} onChange={(event) => setFundingDrafts(fundingDrafts.map((row, rowIndex) => rowIndex === index ? { ...row, partyId: event.target.value } : row))}><option value="">Select</option>{parties.filter((party) => party.status === 'active').map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label>
                  <label>Amount<input required type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => setFundingDrafts(fundingDrafts.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} /></label>
                  <label>Contribution date<input required type="date" value={draft.date} onChange={(event) => setFundingDrafts(fundingDrafts.map((row, rowIndex) => rowIndex === index ? { ...row, date: event.target.value } : row))} /></label>
                  {fundingDrafts.length > 1 && <button className="ghost-button" type="button" onClick={() => setFundingDrafts(fundingDrafts.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}
                </div>;
              })}
              <button type="button" className="ghost-button" onClick={() => setFundingDrafts([...fundingDrafts, { partyId: '', amount: '', date: today }])}>Add contributor</button>
              <p className="funding-total">Recorded contributions: {amount(fundingDrafts.reduce((sum, item) => sum + Number(item.amount || 0), 0))} · Unfunded purchase amount: {amount(Math.max(0, Number(purchase.price || 0) - fundingDrafts.reduce((sum, item) => sum + Number(item.amount || 0), 0)))}</p>
            </div>}
            <label className="operational-form-wide">Notes<textarea rows={2} value={purchase.notes} onChange={(event) => setPurchase({ ...purchase, notes: event.target.value })} /></label>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Record purchase'}</button>
          </form>
        </section>}
        <OperationalFilters search={search} setSearch={setSearch} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <section className="glass-panel panel-section"><h3>Purchase history</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Vehicle</th><th>Category</th><th>Purchase date</th><th>Purchase price</th><th>Recorded funding</th><th>Unfunded portion*</th><th>Status</th></tr></thead><tbody>
          {purchaseRows.map((vehicle) => {
            const recorded = data.funding.filter((item) => item.vehicle_id === vehicle.id);
            const total = recorded.reduce((sum, item) => sum + Number(item.amount), 0);
            return <tr key={vehicle.id}><td><Link to={`/inventory/${vehicle.id}`}>{vehicleName(vehicle)}</Link><small className="table-subtext">{vehicle.registration_number || 'No registration recorded'}</small></td><td>{vehicle.business_category}</td><td>{vehicle.purchase_date}</td><td>{amount(vehicle.purchase_price)}</td><td>{recorded.length ? amount(total) : 'Not linked'}</td><td>{vehicle.purchase_price === null ? 'Not applicable' : amount(Math.max(0, Number(vehicle.purchase_price) - total))}</td><td>{vehicle.status}</td></tr>;
          })}
          {!loading && !purchaseRows.length && <EmptyRow columns={7} />}
        </tbody></table></div><p className="operational-note">*Based only on partner/investor contribution rows; the schema does not link third-party sources to purchases.</p></section>
      </>}

      {section === 'sales' && <>
        {isAdmin && <section className="glass-panel panel-section operational-form-panel">
          <h3>Record sale</h3>
          <p className="operational-note">New sales are saved as pending. Customer payments are recorded separately and do not automatically complete a sale.</p>
          <form className="operational-form" onSubmit={(event) => void saveSale(event)}>
            <label>Available vehicle<select required value={saleDraft.vehicleId} onChange={(event) => setSaleDraft({ ...saleDraft, vehicleId: event.target.value })}><option value="">Select vehicle</option>{data.vehicles.filter((vehicle) => vehicle.status === 'available').map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicleName(vehicle)} · {vehicle.registration_number || 'No registration'}</option>)}</select></label>
            <label>Sale date<input type="date" required value={saleDraft.date} onChange={(event) => setSaleDraft({ ...saleDraft, date: event.target.value })} /></label>
            <label>Agreed sale price<input type="number" min="0.01" step="0.01" required value={saleDraft.price} onChange={(event) => setSaleDraft({ ...saleDraft, price: event.target.value })} /></label>
            <label>Customer name<input required value={saleDraft.customer} onChange={(event) => setSaleDraft({ ...saleDraft, customer: event.target.value })} /></label>
            <label>Customer contact<input value={saleDraft.contact} onChange={(event) => setSaleDraft({ ...saleDraft, contact: event.target.value })} /></label>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Record pending sale'}</button>
          </form>
        </section>}
        {isAdmin && data.sales.length > 0 && <section className="glass-panel panel-section operational-form-panel">
          <h3>Record customer payment</h3>
          <form className="operational-form" onSubmit={(event) => void addPayment(event)}>
            <label>Sale<select required value={selectedSale} onChange={(event) => setSelectedSale(event.target.value)}><option value="">Select pending or active sale</option>{data.sales.filter((sale) => sale.status !== 'cancelled').map((sale) => <option value={sale.id} key={sale.id}>{sale.customer_name} · {vehicleName(vehicleMap.get(sale.vehicle_id))} · balance {amount(sale.remaining_balance)}</option>)}</select></label>
            {selectedSaleRecord && <p className="operational-note">Stored outstanding balance: {amount(selectedSaleRecord.remaining_balance)}. Payment rows and advance fields are not combined because historical duplication is not defined.</p>}
            <label>Payment amount<input required type="number" min="0.01" step="0.01" max={selectedSaleRecord?.remaining_balance ?? undefined} value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: event.target.value })} /></label>
            <label>Payment date<input required type="date" value={paymentDraft.date} onChange={(event) => setPaymentDraft({ ...paymentDraft, date: event.target.value })} /></label>
            <label>Payment method<input value={paymentDraft.method} onChange={(event) => setPaymentDraft({ ...paymentDraft, method: event.target.value })} /></label>
            <label>Reference<input value={paymentDraft.reference} onChange={(event) => setPaymentDraft({ ...paymentDraft, reference: event.target.value })} /></label>
            <button type="submit" className="primary-button" disabled={saving || !selectedSaleRecord}>{saving ? 'Saving…' : 'Record payment'}</button>
          </form>
        </section>}
        <OperationalFilters search={search} setSearch={setSearch} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <section className="glass-panel panel-section"><h3>Sales history</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Sale date</th><th>Vehicle</th><th>Customer</th><th>Sale price</th><th>Stored balance</th><th>Recorded payment rows</th><th>Status</th>{isAdmin && <th>Update status</th>}</tr></thead><tbody>
          {salesRows.map((sale) => <tr key={sale.id}><td>{sale.sale_date}</td><td><Link to={`/inventory/${sale.vehicle_id}`}>{vehicleName(vehicleMap.get(sale.vehicle_id))}</Link></td><td>{sale.customer_name}<small className="table-subtext">{sale.customer_contact || 'No contact recorded'}</small></td><td>{amount(sale.selling_price)}</td><td>{amount(sale.remaining_balance)}</td><td>{data.salePayments.filter((payment) => payment.sale_id === sale.id).length}</td><td>{sale.status}</td>{isAdmin && <td><select aria-label={`Update status for ${sale.customer_name}`} disabled={saving || sale.status !== 'pending'} value={sale.status} onChange={(event) => void updateSaleStatus(sale, event.target.value)}><option value="pending">Pending</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></td>}</tr>)}
          {!loading && !salesRows.length && <EmptyRow columns={isAdmin ? 8 : 7} />}
        </tbody></table></div><h4>Selected sale payment history</h4><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>
          {data.salePayments.filter((payment) => payment.sale_id === selectedSale).map((payment) => <tr key={payment.id}><td>{payment.payment_date}</td><td>{amount(payment.amount)}</td><td>{payment.payment_method || 'Not recorded'}</td><td>{payment.reference_number || 'Not recorded'}</td></tr>)}
          {!!selectedSale && !data.salePayments.some((payment) => payment.sale_id === selectedSale) && <EmptyRow columns={4} />}
        </tbody></table></div></section>
      </>}

      {section === 'expenses' && <>
        {isAdmin && <section className="glass-panel panel-section operational-form-panel">
          <h3>Record expense</h3>
          <form className="operational-form" onSubmit={(event) => void saveExpense(event)}>
            <label>Expense scope<select value={expenseDraft.kind} onChange={(event) => setExpenseDraft({ ...expenseDraft, kind: event.target.value, vehicleId: '' })}><option value="vehicle">Vehicle expense</option><option value="general">General showroom expense</option></select></label>
            {expenseDraft.kind === 'vehicle' && <label>Vehicle<select required value={expenseDraft.vehicleId} onChange={(event) => setExpenseDraft({ ...expenseDraft, vehicleId: event.target.value })}><option value="">Select vehicle</option>{data.vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicleName(vehicle)}</option>)}</select></label>}
            <label>Category<select value={expenseDraft.category} onChange={(event) => setExpenseDraft({ ...expenseDraft, category: event.target.value })}>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>Amount<input type="number" min="0.01" step="0.01" required value={expenseDraft.amount} onChange={(event) => setExpenseDraft({ ...expenseDraft, amount: event.target.value })} /></label>
            <label>Date<input type="date" required value={expenseDraft.date} onChange={(event) => setExpenseDraft({ ...expenseDraft, date: event.target.value })} /></label>
            <label>Payment method<input value={expenseDraft.method} onChange={(event) => setExpenseDraft({ ...expenseDraft, method: event.target.value })} /></label>
            <label>Receipt (PDF)<input type="file" accept="application/pdf" onChange={(event) => setExpenseDraft({ ...expenseDraft, receipt: event.target.files?.[0] ?? null })} /></label>
            <label className="operational-form-wide">Description / notes<textarea rows={2} value={expenseDraft.notes} onChange={(event) => setExpenseDraft({ ...expenseDraft, notes: event.target.value })} /></label>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Record expense'}</button>
          </form>
        </section>}
        <OperationalFilters search={search} setSearch={setSearch} from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <label className="operational-inline-filter">Category filter<select value={expenseCategoryFilter} onChange={(event) => setExpenseCategoryFilter(event.target.value)}><option value="all">All expense categories</option>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <div className="executive-kpi-grid"><Metric label="Vehicle expenses in range" value={amount(vehicleExpenseRows.reduce((sum, item) => sum + Number(item.amount), 0))} /><Metric label="Showroom expenses in range" value={amount(generalExpenseRows.reduce((sum, item) => sum + Number(item.amount), 0))} /></div>
        <p className="operational-note">The current expense tables have no payment-status or responsible-person columns; these filters/details cannot be shown reliably.</p>
        <section className="glass-panel panel-section"><h3>Vehicle expenses</h3><ExpenseTable rows={vehicleExpenseRows} vehicles={vehicleMap} /></section>
        <section className="glass-panel panel-section"><h3>General showroom expenses</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Payment method</th><th>Description</th><th>Receipt</th></tr></thead><tbody>{generalExpenseRows.map((item) => <tr key={item.id}><td>{item.expense_date}</td><td>{item.category}</td><td>{amount(item.amount)}</td><td>{item.payment_method || 'Not recorded'}</td><td>{item.notes || '—'}</td><td><ReceiptLink path={item.receipt_url} /></td></tr>)}{!loading && !generalExpenseRows.length && <EmptyRow columns={6} />}</tbody></table></div></section>
      </>}

      {section === 'finance' && <FinanceLedger data={data} vehicles={vehicleMap} partners={partnerMap} investors={investorMap} isInvestor={profile.role === 'investor'} search={search} setSearch={setSearch} from={from} setFrom={setFrom} to={to} setTo={setTo} transactionType={transactionType} setTransactionType={setTransactionType} loading={loading} />}

      {section === 'profit' && <ProfitLedger data={data} vehicles={vehicleMap} partners={partnerMap} investors={investorMap} isInvestor={profile.role === 'investor'} loading={loading} />}
    </div>
  );
}

function PageHeading({ title, subtitle, onRefresh, loading }: { title: string; subtitle: string; onRefresh: () => void; loading: boolean }) {
  return <div className="page-header"><div><p className="eyebrow">Operational management</p><h2>{title}</h2><p className="muted">{subtitle}</p></div><button type="button" className="ghost-button" onClick={onRefresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button></div>;
}

function OperationalFilters({ search, setSearch, from, setFrom, to, setTo }: { search: string; setSearch: (value: string) => void; from: string; setFrom: (value: string) => void; to: string; setTo: (value: string) => void }) {
  return <div className="inventory-filters glass-panel operational-filters"><input type="search" aria-label="Search records" placeholder="Search records" value={search} onChange={(event) => setSearch(event.target.value)} /><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>;
}

function EmptyRow({ columns }: { columns: number }) {
  return <tr><td colSpan={columns}>No records in this view.</td></tr>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="executive-kpi glass-panel"><span>{label}</span><strong>{value}</strong></article>;
}

function ExpenseTable({ rows, vehicles }: { rows: VehicleExpense[]; vehicles: Map<string, Vehicle> }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Vehicle</th><th>Category</th><th>Amount</th><th>Payment method</th><th>Description</th><th>Receipt</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.expense_date}</td><td><Link to={`/inventory/${item.vehicle_id}`}>{vehicleName(vehicles.get(item.vehicle_id))}</Link></td><td>{item.expense_type}</td><td>{amount(item.amount)}</td><td>{item.payment_method || 'Not recorded'}</td><td>{item.notes || '—'}</td><td><ReceiptLink path={item.receipt_url} /></td></tr>)}{!rows.length && <EmptyRow columns={7} />}</tbody></table></div>;
}

function ReceiptLink({ path }: { path: string | null }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!path || !supabase) return () => { active = false; };
    void supabase.storage.from('vehicle-documents').createSignedUrl(path, 300).then(({ data, error: signingError }) => {
      if (!active) return;
      if (signingError) setError('Receipt unavailable under current storage permissions.');
      else if (data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [path]);
  if (!path) return <>Not attached</>;
  if (error) return <span title={error}>{error}</span>;
  return url ? <a href={url} target="_blank" rel="noreferrer">Open receipt</a> : <span>Loading receipt…</span>;
}

function FinanceLedger({ data, vehicles, partners, investors, isInvestor, search, setSearch, from, setFrom, to, setTo, transactionType, setTransactionType, loading }: {
  data: Data; vehicles: Map<string, Vehicle>; partners: Map<string, string>; investors: Map<string, string>; isInvestor: boolean;
  search: string; setSearch: (value: string) => void; from: string; setFrom: (value: string) => void; to: string; setTo: (value: string) => void;
  transactionType: string; setTransactionType: (value: string) => void; loading: boolean;
}) {
  const inDateRange = (date: string) => (!from || date.slice(0, 10) >= from) && (!to || date.slice(0, 10) <= to);
  const transactions = data.transactions.filter((item) => inDateRange(item.created_at) && (transactionType === 'all' || item.transaction_type === transactionType) && (!search || `${item.transaction_type} ${item.notes ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const funding = data.funding.filter((item) => inDateRange(item.contribution_date) && (!search || `${vehicles.get(item.vehicle_id)?.make ?? ''} ${partners.get(item.partner_id ?? '') ?? ''} ${investors.get(item.investor_id ?? '') ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const payments = data.salePayments.filter((item) => inDateRange(item.payment_date) && (!search || `${item.payment_method ?? ''} ${item.reference_number ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const vehicleExpenses = data.vehicleExpenses.filter((item) => inDateRange(item.expense_date));
  const generalExpenses = data.generalExpenses.filter((item) => inDateRange(item.expense_date));
  const distributionPayments = data.distributionPayments.filter((item) => inDateRange(item.payment_date));
  const reserveTransactions = data.reserveTransactions.filter((item) => inDateRange(item.created_at));
  const incomingCustomer = payments.reduce((sum, item) => sum + Number(item.amount), 0);
  const incomingFunding = funding.reduce((sum, item) => sum + Number(item.amount), 0);
  const outgoingExpenses = [...vehicleExpenses, ...generalExpenses].reduce((sum, item) => sum + Number(item.amount), 0);
  const outgoingDistribution = distributionPayments.reduce((sum, item) => sum + Number(item.paid_amount), 0);
  const salesRevenue = data.sales.filter((sale) => sale.status === 'completed' && inDateRange(sale.sale_date)).reduce((sum, sale) => sum + Number(sale.selling_price), 0);
  const completedSalesCount = data.sales.filter((sale) => sale.status === 'completed' && inDateRange(sale.sale_date)).length;
  return <>
    <OperationalFilters search={search} setSearch={setSearch} from={from} setFrom={setFrom} to={to} setTo={setTo} />
    <label className="operational-inline-filter">Recorded transaction type<select value={transactionType} onChange={(event) => setTransactionType(event.target.value)}><option value="all">All transaction types</option>{[...new Set(data.transactions.map((item) => item.transaction_type))].map((type) => <option key={type}>{type}</option>)}</select></label>
    <div className="executive-kpi-grid">
      {!isInvestor && <Metric label="Completed sale revenue (recorded prices)" value={completedSalesCount ? amount(salesRevenue) : 'No completed sales'} />}
      <Metric label="Recorded customer payments" value={payments.length ? amount(incomingCustomer) : 'No payment rows'} />
      <Metric label="Recorded contributions (not sales)" value={funding.length ? amount(incomingFunding) : 'No contribution rows'} />
      {!isInvestor && <Metric label="Recorded expenses" value={amount(outgoingExpenses)} />}
      <Metric label="Recorded distributions paid" value={distributionPayments.length ? amount(outgoingDistribution) : 'No payment rows'} />
    </div>
    <p className="operational-note">These are source-specific totals, not a consolidated cash balance. Financial transaction types are displayed as recorded and are not guessed as inflows or outflows; they may overlap dedicated payment, funding, or expense tables. Loans are not sales revenue. Reserve transfers are listed separately.</p>
    <section className="glass-panel panel-section"><h3>{isInvestor ? 'Your permitted financial transactions' : 'Recorded financial transactions'}</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Vehicle</th><th>Person</th><th>Notes</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td>{item.created_at.slice(0, 10)}</td><td>{item.transaction_type}</td><td>{item.currency} {Number(item.amount).toLocaleString()}</td><td>{item.status}</td><td>{item.related_vehicle_id ? <Link to={`/inventory/${item.related_vehicle_id}`}>{vehicleName(vehicles.get(item.related_vehicle_id))}</Link> : '—'}</td><td>{partners.get(item.related_partner_id ?? '') ?? investors.get(item.related_investor_id ?? '') ?? '—'}</td><td>{item.notes || '—'}</td></tr>)}{!loading && !transactions.length && <EmptyRow columns={7} />}</tbody></table></div></section>
    {isInvestor && <>
      <section className="glass-panel panel-section"><h3>Your recorded contributions</h3><SimpleTable headers={['Date', 'Vehicle', 'Amount', 'Payment method', 'Reference']} rows={funding.map((item) => [item.contribution_date, vehicleName(vehicles.get(item.vehicle_id)), amount(item.amount), item.payment_method || 'Not recorded', item.reference_number || '—'])} loading={loading} /></section>
      <section className="glass-panel panel-section"><h3>Your recorded distribution payments</h3><SimpleTable headers={['Date', 'Vehicle', 'Amount', 'Method']} rows={distributionPayments.map((item) => {
        const distribution = data.distributions.find((row) => row.id === item.distribution_id);
        return [item.payment_date, distribution ? vehicleName(vehicles.get(distribution.vehicle_id)) : 'Distribution', amount(item.paid_amount), item.payment_method || 'Not recorded'];
      })} loading={loading} /></section>
    </>}
    {!isInvestor && <>
      <section className="glass-panel panel-section"><h3>Customer payments (actual recorded receipts)</h3><SimpleTable headers={['Date', 'Vehicle', 'Amount', 'Method', 'Reference']} rows={payments.map((item) => [item.payment_date, vehicleName(vehicles.get(data.sales.find((sale) => sale.id === item.sale_id)?.vehicle_id ?? '')), amount(item.amount), item.payment_method || 'Not recorded', item.reference_number || '—'])} loading={loading} /></section>
      <section className="glass-panel panel-section"><h3>Partner and investor contributions</h3><SimpleTable headers={['Date', 'Contributor', 'Vehicle', 'Amount', 'Method']} rows={funding.map((item) => [item.contribution_date, partners.get(item.partner_id ?? '') ?? investors.get(item.investor_id ?? '') ?? 'Not recorded', vehicleName(vehicles.get(item.vehicle_id)), amount(item.amount), item.payment_method || 'Not recorded'])} loading={loading} /></section>
      <section className="glass-panel panel-section"><h3>Recorded expenses</h3><SimpleTable headers={['Date', 'Scope', 'Category', 'Vehicle', 'Amount', 'Payment method']} rows={[...vehicleExpenses.map((item) => [item.expense_date, 'Vehicle', item.expense_type, vehicleName(vehicles.get(item.vehicle_id)), amount(item.amount), item.payment_method || 'Not recorded']), ...generalExpenses.map((item) => [item.expense_date, 'Showroom', item.category, '—', amount(item.amount), item.payment_method || 'Not recorded'])]} loading={loading} /></section>
      <section className="glass-panel panel-section"><h3>Profit distributions paid</h3><SimpleTable headers={['Date', 'Distribution', 'Amount', 'Method']} rows={distributionPayments.map((item) => [item.payment_date, data.distributions.find((distribution) => distribution.id === item.distribution_id)?.rule_name ?? item.distribution_id, amount(item.paid_amount), item.payment_method || 'Not recorded'])} loading={loading} /></section>
      <section className="glass-panel panel-section"><h3>Reserve movements (separate transfers)</h3><SimpleTable headers={['Date', 'Type', 'Amount', 'Description']} rows={reserveTransactions.map((item) => [item.created_at.slice(0, 10), item.transaction_type, amount(item.amount), item.description || '—'])} loading={loading} /></section>
      <section className="glass-panel panel-section"><h3>Recorded reserve balances</h3><SimpleTable headers={['Reserve', 'Stored balance']} rows={data.reserves.map((item) => [item.reserve_name, amount(item.current_balance)])} loading={loading} /></section>
    </>}
  </>;
}

function ProfitLedger({ data, vehicles, partners, investors, isInvestor, loading }: { data: Data; vehicles: Map<string, Vehicle>; partners: Map<string, string>; investors: Map<string, string>; isInvestor: boolean; loading: boolean }) {
  return <>
    <p className="operational-note">This page does not calculate profit, create distributions, or modify approvals. It displays approved source records only. Partner allocations, consignment commission/reserve choices, and payout approval automation are unavailable without an existing approved workflow/RPC.</p>
    {!isInvestor && <section className="glass-panel panel-section"><h3>Completed vehicle sale and approved calculation</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Vehicle</th><th>Sale</th><th>Sale price recorded</th><th>Purchase price</th><th>Vehicle expenses recorded</th><th>Approved net profit</th><th>Calculation status</th></tr></thead><tbody>
      {data.sales.filter((sale) => sale.status === 'completed').map((sale) => {
        const vehicle = vehicles.get(sale.vehicle_id);
        const calculationRows = data.calculations.filter((row) => row.sale_id === sale.id && row.status === 'approved');
        const expenses = data.vehicleExpenses.filter((item) => item.vehicle_id === sale.vehicle_id).reduce((sum, item) => sum + Number(item.amount), 0);
        const calculation = calculationRows.length === 1 ? calculationRows[0] : null;
        return <tr key={sale.id}><td><Link to={`/inventory/${sale.vehicle_id}`}>{vehicleName(vehicle)}</Link></td><td>{sale.sale_date} · {sale.status}</td><td>{amount(sale.selling_price)}</td><td>{amount(vehicle?.purchase_price)}</td><td>{amount(expenses)}</td><td>{calculation ? amount(calculation.net_profit) : 'Not yet available'}</td><td>{calculation ? 'Approved' : calculationRows.length > 1 ? 'Multiple approved records; needs review' : 'No approved calculation'}</td></tr>;
      })}
      {!loading && !data.sales.some((sale) => sale.status === 'completed') && <EmptyRow columns={7} />}
    </tbody></table></div></section>}
    <section className="glass-panel panel-section"><h3>{isInvestor ? 'Your distribution history' : 'Profit distribution history'}</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Vehicle</th><th>Recipient</th><th>Rule recorded</th><th>Approval status</th><th>Approved amount</th><th>Paid</th><th>Remaining payable*</th><th>Approval date</th></tr></thead><tbody>
      {data.distributions.map((item) => {
        const paid = data.distributionPayments.filter((payment) => payment.distribution_id === item.id).reduce((sum, payment) => sum + Number(payment.paid_amount), 0);
        const recipient = item.recipient_type === 'partner' ? partners.get(item.recipient_id ?? '') : investors.get(item.recipient_id ?? '');
        const approved = item.approval_status === 'approved';
        const remaining = Number(item.amount) - paid;
        const payable = remaining < 0 ? `Overpaid by ${amount(-remaining)}` : amount(remaining);
        return <tr key={item.id}><td><Link to={`/inventory/${item.vehicle_id}`}>{vehicleName(vehicles.get(item.vehicle_id))}</Link></td><td>{recipient ?? `${item.recipient_type} (name unavailable)`}</td><td>{item.rule_name}</td><td>{item.approval_status}</td><td>{approved ? amount(item.amount) : 'Not approved'}</td><td>{amount(paid)}</td><td>{approved ? payable : 'Not available'}</td><td>{item.created_at.slice(0, 10)}</td></tr>;
      })}
      {!loading && !data.distributions.length && <EmptyRow columns={8} />}
    </tbody></table></div><p className="operational-note">*Computed only as approved distribution amount less its recorded payment rows; no new profit formula or allocation is applied here.</p></section>
    {!isInvestor && <section className="glass-panel panel-section"><h3>Vehicle-linked financial transactions</h3><SimpleTable headers={['Vehicle', 'Transaction type', 'Amount', 'Status', 'Notes']} rows={data.transactions.filter((item) => item.related_vehicle_id).map((item) => [vehicleName(vehicles.get(item.related_vehicle_id ?? '')), item.transaction_type, `${item.currency} ${Number(item.amount).toLocaleString()}`, item.status, item.notes || '—'])} loading={loading} /></section>}
  </>;
}

function SimpleTable({ headers, rows, loading }: { headers: string[]; rows: string[][]; loading: boolean }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${headers[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}{!loading && !rows.length && <EmptyRow columns={headers.length} />}</tbody></table></div>;
}
