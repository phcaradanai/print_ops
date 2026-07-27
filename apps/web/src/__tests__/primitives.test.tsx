import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { FormField } from '../components/FormField.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { LocaleProvider } from '../i18n/index.js';
import { STATUS_BADGE, STATUS_BADGE_FALLBACK } from '../statusColors.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { t } from '../i18n/translations.js';

function render(node: ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
}

describe('Button', () => {
  it('defaults to type=button so it cannot submit a surrounding form by accident', () => {
    expect(render(<Button>Save</Button>)).toContain('type="button"');
  });

  it('blocks further clicks while busy and exposes the state to assistive tech', () => {
    const html = render(
      <Button busy busyLabel="Submitting…">
        Confirm reprint
      </Button>,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Submitting…');
    expect(html).not.toContain('Confirm reprint');
  });
});

describe('Alert', () => {
  it('is assertive for problems and polite for confirmations', () => {
    expect(render(<Alert tone="error">boom</Alert>)).toContain('role="alert"');
    expect(render(<Alert tone="warning">careful</Alert>)).toContain('role="alert"');
    expect(render(<Alert tone="success">done</Alert>)).toContain('role="status"');
    expect(render(<Alert tone="info">fyi</Alert>)).toContain('role="status"');
  });
});

describe('StatusBadge', () => {
  it('uses the audited palette, never a page-local one', () => {
    const html = render(<StatusBadge status="FAILED" />);
    expect(html).toContain(STATUS_BADGE.FAILED!.bg);
    expect(html).toContain(STATUS_BADGE.FAILED!.text);
    expect(html).toContain('FAILED');
  });

  it('renders an unknown status with the neutral fallback instead of crashing', () => {
    const html = render(<StatusBadge status="SOMETHING_NEW" />);
    expect(html).toContain(STATUS_BADGE_FALLBACK.bg);
    expect(html).toContain('SOMETHING_NEW');
  });

  it('never re-labels a status — the server string is shown verbatim', () => {
    for (const status of Object.keys(STATUS_BADGE)) {
      expect(render(<StatusBadge status={status} />)).toContain(`>${status}<`);
    }
  });
});

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    expect(render(<Dialog open={false} onClose={() => {}} title="Reprint">body</Dialog>)).toBe('');
  });

  it('labels itself by its title and marks the warning as an alert', () => {
    const html = render(
      <Dialog open onClose={() => {}} title="Confirm additional physical copy" warning="This creates a new print job.">
        body
      </Dialog>,
    );
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('Confirm additional physical copy');
    expect(html).toContain('role="alert"');
  });
});

describe('FormField', () => {
  it('wires label, hint and error to the control', () => {
    const html = render(
      <FormField label="Reason for reprint" hint="Recorded in the audit log" error="Required">
        {(control) => <textarea {...control} />}
      </FormField>,
    );
    // One generated id, referenced by htmlFor and by the control.
    const forMatch = html.match(/for="([^"]+)"/);
    expect(forMatch).not.toBeNull();
    const id = forMatch![1]!;
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-hint ${id}-error"`);
    expect(html).toContain('aria-invalid="true"');
  });

  it('leaves a valid field without aria-invalid', () => {
    const html = render(
      <FormField label="Copies">{(control) => <input {...control} type="number" />}</FormField>,
    );
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
  });
});

describe('formatRelativeTime', () => {
  const translate = (key: string) => t('en', key);

  it('formats seconds, minutes and hours from the shared keys', () => {
    const now = 10_000_000;
    expect(formatRelativeTime(translate, now - 5_000, now)).toContain('5');
    expect(formatRelativeTime(translate, now - 300_000, now)).toContain('5');
    expect(formatRelativeTime(translate, now - 7_200_000, now)).toContain('2');
  });

  it('reports never for a missing timestamp', () => {
    expect(formatRelativeTime(translate, null)).toBe(t('en', 'status.never'));
    expect(formatRelativeTime(translate, undefined)).toBe(t('en', 'status.never'));
    expect(formatRelativeTime(translate, 'not-a-date')).toBe(t('en', 'status.never'));
  });

  it('never renders a negative age when the workstation clock is behind', () => {
    const now = 1_000;
    expect(formatRelativeTime(translate, now + 60_000, now)).toBe(
      t('en', 'status.secondsAgo').replace('{n}', '0'),
    );
  });
});
