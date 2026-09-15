import { useRef } from 'react';
import { useLocale } from '../../i18n/index.js';
import { useTemplateWorkspace, TemplateWorkspaceProvider } from './hooks/useTemplateWorkspace.js';
import {
  Alert, Button, Dialog, ErrorBanner, Freshness,
  Input, PageLayout, Stack, Text, Mono, Inline, WorkspaceSplit
} from '../../components/ui/index.js';
import { TransferIcon } from '../../components/TransferIcon.js';
import { TemplateIcon } from './components/TemplateIcon.js';
import { TemplateLibrary } from './components/TemplateLibrary.js';
import { TemplateEditor } from './components/TemplateEditor.js';
import { TemplatePreview } from './components/TemplatePreview.js';
import { sanitizePreviewHtml } from '../../lib/previewHtml.js';

export function TemplateWorkspaceInner() {
  const { t } = useLocale();
  const {
    workspaceOpen, busy, message, setMessage, templatesResource, profilesResource,
    search, setSearch, exportTemplates, importTemplates, newTemplate, requestCloseWorkspace,
    editingId, form, confirmDiscard, setConfirmDiscard, closeWorkspace, pendingDelete, setPendingDelete,
    confirmDelete, fullPage, setFullPage, previewHtml
  } = useTemplateWorkspace();

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const actions = (
    <Inline gap="sm" className="tpl-page-tools justify-start">
      {!workspaceOpen ? (
        <>
          <Input
            type="search"
            controlSize="sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('page.templates.searchPlaceholder')}
            aria-label={t('page.templates.searchPlaceholder')}
            leading={<TemplateIcon name="search" />}
          />
          <Button variant="ghost" onClick={exportTemplates}>
            <TransferIcon action="export" /> {t('page.templates.exportBtn')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => importInputRef.current?.click()}
            busy={busy}
            busyLabel={t('page.templates.importing')}
          >
            <TransferIcon action="import" /> {t('page.templates.importBtn')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="tpl-file-input ui-visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importTemplates(file);
            }}
          />
          <Button onClick={newTemplate}>
            <TemplateIcon name="plus" /> {t('page.templates.newTemplate')}
          </Button>
        </>
      ) : (<Inline gap="sm">
        <Button variant="ghost" onClick={requestCloseWorkspace}>
          <TemplateIcon name="back" /> {t('page.templates.backToLibrary')}
        </Button>
        <Text weight="semibold">{editingId ? form.templateCode : t('page.templates.newTemplate')}</Text>
      </Inline>)}
    </Inline>

  );

  return (
    <PageLayout
      className="templates-page"
      width="full"
      title={t('page.templates.title')}
      description={t('page.templates.subtitle')}
      actions={<Freshness
        lastSuccessAt={templatesResource.lastSuccessAt}
        stale={templatesResource.stale}
        refreshing={templatesResource.refreshing}
        onRefresh={templatesResource.refresh}
      />}
    >
      {message && (
        <Alert
          tone={message.tone === 'ok' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('common.close')}
        >
          {message.text}
        </Alert>
      )}

      {templatesResource.error != null && (
        <ErrorBanner
          error={templatesResource.error}
          title={t('page.templates.loadFailed')}
          onRetry={templatesResource.refresh}
        />
      )}

      {profilesResource.error != null && (
        <ErrorBanner
          error={profilesResource.error}
          title={t('page.templates.profilesLoadFailed')}
          onRetry={profilesResource.refresh}
        />
      )}
      {actions}
      {workspaceOpen ? (
        <Stack gap="md">

          <WorkspaceSplit ratio="aside-preview" aside={<TemplatePreview />}>
            <TemplateEditor />
          </WorkspaceSplit>
        </Stack>
      ) : (
        <TemplateLibrary />
      )}

      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title={t('page.templates.unsavedTitle')}
        footer={
          <Inline gap="sm">
            <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
              {t('page.templates.keepEditing')}
            </Button>
            <Button variant="danger" onClick={closeWorkspace}>
              {t('page.templates.discardBtn')}
            </Button>
          </Inline>
        }
      >
        <Text>{t('page.templates.unsavedMessage')}</Text>
      </Dialog>

      <Dialog
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        title={t('page.templates.deleteTitle')}
        footer={
          <Inline gap="sm">
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              {t('common.delete')}
            </Button>
          </Inline>
        }
      >
        <Text>
          {t('page.templates.deleteMessage').replace('{code}', pendingDelete?.templateCode ?? '')}
        </Text>
      </Dialog>

      <Dialog
        open={fullPage}
        onClose={() => setFullPage(false)}
        title={t('page.templates.previewDialogTitle')}
        footer={
          <Button variant="secondary" onClick={() => setFullPage(false)}>
            {t('common.close')}
          </Button>
        }
      >
        {previewHtml ? (
          <div
            className="tpl-full-preview-container"
            dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(previewHtml) }}
          />
        ) : (
          <Text tone="muted">{t('page.templates.noPreviewAvailable')}</Text>
        )}
      </Dialog>
    </PageLayout>
  );
}

export default function TemplateWorkspace() {
  return (
    <TemplateWorkspaceProvider>
      <TemplateWorkspaceInner />
    </TemplateWorkspaceProvider>
  );
}
