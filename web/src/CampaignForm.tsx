import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Campaign, type CampaignInput } from './api';
import { COUNTRY_LABELS, DEVICE_LABELS, SLOT_LABELS, formatNumber } from './format';

const toDateInput = (value: Date | string): string => new Date(value).toISOString().slice(0, 10);

const CheckGroup = ({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string;
  options: Array<[string, string]>;
  selected: string[];
  onChange: (values: string[]) => void;
}) => (
  <fieldset className="checks">
    <legend>{legend}</legend>
    {options.map(([value, label]) => (
      <label key={value}>
        <input
          type="checkbox"
          checked={selected.includes(value)}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? [...selected, value]
                : selected.filter((item) => item !== value),
            )
          }
        />
        {label}
      </label>
    ))}
  </fieldset>
);

const CampaignForm = ({
  campaign,
  onClose,
  onSaved,
}: {
  campaign?: Campaign;
  onClose: () => void;
  onSaved: (id: string) => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const today = new Date();
  const [title, setTitle] = useState(campaign?.title ?? '');
  const [advertiser, setAdvertiser] = useState(campaign?.advertiser ?? '');
  const [budget, setBudget] = useState(campaign ? String(campaign.budgetCents / 100) : '10000');
  const [cpm, setCpm] = useState(campaign ? String(campaign.cpmCents / 100) : '20');
  const [startsAt, setStartsAt] = useState(toDateInput(campaign?.startsAt ?? today));
  const [endsAt, setEndsAt] = useState(
    toDateInput(campaign?.endsAt ?? new Date(today.getTime() + 30 * 86_400_000)),
  );
  const [countries, setCountries] = useState(campaign?.targetCountries ?? []);
  const [genres, setGenres] = useState(campaign?.targetGenres ?? []);
  const [devices, setDevices] = useState(campaign?.targetDevices ?? []);
  const [slots, setSlots] = useState(campaign?.targetSlots ?? []);
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    api
      .shows()
      .then((shows) => setAllGenres([...new Set(shows.map((show) => show.genre))].sort()))
      .catch(() => setAllGenres([]));
  }, []);

  const budgetCents = Math.round(Number(budget) * 100);
  const cpmCents = Math.round(Number(cpm) * 100);
  const impressionGoal = cpmCents > 0 ? Math.floor((budgetCents / cpmCents) * 1000) : 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    const input: CampaignInput = {
      title,
      advertiser,
      budgetCents,
      cpmCents,
      impressionGoal,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      targetCountries: countries,
      targetGenres: genres,
      targetDevices: devices,
      targetSlots: slots,
    };

    try {
      const saved = campaign ? await api.update(campaign.id, input) : await api.create(input);
      onSaved(saved.id);
    } catch (reason) {
      const fields = reason instanceof ApiError ? Object.values(reason.fields ?? {}).flat() : [];
      setError(fields[0] ?? (reason as Error).message);
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="form-title">
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="form-title">{campaign ? 'Edit campaign' : 'New campaign'}</h2>

        <div className="fields">
          <label className="wide">
            Campaign name
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
            />
          </label>
          <label className="wide">
            Advertiser
            <input
              value={advertiser}
              onChange={(e) => setAdvertiser(e.target.value)}
              required
              minLength={2}
            />
          </label>
          <label>
            Budget (€)
            <input
              type="number"
              min="1"
              step="1"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              required
            />
          </label>
          <label>
            CPM (€ per 1,000 impressions)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={cpm}
              onChange={(e) => setCpm(e.target.value)}
              required
            />
          </label>
          <label>
            Starts
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
            />
          </label>
          <label>
            Ends
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
            />
          </label>
        </div>

        <p className="hint">
          This budget buys about <strong>{formatNumber(impressionGoal)}</strong> impressions. Leave
          a targeting group empty to run everywhere.
        </p>

        <CheckGroup
          legend="Ad slots"
          options={Object.entries(SLOT_LABELS)}
          selected={slots}
          onChange={setSlots}
        />
        <CheckGroup
          legend="Countries"
          options={Object.entries(COUNTRY_LABELS)}
          selected={countries}
          onChange={setCountries}
        />
        <CheckGroup
          legend="Devices"
          options={Object.entries(DEVICE_LABELS)}
          selected={devices}
          onChange={setDevices}
        />
        <CheckGroup
          legend="Show genres"
          options={allGenres.map((genre) => [genre, genre])}
          selected={genres}
          onChange={setGenres}
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
          </button>
        </div>
      </form>
    </dialog>
  );
};

export default CampaignForm;
