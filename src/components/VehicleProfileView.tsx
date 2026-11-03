import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CarFront, Pencil } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from '../lib/supabase';

type UserProfile = {
  role: 'pending' | 'super_admin' | 'partner' | 'investor';
  is_active: boolean;
};

type VehicleRecord = {
  id: string;
  business_category: string;
  make: string;
  model: string;
  variant: string | null;
  manufacturing_year: number | null;
  registration_year: number | null;
  registration_city: string | null;
  registration_number: string | null;
  color: string | null;
  mileage: number | null;
  engine_capacity: number | null;
  transmission: string | null;
  fuel_type: string | null;
  condition: string | null;
  chassis_number: string | null;
  engine_number: string | null;
  status: string;
  purchase_date: string | null;
  purchase_price: number | null;
  total_additional_costs: number | null;
  expected_sale_price: number | null;
  actual_sale_price: number | null;
  notes: string | null;
  customer_name: string | null;
  customer_contact: string | null;
};

type FundingRow = {
  id: string;
  partner_id: string | null;
  investor_id: string | null;
  amount: number;
  contribution_date: string;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
};

type VehicleExpense = { id: string; expense_type: string; amount: number; expense_date: string; notes: string | null };
type VehicleSale = { id: string; customer_name: string; customer_contact: string | null; sale_date: string; selling_price: number; advance_payment: number | null; remaining_balance: number | null; discount: number | null; status: string; notes: string | null };
type SalePayment = { id: string; amount: number; payment_method: string | null; payment_date: string; reference_number: string | null };
type ProfitCalculation = { id: string; net_profit: number; status: string; sale_id: string | null; created_at: string };
type Distribution = { id: string; recipient_type: string; recipient_id: string | null; amount: number; rule_name: string; approval_status: string; created_at: string };
type DistributionPayment = { id: string; distribution_id: string; paid_amount: number; payment_date: string; payment_method: string | null; reference_number: string | null };
type VehicleFile = { id: string; storage_bucket: 'vehicle-images' | 'vehicle-documents'; object_path: string; file_name: string; content_type: string; created_at: string };
type FinancialTransaction = { id: string; transaction_type: string; amount: number; status: string; created_at: string; notes: string | null };
type AuditEntry = { id: string; action_type: string; entity_type: string | null; created_at: string; details: unknown };

type VehicleProfileData = {
  vehicle: VehicleRecord;
  funding: FundingRow[];
  expenses: VehicleExpense[];
  sale: VehicleSale | null;
  salePayments: SalePayment[];
  calculations: ProfitCalculation[];
  distributions: Distribution[];
  distributionPayments: DistributionPayment[];
  files: { file: VehicleFile; url: string | null }[];
  transactions: FinancialTransaction[];
  activity: AuditEntry[];
  partyNames: Map<string, string>;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load vehicle profile data.';
}

function text(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
}

export default function VehicleProfileView({ profile }: { profile: UserProfile }) {
  const { vehicleId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<VehicleProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isInvestor = profile.role === 'investor';
  const isAdmin = profile.role === 'super_admin';
  const currency = import.meta.env.VITE_DEFAULT_CURRENCY || 'PKR';
  const formatMoney = (value: number | null) => value === null ? 'Not recorded' : `${currency} ${Number(value).toLocaleString()}`;

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    void loadProfile(client, vehicleId, profile.role)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((loadError: unknown) => {
        if (active) setError(messageOf(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [vehicleId, profile.role]);

  const approvedCalculations = useMemo(
    () => data?.calculations.filter((item) => item.status.toLowerCase() === 'approved' && item.sale_id === data.sale?.id) ?? [],
    [data],
  );
  const grossProfitText = 'Unavailable — no gross-profit field is defined.';
  const netProfitText = approvedCalculations.length === 1
    ? formatMoney(Number(approvedCalculations[0].net_profit))
    : approvedCalculations.length > 1
      ? 'Unavailable — multiple approved calculations exist.'
      : 'Unavailable — no approved calculation is recorded.';

  if (loading) {
    return <div className="page-shell"><p className="muted" role="status">Loading vehicle profile...</p></div>;
  }
  if (error || !data) {
    return (
      <div className="page-shell">
        <Link className="ghost-button profile-back-link" to="/inventory"><ArrowLeft size={16} /> Inventory</Link>
        <p className="auth-feedback error" role="alert">{error || 'Vehicle not found or unavailable to this account.'}</p>
      </div>
    );
  }

  const { vehicle } = data;
  const vehicleName = [vehicle.manufacturing_year, vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(' ');
  const heroPhoto = data.files.find(({ file }) => file.content_type.startsWith('image/') && file.storage_bucket === 'vehicle-images' && file.file_name && data.files.find((candidate) => candidate.file.id === file.id)?.url);
  const categoryLabel = vehicle.business_category === 'consignment'
    ? 'Customer consignment'
    : `${vehicle.business_category.charAt(0).toUpperCase()}${vehicle.business_category.slice(1)} funded`;

  return (
    <div className="page-shell vehicle-profile-page">
      <div className="profile-actions">
        <button type="button" className="ghost-button profile-back-link" onClick={() => navigate('/inventory')}><ArrowLeft size={16} /> Inventory</button>
        {isAdmin && (
          <Link className="ghost-button profile-back-link" to={`/inventory?edit=${encodeURIComponent(vehicle.id)}`}>
            <Pencil size={16} /> Edit vehicle
          </Link>
        )}
      </div>

      <section className="vehicle-profile-hero glass-panel">
        <div className={`vehicle-profile-photo${heroPhoto?.url ? '' : ' vehicle-profile-photo-empty'}`}>
          {heroPhoto?.url
            ? <img src={heroPhoto.url} alt={vehicleName} />
            : <CarFront size={60} strokeWidth={1.2} aria-hidden="true" />}
        </div>
        <div className="vehicle-profile-heading">
          <p className="eyebrow">{categoryLabel}</p>
          <h2>{vehicleName}</h2>
          <div className="vehicle-profile-badges">
            <span className="status-badge">{vehicle.status.replaceAll('_', ' ')}</span>
            <span className="vehicle-card-category">{vehicle.registration_number || 'Registration not recorded'}</span>
          </div>
        </div>
      </section>

      <section className="vehicle-profile-grid">
        <ProfileSection title="Overview">
          <ProfileFacts values={[
            ['Make', vehicle.make], ['Model', vehicle.model], ['Variant', vehicle.variant],
            ['Manufacturing year', vehicle.manufacturing_year], ['Registration year', vehicle.registration_year],
            ['Registration city', vehicle.registration_city], ['Registration number', vehicle.registration_number],
            ['Color', vehicle.color], ['Mileage', vehicle.mileage === null ? null : `${Number(vehicle.mileage).toLocaleString()} km`],
            ['Engine capacity', vehicle.engine_capacity === null ? null : `${vehicle.engine_capacity} cc`],
            ['Transmission', vehicle.transmission], ['Fuel type', vehicle.fuel_type], ['Condition', vehicle.condition],
            ['Chassis number', vehicle.chassis_number], ['Engine number', vehicle.engine_number],
          ]} />
          {vehicle.notes && <p className="vehicle-profile-notes">{vehicle.notes}</p>}
        </ProfileSection>

        <ProfileSection title="Purchase">
          <ProfileFacts values={[
            ['Purchase date', vehicle.purchase_date], ['Purchase price', formatMoney(vehicle.purchase_price)],
            ['Additional costs recorded', formatMoney(vehicle.total_additional_costs)],
            ['Expected sale price', formatMoney(vehicle.expected_sale_price)],
            ['Actual sale price', formatMoney(vehicle.actual_sale_price)],
          ]} />
          {vehicle.business_category === 'consignment' && (
            <ProfileFacts values={[['Customer', vehicle.customer_name], ['Customer contact', vehicle.customer_contact]]} />
          )}
        </ProfileSection>

        <ProfileSection title={isInvestor ? 'Your funding' : 'Funding contributions'}>
          {data.funding.length ? (
            <div className="profile-record-list">
              {data.funding.map((item) => (
                <article className="profile-record" key={item.id}>
                  <strong>{isInvestor ? 'Your investor contribution' : data.partyNames.get(item.partner_id ?? item.investor_id ?? '') ?? 'Contributor not identified'}</strong>
                  <span>{formatMoney(Number(item.amount))} · {item.contribution_date}</span>
                  {item.payment_method && <span>{item.payment_method}</span>}
                  {item.reference_number && <span>Ref: {item.reference_number}</span>}
                  {item.notes && <p>{item.notes}</p>}
                </article>
              ))}
            </div>
          ) : <p className="muted">{isInvestor ? 'No contribution linked to your investor account is visible for this vehicle.' : 'No funding contributions are recorded.'}</p>}
        </ProfileSection>

        <ProfileSection title="Expenses">
          {isInvestor
            ? <p className="muted">Vehicle expense records are not available under this role's current data access.</p>
            : data.expenses.length
              ? <div className="profile-record-list">{data.expenses.map((item) => <article className="profile-record" key={item.id}><strong>{item.expense_type}</strong><span>{formatMoney(Number(item.amount))} · {item.expense_date}</span>{item.notes && <p>{item.notes}</p>}</article>)}</div>
              : <p className="muted">No vehicle expenses are recorded.</p>}
        </ProfileSection>

        <ProfileSection title="Sale & payments">
          {isInvestor
            ? <p className="muted">Sale and customer payment details are not available under this role's current data access.</p>
            : data.sale
              ? <>
                <ProfileFacts values={[
                  ['Buyer', data.sale.customer_name], ['Buyer contact', data.sale.customer_contact],
                  ['Sale date', data.sale.sale_date], ['Sale price', formatMoney(Number(data.sale.selling_price))],
                  ['Advance recorded', formatMoney(data.sale.advance_payment)], ['Stored remaining balance', formatMoney(data.sale.remaining_balance)],
                  ['Status', data.sale.status], ['Notes', data.sale.notes],
                ]} />
                <h4 className="profile-subheading">Recorded payment history</h4>
                {data.salePayments.length
                  ? <div className="profile-record-list">{data.salePayments.map((item) => <article className="profile-record" key={item.id}><strong>{formatMoney(Number(item.amount))} · {item.payment_date}</strong><span>{item.payment_method || 'Payment method not recorded'}</span>{item.reference_number && <span>Ref: {item.reference_number}</span>}</article>)}</div>
                  : <p className="muted">No sale payments are recorded.</p>}
              </>
              : <p className="muted">No sale record is linked to this vehicle.</p>}
        </ProfileSection>

        <ProfileSection title="Profit">
          <ProfileFacts values={[['Gross profit', grossProfitText], ['Approved net profit', isInvestor ? 'Unavailable under this role’s current data access.' : netProfitText]]} />
          {!isInvestor && data.calculations.length > 0 && (
            <>
              <h4 className="profile-subheading">Stored calculation records (not aggregated)</h4>
              <div className="profile-record-list">
                {data.calculations.map((item) => <article className="profile-record" key={item.id}><strong>{item.status.replaceAll('_', ' ')}</strong><span>Net profit stored: {formatMoney(Number(item.net_profit))}</span><span>Recorded {new Date(item.created_at).toLocaleDateString()}</span></article>)}
              </div>
              <p className="muted">Multiple calculation rows are shown separately and are never summed.</p>
            </>
          )}
          {isInvestor && <p className="muted">Profit calculation records are not available under this role’s current data access.</p>}
        </ProfileSection>

        <ProfileSection title={isInvestor ? 'Your distributions' : 'Profit distributions'}>
          {data.distributions.length
            ? <div className="profile-record-list">{data.distributions.map((item) => {
              const payments = data.distributionPayments.filter((payment) => payment.distribution_id === item.id);
              return <article className="profile-record" key={item.id}><strong>{formatMoney(Number(item.amount))} · {item.approval_status.replaceAll('_', ' ')}</strong><span>{item.rule_name} · {new Date(item.created_at).toLocaleDateString()}</span>{isInvestor && <span>Allocated to your investor account</span>}{payments.map((payment) => <span key={payment.id}>Paid {formatMoney(Number(payment.paid_amount))} · {payment.payment_date}</span>)}</article>;
            })}</div>
            : <p className="muted">No permitted distribution records are visible for this vehicle.</p>}
        </ProfileSection>

        <ProfileSection title="Documents & photos">
          {data.files.length
            ? <div className="vehicle-profile-files">{data.files.map(({ file, url }) => url
              ? <a href={url} key={file.id} target="_blank" rel="noreferrer">{file.content_type.startsWith('image/') && <img src={url} alt="" loading="lazy" />}<span>{file.file_name}</span></a>
              : <span className="muted" key={file.id}>{file.file_name} · preview unavailable</span>)}</div>
            : <p className="muted">No documents or photos are visible to this account.</p>}
        </ProfileSection>

        <ProfileSection title="Financial activity">
          {data.transactions.length
            ? <div className="profile-record-list">{data.transactions.map((item) => <article className="profile-record" key={item.id}><strong>{item.transaction_type.replaceAll('_', ' ')}</strong><span>{formatMoney(Number(item.amount))} · {item.status}</span><span>{new Date(item.created_at).toLocaleString()}</span>{item.notes && <p>{item.notes}</p>}</article>)}</div>
            : <p className="muted">No permitted vehicle-linked financial transactions are visible.</p>}
        </ProfileSection>

        <ProfileSection title="Activity history">
          {isAdmin
            ? data.activity.length
              ? <div className="profile-record-list">{data.activity.map((item) => <article className="profile-record" key={item.id}><strong>{item.action_type.replaceAll('_', ' ')}</strong><span>{new Date(item.created_at).toLocaleString()}</span><span>{item.entity_type || 'Entity'} · {item.id}</span></article>)}</div>
              : <p className="muted">No vehicle audit entries are recorded.</p>
            : <p className="muted">Audit history is restricted by the current role’s data access.</p>}
        </ProfileSection>
      </section>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="glass-panel panel-section vehicle-profile-section"><h3>{title}</h3>{children}</section>;
}

function ProfileFacts({ values }: { values: [string, string | number | null | undefined][] }) {
  return <dl className="vehicle-profile-facts">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{text(value)}</dd></div>)}</dl>;
}

async function loadProfile(client: SupabaseClient, vehicleId: string, role: UserProfile['role']): Promise<VehicleProfileData> {
  const { data: vehicle, error: vehicleError } = await client
    .from('vehicles')
    .select('id, business_category, make, model, variant, manufacturing_year, registration_year, registration_city, registration_number, color, mileage, engine_capacity, transmission, fuel_type, condition, chassis_number, engine_number, status, purchase_date, purchase_price, total_additional_costs, expected_sale_price, actual_sale_price, notes, customer_name, customer_contact')
    .eq('id', vehicleId)
    .maybeSingle();
  if (vehicleError) throw vehicleError;
  if (!vehicle) throw new Error('Vehicle not found or unavailable to this account.');

  const isInvestor = role === 'investor';
  const isAdmin = role === 'super_admin';
  const [fundingResult, distributionResult, filesResult, transactionResult] = await Promise.all([
    client.from('funding_contributions')
      .select('id, partner_id, investor_id, amount, contribution_date, payment_method, reference_number, notes')
      .eq('vehicle_id', vehicleId)
      .order('contribution_date', { ascending: false }),
    client.from('profit_distributions')
      .select('id, recipient_type, recipient_id, amount, rule_name, approval_status, created_at')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false }),
    client.from('vehicle_files')
      .select('id, storage_bucket, object_path, file_name, content_type, created_at')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false }),
    client.from('financial_transactions')
      .select('id, transaction_type, amount, status, created_at, notes')
      .eq('related_vehicle_id', vehicleId)
      .order('created_at', { ascending: false }),
  ]);
  const initialError = fundingResult.error ?? distributionResult.error ?? filesResult.error ?? transactionResult.error;
  if (initialError) throw initialError;

  let expenses: VehicleExpense[] = [];
  let sale: VehicleSale | null = null;
  let calculations: ProfitCalculation[] = [];
  let activity: AuditEntry[] = [];
  if (!isInvestor) {
    const [expensesResult, saleResult, calculationResult, activityResult] = await Promise.all([
      client.from('vehicle_expenses')
        .select('id, expense_type, amount, expense_date, notes')
        .eq('vehicle_id', vehicleId)
        .order('expense_date', { ascending: false }),
      client.from('sales')
        .select('id, customer_name, customer_contact, sale_date, selling_price, advance_payment, remaining_balance, discount, status, notes')
        .eq('vehicle_id', vehicleId)
        .maybeSingle(),
      isAdmin
        ? client.from('profit_calculations')
          .select('id, net_profit, status, sale_id, created_at')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      isAdmin
        ? client.from('audit_logs')
          .select('id, action_type, entity_type, created_at, details')
          .eq('entity_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(50)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const detailError = expensesResult.error ?? saleResult.error ?? calculationResult.error ?? activityResult.error;
    if (detailError) throw detailError;
    expenses = (expensesResult.data ?? []) as VehicleExpense[];
    sale = (saleResult.data ?? null) as VehicleSale | null;
    calculations = (calculationResult.data ?? []) as ProfitCalculation[];
    activity = (activityResult.data ?? []) as AuditEntry[];
  }

  const distributions = (distributionResult.data ?? []) as Distribution[];
  const distributionIds = distributions.map((item) => item.id);
  const [salePaymentsResult, distributionPaymentsResult] = await Promise.all([
    !isInvestor && sale
      ? client.from('sale_payments')
        .select('id, amount, payment_method, payment_date, reference_number')
        .eq('sale_id', sale.id)
        .order('payment_date', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    distributionIds.length
      ? client.from('distribution_payments')
        .select('id, distribution_id, paid_amount, payment_date, payment_method, reference_number')
        .in('distribution_id', distributionIds)
        .order('payment_date', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const paymentError = salePaymentsResult.error ?? distributionPaymentsResult.error;
  if (paymentError) throw paymentError;

  const funding = (fundingResult.data ?? []) as FundingRow[];
  const partnerIds = [...new Set(funding.map((item) => item.partner_id).filter((id): id is string => Boolean(id)))];
  const investorIds = [...new Set(funding.map((item) => item.investor_id).filter((id): id is string => Boolean(id)))];
  const partyNames = new Map<string, string>();
  if (!isInvestor && (partnerIds.length || investorIds.length)) {
    const [partnersResult, investorsResult] = await Promise.all([
      partnerIds.length ? client.from('partners').select('id, name').in('id', partnerIds) : Promise.resolve({ data: [], error: null }),
      investorIds.length ? client.from('investors').select('id, name').in('id', investorIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const partyError = partnersResult.error ?? investorsResult.error;
    if (partyError) throw partyError;
    for (const item of partnersResult.data ?? []) partyNames.set(item.id, item.name);
    for (const item of investorsResult.data ?? []) partyNames.set(item.id, item.name);
  }

  const files = (filesResult.data ?? []) as VehicleFile[];
  const filesWithUrls = await Promise.all(files.map(async (file) => {
    const { data, error } = await client.storage.from(file.storage_bucket).createSignedUrl(file.object_path, 300);
    return { file, url: error ? null : data.signedUrl };
  }));
  const signedUrlErrors = filesWithUrls.filter((item) => item.url === null);
  if (signedUrlErrors.length && files.length && role === 'super_admin') {
    throw new Error('One or more vehicle files could not be opened. Check Storage access and retry.');
  }

  return {
    vehicle: vehicle as VehicleRecord,
    funding,
    expenses,
    sale,
    salePayments: (salePaymentsResult.data ?? []) as SalePayment[],
    calculations,
    distributions,
    distributionPayments: (distributionPaymentsResult.data ?? []) as DistributionPayment[],
    files: filesWithUrls,
    transactions: (transactionResult.data ?? []) as FinancialTransaction[],
    partyNames,
    activity,
  };
}
