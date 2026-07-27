/**
 * Shared inline message (FE-01.1).
 *
 * `JobQueue`, `Settings`, `PrintFlowBindings`, `Templates` and `Webhooks` each
 * hand-rolled the same coloured strip with hardcoded `#fee2e2` / `#dcfce7`
 * pairs and no `role`, so a screen reader announced none of them. `Alert` is
 * the single implementation; `ErrorBanner` in `PageState.tsx` is a thin wrapper
 * over it for the `ApiError` case, so there is exactly one visual language for
 * "something needs your attention".
 *
 * `role` follows severity: errors and warnings are assertive `alert`s, success
 * and info are polite `status` regions — an operator should not have a routine
 * confirmation interrupt whatever they are reading.
 */

import type { ReactNode } from 'react';
import { Button } from './Button.js';

export type AlertTone = 'error' | 'warning' | 'success' | 'info';

export interface AlertProps {
  tone?: AlertTone;
  /** Bold first line. Omit for a single-line message. */
  title?: ReactNode;
  children?: ReactNode;
  /** Extra content under the message (technical details, links). */
  footer?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  dismissLabel?: string;
}

export function Alert({
  tone = 'info',
  title,
  children,
  footer,
  onRetry,
  retryLabel,
  onDismiss,
  dismissLabel,
}: AlertProps) {
  const assertive = tone === 'error' || tone === 'warning';
  return (
    <div className={`ui-alert ui-alert--${tone}`} role={assertive ? 'alert' : 'status'}>
      <div className="ui-alert-body">
        {title && <span className="ui-alert-title">{title}</span>}
        {children && <span className="ui-alert-message">{children}</span>}
        {footer}
      </div>
      <div className="ui-alert-actions">
        {onRetry && retryLabel && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="ui-alert-dismiss"
            aria-label={dismissLabel}
            onClick={onDismiss}
          >
            {'✕'}
          </button>
        )}
      </div>
    </div>
  );
}
