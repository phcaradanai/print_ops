/**
 * Reprint confirmation, usable from any page that holds a full job.
 *
 * Lifted out of `JobQueue` so the decision can happen where the evidence is —
 * on the job's own page — instead of forcing an operator back to the list.
 * The safety semantics are carried over unchanged and are not negotiable:
 * submit stays blocked without an explicit duplicate-risk acknowledgement, a
 * reason, a runner id and the original request id, and the request body is
 * still `{ printerId, copies, reason, confirmedDuplicateRisk }`.
 *
 * Strings intentionally reuse the existing `page.jobQueue.reprint*` keys. It is
 * the same dialog saying the same things; duplicating twenty already-translated
 * strings under a second namespace would only create drift between two copies
 * of a safety warning.
 *
 * What is new: when the job's outcome is genuinely unknown (`UNVERIFIED`,
 * `TIMEOUT`), the duplicate warning leads with that fact rather than the
 * generic "output may already have occurred". Those are the jobs where a
 * second physical label is a live risk rather than a formality.
 */

import { useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '../api/client.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { getJobVerdict } from '../lib/jobVerdict.js';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';
import { FormField } from './FormField.js';
import { StatusBadge } from './StatusBadge.js';

/** The fields a safe reprint needs. A partial job cannot be reprinted. */
export interface ReprintableJob {
  id: string;
  status: string;
  copies: number;
  printerId: string;
  printerCode?: string;
  requestId?: string;
  runnerId?: string;
  completedAt?: string;
}

export interface ReprintDialogProps {
  job: ReprintableJob | null;
  open: boolean;
  onClose: () => void;
  /** Called with the newly created job once the reprint is accepted. */
  onSuccess: (newJobId: string) => void;
  onError: (message: string) => void;
  t: (key: string) => string;
}

export function ReprintDialog({ job, open, onClose, onSuccess, onError, t }: ReprintDialogProps) {
  const [copies, setCopies] = useState(1);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset per job, not per open: reopening the dialog for the SAME job after a
  // failed submit should not silently clear a reason the operator just typed,
  // but switching jobs must never carry an acknowledgement across.
  useEffect(() => {
    if (!job) return;
    setCopies(job.copies || 1);
    setReason('');
    setAcknowledged(false);
  }, [job?.id]);

  const submit = useApiAction(async (target: ReprintableJob) => {
    return apiFetch<{ id: string }>(`/jobs/${target.id}/reprint`, {
      method: 'POST',
      body: JSON.stringify({
        printerId: target.printerId,
        copies,
        reason,
        confirmedDuplicateRisk: acknowledged,
      }),
    });
  });

  if (!job) return null;

  const verdict = getJobVerdict(job.status);
  // Identity the server will demand. Checked here so the operator learns the
  // reprint is impossible before filling in a reason, not after.
  const identityComplete = Boolean(job.requestId) && Boolean(job.runnerId);

  const confirm = async () => {
    const created = await submit.run(job);
    if (created) {
      onSuccess(created.id);
      onClose();
    } else {
      onError(`${t('page.jobQueue.reprintFailed')} ${errorMessage(submit.getError())}`);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('page.jobQueue.reprintTitle')}
      warning={
        verdict.outcomeUnknown
          ? t('page.jobDetail.verdict.' + verdict.copyKey + '.detail')
          : t('page.jobQueue.reprintWarning')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            form="reprint-form"
            type="submit"
            busy={submit.pending}
            busyLabel={t('page.jobQueue.reprintSubmitting')}
            disabled={!acknowledged || !reason.trim() || !identityComplete}
          >
            {t('page.jobQueue.reprintConfirm')}
          </Button>
        </>
      }
    >
      <form
        id="reprint-form"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <dl className="reprint-facts">
          <dt>{t('page.jobQueue.reprintOriginalRequestId')}</dt>
          <dd><code>{job.requestId ?? t('page.jobQueue.reprintBlockedMissing')}</code></dd>
          <dt>{t('page.jobQueue.reprintOriginalJobId')}</dt>
          <dd><code>{job.id}</code></dd>
          <dt>{t('page.jobQueue.reprintPrintStatus')}</dt>
          <dd><StatusBadge status={job.status} size="sm" /></dd>
          <dt>{t('page.jobQueue.reprintDestination')}</dt>
          <dd>{job.printerCode ?? job.printerId}</dd>
          <dt>{t('page.jobQueue.reprintRunner')}</dt>
          <dd>{job.runnerId ?? t('page.jobQueue.reprintBlockedUnknown')}</dd>
          <dt>{t('page.jobQueue.reprintCompletedAt')}</dt>
          <dd>
            {job.completedAt
              ? new Date(job.completedAt).toLocaleString()
              : t('page.jobQueue.reprintNotRecorded')}
          </dd>
          <dt>{t('page.jobQueue.reprintRunnerAck')}</dt>
          <dd>
            {job.runnerId && job.completedAt
              ? t('page.jobQueue.reprintAckYes')
              : t('page.jobQueue.reprintAckUnknown')}
          </dd>
          <dt>{t('page.jobQueue.reprintCallbackDelivery')}</dt>
          <dd>{t('page.jobQueue.reprintCallbackNote')}</dd>
        </dl>

        <FormField
          label={t('page.jobQueue.reprintCopies')}
          required
          requiredLabel={t('common.required')}
        >
          {(control) => (
            <input
              {...control}
              type="number"
              min={1}
              step={1}
              value={copies}
              onChange={(event) => setCopies(Number(event.target.value))}
              required
            />
          )}
        </FormField>

        <FormField
          label={t('page.jobQueue.reprintReason')}
          required
          requiredLabel={t('common.required')}
        >
          {(control) => (
            <textarea
              {...control}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          )}
        </FormField>

        <label className="reprint-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {t('page.jobQueue.reprintAcknowledge')}
        </label>
      </form>
    </Dialog>
  );
}
