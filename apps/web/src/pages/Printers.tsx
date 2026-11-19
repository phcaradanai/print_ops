import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionIcon } from '../components/ActionIcon.js';
import { apiFetch, getRuntimeArchitecture } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { printerHealth } from '../lib/deviceHealth.js';
import {
  Alert,
  Badge,
  Button,
  Inline,
  SearchField,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  Divider,
  EmptyState,
  ErrorState,
  Freshness,
  FormField,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  RecordCard,
  RecordHeader,
  RecordList,
  ResourceToolbar,
  Select,
  SelectFilter,
  Stack,
  StateBadge,
  StatusIndicator,
  TableEmpty,
  Text,
} from '../components/ui/index.js';

interface Printer {
  id: string; code: string; name: string; location?: string;
  protocol: string; isActive: boolean;
  status?: { code: string; checkedAt: string };
  allowedTemplates?: string[]; maxCopiesPerJob?: number;
}

interface CupsQueue {
  name: string;
  registered: boolean;
  deviceUri?: string;
}

/** A printer PrintOps found on the network before CUPS knew about it. */
interface CupsDevice {
  host: string;
  uri: string;
  secure: boolean;
  makeModel?: string;
  info?: string;
  formats: string[];
  driverless: boolean;
}

interface CupsScanReport {
  devices: CupsDevice[];
  failures: Array<{ host: string; error: string }>;
}

type CupsReadinessCode = 'MISSING_FILTER' | 'INSECURE_FILTER' | 'STOPPED';

interface CupsQueueCreation {
  queue: string;
  deviceUri: string;
  created: boolean;
  registered: boolean;
  printer: Printer;
  device: CupsDevice;
  readiness: { ready: boolean; reasons: string[]; code?: CupsReadinessCode };
}

interface CupsAdminStatus {
  configured: boolean;
  user?: string;
  source: 'file' | 'env' | 'none';
}

/** Mirror the server-side default so the field starts with the same name. */
function suggestQueueName(host: string): string {
  const derived = `PRINT_${host.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
  return derived.slice(0, 127);
}

const fetchCupsQueues = () => apiFetch<CupsQueue[]>('/printers/cups-queues');
const fetchCupsServer = () => apiFetch<{ server: string }>('/printers/cups-server');
const fetchCupsAdmin = () => apiFetch<CupsAdminStatus>('/printers/cups-admin');

export default function Printers() {
  const { t } = useLocale();
  const fetchPrinters = useCallback(() => apiFetch<Printer[]>('/printers'), []);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const printersResource = useApiResource(fetchPrinters);
  const printers = printersResource.data ?? [];
  const runtime = useApiResource(getRuntimeArchitecture);
  const [cupsDialog, setCupsDialog] = useState<'closed' | 'connect' | 'help'>('closed');
  const cupsOpen = cupsDialog !== 'closed';
  const [queueName, setQueueName] = useState('');
  const [serverDraft, setServerDraft] = useState<string | null>(null);
  const [scanRange, setScanRange] = useState('');
  const [foundDevices, setFoundDevices] = useState<CupsDevice[] | null>(null);
  const [deviceDrafts, setDeviceDrafts] = useState<Record<string, string>>({});
  const [adminUser, setAdminUser] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const cupsServer = useApiResource(fetchCupsServer, { enabled: cupsOpen });
  const cupsQueues = useApiResource(fetchCupsQueues, { enabled: cupsOpen });
  const cupsAdmin = useApiResource(fetchCupsAdmin, { enabled: cupsOpen });
  const availableQueues = (cupsQueues.data ?? []).filter((queue) => !queue.registered);
  const serverValue = serverDraft ?? cupsServer.data?.server ?? '';
  const serverChanged = serverDraft !== null && serverDraft.trim() !== cupsServer.data?.server;
  const adminStatus = cupsAdmin.data;
  const saveCupsServer = useApiAction(async (server: string) => {
    await apiFetch('/printers/cups-server', { method: 'PUT', body: JSON.stringify({ server }) });
    setQueueName('');
    setServerDraft(null);
    cupsServer.refresh();
    cupsQueues.refresh();
    return true;
  });
  const importCupsQueue = useApiAction(async (name: string) => {
    await apiFetch<Printer>(`/printers/cups-queues/${encodeURIComponent(name)}`, { method: 'POST' });
    printersResource.refresh();
    setCupsDialog('closed');
  });
  // CUPS is the Linux spooler of this station, so PrintOps finds the device and
  // creates the queue itself: no lpadmin command on the host.
  const scanCupsDevices = useApiAction(async (targets: string) => {
    const report = await apiFetch<CupsScanReport>('/printers/cups-scan', {
      method: 'POST',
      body: JSON.stringify({ targets }),
    });
    setFoundDevices(report.devices);
    setDeviceDrafts(Object.fromEntries(report.devices.map((device) => [device.host, suggestQueueName(device.host)])));
    return report;
  });
  const createCupsQueue = useApiAction(async (input: { host: string; queue: string }) => {
    const created = await apiFetch<CupsQueueCreation>('/printers/cups-queues', {
      method: 'POST',
      body: JSON.stringify({ host: input.host, queue: input.queue }),
    });
    printersResource.refresh();
    cupsQueues.refresh();
    setFoundDevices((current) => current?.filter((device) => device.host !== input.host) ?? null);
    return created;
  });
  const saveCupsAdmin = useApiAction(async () => {
    await apiFetch<CupsAdminStatus>('/printers/cups-admin', {
      method: 'PUT',
      body: JSON.stringify({ user: adminUser, password: adminPassword }),
    });
    setAdminPassword('');
    cupsAdmin.refresh();
    return true;
  });
  const createdQueue = createCupsQueue.result;
  const readinessMessage = (code: CupsReadinessCode | undefined): string | undefined => {
    if (code === 'MISSING_FILTER') return t('page.printers.cupsReadinessMissingFilter');
    if (code === 'INSECURE_FILTER') return t('page.printers.cupsReadinessInsecureFilter');
    if (code === 'STOPPED') return t('page.printers.cupsReadinessStopped');
    return undefined;
  };

  // Health buckets are mutually exclusive and share lib/deviceHealth with the
  // dashboard attention strip: "ready" here is exactly what the strip counts
  // as not needing attention. An unknown or never-reported condition is NOT
  // ready — it needs eyes at the printer detail page.
  const [healthFilter, setHealthFilter] = useState<'ALL' | 'READY' | 'ATTENTION'>('ALL');
  const readyCount = printers.filter(
    (p) => printerHealth(p.isActive, p.status?.code) === 'ready',
  ).length;
  const attentionCount = printers.length - readyCount;
  const normalizedSearch = search.trim().toLowerCase();
  const visiblePrinters = printers.filter((p) => {
    if (healthFilter === 'READY' && printerHealth(p.isActive, p.status?.code) !== 'ready') return false;
    if (healthFilter === 'ATTENTION' && printerHealth(p.isActive, p.status?.code) !== 'attention') return false;
    if (!normalizedSearch) return true;
    return `${p.code} ${p.name ?? ''} ${p.location ?? ''}`.toLowerCase().includes(normalizedSearch);
  });
  const columns = {
    code: t('page.printers.code'),
    name: t('page.printers.name'),
    location: t('page.printers.location'),
    protocol: t('page.printers.protocol'),
    status: t('page.printers.status'),
    maxCopies: t('page.printers.maxCopies'),
    active: t('page.printers.active'),
    health: t('page.printers.filterHealth'),
  };

  return (
    <PageLayout
      title={t('page.printers.title')}
      description={t('page.printers.subtitle')}
      width="full"
      density="compact"
      actions={
        <Inline gap="sm">
          {runtime.data?.runtimeMode === 'linux-server' && (
            <Button onClick={() => {
              setQueueName('');
              setServerDraft(null);
              saveCupsServer.reset();
              importCupsQueue.reset();
              scanCupsDevices.reset();
              createCupsQueue.reset();
              saveCupsAdmin.reset();
              setFoundDevices(null);
              setAdminPassword('');
              setCupsDialog('connect');
            }}>
              {t('page.printers.cupsImport')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/discovered-printers')}>
            <ActionIcon name="search" /> {t('page.printers.discover')}
          </Button>
          <Freshness
            lastSuccessAt={printersResource.lastSuccessAt}
            stale={printersResource.stale}
            refreshing={printersResource.refreshing}
            onRefresh={printersResource.refresh}
          />
        </Inline>
      }
    >
      {cupsDialog === 'connect' && (
        <Dialog
          open
          title={t('page.printers.cupsImport')}
          onClose={() => {
            if (!importCupsQueue.pending && !saveCupsServer.pending) setCupsDialog('closed');
          }}
          footer={
            <Button variant="secondary" onClick={() => setCupsDialog('help')}>
              {t('page.printers.cupsHelp')}
            </Button>
          }
        >
          <Stack gap="lg">
            <Stack gap="sm">
              <FormField label={t('page.printers.cupsServer')} hint={t('page.printers.cupsServerHint')}>
                {(control) => (
                  <Input {...control} value={serverValue} placeholder="cups:631"
                    disabled={saveCupsServer.pending || importCupsQueue.pending}
                    onChange={(event) => {
                      saveCupsServer.reset();
                      setServerDraft(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <Inline gap="sm">
                <Button variant="secondary" disabled={!serverValue.trim() || serverValue.startsWith('/') || importCupsQueue.pending}
                  busy={saveCupsServer.pending} onClick={() => void saveCupsServer.run(serverValue)}>
                  {t('page.printers.cupsConnect')}
                </Button>
              </Inline>
              {saveCupsServer.error != null && <ErrorState error={saveCupsServer.error} />}
              {saveCupsServer.result && <Alert tone="success">{t('page.printers.cupsConnected')}</Alert>}
              {cupsServer.error != null && <ErrorState error={cupsServer.error} onRetry={cupsServer.refresh} />}
            </Stack>

            <Divider />

            <Stack gap="sm">
              <Text weight="semibold">{t('page.printers.cupsAdminTitle')}</Text>
              <Text tone="muted" size="label" wrap>{t('page.printers.cupsAdminHint')}</Text>
              <Text tone={adminStatus?.configured ? 'muted' : 'warning'} size="label" wrap>
                {adminStatus?.configured
                  ? t('page.printers.cupsAdminActive').replace('{user}', adminStatus.user ?? '')
                  : t('page.printers.cupsAdminUnset')}
              </Text>
              <Inline gap="sm" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 10rem', minWidth: 0 }}>
                  <FormField label={t('page.printers.cupsAdminUser')}>
                    {(control) => (
                      <Input {...control} value={adminUser} autoComplete="username"
                        onChange={(event) => {
                          saveCupsAdmin.reset();
                          setAdminUser(event.target.value);
                        }} />
                    )}
                  </FormField>
                </div>
                <div style={{ flex: '1 1 10rem', minWidth: 0 }}>
                  <FormField label={t('page.printers.cupsAdminPassword')}>
                    {(control) => (
                      <Input {...control} type="password" value={adminPassword} autoComplete="current-password"
                        onChange={(event) => {
                          saveCupsAdmin.reset();
                          setAdminPassword(event.target.value);
                        }} />
                    )}
                  </FormField>
                </div>
                <Button variant="secondary" busy={saveCupsAdmin.pending}
                  disabled={!adminUser.trim() || !adminPassword}
                  onClick={() => void saveCupsAdmin.run()}>
                  {t('page.printers.cupsAdminSave')}
                </Button>
              </Inline>
              {saveCupsAdmin.error != null && <ErrorState error={saveCupsAdmin.error} />}
              {saveCupsAdmin.result && <Alert tone="success">{t('page.printers.cupsAdminSaved')}</Alert>}
            </Stack>

            <Divider />

            <Stack gap="sm">
              <Text weight="semibold">{t('page.printers.cupsFindTitle')}</Text>
              <Text tone="muted" size="label" wrap>{t('page.printers.cupsFindHint')}</Text>
              <Inline gap="sm" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                  <FormField label={t('page.printers.cupsFindRange')}>
                    {(control) => (
                      <Input {...control} value={scanRange} placeholder="192.168.10.1-192.168.10.60"
                        disabled={scanCupsDevices.pending}
                        onChange={(event) => {
                          scanCupsDevices.reset();
                          setScanRange(event.target.value);
                        }} />
                    )}
                  </FormField>
                </div>
                <Button variant="secondary" busy={scanCupsDevices.pending}
                  disabled={!scanRange.trim() || createCupsQueue.pending}
                  onClick={() => void scanCupsDevices.run(scanRange)}>
                  {t('page.printers.cupsFindAction')}
                </Button>
              </Inline>
              {scanCupsDevices.error != null && <ErrorState error={scanCupsDevices.error} />}
              {foundDevices && foundDevices.length === 0 && (
                <Text tone="muted" wrap>{t('page.printers.cupsFindEmpty')}</Text>
              )}
              {foundDevices && foundDevices.length > 0 && (
                <RecordList>
                  {foundDevices.map((device) => (
                    <RecordCard key={device.host}>
                      <RecordHeader>
                        <Text weight="semibold">{device.makeModel ?? device.info ?? device.host}</Text>
                        <Badge tone={device.driverless ? 'info' : 'warning'}>
                          {device.driverless
                            ? t('page.printers.cupsDeviceDriverless')
                            : t('page.printers.cupsDeviceRaw')}
                        </Badge>
                      </RecordHeader>
                      <Text tone="muted" size="label" wrap>
                        <Mono>{device.host}</Mono> · <Mono wrap>{device.uri}</Mono>
                      </Text>
                      <Inline gap="sm" style={{ alignItems: 'flex-end' }}>
                        <div style={{ flex: '1 1 10rem', minWidth: 0 }}>
                          <FormField label={t('page.printers.cupsDeviceQueue')}>
                            {(control) => (
                              <Input {...control} value={deviceDrafts[device.host] ?? ''}
                                onChange={(event) => {
                                  createCupsQueue.reset();
                                  setDeviceDrafts((current) => ({ ...current, [device.host]: event.target.value }));
                                }} />
                            )}
                          </FormField>
                        </div>
                        <Button busy={createCupsQueue.pending}
                          disabled={!(deviceDrafts[device.host] ?? '').trim()}
                          onClick={() => void createCupsQueue.run({
                            host: device.host,
                            queue: (deviceDrafts[device.host] ?? '').trim(),
                          })}>
                          {t('page.printers.cupsDeviceAdd')}
                        </Button>
                      </Inline>
                    </RecordCard>
                  ))}
                </RecordList>
              )}
              {createCupsQueue.error != null && <ErrorState error={createCupsQueue.error} />}
              {createdQueue && (
                <>
                  <Alert tone={createdQueue.readiness.ready ? 'success' : 'warning'}>
                    {`${t('page.printers.cupsAdded').replace('{queue}', createdQueue.queue)}${
                      readinessMessage(createdQueue.readiness.code)
                        ? ` ${readinessMessage(createdQueue.readiness.code)}`
                        : ''
                    }`}
                  </Alert>
                  {createdQueue.readiness.reasons.length > 0 && (
                    <Alert tone="warning">
                      {t('page.printers.cupsReasons').replace('{reasons}', createdQueue.readiness.reasons.join(', '))}
                    </Alert>
                  )}
                </>
              )}
            </Stack>

            <Divider />

            <Stack gap="sm">
              <Text weight="semibold">{t('page.printers.cupsExistingTitle')}</Text>
              {cupsQueues.loading && <LoadingState />}
              {cupsQueues.error != null && <ErrorState error={cupsQueues.error} onRetry={cupsQueues.refresh} />}
              {cupsQueues.data && cupsQueues.error == null && (availableQueues.length === 0 ? (
                <Text tone="muted" wrap>{t('page.printers.cupsEmpty')}</Text>
              ) : (
                <>
                  <FormField label={t('page.printers.cupsQueue')}>
                    {(control) => (
                      <Select {...control} value={queueName} onChange={(event) => setQueueName(event.target.value)}>
                        <option value="">{t('page.printers.cupsSelect')}</option>
                        {availableQueues.map((queue) => (
                          <option key={queue.name} value={queue.name}>
                            {queue.deviceUri ? `${queue.name} — ${queue.deviceUri}` : queue.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <Inline gap="sm">
                    <Button variant="secondary"
                      disabled={serverChanged || !availableQueues.some((queue) => queue.name === queueName)}
                      busy={importCupsQueue.pending}
                      onClick={() => void importCupsQueue.run(queueName)}>
                      {t('page.printers.cupsImportExisting')}
                    </Button>
                  </Inline>
                </>
              ))}
              {importCupsQueue.error != null && <ErrorState error={importCupsQueue.error} />}
            </Stack>
          </Stack>
        </Dialog>
      )}
      {cupsDialog === 'help' && (
        <Dialog
          open
          title={t('page.printers.cupsHelp')}
          onClose={() => setCupsDialog('connect')}
          footer={<Button onClick={() => setCupsDialog('connect')}>{t('page.printers.cupsHelpBack')}</Button>}
        >
          <Stack as="ol" gap="md">
            <Text as="li" wrap>{t('page.printers.cupsHelpAdd')}</Text>
            <Text as="li" wrap>{t('page.printers.cupsHelpShare')}</Text>
            <Text as="li" wrap>{t('page.printers.cupsHelpAddress')}</Text>
            <Text as="li" wrap>{t('page.printers.cupsHelpRegister')}</Text>
          </Stack>
        </Dialog>
      )}

      {printersResource.loading && !printersResource.data ? (
        <LoadingState />
      ) : printersResource.error != null && !printersResource.data ? (
        <ErrorState
          error={printersResource.error}
          title={t('page.printers.failedToLoad')}
          onRetry={printersResource.refresh}
        />
      ) : (
        <div className="ui-table-card">
          <ResourceToolbar ariaLabel={columns.health}>
            <SearchField
              label={t('page.printers.search')}
              placeholder={t('page.printers.searchPlaceholder')}
              value={search}
              onValueChange={setSearch}
            />
            <SelectFilter
              label={columns.health}
              value={healthFilter}
              onValueChange={(value) => setHealthFilter(value as 'ALL' | 'READY' | 'ATTENTION')}
            >
              <option value="ALL">{t('page.printers.filterAll')} ({printers.length})</option>
              <option value="READY">{t('page.printers.filterReady')} ({readyCount})</option>
              <option value="ATTENTION">{t('page.printers.filterAttention')} ({attentionCount})</option>
            </SelectFilter>
          </ResourceToolbar>
          <DataTable label={t('page.printers.title')} responsive>
          <thead>
            <tr>
              <DataHead>{columns.code}</DataHead>
              <DataHead>{columns.name}</DataHead>
              <DataHead>{columns.location}</DataHead>
              <DataHead>{columns.protocol}</DataHead>
              <DataHead>{columns.status}</DataHead>
              <DataHead>{columns.maxCopies}</DataHead>
              <DataHead>{columns.active}</DataHead>
            </tr>
          </thead>
          <tbody>
            {visiblePrinters.map((p) => (
              <tr key={p.id}>
                <DataCell label={columns.code}>
                  <Link className="ui-link" to={`/printers/${p.id}`}>
                    <Mono weight="semibold">{p.code}</Mono>
                  </Link>
                </DataCell>
                <DataCell label={columns.name}>
                  <Text weight="medium" tone="strong">{p.name}</Text>
                </DataCell>
                <DataCell label={columns.location}>
                  <Text tone="muted">{p.location ?? t('common.noData')}</Text>
                </DataCell>
                <DataCell label={columns.protocol}>
                  <Badge>{p.protocol}</Badge>
                </DataCell>
                {/* The dot colour came from a page-local hex map that
                    DiscoveredPrinters and LocalDiagnostics each duplicated with
                    different values. `StatusIndicator` owns the mapping and
                    always prints the condition as text next to the dot. */}
                <DataCell label={columns.status}>
                  {p.status ? <StatusIndicator condition={p.status.code} /> : <Text tone="muted">{t('common.noData')}</Text>}
                </DataCell>
                <DataCell label={columns.maxCopies}>
                  <Mono nowrap>{p.maxCopiesPerJob ?? t('common.noData')}</Mono>
                </DataCell>
                <DataCell label={columns.active}>
                  <StateBadge
                    value={p.isActive}
                    onLabel={t('status.active')}
                    offLabel={t('status.inactive')}
                  />
                </DataCell>
              </tr>
            ))}
            {visiblePrinters.length === 0 && (
              <TableEmpty columns={7}>
                <EmptyState
                  title={printers.length === 0 ? t('page.printers.noPrinters') : t('page.printers.noMatch')}
                />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>
        </div>
      )}
    </PageLayout>
  );
}
