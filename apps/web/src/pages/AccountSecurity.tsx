import { useState } from 'react';
import { errorMessage } from '../api/errors.js';
import { issuePasswordRecoveryCode } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { Alert, Button, CodeBlock, PageLayout, Panel, Stack, Text } from '../components/ui/index.js';

export default function AccountSecurity() {
  const { t } = useLocale();
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generateRecoveryCode() {
    setGenerating(true);
    setError(null);
    setCopyMessage(null);
    try {
      const result = await issuePasswordRecoveryCode();
      setRecoveryCode(result.recoveryCode);
    } catch (cause) {
      setError(errorMessage(cause, t('recovery.resetError')));
    } finally {
      setGenerating(false);
    }
  }

  async function copyRecoveryCode() {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopyMessage(t('recovery.copied'));
    } catch {
      setCopyMessage(t('recovery.copyFailed'));
    }
  }

  return (
    <PageLayout
      width="standard"
      title={t('recovery.manageTitle')}
      description={t('recovery.manageDescription')}
    >
      <Panel>
          <Stack gap="lg">
            <Text as="p">{t('recovery.codeStore')}</Text>
            <Text as="p" tone="muted">{t('recovery.noCodeHelp')}</Text>
            {error && <Alert tone="error">{error}</Alert>}
            {recoveryCode && (
              <>
                <CodeBlock label={t('recovery.generated')} scroll={false}>{recoveryCode}</CodeBlock>
                <Text as="p" role="status">{t('recovery.generated')}</Text>
                <Button type="button" variant="ghost" onClick={() => void copyRecoveryCode()}>
                  {t('recovery.copy')}
                </Button>
                {copyMessage && <Text as="p" role="status">{copyMessage}</Text>}
              </>
            )}
            <Button type="button" disabled={generating} busy={generating} onClick={() => void generateRecoveryCode()}>
              {generating ? t('recovery.generating') : recoveryCode ? t('recovery.regenerate') : t('recovery.generate')}
            </Button>
          </Stack>
      </Panel>
    </PageLayout>
  );
}
