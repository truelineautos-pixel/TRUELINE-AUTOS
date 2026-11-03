import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Route, Routes, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  BriefcaseBusiness,
  CarFront,
  CircleDollarSign,
  FileText,
  HandCoins,
  Home,
  LogOut,
  Menu,
  PackageSearch,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';
import { supabase, supabaseConfigError } from './lib/supabase';

const SalesExpenseChart = lazy(() => import('./components/SalesExpenseChart'));

type NavItem = {
  key: string;
  label: string;
  icon: React.ComponentType<React.ComponentProps<typeof Home>>;
  path: string;
};

type BackgroundSettings = {
  blur: number;
  brightness: number;
  opacity: number;
};

type Profile = {
  full_name: string | null;
  role: 'pending' | 'super_admin' | 'partner' | 'investor';
  is_active: boolean;
};

const navSections: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: [{ key: 'dashboard', label: 'Dashboard', icon: Home, path: '/' }] },
  {
    label: 'Showroom',
    items: [
      { key: 'inventory', label: 'Inventory', icon: PackageSearch, path: '/inventory' },
      { key: 'purchases', label: 'Purchase', icon: ShoppingBagIcon, path: '/purchases' },
      { key: 'sales', label: 'Sales', icon: TrendingUp, path: '/sales' },
    ],
  },
  {
    label: 'People',
    items: [
      { key: 'partners', label: 'Partners', icon: Users, path: '/partners' },
      { key: 'investors', label: 'Investors', icon: UserRoundCheck, path: '/investors' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { key: 'finance', label: 'Finance', icon: CircleDollarSign, path: '/finance' },
      { key: 'profit', label: 'Profit', icon: HandCoins, path: '/profit' },
      { key: 'expenses', label: 'Expenses', icon: ReceiptText, path: '/expenses' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { key: 'reports', label: 'Reports', icon: FileText, path: '/reports' },
      { key: 'ai', label: 'AI Insights', icon: Sparkles, path: '/ai' },
      { key: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
    ],
  },
];
const navItems = navSections.flatMap((section) => section.items);

const defaultBackground: BackgroundSettings = {
  blur: 8,
  brightness: 0.78,
  opacity: 0.68,
};

const defaultDashboardMonth = (() => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
})();
const dashboardDateLabel = new Date().toLocaleDateString(undefined, { dateStyle: 'medium' });

function formatOperationError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const errorFields = error as Record<string, unknown>;
    if (typeof errorFields.message !== 'string') return 'The operation failed with an unexpected error.';
    const fields = ['details', 'hint', 'code'] as const;
    const extra = fields
      .filter((field) => typeof errorFields[field] === 'string' && errorFields[field])
      .map((field) => `${field}: ${errorFields[field] as string}`);
    return [errorFields.message, ...extra].join(' · ');
  }
  return 'The operation failed with an unexpected error.';
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

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [background, setBackground] = useState<BackgroundSettings>(defaultBackground);
  const [showBackgroundControls, setShowBackgroundControls] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const activeKey = useMemo(
    () => navItems.find((item) => item.path === location.pathname)?.key ?? 'dashboard',
    [location.pathname],
  );
  const displayName = profile?.full_name?.trim() || session?.user.email || 'User';
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      setAuthError('');
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    let mounted = true;
    setProfileLoading(true);
    void supabase
      .from('profiles')
      .select('full_name, role, is_active')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          setAuthError(error.message);
          setProfile(null);
        } else {
          setProfile(data as Profile | null);
        }
        setProfileLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [session]);

  const handleSignIn = async (email: string, password: string) => {
    if (!supabase) {
      setAuthError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthBusy(false);
  };

  const handlePasswordReset = async (email: string) => {
    if (!supabase) {
      setAuthError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) setAuthError(error.message);
    else setAuthMessage('If the account exists, a password reset email has been sent.');
    setAuthBusy(false);
  };

  const handlePasswordUpdate = async (password: string) => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setAuthError(error.message);
    else {
      setRecoveryMode(false);
      setAuthMessage('Password updated. Your account is ready to use.');
    }
    setAuthBusy(false);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
    setRecoveryMode(false);
  };

  const handleBackgroundChange = (key: keyof BackgroundSettings, value: number) => {
    setBackground((prev) => ({ ...prev, [key]: value }));
  };

  const handleGlobalSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = globalSearch.trim();
    if (!query) return;
    navigate(`/inventory?search=${encodeURIComponent(query)}`);
    setGlobalSearch('');
    setMobileNavOpen(false);
  };

  const appStyle = {
    '--bg-blur': `${background.blur}px`,
    '--bg-brightness': background.brightness,
    '--bg-opacity': background.opacity,
  } as React.CSSProperties;

  if (authLoading || profileLoading) {
    return (
      <div className="login-screen">
        <div className="login-panel">
          <div className="login-badge">TRUELINE AUTOS</div>
          <h1>Checking session</h1>
          <p>Loading your account access.</p>
        </div>
      </div>
    );
  }

  if (recoveryMode || !session || !profile?.is_active) {
    return (
      <LoginView
        busy={authBusy}
        error={authError || (!profile?.is_active && session ? 'This account is pending activation. Contact your Super Admin.' : '')}
        message={authMessage}
        configured={Boolean(supabase)}
        recoveryMode={recoveryMode}
        onSignIn={handleSignIn}
        onPasswordReset={handlePasswordReset}
        onPasswordUpdate={handlePasswordUpdate}
        onSignOut={handleSignOut}
        hasSession={Boolean(session)}
      />
    );
  }

  return (
    <div className="app-shell" style={appStyle}>
      <div className="app-background" />
      {mobileNavOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={`sidebar glass-panel${mobileNavOpen ? ' sidebar-open' : ''}`} id="primary-navigation">
        <div className="brand-block">
          <div className="brand-mark">TA</div>
          <div>
            <div className="brand-name">TRUELINE AUTOS</div>
            <div className="brand-subtitle">Smart Showroom</div>
          </div>
          <button type="button" className="icon-button sidebar-close" aria-label="Close navigation menu" onClick={() => setMobileNavOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="nav-list">
          {navSections.map((section) => (
            <div className="nav-section" key={section.label}>
              <p className="nav-section-label">{section.label}</p>
              {section.items.map(({ key, label, icon: Icon, path }) => (
                <NavLink
                  key={key}
                  to={path}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) => `nav-item ${isActive || activeKey === key ? 'active' : ''}`}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-pill">
            <span className="dot" />
            Signed in securely
          </div>
          <button type="button" className="ghost-button" onClick={() => void handleSignOut()}>
            <LogOut size={18} />
            Log out
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar glass-panel">
          <div className="topbar-leading">
            <button
              type="button"
              className="icon-button mobile-menu-toggle"
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-controls="primary-navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
            <div className="mobile-brand">
              <div className="brand-mark">TA</div>
              <div className="brand-name">TRUELINE AUTOS</div>
            </div>
            <form className="search-wrap" onSubmit={handleGlobalSearch} role="search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search inventory"
                placeholder="Search inventory"
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
              />
              <button type="submit" className="search-submit" aria-label="Search inventory">
                <Search size={16} />
              </button>
            </form>
          </div>

          <div className="topbar-actions">
            <div className="user-pill">
              <div className="avatar">{initials}</div>
              <div>
                <strong>{profile?.role.replaceAll('_', ' ')}</strong>
                <span>{displayName}</span>
              </div>
            </div>
            <button type="button" className="icon-button topbar-logout" aria-label="Log out" onClick={() => void handleSignOut()}>
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<DashboardView profile={profile} />} />
          <Route path="/inventory" element={<InventoryView key={location.search} profile={profile} userId={session.user.id} />} />
          <Route path="/purchases" element={<PurchaseView />} />
          <Route path="/sales" element={<SalesView />} />
          <Route path="/partners" element={<PartnersView />} />
          <Route path="/investors" element={<InvestorsView />} />
          <Route path="/finance" element={<FinanceView />} />
          <Route path="/profit" element={<ProfitView />} />
          <Route path="/expenses" element={<ExpensesView />} />
          <Route path="/reports" element={<ReportsView />} />
          <Route path="/ai" element={<AiView />} />
          <Route path="/settings" element={<SettingsView profile={profile} background={background} onChange={handleBackgroundChange} showControls={showBackgroundControls} setShowControls={setShowBackgroundControls} />} />
        </Routes>
      </main>
    </div>
  );
}

function LoginView({
  busy,
  error,
  message,
  configured,
  recoveryMode,
  hasSession,
  onSignIn,
  onPasswordReset,
  onPasswordUpdate,
  onSignOut,
}: {
  busy: boolean;
  error: string;
  message: string;
  configured: boolean;
  recoveryMode: boolean;
  hasSession: boolean;
  onSignIn: (email: string, password: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
  onPasswordUpdate: (password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (recoveryMode) {
      if (password !== confirmPassword) return;
      void onPasswordUpdate(password);
    } else if (resetMode) {
      void onPasswordReset(email);
    } else {
      void onSignIn(email, password);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="login-badge">TRUELINE AUTOS</div>
        <h1>{recoveryMode ? 'Set a new password' : resetMode ? 'Reset password' : 'Smart Showroom Management'}</h1>
        <p>Secure access for Super Admins, partners, and investors.</p>

        <form onSubmit={handleSubmit}>
          {!recoveryMode && (
            <div className="field-group">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
          )}

          {!resetMode && (
            <div className="field-group">
              <label htmlFor="password">{recoveryMode ? 'New password' : 'Password'}</label>
              <input id="password" type="password" autoComplete={recoveryMode ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
          )}

          {recoveryMode && (
            <div className="field-group">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
          )}

          {!recoveryMode && !resetMode && (
            <div className="login-row">
              <span />
              <button type="button" className="text-button" onClick={() => setResetMode(true)}>Forgot password?</button>
            </div>
          )}

          {error && <p role="alert" className="auth-feedback error">{error}</p>}
          {message && <p role="status" className="auth-feedback">{message}</p>}
          {!configured && <p role="status" className="auth-feedback">Set the Supabase URL and anon key in `.env.local` to enable sign-in.</p>}

          <button type="submit" className="primary-button" disabled={busy || !configured || (recoveryMode && password !== confirmPassword)}>
            {busy ? 'Please wait...' : recoveryMode ? 'Update password' : resetMode ? 'Send reset link' : 'Sign in securely'}
          </button>
          {(resetMode || recoveryMode) && (
            <button type="button" className="text-button auth-back-button" onClick={() => { setResetMode(false); setPassword(''); setConfirmPassword(''); }}>
              Back to sign in
            </button>
          )}
          {hasSession && (
            <button type="button" className="text-button auth-back-button" onClick={() => void onSignOut()}>
              Sign out of this account
            </button>
          )}
        </form>

        <div className="login-meta">
          <span>Supabase authentication</span>
          <span>{configured ? 'Project configured' : 'Configuration required'}</span>
        </div>
      </div>
    </div>
  );
}

type DashboardSale = { id: string; sale_date: string; selling_price: number; remaining_balance: number; customer_name: string; status: string; vehicle_id: string };
type DashboardPartnerFunding = { partner_id: string; amount: number };
type DashboardInvestorFunding = { investor_id: string; amount: number };
type DashboardExpense = { amount: number; expense_date: string };
type DashboardSalePayment = { amount: number; payment_date: string };
type DashboardParty = { id: string; name: string };
type DashboardTransaction = { id: string; transaction_type: string; amount: number; status: string; created_at: string };
type DashboardVehicle = { id: string; business_category: string; make: string; model: string; manufacturing_year: number | null; purchase_date: string | null; purchase_price: number | null; status: string; days_in_stock?: number };
function DashboardView({ profile }: { profile: Profile }) {
  const [selectedMonth, setSelectedMonth] = useState(defaultDashboardMonth);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dashboardData, setDashboardData] = useState<{
    inventory: { available_count: number; showroom_cost_value: number };
    sales: DashboardSale[];
    salePayments: DashboardSalePayment[];
    purchaseCount: number;
    vehicleExpenses: DashboardExpense[];
    generalExpenses: DashboardExpense[];
    partners: DashboardParty[];
    investors: DashboardParty[];
    partnerFunding: DashboardPartnerFunding[];
    investorFunding: DashboardInvestorFunding[];
    transactions: DashboardTransaction[];
    purchases: DashboardVehicle[];
    slowInventory: DashboardVehicle[];
    outstandingSales: DashboardSale[];
    reserveBalances: number[];
    investor: { invested_capital: number; funded_vehicle_count: number; recorded_distributions: number; recorded_payments: number };
  }>({
    inventory: { available_count: 0, showroom_cost_value: 0 },
    sales: [],
    salePayments: [],
    purchaseCount: 0,
    vehicleExpenses: [],
    generalExpenses: [],
    partners: [],
    investors: [],
    partnerFunding: [],
    investorFunding: [],
    transactions: [],
    purchases: [],
    slowInventory: [],
    outstandingSales: [],
    reserveBalances: [],
    investor: { invested_capital: 0, funded_vehicle_count: 0, recorded_distributions: 0, recorded_payments: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }

    let mounted = true;
    const [year, month] = selectedMonth.split('-').map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);
    const trendStart = new Date(year, month - 12, 1);
    const dateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const historyFrom = dateString(trendStart);
    const periodTo = dateString(periodEnd);
    setLoading(true);
    setError('');

    void (async () => {
      try {
        const transactionPromise = client.from('financial_transactions')
          .select('id, transaction_type, amount, status, created_at')
          .order('created_at', { ascending: false })
          .limit(5);

        if (profile.role === 'investor') {
          const [investorSummaryResult, transactions] = await Promise.all([
            client.rpc('dashboard_current_investor_summary'),
            transactionPromise,
          ]);
          if (investorSummaryResult.error) throw new Error(investorSummaryResult.error.message);
          if (transactions.error) throw new Error(transactions.error.message);
          if (!mounted) return;
          setDashboardData((current) => ({
            ...current,
            transactions: (transactions.data ?? []) as DashboardTransaction[],
            investor: (investorSummaryResult.data?.[0] ?? {
              invested_capital: 0,
              funded_vehicle_count: 0,
              recorded_distributions: 0,
              recorded_payments: 0,
            }) as { invested_capital: number; funded_vehicle_count: number; recorded_distributions: number; recorded_payments: number },
          }));
          return;
        }

        const [inventoryResult, sales, salePayments, purchaseCountResult, vehicleExpenses, generalExpenses, partnersResult, investorsResult, partnerFundingResult, investorFundingResult, transactions, purchasesResult, slowInventoryResult, outstandingSales, reserveResult] = await Promise.all([
          client.rpc('dashboard_inventory_summary'),
          fetchPagedRows<DashboardSale>((from, to) => client.from('sales')
            .select('id, sale_date, selling_price, remaining_balance, customer_name, status, vehicle_id')
            .eq('status', 'completed')
            .gte('sale_date', historyFrom)
            .lt('sale_date', periodTo)
            .order('sale_date', { ascending: false })
            .range(from, to)),
          fetchPagedRows<DashboardSalePayment>((from, to) => client.from('sale_payments')
            .select('amount, payment_date')
            .gte('payment_date', dateString(trendStart))
            .lt('payment_date', periodTo)
            .range(from, to)),
          client.from('vehicles')
            .select('id', { count: 'exact', head: true })
            .neq('business_category', 'consignment')
            .gte('purchase_date', dateString(periodStart))
            .lt('purchase_date', periodTo),
          fetchPagedRows<DashboardExpense>((from, to) => client.from('vehicle_expenses')
            .select('amount, expense_date')
            .gte('expense_date', historyFrom)
            .lt('expense_date', periodTo)
            .range(from, to)),
          fetchPagedRows<DashboardExpense>((from, to) => client.from('general_expenses')
            .select('amount, expense_date')
            .gte('expense_date', historyFrom)
            .lt('expense_date', periodTo)
            .range(from, to)),
          client.from('partners').select('id, name').order('name'),
          client.from('investors').select('id, name').order('name'),
          client.rpc('dashboard_partner_funding_summary'),
          client.rpc('dashboard_investor_funding_summary'),
          transactionPromise,
          client.from('vehicles')
            .select('id, business_category, make, model, manufacturing_year, purchase_date, purchase_price, status')
            .neq('business_category', 'consignment')
            .not('purchase_date', 'is', null)
            .order('purchase_date', { ascending: false })
            .limit(5),
          client.from('vehicles')
            .select('id, business_category, make, model, manufacturing_year, purchase_date, purchase_price, status')
            .eq('status', 'available')
            .neq('business_category', 'consignment')
            .not('purchase_date', 'is', null)
            .lt('purchase_date', dateString(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)))
            .order('purchase_date')
            .limit(5),
          fetchPagedRows<DashboardSale>((from, to) => client.from('sales')
            .select('id, sale_date, selling_price, remaining_balance, customer_name, status, vehicle_id')
            .gt('remaining_balance', 0)
            .order('sale_date')
            .range(from, to)),
          client.from('showroom_reserves').select('current_balance'),
        ]);
        const failures = [
          inventoryResult.error,
          partnersResult.error,
          investorsResult.error,
          partnerFundingResult.error,
          investorFundingResult.error,
          purchaseCountResult.error,
          purchasesResult.error,
          slowInventoryResult.error,
          reserveResult.error,
          transactions.error,
        ].filter((item): item is NonNullable<typeof item> => Boolean(item));
        if (failures.length) throw new Error(failures.map((item) => item.message).join('; '));
        if (!mounted) return;
        setDashboardData({
          inventory: (inventoryResult.data?.[0] ?? { available_count: 0, showroom_cost_value: 0 }) as { available_count: number; showroom_cost_value: number },
          sales,
          salePayments,
          purchaseCount: purchaseCountResult.count ?? 0,
          vehicleExpenses,
          generalExpenses,
          partners: (partnersResult.data ?? []) as DashboardParty[],
          investors: (investorsResult.data ?? []) as DashboardParty[],
          partnerFunding: (partnerFundingResult.data ?? []) as DashboardPartnerFunding[],
          investorFunding: (investorFundingResult.data ?? []) as DashboardInvestorFunding[],
          transactions: (transactions.data ?? []) as DashboardTransaction[],
          purchases: (purchasesResult.data ?? []) as DashboardVehicle[],
          slowInventory: ((slowInventoryResult.data ?? []) as DashboardVehicle[]).map((vehicle) => ({
            ...vehicle,
            days_in_stock: vehicle.purchase_date
              ? Math.floor((Date.now() - new Date(`${vehicle.purchase_date}T00:00:00`).getTime()) / (24 * 60 * 60 * 1000))
              : undefined,
          })),
          outstandingSales,
          reserveBalances: ((reserveResult.data ?? []) as { current_balance: number }[]).map((item) => Number(item.current_balance || 0)),
          investor: { invested_capital: 0, funded_vehicle_count: 0, recorded_distributions: 0, recorded_payments: 0 },
        });
      } catch (loadError) {
        if (mounted) setError(formatOperationError(loadError));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [profile.role, refreshKey, selectedMonth]);

  const [year, month] = selectedMonth.split('-').map(Number);
  const currency = import.meta.env.VITE_DEFAULT_CURRENCY || 'PKR';
  const formatMoney = (value: number) => `${currency} ${Math.round(value).toLocaleString()}`;
  const periodSales = useMemo(
    () => dashboardData.sales.filter((sale) => sale.sale_date.startsWith(selectedMonth)),
    [dashboardData.sales, selectedMonth],
  );
  const monthlySales = useMemo(() => {
    const totals = new Map<string, number>();
    for (const sale of dashboardData.sales) {
      const monthKey = sale.sale_date.slice(0, 7);
      totals.set(monthKey, (totals.get(monthKey) ?? 0) + Number(sale.selling_price || 0));
    }
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(year, month - 12 + index, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return { key: monthKey, label: date.toLocaleString(undefined, { month: 'short' }), total: totals.get(monthKey) ?? 0 };
    });
  }, [dashboardData.sales, month, year]);
  const monthlyExpenses = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of [...dashboardData.vehicleExpenses, ...dashboardData.generalExpenses]) {
      const monthKey = item.expense_date.slice(0, 7);
      totals.set(monthKey, (totals.get(monthKey) ?? 0) + Number(item.amount || 0));
    }
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(year, month - 12 + index, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return { key: monthKey, label: date.toLocaleString(undefined, { month: 'short' }), total: totals.get(monthKey) ?? 0 };
    });
  }, [dashboardData.generalExpenses, dashboardData.vehicleExpenses, month, year]);
  const partnerFunding = useMemo(() => dashboardData.partners.map((partner) => ({
    ...partner,
    amount: Number(dashboardData.partnerFunding.find((item) => item.partner_id === partner.id)?.amount ?? 0),
  })), [dashboardData.partnerFunding, dashboardData.partners]);
  const investorFunding = useMemo(() => dashboardData.investors.map((investor) => ({
    ...investor,
    amount: Number(dashboardData.investorFunding.find((item) => item.investor_id === investor.id)?.amount ?? 0),
  })), [dashboardData.investorFunding, dashboardData.investors]);
  const maxFunding = Math.max(...partnerFunding.map((item) => item.amount), ...investorFunding.map((item) => item.amount), 1);
  const financialTrend = monthlySales.map((item, index) => ({
    month: item.label,
    sales: item.total,
    expenses: monthlyExpenses[index]?.total ?? 0,
  }));
  const hasFinancialTrend = financialTrend.some((item) => item.sales > 0 || item.expenses > 0);
  const recordedExpenseTotal = useMemo(
    () => [...dashboardData.vehicleExpenses, ...dashboardData.generalExpenses]
      .filter((item) => item.expense_date.startsWith(selectedMonth))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [dashboardData.generalExpenses, dashboardData.vehicleExpenses, selectedMonth],
  );
  const recordedSalePayments = useMemo(
    () => dashboardData.salePayments
      .filter((item) => item.payment_date.startsWith(selectedMonth))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [dashboardData.salePayments, selectedMonth],
  );
  const completedSalesValue = useMemo(
    () => periodSales.reduce((sum, item) => sum + Number(item.selling_price || 0), 0),
    [periodSales],
  );
  const recordedReceivables = useMemo(
    () => dashboardData.outstandingSales.reduce((sum, item) => sum + Number(item.remaining_balance || 0), 0),
    [dashboardData.outstandingSales],
  );
  const currentMonthLabel = new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const investorCapital = Number(dashboardData.investor.invested_capital || 0);
  const investorDistributionAmount = Number(dashboardData.investor.recorded_distributions || 0);
  const investorPaymentsAmount = Number(dashboardData.investor.recorded_payments || 0);
  const fundingVehicleCount = Number(dashboardData.investor.funded_vehicle_count || 0);
  const profitStatus = 'Unavailable';

  if (error && !loading) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <div><p className="eyebrow">Operations overview</p><h2>Premium showroom dashboard</h2></div>
          <button type="button" className="ghost-button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button>
        </div>
        <p role="alert" className="auth-feedback error">{error}</p>
        <p className="muted">Dashboard totals are hidden because the latest database queries did not complete successfully.</p>
      </div>
    );
  }

  const exportSummary = () => {
    const rows = profile.role === 'investor'
      ? [
        ['Metric', 'Value'],
        ['View', 'Own investor records only'],
        ['Recorded contributions', String(investorCapital)],
        ['Funded vehicles', String(fundingVehicleCount)],
        ['Recorded distributions', String(investorDistributionAmount)],
        ['Recorded distribution payments', String(investorPaymentsAmount)],
        ['Profit calculation', 'Unavailable until transactional profit workflow is implemented'],
      ]
      : [
        ['Metric', 'Value'],
        ['Month', selectedMonth],
        ['Available vehicles', String(dashboardData.inventory.available_count)],
        ['Available inventory purchase cost (excluding customer consignment)', String(dashboardData.inventory.showroom_cost_value)],
        ['Completed sales', String(periodSales.length)],
        ['Completed sales recorded value (not cash received)', String(completedSalesValue)],
        ['Recorded sale payments', String(recordedSalePayments)],
        ['Recorded expenses', String(recordedExpenseTotal)],
        ['Recorded outstanding sales balances', String(recordedReceivables)],
        ['Stored showroom reserve balance', String(dashboardData.reserveBalances.reduce((sum, value) => sum + value, 0))],
        ['Profit calculation', 'Unavailable until transactional profit workflow is implemented'],
      ];
    const csv = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `trueline-dashboard-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (profile.role === 'investor') {
    return (
      <div className="page-shell">
        <div className="page-header">
          <div>
            <p className="eyebrow">Your investment overview · {dashboardDateLabel}</p>
            <h2>Welcome back, {profile.full_name?.trim().split(/\s+/)[0] || 'Investor'}</h2>
          </div>
          <div className="header-actions">
            <button type="button" className="ghost-button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>{loading ? 'Refreshing...' : 'Refresh'}</button>
            <button type="button" className="primary-button" onClick={exportSummary}>Export summary</button>
          </div>
        </div>
        {error && <p role="alert" className="auth-feedback error">{error}</p>}
        <section className="kpi-grid">
          <KpiCard label="Your recorded capital" value={formatMoney(investorCapital)} tone="emerald" loading={loading} />
          <KpiCard label="Vehicles you funded" value={String(fundingVehicleCount)} tone="cyan" loading={loading} />
          <KpiCard label="Recorded distributions" value={formatMoney(investorDistributionAmount)} tone="amber" loading={loading} />
          <KpiCard label="Recorded payments" value={formatMoney(investorPaymentsAmount)} tone="violet" loading={loading} />
        </section>
        <p className="muted">All financial totals are limited to records associated with your investor account. Profit, outstanding balances, and investment performance are unavailable until their approved transactional workflows are implemented.</p>
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>Your recent financial transactions</h3></div>
          <div className="table-list">
            {dashboardData.transactions.map((item) => <div key={item.id} className="transaction-row"><div><strong>{item.transaction_type.replaceAll('_', ' ')}</strong><span>{new Date(item.created_at).toLocaleDateString()}</span></div><div className="transaction-meta"><span className="type-chip">{item.status}</span><strong className={item.amount < 0 ? 'neg' : 'pos'}>{formatMoney(item.amount)}</strong></div></div>)}
            {!loading && !dashboardData.transactions.length && <p className="muted">No investor-linked transactions recorded.</p>}
          </div>
        </div>
      </div>
    );
  }

  const inventoryValue = Number(dashboardData.inventory.showroom_cost_value || 0);
  const partnerCapital = partnerFunding.reduce((sum, item) => sum + item.amount, 0);
  const totalInvestorCapital = investorFunding.reduce((sum, item) => sum + item.amount, 0);
  const storedReserveBalance = dashboardData.reserveBalances.reduce((sum, value) => sum + value, 0);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operations overview · {dashboardDateLabel}</p>
          <h2>Welcome back, {profile.full_name?.trim().split(/\s+/)[0] || 'team'}</h2>
        </div>
        <div className="header-actions">
          <input aria-label="Dashboard month" type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
          <button type="button" className="ghost-button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>{loading ? 'Refreshing...' : 'Refresh'}</button>
          <button type="button" className="primary-button" onClick={exportSummary}>Export summary</button>
          <NavLink className="primary-button dashboard-action" to="/inventory">View inventory</NavLink>
        </div>
      </div>
      {error && <p role="alert" className="auth-feedback error">{error}</p>}
      <section className="kpi-grid">
        <KpiCard label="Available inventory purchase cost" value={formatMoney(inventoryValue)} tone="emerald" loading={loading} />
        <KpiCard label="Available vehicles" value={String(dashboardData.inventory.available_count)} tone="cyan" loading={loading} />
        <KpiCard label="Completed sales · selected month" value={String(periodSales.length)} tone="amber" loading={loading} />
        <KpiCard label="Vehicles purchased · selected month" value={String(dashboardData.purchaseCount)} tone="cyan" loading={loading} />
        <KpiCard label="Completed sales value · selected month" value={formatMoney(completedSalesValue)} tone="violet" loading={loading} />
        <KpiCard label="Recorded sale payments · selected month" value={formatMoney(recordedSalePayments)} tone="emerald" loading={loading} />
        <KpiCard label="Recorded expenses · selected month" value={formatMoney(recordedExpenseTotal)} tone="amber" loading={loading} />
        <KpiCard label="Recorded outstanding sales balances" value={formatMoney(recordedReceivables)} tone="cyan" loading={loading} />
        <KpiCard label="Partner capital recorded" value={formatMoney(partnerCapital)} tone="emerald" loading={loading} />
        <KpiCard label="Investor capital recorded" value={formatMoney(totalInvestorCapital)} tone="violet" loading={loading} />
        <KpiCard label="Gross profit" value="Unavailable" tone="amber" loading={false} />
        <KpiCard label="Net profit" value="Unavailable" tone="violet" loading={false} />
      </section>
      <p className="muted">Sales value is not cash received. Outstanding balances use the stored sales balance field and are not reconciled against payment history. Expense totals use recorded expense rows. Profit is unavailable until transaction-safe sales, expense approval, and profit posting are implemented.</p>

      <section className="glass-panel panel-section">
        <div className="section-head chart-heading">
          <div>
            <h3>Sales & recorded expenses</h3>
            <p className="muted">Monthly totals · 12 months through {currentMonthLabel}</p>
          </div>
          <span className="small-tag">Recorded amounts</span>
        </div>
        {loading ? (
          <p className="muted chart-state" role="status">Loading financial activity...</p>
        ) : !hasFinancialTrend ? (
          <p className="muted chart-state">No completed sales or recorded expenses in this period.</p>
        ) : (
          <Suspense fallback={<p className="muted chart-state" role="status">Loading chart...</p>}>
            <SalesExpenseChart data={financialTrend} formatMoney={formatMoney} />
          </Suspense>
        )}
      </section>

      <section className="content-grid three-columns">
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>Partner capital</h3><span className="small-tag">{dashboardData.partners.length} records</span></div>
          <div className="list-wrap">{partnerFunding.map((partner) => <div key={partner.id} className="row-item"><div><strong>{partner.name}</strong><span>{formatMoney(partner.amount)}</span></div><div className="mini-meter"><span style={{ width: `${partner.amount / maxFunding * 100}%` }} /></div></div>)}{!loading && !partnerFunding.length && <p className="muted">No partner contribution records.</p>}</div>
        </div>
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>Investor capital</h3><span className="small-tag">{dashboardData.investors.length} records</span></div>
          <div className="list-wrap">{investorFunding.map((investor) => <div key={investor.id} className="row-item"><div><strong>{investor.name}</strong><span>{formatMoney(investor.amount)}</span></div><div className="mini-meter"><span style={{ width: `${investor.amount / maxFunding * 100}%` }} /></div></div>)}{!loading && !investorFunding.length && <p className="muted">No investor contribution records.</p>}</div>
        </div>
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>Profit & reserves</h3></div>
          <div className="ai-box">
            <div className="ai-title"><ShieldCheck size={18} />Financial data coverage</div>
            <p>Approved profit: {profitStatus}. The existing profit-calculation records do not enforce one approved calculation per sale, so summing them could double-count.</p>
            <p>Stored reserve balance: {formatMoney(storedReserveBalance)}. No reserve reconciliation or movement-posting workflow is available yet.</p>
          </div>
        </div>
      </section>

      <section className="content-grid three-columns">
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>Recent purchases</h3></div>
          <div className="table-list">{dashboardData.purchases.map((item) => <div key={item.id} className="transaction-row"><div><strong>{[item.manufacturing_year, item.make, item.model].filter(Boolean).join(' ')}</strong><span>{item.purchase_date}</span></div><div className="transaction-meta"><strong>{formatMoney(Number(item.purchase_price || 0))}</strong></div></div>)}{!loading && !dashboardData.purchases.length && <p className="muted">No purchase-dated showroom vehicles recorded.</p>}</div>
        </div>
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>Slow-moving available inventory · 90+ days</h3></div>
          <div className="table-list">{dashboardData.slowInventory.map((item) => <div key={item.id} className="transaction-row"><div><strong>{[item.manufacturing_year, item.make, item.model].filter(Boolean).join(' ')}</strong><span>Purchased {item.purchase_date}</span></div><div className="transaction-meta"><span className="type-chip">{item.days_in_stock} days</span></div></div>)}{!loading && !dashboardData.slowInventory.length && <p className="muted">No available showroom vehicles older than 90 days.</p>}</div>
        </div>
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>Outstanding sale balances</h3></div>
          <div className="table-list">{dashboardData.outstandingSales.slice(0, 5).map((item) => <div key={item.id} className="transaction-row"><div><strong>{item.customer_name}</strong><span>{item.sale_date} · {item.status}</span></div><div className="transaction-meta"><strong>{formatMoney(Number(item.remaining_balance || 0))}</strong></div></div>)}{!loading && !dashboardData.outstandingSales.length && <p className="muted">No outstanding balances are recorded on sales.</p>}</div>
        </div>
      </section>

      <section className="glass-panel panel-section">
        <div className="section-head"><h3>Recent financial transactions</h3></div>
        <div className="table-list">{dashboardData.transactions.map((item) => <div key={item.id} className="transaction-row"><div><strong>{item.transaction_type.replaceAll('_', ' ')}</strong><span>{new Date(item.created_at).toLocaleDateString()}</span></div><div className="transaction-meta"><span className="type-chip">{item.status}</span><strong className={item.amount < 0 ? 'neg' : 'pos'}>{formatMoney(item.amount)}</strong></div></div>)}{!loading && !dashboardData.transactions.length && <p className="muted">No financial transactions recorded.</p>}</div>
      </section>
    </div>
  );
}

function KpiCard({ label, value, tone, loading }: { label: string; value: string; tone: string; loading: boolean }) {
  return (
    <div className="kpi-card glass-panel">
      <div className="kpi-topline"><span>{label}</span><span className={`trend trend-${tone}`}>{loading ? 'Loading' : 'Records'}</span></div>
      <strong>{loading ? '...' : value}</strong>
    </div>
  );
}

type Vehicle = {
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

type VehicleFile = {
  id: string;
  storage_bucket: 'vehicle-images' | 'vehicle-documents';
  object_path: string;
  file_name: string;
  content_type: string;
};

type Party = { id: string; name: string; status: string };
type FundingRow = {
  id: string;
  vehicle_id: string;
  partner_id: string | null;
  investor_id: string | null;
  amount: number;
  contribution_date: string;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
};
type FundingDraft = {
  partyId: string;
  amount: string;
  contributionDate: string;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
};

const vehicleCategories = [
  { value: 'partner', label: 'Partner vehicle' },
  { value: 'investor', label: 'Investor vehicle' },
  { value: 'consignment', label: 'Customer vehicle (consignment)' },
];

function InventoryView({ profile, userId }: { profile: Profile; userId: string }) {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search')?.trim() ?? '';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehicleFiles, setVehicleFiles] = useState<VehicleFile[]>([]);
  const [makeSuggestions, setMakeSuggestions] = useState<string[]>([]);
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  const [variantSuggestions, setVariantSuggestions] = useState<string[]>([]);
  const [catalogSuggestions, setCatalogSuggestions] = useState<{ make: string; model: string; variant: string | null }[]>([]);
  const [formMake, setFormMake] = useState('');
  const [formModel, setFormModel] = useState('');
  const [vehicleCategory, setVehicleCategory] = useState('partner');
  const [partners, setPartners] = useState<Party[]>([]);
  const [investors, setInvestors] = useState<Party[]>([]);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingDrafts, setFundingDrafts] = useState<FundingDraft[]>([]);
  const [existingFunding, setExistingFunding] = useState<FundingRow[]>([]);
  const pageSize = 50;

  const loadVehicles = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    setLoading(true);
    try {
      let query = supabase.from('vehicles').select('id, business_category, make, model, variant, manufacturing_year, registration_year, registration_city, registration_number, color, mileage, engine_capacity, transmission, fuel_type, condition, chassis_number, engine_number, status, purchase_date, purchase_price, total_additional_costs, expected_sale_price, actual_sale_price, notes, customer_name, customer_contact', { count: 'exact' });
      if (categoryFilter !== 'all') query = query.eq('business_category', categoryFilter);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (search) {
        const safeSearch = search.replace(/[^a-zA-Z0-9 -]/g, '').trim();
        if (safeSearch) {
          const terms = [`make.ilike.%${safeSearch}%`, `model.ilike.%${safeSearch}%`, `variant.ilike.%${safeSearch}%`];
          if (/^\d{1,4}$/.test(safeSearch)) terms.push(`manufacturing_year.eq.${safeSearch}`);
          query = query.or(terms.join(','));
        }
      }
      const { data: pageData, count, error: pageError } = await query
        .order('created_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (pageError) setError(formatOperationError(pageError));
      else {
        setError('');
        setVehicles((pageData ?? []) as Vehicle[]);
        setVehicleCount(count ?? 0);
      }
    } catch (loadError) {
      setError(formatOperationError(loadError));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, page, search, statusFilter]);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadCatalogSuggestions = async () => {
    if (!supabase) return;
    const { data, error: catalogError } = await supabase
      .from('vehicle_catalog')
      .select('make, model, variant')
      .order('make')
      .limit(500);
    if (catalogError) {
      setError(catalogError.message);
      return;
    }
    const values = (data ?? []) as { make: string; model: string; variant: string | null }[];
    setCatalogSuggestions(values);
    setMakeSuggestions([...new Set(values.map((item) => item.make))]);
    setModelSuggestions([...new Set(values.map((item) => item.model))]);
    setVariantSuggestions([...new Set(values.map((item) => item.variant).filter((value): value is string => Boolean(value)))]);
  };

  const loadParties = async () => {
    if (!supabase) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    setPartiesLoading(true);
    try {
      const [partnersResult, investorsResult] = await Promise.all([
        supabase.from('partners').select('id, name, status').order('name'),
        supabase.from('investors').select('id, name, status').order('name'),
      ]);
      const failure = partnersResult.error ?? investorsResult.error;
      if (failure) {
        setError(formatOperationError(failure));
        return;
      }
      setPartners((partnersResult.data ?? []) as Party[]);
      setInvestors((investorsResult.data ?? []) as Party[]);
    } catch (loadError) {
      setError(formatOperationError(loadError));
    } finally {
      setPartiesLoading(false);
    }
  };

  const loadExistingFunding = async (vehicleId: string) => {
    if (!supabase) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      setFundingLoading(false);
      return;
    }
    setFundingLoading(true);
    try {
      const { data, error: fundingError } = await supabase
        .from('funding_contributions')
        .select('id, vehicle_id, partner_id, investor_id, amount, contribution_date, payment_method, reference_number, notes')
        .eq('vehicle_id', vehicleId)
        .order('contribution_date');
      if (fundingError) setError(formatOperationError(fundingError));
      else setExistingFunding((data ?? []) as FundingRow[]);
    } catch (loadError) {
      setError(formatOperationError(loadError));
    } finally {
      setFundingLoading(false);
    }
  };

  const loadVehicleFiles = async (vehicle: Vehicle) => {
    if (!supabase) return;
    setSelectedVehicle(vehicle);
    setVehicleFiles([]);
    const { data, error: filesError } = await supabase
      .from('vehicle_files')
      .select('id, storage_bucket, object_path, file_name, content_type')
      .eq('vehicle_id', vehicle.id)
      .order('created_at', { ascending: false });
    if (filesError) {
      setError(filesError.message);
      return;
    }
    setVehicleFiles((data ?? []) as VehicleFile[]);
  };

  const openNewVehicle = () => {
    setEditingVehicle(null);
    setVehicleCategory('partner');
    setFormMake('');
    setFormModel('');
    setFundingDrafts([]);
    setExistingFunding([]);
    setFundingLoading(false);
    setError('');
    setNotice('');
    void loadCatalogSuggestions();
    void loadParties();
    setFormOpen(true);
  };

  const openEditVehicle = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setVehicleCategory(vehicle.business_category);
    setFormMake(vehicle.make);
    setFormModel(vehicle.model);
    setFundingDrafts([]);
    setExistingFunding([]);
    setFundingLoading(true);
    setSelectedVehicle(null);
    setError('');
    setNotice('');
    void loadCatalogSuggestions();
    void loadParties();
    void loadExistingFunding(vehicle.id);
    setFormOpen(true);
  };

  const toggleFundingParty = (partyId: string, checked: boolean) => {
    setFundingDrafts((current) => checked
      ? [...current, { partyId, amount: '', contributionDate: new Date().toISOString().slice(0, 10), paymentMethod: '', referenceNumber: '', notes: '' }]
      : current.filter((draft) => draft.partyId !== partyId));
  };

  const saveVehicle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    if (profile.role !== 'super_admin') {
      setError('Only a Super Admin can add or edit vehicles.');
      return;
    }
    if (partiesLoading || fundingLoading) {
      setError('Wait for partner, investor, and funding records to finish loading before saving.');
      return;
    }
    const formData = new FormData(event.currentTarget);
    const text = (name: string) => String(formData.get(name) ?? '').trim();
    const number = (name: string) => {
      const value = text(name);
      return value ? Number(value) : null;
    };
    const make = text('make');
    const model = text('model');
    const vehicleData = {
      business_category: vehicleCategory,
      make,
      model,
      variant: text('variant') || null,
      manufacturing_year: number('manufacturing_year'),
      registration_year: number('registration_year'),
      registration_city: text('registration_city') || null,
      registration_number: text('registration_number') || null,
      color: text('color') || null,
      mileage: number('mileage'),
      engine_capacity: number('engine_capacity'),
      transmission: text('transmission') || null,
      fuel_type: text('fuel_type') || null,
      condition: text('condition') || null,
      chassis_number: text('chassis_number') || null,
      engine_number: text('engine_number') || null,
      status: text('status'),
      purchase_date: vehicleCategory === 'consignment' ? null : text('purchase_date') || null,
      purchase_price: vehicleCategory === 'consignment' ? null : number('purchase_price'),
      total_additional_costs: vehicleCategory === 'consignment' ? 0 : number('total_additional_costs') ?? 0,
      expected_sale_price: number('expected_sale_price'),
      actual_sale_price: number('actual_sale_price'),
      notes: text('notes') || null,
      customer_name: vehicleCategory === 'consignment' ? text('customer_name') || null : null,
      customer_contact: vehicleCategory === 'consignment' ? text('customer_contact') || null : null,
    };
    const activePartyIds = (vehicleCategory === 'partner' ? partners : investors)
      .filter((party) => party.status === 'active')
      .map((party) => party.id);
    if (vehicleCategory !== 'consignment' && !existingFunding.length && !fundingDrafts.length) {
      setError('Select at least one active partner or investor and record their contribution.');
      return;
    }
    if (fundingDrafts.some((draft) => !activePartyIds.includes(draft.partyId) || !draft.amount || Number(draft.amount) <= 0 || !draft.contributionDate)) {
      setError('Each selected contributor needs an active account, a positive contribution amount, and a date.');
      return;
    }
    const recordedFunding = existingFunding.reduce((total, item) => total + Number(item.amount), 0);
    const newFunding = fundingDrafts.reduce((total, item) => total + Number(item.amount || 0), 0);
    if (vehicleData.purchase_price === null && recordedFunding + newFunding > 0) {
      setError('Enter the purchase price before recording funding contributions.');
      return;
    }
    if (vehicleData.purchase_price !== null && recordedFunding + newFunding > vehicleData.purchase_price) {
      setError('Total recorded funding cannot exceed the purchase price.');
      return;
    }
    if (vehicleCategory === 'consignment' && (existingFunding.length || fundingDrafts.length)) {
      setError('Customer vehicles cannot have showroom partner or investor funding.');
      return;
    }
    if (vehicleCategory === 'consignment' && !vehicleData.customer_name) {
      setError('Enter the customer name for a customer vehicle.');
      return;
    }
    const contributions = fundingDrafts.map((draft) => ({
      partner_id: vehicleCategory === 'partner' ? draft.partyId : null,
      investor_id: vehicleCategory === 'investor' ? draft.partyId : null,
      amount: Number(draft.amount),
      contribution_date: draft.contributionDate,
      payment_method: draft.paymentMethod || null,
      reference_number: draft.referenceNumber || null,
      notes: draft.notes || null,
    }));

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data: savedVehicleId, error: saveError } = await supabase.rpc('save_vehicle_with_contributions', {
        p_vehicle_id: editingVehicle?.id ?? null,
        p_vehicle: vehicleData,
        p_contributions: contributions,
      });
      if (saveError || !savedVehicleId) {
        setError(formatOperationError(saveError ?? new Error('Supabase did not return a saved vehicle ID.')));
        return;
      }

      let catalogWarning = '';
      try {
        const { data: existingCatalog, error: catalogLookupError } = await supabase
          .from('vehicle_catalog')
          .select('id')
          .eq('make', make)
          .eq('model', model)
          .limit(1);
        if (catalogLookupError) throw catalogLookupError;
        if (!existingCatalog?.length) {
          const { error: catalogInsertError } = await supabase
            .from('vehicle_catalog')
            .insert({ make, model, variant: vehicleData.variant, year: vehicleData.manufacturing_year });
          if (catalogInsertError) throw catalogInsertError;
        }
      } catch (catalogError) {
        catalogWarning = ` Catalog suggestion was not saved: ${formatOperationError(catalogError)}`;
      }

      setNotice(`${editingVehicle ? 'Vehicle updated.' : 'Vehicle added.'}${catalogWarning}`);
      setFormOpen(false);
      setEditingVehicle(null);
      try {
        if (page === 0) await loadVehicles();
        else setPage(0);
      } catch (refreshError) {
        setError(`Vehicle saved, but the inventory could not be refreshed: ${formatOperationError(refreshError)}`);
      }
    } catch (saveError) {
      setError(formatOperationError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const archiveVehicle = async (vehicle: Vehicle) => {
    if (!supabase || profile.role !== 'super_admin') return;
    if (!window.confirm(`Archive ${vehicle.manufacturing_year ?? ''} ${vehicle.make} ${vehicle.model}?`)) return;
    const { error: archiveError } = await supabase.from('vehicles').update({ status: 'archived' }).eq('id', vehicle.id);
    if (archiveError) setError(archiveError.message);
    else {
      setNotice('Vehicle archived.');
      await loadVehicles();
    }
  };

  const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!supabase || !selectedVehicle || !files.length) return;
    if (profile.role !== 'super_admin') {
      setError('Only a Super Admin can upload vehicle files.');
      return;
    }
    setSaving(true);
    setError('');
    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const bucket = isImage ? 'vehicle-images' : 'vehicle-documents';
      const allowed = isImage
        ? ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 10 * 1024 * 1024
        : file.type === 'application/pdf' && file.size <= 20 * 1024 * 1024;
      if (!allowed) {
        setError(`${file.name}: select a JPG, PNG, WebP image up to 10 MB or a PDF up to 20 MB.`);
        continue;
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const objectPath = `${selectedVehicle.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, { upsert: false });
      if (uploadError) {
        setError(uploadError.message);
        continue;
      }
      const { error: metadataError } = await supabase.from('vehicle_files').insert({
        vehicle_id: selectedVehicle.id,
        storage_bucket: bucket,
        object_path: objectPath,
        file_name: file.name,
        content_type: file.type,
        uploaded_by: userId,
      });
      if (metadataError) {
        await supabase.storage.from(bucket).remove([objectPath]);
        setError(metadataError.message);
      }
    }
    await loadVehicleFiles(selectedVehicle);
    setSaving(false);
  };

  const activeParties = vehicleCategory === 'partner'
    ? partners.filter((party) => party.status === 'active')
    : investors.filter((party) => party.status === 'active');
  const matchingCatalogSuggestions = catalogSuggestions.filter((item) =>
    (!formMake || item.make.toLowerCase() === formMake.toLowerCase())
    && (!formModel || item.model.toLowerCase() === formModel.toLowerCase()),
  );
  const matchingModelSuggestions = formMake
    ? [...new Set(matchingCatalogSuggestions.map((item) => item.model))]
    : modelSuggestions;
  const matchingVariantSuggestions = matchingCatalogSuggestions.length
    ? [...new Set(matchingCatalogSuggestions.map((item) => item.variant).filter((value): value is string => Boolean(value)))]
    : variantSuggestions;
  const fundingTotal = existingFunding.reduce((total, item) => total + Number(item.amount), 0)
    + fundingDrafts.reduce((total, item) => total + Number(item.amount || 0), 0);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Vehicle catalog</p>
          <h2>Inventory overview</h2>
        </div>
        {profile.role === 'super_admin' && <button type="button" className="primary-button" onClick={openNewVehicle}>Add vehicle</button>}
      </div>
      {error && <p role="alert" className="auth-feedback error">{error}</p>}
      {notice && <p role="status" className="auth-feedback">{notice}</p>}

      <div className="inventory-toolbar glass-panel">
        <input aria-label="Search inventory" type="search" placeholder="Search make, model, variant, year" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => { setPage(0); setCategoryFilter(event.target.value); }}>
          <option value="all">All categories</option>
          {vehicleCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
        <select aria-label="Filter by status" value={statusFilter} onChange={(event) => { setPage(0); setStatusFilter(event.target.value); }}>
          <option value="all">All statuses</option>
          {['available', 'reserved', 'repair', 'sold', 'archived'].map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>

      {formOpen && (
        <div className="glass-panel panel-section">
          <div className="section-head"><h3>{editingVehicle ? 'Edit vehicle' : 'Add vehicle'}</h3><button type="button" className="text-button" onClick={() => setFormOpen(false)}>Close</button></div>
          <form key={editingVehicle?.id ?? 'new'} className="vehicle-form" onSubmit={saveVehicle}>
            <section className="vehicle-form-section">
              <h4>Vehicle details</h4>
              <div className="vehicle-field-grid">
                <label className="field-group">Ownership category<select name="business_category" value={vehicleCategory} disabled={Boolean(editingVehicle && existingFunding.length)} onChange={(event) => { setVehicleCategory(event.target.value); setFundingDrafts([]); }}>{vehicleCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
                <label className="field-group">Make<input name="make" required list="vehicle-makes" defaultValue={editingVehicle?.make ?? ''} onChange={(event) => setFormMake(event.target.value)} /><datalist id="vehicle-makes">{makeSuggestions.map((make) => <option key={make} value={make} />)}</datalist></label>
                <label className="field-group">Model<input name="model" required list="vehicle-models" value={formModel} onChange={(event) => setFormModel(event.target.value)} /><datalist id="vehicle-models">{matchingModelSuggestions.map((model) => <option key={model} value={model} />)}</datalist></label>
                <label className="field-group">Variant<input name="variant" list="vehicle-variants" defaultValue={editingVehicle?.variant ?? ''} /><datalist id="vehicle-variants">{matchingVariantSuggestions.map((variant) => <option key={variant} value={variant} />)}</datalist></label>
                <label className="field-group">Manufacturing year<input name="manufacturing_year" type="number" min="1900" max="2100" defaultValue={editingVehicle?.manufacturing_year ?? ''} /></label>
                <label className="field-group">Color<input name="color" defaultValue={editingVehicle?.color ?? ''} /></label>
                <label className="field-group">Mileage<input name="mileage" type="number" min="0" step="1" defaultValue={editingVehicle?.mileage ?? ''} /></label>
                <label className="field-group">Engine capacity (cc)<input name="engine_capacity" type="number" min="0" step="0.01" defaultValue={editingVehicle?.engine_capacity ?? ''} /></label>
                <label className="field-group">Transmission<select name="transmission" defaultValue={editingVehicle?.transmission ?? ''}><option value="">Select transmission</option><option value="automatic">Automatic</option><option value="manual">Manual</option><option value="cvt">CVT</option><option value="other">Other</option></select></label>
                <label className="field-group">Fuel type<select name="fuel_type" defaultValue={editingVehicle?.fuel_type ?? ''}><option value="">Select fuel type</option><option value="petrol">Petrol</option><option value="diesel">Diesel</option><option value="hybrid">Hybrid</option><option value="electric">Electric</option><option value="cng">CNG</option><option value="other">Other</option></select></label>
                <label className="field-group">Condition<select name="condition" defaultValue={editingVehicle?.condition ?? ''}><option value="">Select condition</option><option value="new">New</option><option value="used">Used</option><option value="certified">Certified</option></select></label>
              </div>
            </section>

            {vehicleCategory === 'consignment' ? (
              <section className="vehicle-form-section">
                <h4>Customer details</h4>
                <div className="vehicle-field-grid">
                  <label className="field-group">Customer name<input name="customer_name" required defaultValue={editingVehicle?.customer_name ?? ''} /></label>
                  <label className="field-group">Customer contact<input name="customer_contact" type="tel" defaultValue={editingVehicle?.customer_contact ?? ''} /></label>
                </div>
                <p className="muted">Customer vehicles are consigned and are not recorded as partner- or investor-funded inventory.</p>
              </section>
            ) : (
              <section className="vehicle-form-section">
                <h4>{vehicleCategory === 'partner' ? 'Partner funding' : 'Investor funding'}</h4>
                {(partiesLoading || fundingLoading) && <p className="muted" role="status">Loading active parties and existing funding...</p>}
                {existingFunding.length > 0 && (
                  <div className="funding-history">
                    <strong>Recorded contributions (read-only history)</strong>
                    {existingFunding.map((funding) => {
                      const party = vehicleCategory === 'partner'
                        ? partners.find((item) => item.id === funding.partner_id)
                        : investors.find((item) => item.id === funding.investor_id);
                      return <div key={funding.id} className="funding-history-row"><span>{party?.name ?? 'Former/inactive contributor'}</span><span>{funding.contribution_date} · PKR {Number(funding.amount).toLocaleString()}</span></div>;
                    })}
                    <p className="muted">Existing funding entries cannot be edited or deleted. New contributions are appended to preserve the audit history.</p>
                  </div>
                )}
                <div className="contributor-list">
                  <strong>Select active {vehicleCategory === 'partner' ? 'partners' : 'investors'} and enter each contribution</strong>
                  {activeParties.map((party) => {
                    const draft = fundingDrafts.find((item) => item.partyId === party.id);
                    return (
                      <div className="contributor-row" key={party.id}>
                        <label className="checkbox-row"><input type="checkbox" checked={Boolean(draft)} onChange={(event) => toggleFundingParty(party.id, event.target.checked)} />{party.name}</label>
                        {draft && <div className="contribution-fields">
                          <label className="field-group">Amount<input type="number" min="0.01" step="0.01" required value={draft.amount} onChange={(event) => setFundingDrafts((rows) => rows.map((row) => row.partyId === party.id ? { ...row, amount: event.target.value } : row))} /></label>
                          <label className="field-group">Contribution date<input type="date" required value={draft.contributionDate} onChange={(event) => setFundingDrafts((rows) => rows.map((row) => row.partyId === party.id ? { ...row, contributionDate: event.target.value } : row))} /></label>
                          <label className="field-group">Payment method<input value={draft.paymentMethod} onChange={(event) => setFundingDrafts((rows) => rows.map((row) => row.partyId === party.id ? { ...row, paymentMethod: event.target.value } : row))} /></label>
                          <label className="field-group">Reference<input value={draft.referenceNumber} onChange={(event) => setFundingDrafts((rows) => rows.map((row) => row.partyId === party.id ? { ...row, referenceNumber: event.target.value } : row))} /></label>
                        </div>}
                      </div>
                    );
                  })}
                  {!activeParties.length && <p className="muted">No active {vehicleCategory === 'partner' ? 'partners' : 'investors'} are available. Add or activate one in Settings.</p>}
                  <p className="funding-total">Recorded funding: PKR {fundingTotal.toLocaleString()}. Partial funding is allowed; the total cannot exceed purchase price.</p>
                </div>
              </section>
            )}

            <section className="vehicle-form-section">
              <h4>Registration details</h4>
              <div className="vehicle-field-grid">
                <label className="field-group">Registration year<input name="registration_year" type="number" min="1900" max="2100" defaultValue={editingVehicle?.registration_year ?? ''} /></label>
                <label className="field-group">Registration city<input name="registration_city" defaultValue={editingVehicle?.registration_city ?? ''} /></label>
                <label className="field-group">Registration number<input name="registration_number" defaultValue={editingVehicle?.registration_number ?? ''} /></label>
                <label className="field-group">Chassis number<input name="chassis_number" defaultValue={editingVehicle?.chassis_number ?? ''} /></label>
                <label className="field-group">Engine number<input name="engine_number" defaultValue={editingVehicle?.engine_number ?? ''} /></label>
              </div>
            </section>

            <section className="vehicle-form-section">
              <h4>Purchase &amp; pricing</h4>
              <div className="vehicle-field-grid">
                {vehicleCategory !== 'consignment' && <>
                  <label className="field-group">Purchase date<input name="purchase_date" type="date" defaultValue={editingVehicle?.purchase_date ?? ''} /></label>
                  <label className="field-group">Purchase price<input name="purchase_price" type="number" min="0" step="0.01" required defaultValue={editingVehicle?.purchase_price ?? ''} /></label>
                  <label className="field-group">Total additional costs<input name="total_additional_costs" type="number" min="0" step="0.01" defaultValue={editingVehicle?.total_additional_costs ?? 0} /></label>
                </>}
                <label className="field-group">Expected sale price<input name="expected_sale_price" type="number" min="0" step="0.01" defaultValue={editingVehicle?.expected_sale_price ?? ''} /></label>
                <label className="field-group">Actual sale price<input name="actual_sale_price" type="number" min="0" step="0.01" defaultValue={editingVehicle?.actual_sale_price ?? ''} /></label>
                <label className="field-group">Vehicle status<select name="status" defaultValue={editingVehicle?.status ?? 'available'}><option value="available">Available</option><option value="reserved">Reserved</option><option value="repair">Repair</option><option value="sold">Sold</option><option value="archived">Archived</option></select></label>
              </div>
            </section>

            <section className="vehicle-form-section">
              <h4>Other information</h4>
              <label className="field-group">Notes<textarea name="notes" rows={3} defaultValue={editingVehicle?.notes ?? ''} /></label>
            </section>
            <div className="vehicle-form-actions"><button type="button" className="ghost-button" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving || partiesLoading || fundingLoading}>{saving ? 'Saving...' : partiesLoading || fundingLoading ? 'Loading funding...' : 'Save vehicle'}</button></div>
          </form>
        </div>
      )}

      <div className="glass-panel panel-section">
        {loading ? <p className="muted">Loading inventory...</p> : vehicles.length === 0 ? <p className="muted">No vehicles match this view.</p> : <div className="table-scroll"><table className="data-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Category</th>
              <th>Status</th>
              <th>Purchase cost</th>
              <th>Expected sale</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>{[vehicle.manufacturing_year, vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(' ')}</td>
                <td>{vehicleCategories.find((category) => category.value === vehicle.business_category)?.label ?? vehicle.business_category}</td>
                <td><span className="status-badge">{vehicle.status}</span></td>
                <td>{vehicle.purchase_price?.toLocaleString() ?? '0'}</td>
                <td>{vehicle.expected_sale_price?.toLocaleString() ?? '—'}</td>
                <td className="inventory-actions">
                  <button type="button" className="text-button" onClick={() => void loadVehicleFiles(vehicle)}>View</button>
                  {profile.role === 'super_admin' && <><button type="button" className="text-button" onClick={() => openEditVehicle(vehicle)}>Edit</button>{vehicle.status !== 'archived' && <button type="button" className="text-button" onClick={() => void archiveVehicle(vehicle)}>Archive</button>}</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>}
        <div className="pagination-controls">
          <span className="muted">{vehicleCount ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, vehicleCount)} of ${vehicleCount}` : '0 vehicles'}</span>
          <div><button type="button" className="ghost-button" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button type="button" className="ghost-button" disabled={(page + 1) * pageSize >= vehicleCount || loading} onClick={() => setPage((current) => current + 1)}>Next</button></div>
        </div>
      </div>

      {selectedVehicle && (
        <div className="glass-panel panel-section">
          <div className="section-head">
            <h3>{[selectedVehicle.manufacturing_year, selectedVehicle.make, selectedVehicle.model].filter(Boolean).join(' ')}</h3>
            <button type="button" className="text-button" onClick={() => setSelectedVehicle(null)}>Close</button>
          </div>
          <p className="muted">{selectedVehicle.notes || 'No vehicle notes.'}</p>
          <div className="vehicle-files">
            {vehicleFiles.map((file) => (
              <VehicleFileLink key={file.id} file={file} />
            ))}
            {!vehicleFiles.length && <span className="muted">No files uploaded.</span>}
          </div>
          {profile.role === 'super_admin' && <label className="ghost-button upload-button">Upload images or PDF documents<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={saving} onChange={(event) => void uploadFiles(event)} /></label>}
        </div>
      )}
    </div>
  );
}

function VehicleFileLink({ file }: { file: VehicleFile }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!supabase) return;
    void supabase.storage.from(file.storage_bucket).createSignedUrl(file.object_path, 300).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [file]);
  return url ? <a href={url} target="_blank" rel="noreferrer">{file.file_name}</a> : <span>{file.file_name}</span>;
}

function PurchaseView() {
  return <PagePlaceholder title="Purchase management" subtitle="Add funding, vehicle expenses, and purchase approval workflow." />;
}

function SalesView() {
  return <PagePlaceholder title="Sales management" subtitle="Record customer sales, partial payments, and approval workflow." />;
}

function PartnersView() {
  return <PagePlaceholder title="Partners" subtitle="Manage six partner profiles, funding records, and profit allocations." />;
}

function InvestorsView() {
  return <PagePlaceholder title="Investors" subtitle="Track investor portfolios, returns, links to funded vehicles, and balances." />;
}

function FinanceView() {
  return <PagePlaceholder title="Financial transactions" subtitle="Unified ledger with partner and investor funding, sales receipts, and reserve movement." />;
}

function ProfitView() {
  return <PagePlaceholder title="Profit distribution" subtitle="Reproducible profit calculation engine and payout approvals." />;
}

function ExpensesView() {
  return <PagePlaceholder title="Expenses" subtitle="Operating costs, reserves, receipts, and monthly totals." />;
}

function ReportsView() {
  return <PagePlaceholder title="Reports" subtitle="CSV and PDF business statements for inventory, sales, and financial summaries." />;
}

function AiView() {
  return <PagePlaceholder title="AI business intelligence" subtitle="Internal analytics, purchase recommendations, and market intelligence foundation." />;
}

type InvestorRecord = Party & {
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
};
type PartnerRecord = Party & { email: string | null; phone: string | null };

type PartySummary = {
  party_id: string;
  vehicle_count: number;
  invested_capital: number;
};

function InvestorManagement() {
  const [investors, setInvestors] = useState<InvestorRecord[]>([]);
  const [summaries, setSummaries] = useState<PartySummary[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingInvestorId, setUpdatingInvestorId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestorRecord | null>(null);
  const [detail, setDetail] = useState<InvestorRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [history, setHistory] = useState<{
    contributions: FundingRow[];
    transactions: { id: string; transaction_type: string; amount: number; status: string; created_at: string }[];
    distributions: { id: string; vehicle_id: string; amount: number; approval_status: string; created_at: string }[];
    payments: { id: string; distribution_id: string; paid_amount: number; payment_date: string; payment_method: string | null }[];
    vehicles: { id: string; make: string; model: string; manufacturing_year: number | null }[];
  }>({ contributions: [], transactions: [], distributions: [], payments: [], vehicles: [] });
  const pageSize = 20;

  const loadInvestors = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    setLoading(true);
    try {
      const investorResult = await supabase.from('investors')
        .select('id, name, email, phone, status, created_at', { count: 'exact' })
        .ilike('name', `%${search.replace(/[%_,]/g, '')}%`)
        .order('name')
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (investorResult.error) {
        setError(formatOperationError(investorResult.error));
        return;
      }
      const investorIds = (investorResult.data ?? []).map((investor) => investor.id);
      const [summaryResult, detailsResult] = await Promise.all([
        supabase.rpc('party_funding_summary', { p_party_type: 'investor' }),
        investorIds.length
          ? supabase.from('investor_private_details')
            .select('investor_id, address, notes')
            .in('investor_id', investorIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const failure = summaryResult.error ?? detailsResult.error;
      if (failure) {
        setError(formatOperationError(failure));
        return;
      }
      setError('');
      const privateDetails = new Map((detailsResult.data ?? []).map((item) => [item.investor_id, item]));
      setInvestors((investorResult.data ?? []).map((investor) => ({
        ...investor,
        address: privateDetails.get(investor.id)?.address ?? null,
        notes: privateDetails.get(investor.id)?.notes ?? null,
      })) as InvestorRecord[]);
      setSummaries((summaryResult.data ?? []) as PartySummary[]);
      setCount(investorResult.count ?? 0);
    } catch (loadError) {
      setError(formatOperationError(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { void loadInvestors(); }, [loadInvestors]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
    setError('');
    setNotice('');
  };

  const submitInvestor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    const values = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data: savedInvestorId, error: saveError } = await supabase.rpc('manage_investor', {
        p_investor_id: editing?.id ?? null,
        p_name: String(values.get('name') ?? '').trim(),
        p_email: String(values.get('email') ?? '').trim() || null,
        p_phone: String(values.get('phone') ?? '').trim() || null,
        p_address: String(values.get('address') ?? '').trim() || null,
        p_notes: String(values.get('notes') ?? '').trim() || null,
        p_status: String(values.get('status') ?? 'active'),
      });
      if (saveError || !savedInvestorId) {
        setError(formatOperationError(saveError ?? new Error('Supabase did not confirm the investor save.')));
        return;
      }
      setNotice(editing ? 'Investor updated.' : 'Investor added.');
      setFormOpen(false);
      setEditing(null);
      if (page === 0) await loadInvestors();
      else setPage(0);
    } catch (saveError) {
      setError(formatOperationError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const editInvestor = (investor: InvestorRecord) => {
    setEditing(investor);
    setFormOpen(true);
    setError('');
  };

  const toggleInvestorStatus = async (investor: InvestorRecord) => {
    if (!supabase) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    const nextStatus = investor.status === 'active' ? 'inactive' : 'active';
    setUpdatingInvestorId(investor.id);
    setError('');
    setNotice('');
    try {
      const { data: updatedInvestorId, error: updateError } = await supabase.rpc('manage_investor', {
        p_investor_id: investor.id,
        p_name: investor.name,
        p_email: investor.email,
        p_phone: investor.phone,
        p_address: investor.address,
        p_notes: investor.notes,
        p_status: nextStatus,
      });
      if (updateError || !updatedInvestorId) {
        setError(formatOperationError(updateError ?? new Error('Supabase did not confirm the investor status update.')));
        return;
      }
      setNotice(`Investor ${nextStatus === 'active' ? 'activated' : 'deactivated'}. Historical funding remains unchanged.`);
      await loadInvestors();
    } catch (updateError) {
      setError(formatOperationError(updateError));
    } finally {
      setUpdatingInvestorId(null);
    }
  };

  const showInvestor = async (investor: InvestorRecord) => {
    if (!supabase) return;
    setDetail(investor);
    setDetailLoading(true);
    setHistory({ contributions: [], transactions: [], distributions: [], payments: [], vehicles: [] });
    setError('');
    const [contributionsResult, transactionResult, distributionResult] = await Promise.all([
      supabase.from('funding_contributions')
        .select('id, vehicle_id, partner_id, investor_id, amount, contribution_date, payment_method, reference_number, notes')
        .eq('investor_id', investor.id)
        .order('contribution_date', { ascending: false }),
      supabase.from('financial_transactions')
        .select('id, transaction_type, amount, status, created_at')
        .eq('related_investor_id', investor.id)
        .order('created_at', { ascending: false }),
      supabase.from('profit_distributions')
        .select('id, vehicle_id, amount, approval_status, created_at')
        .eq('recipient_type', 'investor')
        .eq('recipient_id', investor.id)
        .order('created_at', { ascending: false }),
    ]);
    const failure = contributionsResult.error ?? transactionResult.error ?? distributionResult.error;
    if (failure) {
      setError(failure.message);
      setDetailLoading(false);
      return;
    }
    const contributions = (contributionsResult.data ?? []) as FundingRow[];
    const distributions = (distributionResult.data ?? []) as { id: string; vehicle_id: string; amount: number; approval_status: string; created_at: string }[];
    const actualVehicleIds = [...new Set([
      ...contributions.map((row) => row.vehicle_id),
      ...distributions.map((row) => row.vehicle_id),
    ])];
    const [vehiclesResult, paymentsResult] = await Promise.all([
      actualVehicleIds.length
        ? supabase.from('vehicles').select('id, make, model, manufacturing_year').in('id', actualVehicleIds)
        : Promise.resolve({ data: [], error: null }),
      distributions.length
        ? supabase.from('distribution_payments')
          .select('id, distribution_id, paid_amount, payment_date, payment_method')
          .in('distribution_id', distributions.map((row) => row.id))
          .order('payment_date', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    const historyError = vehiclesResult.error ?? paymentsResult.error;
    if (historyError) {
      setError(historyError.message);
      setDetailLoading(false);
      return;
    }
    setHistory({
      contributions: contributionsResult.data as FundingRow[],
      transactions: (transactionResult.data ?? []) as { id: string; transaction_type: string; amount: number; status: string; created_at: string }[],
      distributions,
      payments: (paymentsResult.data ?? []) as { id: string; distribution_id: string; paid_amount: number; payment_date: string; payment_method: string | null }[],
      vehicles: (vehiclesResult.data ?? []) as { id: string; make: string; model: string; manufacturing_year: number | null }[],
    });
    setDetailLoading(false);
  };

  const summaryByInvestor = useMemo(() => new Map(summaries.map((item) => [item.party_id, item])), [summaries]);
  const currency = import.meta.env.VITE_DEFAULT_CURRENCY || 'PKR';

  return (
    <section className="glass-panel panel-section party-management">
      <div className="section-head">
        <div><h3>Investor management</h3><p className="muted">Manage investor contacts and active status. Historical financial records are retained.</p></div>
        <button type="button" className="primary-button" onClick={openNew}>Add investor</button>
      </div>
      {error && <p role="alert" className="auth-feedback error">{error}</p>}
      {notice && <p role="status" className="auth-feedback">{notice}</p>}
      <label className="field-group party-search">Search investors<input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by name" /></label>
      {formOpen && <form key={editing?.id ?? 'new'} className="party-form" onSubmit={submitInvestor}>
        <h4>{editing ? 'Edit investor' : 'Add investor'}</h4>
        <div className="field-grid">
          <label className="field-group">Full name<input name="name" required defaultValue={editing?.name ?? ''} /></label>
          <label className="field-group">Phone<input name="phone" type="tel" defaultValue={editing?.phone ?? ''} /></label>
          <label className="field-group">Email<input name="email" type="email" defaultValue={editing?.email ?? ''} /></label>
          <label className="field-group">Address<input name="address" defaultValue={editing?.address ?? ''} /></label>
          <label className="field-group">Status<select name="status" defaultValue={editing?.status ?? 'active'}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <label className="field-group party-notes">Notes<textarea name="notes" rows={2} defaultValue={editing?.notes ?? ''} /></label>
        </div>
        <div className="vehicle-form-actions"><button type="button" className="ghost-button" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save investor'}</button></div>
      </form>}
      {loading ? <p className="muted">Loading investors...</p> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Investor</th><th>Contact</th><th>Status</th><th>Vehicles</th><th>Invested capital</th><th>Actions</th></tr></thead>
            <tbody>{investors.map((investor) => {
              const summary = summaryByInvestor.get(investor.id);
              return <tr key={investor.id}>
                <td>{investor.name}<small className="table-subtext">Added {new Date(investor.created_at).toLocaleDateString()}</small></td>
                <td>{investor.phone || '—'}<small className="table-subtext">{investor.email || '—'}</small></td>
                <td><span className="status-badge">{investor.status}</span></td>
                <td>{summary?.vehicle_count ?? 0}</td>
                <td>{currency} {Number(summary?.invested_capital ?? 0).toLocaleString()}</td>
                <td className="inventory-actions">
                  <button type="button" className="text-button" onClick={() => void showInvestor(investor)}>Details</button>
                  <button type="button" className="text-button" onClick={() => editInvestor(investor)}>Edit</button>
                  <button type="button" className="text-button" disabled={saving || updatingInvestorId !== null} onClick={() => void toggleInvestorStatus(investor)}>{updatingInvestorId === investor.id ? 'Updating...' : investor.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
                </td>
              </tr>;
            })}</tbody>
          </table>
          {!investors.length && <p className="muted">No investors found.</p>}
        </div>
      )}
      <div className="pagination-controls">
        <span className="muted">{count ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)} of ${count}` : '0 investors'}</span>
        <div><button type="button" className="ghost-button" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button type="button" className="ghost-button" disabled={(page + 1) * pageSize >= count || loading} onClick={() => setPage((current) => current + 1)}>Next</button></div>
      </div>
      {detail && <div className="party-detail">
        <div className="section-head"><div><h4>{detail.name} · Investor details</h4><p className="muted">{detail.email || 'No email'} · {detail.phone || 'No phone'} · {detail.address || 'No address'}</p></div><button type="button" className="text-button" onClick={() => setDetail(null)}>Close</button></div>
        {detail.notes && <p className="muted">{detail.notes}</p>}
        {detailLoading && <p className="muted">Loading financial history...</p>}
        <h5>Vehicle funding history</h5>
        {history.contributions.map((item) => {
          const vehicle = history.vehicles.find((row) => row.id === item.vehicle_id);
          return <div className="history-row" key={item.id}><span>{vehicle ? `${vehicle.manufacturing_year ?? ''} ${vehicle.make} ${vehicle.model}` : 'Vehicle funding'}</span><span>{item.contribution_date} · {currency} {Number(item.amount).toLocaleString()}</span></div>;
        })}
        {!history.contributions.length && <p className="muted">No vehicle funding records.</p>}
        <h5>Financial transactions</h5>
        {history.transactions.map((item) => <div className="history-row" key={item.id}><span>{item.transaction_type.replaceAll('_', ' ')} · {item.status}</span><span>{new Date(item.created_at).toLocaleDateString()} · {currency} {Number(item.amount).toLocaleString()}</span></div>)}
        {!history.transactions.length && <p className="muted">No investor-linked transactions recorded.</p>}
        <h5>Profit distributions and payments</h5>
        {history.distributions.map((item) => {
          const paid = history.payments.filter((payment) => payment.distribution_id === item.id);
          return <div className="history-row" key={item.id}><span>{item.approval_status} · {paid.length} payment(s)</span><span>{currency} {Number(item.amount).toLocaleString()}</span></div>;
        })}
        {history.payments.map((item) => <div className="history-row" key={item.id}><span>Payment · {item.payment_method || 'unspecified'}</span><span>{item.payment_date} · {currency} {Number(item.paid_amount).toLocaleString()}</span></div>)}
        {!history.distributions.length && !history.payments.length && <p className="muted">No profit distribution history recorded.</p>}
      </div>}
    </section>
  );
}

function PartnerManagement() {
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [summaries, setSummaries] = useState<PartySummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingPartnerId, setUpdatingPartnerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PartnerRecord | null>(null);

  const loadPartners = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    setLoading(true);
    try {
      const [partnersResult, summaryResult] = await Promise.all([
        supabase.from('partners').select('id, name, email, phone, status').order('name'),
        supabase.rpc('party_funding_summary', { p_party_type: 'partner' }),
      ]);
      const failure = partnersResult.error ?? summaryResult.error;
      if (failure) {
        setError(formatOperationError(failure));
        return;
      }
      setError('');
      setPartners((partnersResult.data ?? []) as PartnerRecord[]);
      setSummaries((summaryResult.data ?? []) as PartySummary[]);
    } catch (loadError) {
      setError(formatOperationError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPartners(); }, [loadPartners]);

  const submitPartner = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    const values = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data: savedPartnerId, error: saveError } = await supabase.rpc('manage_partner', {
        p_partner_id: editing?.id ?? null,
        p_name: String(values.get('name') ?? '').trim(),
        p_email: String(values.get('email') ?? '').trim() || null,
        p_phone: String(values.get('phone') ?? '').trim() || null,
        p_status: String(values.get('status') ?? 'active'),
      });
      if (saveError || !savedPartnerId) {
        setError(formatOperationError(saveError ?? new Error('Supabase did not confirm the partner save.')));
        return;
      }
      setNotice(editing ? 'Partner updated.' : 'Partner added.');
      setEditing(null);
      setFormOpen(false);
      await loadPartners();
    } catch (saveError) {
      setError(formatOperationError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const togglePartnerStatus = async (partner: PartnerRecord) => {
    if (!supabase) {
      setError(supabaseConfigError ?? 'Supabase is unavailable.');
      return;
    }
    const nextStatus = partner.status === 'active' ? 'inactive' : 'active';
    setUpdatingPartnerId(partner.id);
    setError('');
    setNotice('');
    try {
      const { data: updatedPartnerId, error: updateError } = await supabase.rpc('manage_partner', {
        p_partner_id: partner.id,
        p_name: partner.name,
        p_email: partner.email ?? null,
        p_phone: partner.phone ?? null,
        p_status: nextStatus,
      });
      if (updateError || !updatedPartnerId) {
        setError(formatOperationError(updateError ?? new Error('Supabase did not confirm the partner status update.')));
        return;
      }
      setNotice(`Partner ${nextStatus === 'inactive' ? 'deactivated' : 'reactivated'}. Historical funding remains unchanged.`);
      await loadPartners();
    } catch (updateError) {
      setError(formatOperationError(updateError));
    } finally {
      setUpdatingPartnerId(null);
    }
  };

  const openNewPartner = () => {
    setEditing(null);
    setFormOpen(true);
    setError('');
    setNotice('');
  };

  const summaryByPartner = useMemo(() => new Map(summaries.map((item) => [item.party_id, item])), [summaries]);
  const visiblePartners = partners.filter((partner) => partner.name.toLowerCase().includes(search.toLowerCase()));
  const currency = import.meta.env.VITE_DEFAULT_CURRENCY || 'PKR';

  return (
    <section className="glass-panel panel-section party-management">
      <div className="section-head"><div><h3>Partner management</h3><p className="muted">Edit contact details and active status without deleting financial history.</p></div></div>
      {error && <p role="alert" className="auth-feedback error">{error}</p>}
      {notice && <p role="status" className="auth-feedback">{notice}</p>}
      <button type="button" className="primary-button" onClick={openNewPartner}>Add partner</button>
      <label className="field-group party-search">Search partners<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" /></label>
      {formOpen && <form key={editing?.id ?? 'new'} className="party-form" onSubmit={submitPartner}>
        <h4>{editing ? `Edit ${editing.name}` : 'Add partner'}</h4>
        <div className="field-grid">
          <label className="field-group">Name<input name="name" required defaultValue={editing?.name ?? ''} /></label>
          <label className="field-group">Phone<input name="phone" type="tel" defaultValue={editing?.phone ?? ''} /></label>
          <label className="field-group">Email<input name="email" type="email" defaultValue={editing?.email ?? ''} /></label>
          <label className="field-group">Status<select name="status" defaultValue={editing?.status ?? 'active'}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        </div>
        <div className="vehicle-form-actions"><button type="button" className="ghost-button" disabled={saving} onClick={() => { setEditing(null); setFormOpen(false); }}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save partner'}</button></div>
      </form>}
      {loading ? <p className="muted">Loading partners...</p> : <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Partner</th><th>Contact</th><th>Status</th><th>Funded vehicles</th><th>Recorded capital</th><th>Actions</th></tr></thead>
          <tbody>{visiblePartners.map((partner) => {
            const summary = summaryByPartner.get(partner.id);
            return <tr key={partner.id}>
              <td>{partner.name}</td>
              <td>{partner.phone || '—'}<small className="table-subtext">{partner.email || '—'}</small></td>
              <td><span className="status-badge">{partner.status}</span></td>
              <td>{summary?.vehicle_count ?? 0}</td>
              <td>{currency} {Number(summary?.invested_capital ?? 0).toLocaleString()}</td>
              <td className="inventory-actions">
                <button type="button" className="text-button" disabled={saving || updatingPartnerId !== null} onClick={() => { setEditing(partner); setFormOpen(true); setError(''); setNotice(''); }}>Edit</button>
                <button type="button" className="text-button" disabled={saving || updatingPartnerId !== null} onClick={() => void togglePartnerStatus(partner)}>{updatingPartnerId === partner.id ? 'Updating...' : partner.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
              </td>
            </tr>;
          })}</tbody>
        </table>
        {!visiblePartners.length && <p className="muted">No partners found.</p>}
      </div>}
    </section>
  );
}

function SettingsView({ profile, background, onChange, showControls, setShowControls }: { profile: Profile; background: BackgroundSettings; onChange: (key: keyof BackgroundSettings, value: number) => void; showControls: boolean; setShowControls: (value: boolean) => void; }) {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">System configuration</p>
          <h2>Brand and background settings</h2>
        </div>
        <button type="button" className="primary-button" onClick={() => setShowControls(!showControls)}>
          {showControls ? 'Hide settings' : 'Adjust background'}
        </button>
      </div>

      <div className="settings-grid">
        <div className="glass-panel panel-section">
          <h3>Business profile</h3>
          <div className="field-grid">
            <div className="field-group"><label>Business name</label><input defaultValue="TRUELINE AUTOS" /></div>
            <div className="field-group"><label>Currency</label><input defaultValue="PKR" /></div>
            <div className="field-group"><label>Theme</label><input defaultValue="Luxury glass" /></div>
            <div className="field-group"><label>Contact</label><input defaultValue="+92 300 1234567" /></div>
          </div>
        </div>

        <div className="glass-panel panel-section">
          <h3>Background customization</h3>
          {showControls ? (
            <div className="slider-stack">
              <label>
                Blur: {background.blur}px
                <input type="range" min="0" max="16" value={background.blur} onChange={(e) => onChange('blur', Number(e.target.value))} />
              </label>
              <label>
                Brightness: {background.brightness.toFixed(2)}
                <input type="range" min="0.4" max="1" step="0.01" value={background.brightness} onChange={(e) => onChange('brightness', Number(e.target.value))} />
              </label>
              <label>
                Overlay opacity: {background.opacity.toFixed(2)}
                <input type="range" min="0.1" max="1" step="0.01" value={background.opacity} onChange={(e) => onChange('opacity', Number(e.target.value))} />
              </label>
              <button type="button" className="ghost-button" onClick={() => onChange('blur', defaultBackground.blur)}>Reset background</button>
            </div>
          ) : (
            <p className="muted">Background settings are available for the admin to adjust the showroom backdrop without changing the luxury glass-card structure.</p>
          )}
        </div>
      </div>
      {profile.role === 'super_admin' && (
        <div className="party-management-stack">
          <InvestorManagement />
          <PartnerManagement />
        </div>
      )}
    </div>
  );
}

function PagePlaceholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Under development</p>
          <h2>{title}</h2>
        </div>
      </div>

      <div className="glass-panel panel-section placeholder-box">
        <div className="placeholder-icon"><BriefcaseBusiness size={28} /></div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function ShoppingBagIcon(props: React.ComponentProps<typeof CarFront>) {
  return <CarFront {...props} />;
}

export default App;
