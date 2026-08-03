import { Button, Dialog, Inline, Mono, Stack, Text } from '../../../components/ui/index.js';
import type { Translate } from './types.js';

export function UnsavedChangesDialog({ open, profileCode, onContinue, onDiscard, t }: {
  open: boolean;
  profileCode: string;
  onContinue: () => void;
  onDiscard: () => void;
  t: Translate;
}) {
  return (
    <Dialog
      open={open}
      onClose={onContinue}
      title={t('page.paperProfiles.unsavedTitle')}
      closeLabel={t('common.close')}
      // Losing unsaved work to a stray backdrop click is exactly what this
      // dialog exists to prevent, so dismissal has to be deliberate.
      dismissOnBackdrop={false}
      footer={
        <Inline gap="sm">
          <Button variant="secondary" onClick={onContinue}>
            {t('page.paperProfiles.continueEditing')}
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            {t('page.paperProfiles.discardChanges')}
          </Button>
        </Inline>
      }
    >
      <Stack gap="sm">
        <Text>{t('page.paperProfiles.unsavedBody').replace('{code}', profileCode)}</Text>
        <Mono wrap>{profileCode}</Mono>
      </Stack>
    </Dialog>
  );
}
