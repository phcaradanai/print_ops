import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../api/client.js';
import { useHasPermission } from '../../api/session.js';
import { errorMessage } from '../../api/errors.js';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useLocale } from '../../i18n/index.js';
import { Alert, Button, FormField, Input, Mono, Panel, Select, Stack, Text } from '../../components/ui/index.js';

interface SearchRunner {
  id: string;
  name: string;
  hostname: string;
  status: string;
  metadata: Record<string, unknown>;
}
interface Search {
  id: string;
  runnerId: string;
  createdAt: string;
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  targets: string[];
  addresses: string[];
}
const active = (search: Search | null | undefined) => search?.state === 'QUEUED' || search?.state === 'RUNNING';

function RunnerSearch({ runner, onResults }: { runner: SearchRunner; onResults: () => void }) {
  const { t } = useLocale();
  const [targets, setTargets] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Search | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = runner.metadata['network_printer_search'] === true;
  const fetchLatest = useCallback(() => apiFetch<Search | null>(`/v1/runners/${encodeURIComponent(runner.id)}/printer-searches/latest`), [runner.id]);
  const latest = useApiResource(fetchLatest, { enabled: supported, intervalMs: 2000 });
  // Keep an optimistic POST response only until an equally new or newer server
  // snapshot arrives. Another operator may already have started the next search.
  const awaitingAcknowledgement = submitted && (!latest.data || latest.data.createdAt < submitted.createdAt);
  const search = awaitingAcknowledgement ? submitted : latest.data;
  const busy = submitting || active(search);
  const notified = useRef('');

  useEffect(() => {
    if (submitted && !awaitingAcknowledgement) setSubmitted(null);
  }, [submitted, awaitingAcknowledgement]);

  useEffect(() => {
    latest.setPollingEnabled(active(search));
    if (search && !active(search) && notified.current !== `${search.id}:${search.state}`) {
      notified.current = `${search.id}:${search.state}`;
      onResults();
    }
  }, [search, latest.setPollingEnabled, onResults]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !supported) return;
    setError(null);
    if (!targets.trim()) { setError(t('networkSearch.required')); return; }
    setSubmitting(true);
    try {
      const result = await apiFetch<Search>(`/v1/runners/${encodeURIComponent(runner.id)}/printer-searches`, {
        method: 'POST', body: JSON.stringify({ targets }),
      });
      setSubmitted(result);
      latest.setPollingEnabled(true);
      latest.refresh();
    } catch (cause) {
      setError(errorMessage(cause, t('networkSearch.error')));
      // A timed-out POST may have been accepted; reconcile before another start.
      latest.setPollingEnabled(true);
      latest.refresh();
    } finally { setSubmitting(false); }
  };

  return <Stack gap="md">
    {!supported && <Alert tone="warning">{t('networkSearch.updateRunner')}</Alert>}
    {runner.status === 'offline' && <Alert tone="warning">{t('networkSearch.offline')}</Alert>}
    <form onSubmit={submit}>
      <Stack gap="md">
        <FormField label={t('networkSearch.targets')} hint={t('networkSearch.targetsHint')} error={error ?? undefined}>
          {control => <Input {...control} mono value={targets} maxLength={4096} disabled={busy || !supported}
            placeholder="192.168.1.50" onChange={event => { setTargets(event.target.value); setError(null); }} />}
        </FormField>
        <div><Button type="submit" variant="primary" busy={submitting} busyLabel={t('networkSearch.submitting')}
          disabled={!supported || busy || latest.loading || Boolean(latest.error)}>{t('networkSearch.start')}</Button></div>
      </Stack>
    </form>
    {latest.error != null && <Alert tone="error">
      <Stack gap="sm"><Text>{t('networkSearch.statusError')}</Text><div><Button onClick={() => latest.refresh()}>{t('error.retry')}</Button></div></Stack>
    </Alert>}
    {search && <Stack gap="sm" role="status" aria-live="polite">
      <Text weight="semibold">{t(`networkSearch.state.${search.state}`)}</Text>
      <Text size="label" tone="muted">{t('networkSearch.targetCount').replace('{count}', String(search.targets.length))}</Text>
      {search.state === 'COMPLETED' && search.addresses.length === 0 && <Text>{t('networkSearch.empty')}</Text>}
      {search.state === 'FAILED' && <Text>{t('networkSearch.partial')}</Text>}
      {search.state === 'EXPIRED' && <Text>{t('networkSearch.expired')}</Text>}
      {search.addresses.length > 0 && <>
        <Text>{t('networkSearch.candidates').replace('{count}', String(search.addresses.length))}</Text>
        <ul>{search.addresses.map(address => <li key={address}><Mono>{address}:9100</Mono></li>)}</ul>
        <Text size="label" tone="muted">{t('networkSearch.registerHint')}</Text>
      </>}
    </Stack>}
  </Stack>;
}

/** Search runs on the selected Runner, even when that Runner cannot claim print jobs. */
export function NetworkPrinterSearch({ onResults }: { onResults: () => void }) {
  const canCreate = useHasPermission('printer:create');
  return canCreate ? <SearchPanel onResults={onResults} /> : null;
}

function SearchPanel({ onResults }: { onResults: () => void }) {
  const { t } = useLocale();
  const fetchRunners = useCallback(() => apiFetch<SearchRunner[]>('/runners'), []);
  const runners = useApiResource(fetchRunners);
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem('printops-network-search-runner') ?? ''; } catch { return ''; }
  });
  const chosen = runners.data?.find(r => r.id === selected) ?? runners.data?.find(r => r.metadata['network_printer_search'] === true) ?? runners.data?.[0];
  return <Panel title={t('networkSearch.title')} description={t('networkSearch.description')} padding="lg">
    <Stack gap="md">
      <FormField label={t('networkSearch.runner')} hint={t('networkSearch.runnerHint')}>
        {control => <Select {...control} value={chosen?.id ?? ''} disabled={!runners.data?.length} onChange={event => {
          setSelected(event.target.value);
          try { localStorage.setItem('printops-network-search-runner', event.target.value); } catch { /* session only */ }
        }}>
          {!runners.data?.length && <option value="">{t(runners.loading ? 'networkSearch.loading' : 'networkSearch.noRunners')}</option>}
          {runners.data?.map(runner => <option key={runner.id} value={runner.id}>{runner.name} ({runner.hostname})</option>)}
        </Select>}
      </FormField>
      {runners.error != null && <Alert tone="error"><Stack gap="sm"><Text>{t('networkSearch.runnerError')}</Text>
        <div><Button onClick={runners.refresh}>{t('error.retry')}</Button></div></Stack></Alert>}
      {chosen && <RunnerSearch key={chosen.id} runner={chosen} onResults={onResults} />}
      <Text size="label" tone="muted">{t('networkSearch.candidateNote')}</Text>
    </Stack>
  </Panel>;
}
