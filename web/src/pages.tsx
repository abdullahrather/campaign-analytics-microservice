import { useMemo, useState, type FormEvent } from 'react';
import { api, type Campaign, type User } from './api';
import CampaignForm from './CampaignForm';
import {
  Breakdown,
  Kpis,
  PacingBadge,
  Progress,
  RangePicker,
  StatusBadge,
  Trends,
  sumTotals,
} from './components';
import {
  COUNTRY_LABELS,
  DEVICE_LABELS,
  SLOT_LABELS,
  formatCompact,
  formatCpm,
  formatDate,
  formatEuros,
  formatNumber,
  formatPercent,
} from './format';
import { rangeFor, useLiveData } from './hooks';

const DEMO_ACCOUNTS = [
  { label: 'Advertiser demo', email: 'advertiser@example.com', password: 'advert1234' },
  { label: 'Admin demo', email: 'admin@example.com', password: 'admin1234' },
];

export const Login = ({ onLogin }: { onLogin: (user: User) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const signIn = (address: string, secret: string) => {
    setError('');
    api
      .login(address, secret)
      .then((session) => onLogin(session.user))
      .catch((reason: Error) => setError(reason.message));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signIn(email, password);
  };

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Campaign Analytics</h1>
        <p className="muted">Plan, run and measure ads across a streaming catalogue.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary">
          Sign in
        </button>
        <div className="demo-accounts">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="button"
              onClick={() => signIn(account.email, account.password)}
            >
              {account.label}
            </button>
          ))}
        </div>
      </form>
    </main>
  );
};

const CampaignTable = ({ campaigns, isAdmin }: { campaigns: Campaign[]; isAdmin: boolean }) => (
  <section className="card">
    <h2>Campaigns</h2>
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Campaign</th>
            <th scope="col">Status</th>
            <th scope="col">Pacing</th>
            <th scope="col">Delivered</th>
            <th scope="col" className="num">
              Impressions
            </th>
            <th scope="col" className="num">
              CTR
            </th>
            <th scope="col" className="num">
              Spent / budget
            </th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id}>
              <td>
                <a href={`#/campaigns/${campaign.id}`}>{campaign.title}</a>
                <div className="muted small">
                  {campaign.advertiser}
                  {isAdmin ? ` · ${campaign.ownerEmail}` : ''}
                </div>
              </td>
              <td>
                <StatusBadge status={campaign.status} />
              </td>
              <td>
                <PacingBadge pacing={campaign.pacing} />
              </td>
              <td className="delivery">
                <Progress label={`${campaign.title} delivery`} rate={campaign.deliveryRate} />
                <span className="muted small">{formatPercent(campaign.deliveryRate, 0)}</span>
              </td>
              <td className="num">{formatCompact(campaign.impressions)}</td>
              <td className="num">{formatPercent(campaign.ctr, 2)}</td>
              <td className="num">
                {formatEuros(campaign.lifetimeSpendCents)} / {formatEuros(campaign.budgetCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

const ErrorNote = ({ message }: { message: string }) =>
  message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;

export const Overview = ({ user, onOpen }: { user: User; onOpen: (id: string) => void }) => {
  const [rangeId, setRangeId] = useState('7d');
  const [creating, setCreating] = useState(false);

  const { data, error, refresh } = useLiveData(async () => {
    const range = rangeFor(rangeId);
    const [campaigns, points] = await Promise.all([api.analytics(range), api.timeseries(range)]);
    return { campaigns, points };
  }, rangeId);

  const totals = useMemo(() => sumTotals(data?.campaigns ?? []), [data]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Overview</h1>
          <p className="muted live">
            <span className="live-dot" aria-hidden="true" /> Updates every 5 seconds
          </p>
        </div>
        <div className="toolbar">
          <RangePicker value={rangeId} onChange={setRangeId} />
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            New campaign
          </button>
        </div>
      </header>

      <ErrorNote message={error} />

      {data ? (
        <>
          <Kpis totals={totals} spendCents={totals.spendCents} />
          <Trends points={data.points} />
          {data.campaigns.length > 0 ? (
            <CampaignTable campaigns={data.campaigns} isAdmin={user.role === 'ADMIN'} />
          ) : (
            <p className="empty card">No campaigns yet. Create your first one.</p>
          )}
        </>
      ) : (
        !error && <p className="empty">Loading…</p>
      )}

      {creating && (
        <CampaignForm
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            refresh();
            onOpen(id);
          }}
        />
      )}
    </>
  );
};

const list = (values: string[], labels?: Record<string, string>): string =>
  values.length > 0 ? values.map((value) => labels?.[value] ?? value).join(', ') : 'All';

const Facts = ({ campaign }: { campaign: Campaign }) => {
  const facts = [
    ['Flight', `${formatDate(campaign.startsAt)} – ${formatDate(campaign.endsAt)}`],
    ['CPM', formatCpm(campaign.cpmCents)],
    ['Ad slots', list(campaign.targetSlots, SLOT_LABELS)],
    ['Countries', list(campaign.targetCountries, COUNTRY_LABELS)],
    ['Devices', list(campaign.targetDevices, DEVICE_LABELS)],
    ['Show genres', list(campaign.targetGenres)],
  ];
  return (
    <section className="card">
      <h2>Setup</h2>
      <dl className="facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

const Delivery = ({ campaign }: { campaign: Campaign }) => (
  <section className="card">
    <h2>Delivery</h2>
    <div className="goal">
      <div className="bar-label">
        <span>Impressions</span>
        <span className="bar-value">
          {formatNumber(campaign.lifetimeImpressions)} of {formatNumber(campaign.impressionGoal)}
        </span>
      </div>
      <Progress label="Impression goal" rate={campaign.deliveryRate} />
    </div>
    <div className="goal">
      <div className="bar-label">
        <span>Budget</span>
        <span className="bar-value">
          {formatEuros(campaign.lifetimeSpendCents)} of {formatEuros(campaign.budgetCents)}
        </span>
      </div>
      <Progress label="Budget used" rate={campaign.budgetUsedRate} />
    </div>
  </section>
);

export const CampaignPage = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [rangeId, setRangeId] = useState('7d');
  const [editing, setEditing] = useState(false);
  const { data, error, refresh } = useLiveData(
    () => api.campaign(id, rangeFor(rangeId)),
    `${id}-${rangeId}`,
  );

  const campaign = data?.campaign;

  const setStatus = (status: 'ACTIVE' | 'PAUSED') => {
    api.update(id, { status }).then(refresh).catch(refresh);
  };

  const remove = () => {
    if (!campaign || !window.confirm(`Delete “${campaign.title}” and all its data?`)) return;
    api.remove(id).then(onBack).catch(refresh);
  };

  return (
    <>
      <a className="back" href="#/">
        ← Overview
      </a>
      <ErrorNote message={error} />
      {campaign && data ? (
        <>
          <header className="page-header">
            <div>
              <h1>{campaign.title}</h1>
              <p className="muted">{campaign.advertiser}</p>
              <p className="badges">
                <StatusBadge status={campaign.status} />
                <PacingBadge pacing={campaign.pacing} />
              </p>
            </div>
            <div className="toolbar">
              <RangePicker value={rangeId} onChange={setRangeId} />
              {campaign.status !== 'COMPLETED' && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setStatus(campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}
                >
                  {campaign.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                </button>
              )}
              <button type="button" className="button" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className="button danger" onClick={remove}>
                Delete
              </button>
            </div>
          </header>

          <Kpis totals={campaign} spendCents={campaign.spendCents} />
          <div className="columns">
            <Delivery campaign={campaign} />
            <Facts campaign={campaign} />
          </div>
          <Trends points={data.timeseries} />
          <div className="columns">
            <Breakdown title="By ad slot" rows={data.breakdown.slot} labels={SLOT_LABELS} />
            <Breakdown title="By device" rows={data.breakdown.device} labels={DEVICE_LABELS} />
            <Breakdown title="By country" rows={data.breakdown.country} labels={COUNTRY_LABELS} />
            <Breakdown title="By show" rows={data.breakdown.show} />
          </div>

          {editing && (
            <CampaignForm
              campaign={campaign}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                refresh();
              }}
            />
          )}
        </>
      ) : (
        !error && <p className="empty">Loading…</p>
      )}
    </>
  );
};
