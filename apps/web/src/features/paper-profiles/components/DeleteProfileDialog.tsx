import { Button, Dialog, Inline, Mono, Stack, Text } from '../../../components/ui/index.js';
import type { PaperProfilePersistence } from '../hooks/usePaperProfilePersistence.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function DeleteProfileDialog({ persistence, t }: {
  persistence: PaperProfilePersistence;
  t: Translate;
}) {
  const profile = persistence.pendingDeleteProfile;

  return (
    <Dialog
      open={Boolean(profile)}
      onClose={persistence.cancelDelete}
      title={t('page.paperProfiles.deleteProfile')}
      closeLabel={t('common.cancel')}
      // Destructive: an incidental backdrop click must not dismiss the
      // confirmation, and neither path is available mid-delete.
      dismissOnBackdrop={false}
      footer={
        <Inline gap="sm">
          <Button
            variant="secondary"
            onClick={persistence.cancelDelete}
            disabled={persistence.deletePending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void persistence.confirmDelete()}
            busy={persistence.deletePending}
            busyLabel={t('page.paperProfiles.deleteProfile')}
          >
            <PaperProfileIcon name="trash" /> {t('page.paperProfiles.deleteProfile')}
          </Button>
        </Inline>
      }
    >
      <Stack gap="sm">
        <Text>{t('page.paperProfiles.confirmDelete').replace('{code}', profile?.code ?? '')}</Text>
        <Mono wrap>{profile?.code ?? ''}</Mono>
      </Stack>
    </Dialog>
  );
}
