import { useState } from 'react';
import { ActionIcon } from '../../../components/ActionIcon.js';
import {
  Badge,
  Button,
  CardDetail,
  CardDetailItem,
  Checkbox,
  CodeBlock,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  Inline,
  Mono,
  Stack,
  StateBadge,
  Text,
} from '../../../components/ui/index.js';
import { curlExample, intakeUrl } from '../model.js';
import type { ImportCandidate } from '../types.js';
import type { WebhookWorkspaceController } from '../useWebhookWorkspace.js';

export function WebhookDialogs({ controller }: { controller: WebhookWorkspaceController }) {
  const {
    t,
    policies,
    busy,
    detailsEndpoint,
    setDetailsEndpoint,
    testCallback,
    pendingDelete,
    setPendingDelete,
    confirmDelete,
    batchDeleteOpen,
    setBatchDeleteOpen,
    selectedEndpoints,
    confirmBatchDelete,
    importCandidates,
    setImportCandidates,
    overwriteExisting,
    setOverwriteExisting,
    confirmImport,
    selectedAttempt,
    setSelectedAttempt,
  } = controller;
  const [copied, setCopied] = useState(false);

  const translateCandidateStatus = (candidate: ImportCandidate) => {
    if (candidate.status === 'new') return t('page.webhooks.importStatusNew');
    if (candidate.status === 'existing') return t('page.webhooks.importStatusExisting');
    return t('page.webhooks.importStatusInvalid');
  };

  const detailsPolicy = detailsEndpoint
    ? policies.find((policy) => policy.id === detailsEndpoint.routePolicyId)
    : undefined;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const detailsUrl = detailsEndpoint ? intakeUrl(origin, detailsEndpoint.endpointCode) : '';

  const copyUrl = async () => {
    if (!detailsUrl) return;
    await navigator.clipboard.writeText(detailsUrl);
    setCopied(true);
  };

  return (
    <>
      <Dialog
        open={detailsEndpoint != null}
        onClose={() => {
          setDetailsEndpoint(null);
          setCopied(false);
        }}
        title={t('page.webhooks.endpointDetailTitle').replace('{code}', detailsEndpoint?.endpointCode ?? '')}
        footer={
          <>
            <Button variant="secondary" onClick={() => detailsEndpoint && void testCallback(detailsEndpoint)}>
              <ActionIcon name="play" /> {t('page.webhooks.testSavedEndpoint')}
            </Button>
            <Button onClick={() => setDetailsEndpoint(null)}>{t('common.close')}</Button>
          </>
        }
      >
        {detailsEndpoint && (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="label" tone="muted">{t('page.webhooks.detailsIntakeUrl')}</Text>
              <CodeBlock label={t('page.webhooks.detailsIntakeUrl')}>{detailsUrl}</CodeBlock>
              <Inline gap="sm">
                <Button variant="secondary" size="sm" onClick={() => void copyUrl()}>
                  <ActionIcon name="copy" /> {t('page.webhooks.copyIntakeUrl')}
                </Button>
                {copied && (
                  <Text size="label" tone="success" aria-live="polite">
                    {t('page.webhooks.copySuccess')}
                  </Text>
                )}
              </Inline>
            </Stack>

            <Stack gap="xs">
              <Text size="label" tone="muted">{t('page.webhooks.curlExampleLabel')}</Text>
              <CodeBlock label={t('page.webhooks.curlExampleLabel')}>
                {curlExample(origin, detailsEndpoint.endpointCode)}
              </CodeBlock>
            </Stack>

            <CardDetail>
              <CardDetailItem label={t('page.webhooks.source')}>
                {detailsEndpoint.sourceSystem || 'integration-service'}
              </CardDetailItem>
              <CardDetailItem label={t('page.webhooks.authModeLabel')}>
                <Mono>{detailsEndpoint.authMode || 'NONE'}</Mono>
              </CardDetailItem>
              <CardDetailItem label={t('page.webhooks.routePolicy')}>
                {detailsPolicy
                  ? `${detailsPolicy.policyCode} — ${detailsPolicy.name}`
                  : detailsEndpoint.routePolicyId || '—'}
              </CardDetailItem>
              <CardDetailItem label={t('page.webhooks.statusLabelColon')}>
                <StateBadge
                  value={detailsEndpoint.enabled}
                  onLabel={t('page.webhooks.statusEnabled')}
                  offLabel={t('page.webhooks.statusDraft')}
                />
              </CardDetailItem>
              <CardDetailItem label={t('page.webhooks.callbackTrigger')}>
                {detailsEndpoint.callbackOnPrintResult
                  ? t('page.webhooks.callbackTriggerTerminal')
                  : t('page.webhooks.callbackTriggerAcceptance')}
              </CardDetailItem>
              <CardDetailItem label={t('page.webhooks.callbackTransport')}>
                <Badge tone={detailsEndpoint.callbackTransport === 'NONE' ? 'neutral' : 'info'}>
                  {detailsEndpoint.callbackTransport === 'NONE'
                    ? t('page.webhooks.transport.none')
                    : detailsEndpoint.callbackTransport}
                </Badge>
              </CardDetailItem>
              {detailsEndpoint.callbackUrl && (
                <CardDetailItem label={t('page.webhooks.callbackTarget')}>
                  <Mono className="webhook-bounded-code">{detailsEndpoint.callbackUrl}</Mono>
                </CardDetailItem>
              )}
              {detailsEndpoint.callbackNatsSubject && (
                <CardDetailItem label={t('page.webhooks.detailsNatsSubject')}>
                  <Mono className="webhook-bounded-code">{detailsEndpoint.callbackNatsSubject}</Mono>
                </CardDetailItem>
              )}
            </CardDetail>
          </Stack>
        )}
      </Dialog>

      <Dialog
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        dismissOnBackdrop={false}
        title={t('page.webhooks.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" busy={busy} onClick={() => void confirmDelete()}>
              <ActionIcon name="delete" /> {t('page.webhooks.deleteTitle')}
            </Button>
          </>
        }
      >
        {pendingDelete && (
          <Stack gap="md">
            <Text>{t('page.webhooks.confirmDeleteBody')}</Text>
            <Mono weight="semibold">{pendingDelete.endpointCode}</Mono>
            <Text tone="danger">{t('page.webhooks.deleteImpact')}</Text>
          </Stack>
        )}
      </Dialog>

      <Dialog
        open={batchDeleteOpen}
        onClose={() => setBatchDeleteOpen(false)}
        dismissOnBackdrop={false}
        title={t('page.webhooks.batchDeleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBatchDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" busy={busy} onClick={() => void confirmBatchDelete()}>
              <ActionIcon name="delete" />{' '}
              {t('page.webhooks.batchDeleteConfirm').replace('{n}', String(selectedEndpoints.length))}
            </Button>
          </>
        }
      >
        <Stack gap="md">
          <Text>
            {t('page.webhooks.batchDeleteBody').replace('{n}', String(selectedEndpoints.length))}
          </Text>
          <div className="webhook-dialog-code-list" tabIndex={0}>
            {selectedEndpoints.map((endpoint) => (
              <Mono key={endpoint.id}>{endpoint.endpointCode}</Mono>
            ))}
          </div>
        </Stack>
      </Dialog>

      <Dialog
        open={importCandidates != null}
        onClose={() => setImportCandidates(null)}
        title={t('page.webhooks.importPreviewTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportCandidates(null)}>
              {t('common.cancel')}
            </Button>
            <Button busy={busy} onClick={() => void confirmImport()}>
              {t('page.webhooks.importApply')}
            </Button>
          </>
        }
      >
        {importCandidates && (
          <Stack gap="lg">
            <Text tone="muted">{t('page.webhooks.importPreviewDescription')}</Text>
            <DataTable label={t('page.webhooks.importPreviewTitle')} responsive>
              <thead>
                <tr>
                  <DataHead>{t('page.webhooks.colEndpointCode')}</DataHead>
                  <DataHead>{t('page.webhooks.name')}</DataHead>
                  <DataHead>{t('page.webhooks.colExistingStatus')}</DataHead>
                  <DataHead>{t('page.webhooks.errorDetail')}</DataHead>
                </tr>
              </thead>
              <tbody>
                {importCandidates.map((candidate, index) => (
                  <tr key={`${candidate.endpointCode}-${index}`}>
                    <DataCell label={t('page.webhooks.colEndpointCode')}>
                      <Mono>{candidate.endpointCode}</Mono>
                    </DataCell>
                    <DataCell label={t('page.webhooks.name')}>
                      {candidate.endpoint.name || '—'}
                    </DataCell>
                    <DataCell label={t('page.webhooks.colExistingStatus')}>
                      <Badge
                        tone={candidate.status === 'invalid'
                          ? 'danger'
                          : candidate.status === 'existing'
                            ? 'warning'
                            : 'success'}
                      >
                        {translateCandidateStatus(candidate)}
                      </Badge>
                    </DataCell>
                    <DataCell label={t('page.webhooks.errorDetail')}>
                      {candidate.errors.length > 0 ? candidate.errors.map(t).join(', ') : '—'}
                    </DataCell>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Checkbox
              label={t('page.webhooks.overwriteExisting')}
              checked={overwriteExisting}
              onChange={(event) => setOverwriteExisting(event.target.checked)}
            />
          </Stack>
        )}
      </Dialog>

      <Dialog
        open={selectedAttempt != null}
        onClose={() => setSelectedAttempt(null)}
        title={t('page.webhooks.deliveryDetailTitle')}
        footer={<Button onClick={() => setSelectedAttempt(null)}>{t('common.close')}</Button>}
      >
        {selectedAttempt && (
          <CardDetail>
            <CardDetailItem label={t('page.webhooks.endpoint')}>
              <Mono>{selectedAttempt.endpointCode}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('page.webhooks.colChannel')}>
              <Badge>{selectedAttempt.transport}</Badge>
            </CardDetailItem>
            <CardDetailItem label={t('page.webhooks.colTrigger')}>
              {selectedAttempt.trigger === 'test'
                ? t('page.webhooks.triggerTest')
                : t('page.webhooks.triggerLive')}
            </CardDetailItem>
            <CardDetailItem label={t('page.webhooks.colOutcome')}>
              <Badge
                tone={selectedAttempt.outcome === 'success'
                  ? 'success'
                  : selectedAttempt.outcome === 'failed'
                    ? 'danger'
                    : 'neutral'}
              >
                {selectedAttempt.outcome === 'success'
                  ? t('page.webhooks.outcomeSuccess')
                  : selectedAttempt.outcome === 'failed'
                    ? t('page.webhooks.outcomeFailed')
                    : t('page.webhooks.outcomeSkipped')}
              </Badge>
            </CardDetailItem>
            <CardDetailItem label={t('page.webhooks.colHttpStatus')}>
              <Mono>{selectedAttempt.httpStatus ?? '—'}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('page.webhooks.colDuration')}>
              <Mono>{selectedAttempt.durationMs} ms</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('page.webhooks.target')}>
              <Mono className="webhook-bounded-code">{selectedAttempt.target || '—'}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('page.webhooks.errorDetail')}>
              <Text tone={selectedAttempt.errorMessage ? 'danger' : 'muted'}>
                {selectedAttempt.errorMessage || '—'}
              </Text>
            </CardDetailItem>
          </CardDetail>
        )}
      </Dialog>
    </>
  );
}
