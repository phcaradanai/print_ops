import { useRef } from 'react';
import { ActionIcon } from '../../components/ActionIcon.js';
import {
  Alert,
  Button,
  ErrorBanner,
  Freshness,
  Inline,
  LoadingState,
  PageLayout,
  Stack,
  Tab,
  TabList,
  Text,
} from '../../components/ui/index.js';
import { CallbackDeliveryLog } from './components/CallbackDeliveryLog.js';
import { EndpointEditor } from './components/EndpointEditor.js';
import { EndpointList } from './components/EndpointList.js';
import { WebhookDialogs } from './components/WebhookDialogs.js';
import { useWebhookWorkspace } from './useWebhookWorkspace.js';
import './webhooks.css';
import './webhooks.mobile.css';

export default function WebhookWorkspace() {
  const controller = useWebhookWorkspace();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    t,
    view,
    setView,
    feedback,
    setFeedback,
    endpointsResource,
    policiesResource,
    callbackLogResource,
    refreshEndpoints,
    openCreate,
    prepareImport,
  } = controller;

  const openHistoryEvidence = (logEntryId?: string) => {
    setView('history');
    setFeedback(null);
    if (!logEntryId) return;
    requestAnimationFrame(() => {
      document.getElementById(`callback-attempt-${logEntryId}`)?.scrollIntoView({ block: 'center' });
    });
  };

  const headerActions = (
    <Inline gap="sm" className="webhook-page-actions">
      <Freshness
        lastSuccessAt={endpointsResource.lastSuccessAt}
        stale={endpointsResource.stale}
        refreshing={endpointsResource.refreshing}
        onRefresh={refreshEndpoints}
      />
      {view !== 'editor' && (
        <Button onClick={openCreate}>
          <ActionIcon name="plus" /> {t('page.webhooks.createEndpoint')}
        </Button>
      )}
    </Inline>
  );

  return (
    <PageLayout
      width="wide"
      title={t('page.webhooks.title')}
      description={t('page.webhooks.subtitle')}
      actions={headerActions}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="ui-visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void prepareImport(file);
        }}
      />

      {feedback && (
        <Alert
          tone={feedback.tone === 'error' || feedback.tone === 'warning'
            ? 'error'
            : feedback.tone === 'success'
              ? 'success'
              : 'info'}
          onDismiss={() => setFeedback(null)}
          dismissLabel={t('common.close')}
        >
          <Stack gap="sm">
            <Text>{feedback.text}</Text>
            {feedback.details && feedback.details.length > 0 && (
              <ul className="webhook-feedback-details">
                {feedback.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}
              </ul>
            )}
            {feedback.logEntryId && (
              <Inline gap="sm">
                <Button variant="secondary" size="sm" onClick={() => openHistoryEvidence(feedback.logEntryId)}>
                  {t('page.webhooks.openDeliveryHistory')}
                </Button>
              </Inline>
            )}
          </Stack>
        </Alert>
      )}

      {view !== 'editor' && (
        <TabList label={t('page.webhooks.title')}>
          <Tab selected={view === 'endpoints'} onClick={() => setView('endpoints')}>
            {t('page.webhooks.viewEndpoints')}
          </Tab>
          <Tab selected={view === 'history'} onClick={() => setView('history')}>
            {t('page.webhooks.viewHistory')}
          </Tab>
        </TabList>
      )}

      {view === 'endpoints' && endpointsResource.error != null && (
        <ErrorBanner
          error={endpointsResource.error}
          title={t('page.webhooks.toastLoadFailed')}
          onRetry={endpointsResource.refresh}
        />
      )}

      {view === 'editor' && policiesResource.error != null && (
        <ErrorBanner
          error={policiesResource.error}
          title={t('page.webhooks.policiesLoadFailed')}
          onRetry={policiesResource.refresh}
        />
      )}

      {view === 'history' && callbackLogResource.error != null && (
        <ErrorBanner
          error={callbackLogResource.error}
          title={t('page.webhooks.callbackLogLoadFailed')}
          onRetry={callbackLogResource.refresh}
        />
      )}

      {view === 'endpoints' && endpointsResource.loading && endpointsResource.data == null ? (
        <LoadingState />
      ) : view === 'editor' ? (
        <EndpointEditor controller={controller} />
      ) : view === 'history' ? (
        <CallbackDeliveryLog controller={controller} />
      ) : (
        <EndpointList controller={controller} onImportRequested={() => fileInputRef.current?.click()} />
      )}

      <WebhookDialogs controller={controller} />
    </PageLayout>
  );
}
