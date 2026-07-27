import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { getStatusBadgeColors } from '../statusColors.js';
import { EmptyState, ErrorBanner, LoadingState } from '../components/PageState.js';

interface Job {
  id: string;
  printerCode?: string;
  printerId: string;
  status: string;
  copies: number;
  priorityLabel?: string;
  sourceSystem?: string;
  sourceReference?: string;
  requestId?: string;
  templateCode?: string;
  resolvedTemplateCode?: string;
  paperProfileId?: string;
  payloadSnapshot?: string;
  mimeType?: string;
  latency?: { totalLatencyMs?: number };
  createdAt: string;
  completedAt?: string;
  runnerId?: string;
  metadata?: Record<string, unknown>;
}

/** Extract a short human hint about what was printed from payloadSnapshot.
 *  Snapshot format is "keys=[a,b,c] len=123" — surface the keys so an operator
 *  scanning the queue can tell a label apart from a prescription at a glance. */
function payloadHint(snapshot?: string): string | null {
  if (!snapshot) return null;
  const match = snapshot.match(/keys=\[([^\]]*)\]/);
  if (match && match[1]) return match[1];
  return null;
}

export default function JobQueue() {
  const { t } = useLocale();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  // The 1.5s poll used to `.catch(() => {})`: when the API went down the table
  // silently froze on stale rows and the operator kept reading them as live.
  const [pollError, setPollError] = useState<unknown>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [reprinting, setReprinting] = useState<string | null>(null);
  const [reprintJob, setReprintJob] = useState<Job | null>(null);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintCopies, setReprintCopies] = useState(1);
  const [duplicateRisk, setDuplicateRisk] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void apiFetch<Job[]>('/jobs?limit=100')
        .then((data) => {
          if (!active) return;
          setJobs(data);
          setPollError(null);
        })
        .catch((err: unknown) => { if (active) setPollError(err); })
        .finally(() => { if (active) setLoading(false); });
    };
    load();
    const interval = window.setInterval(load, 1_500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (reprintJob && dialog && !dialog.open) dialog.showModal();
    if (!reprintJob && dialog?.open) dialog.close();
  }, [reprintJob]);

  const openReprint = async (job: Job) => {
    try {
      const fullJob = await apiFetch<Job>(`/jobs/${job.id}`);
      setReprintCopies(fullJob.copies || 1);
      setReprintReason('');
      setDuplicateRisk(false);
      setReprintJob(fullJob);
    } catch (err: unknown) {
      // The server's reason matters here (job gone, permission denied): a
      // generic sentence made every one of them look like the same problem.
      setMessage({
        tone: 'error',
        text: `Unable to load the safety information required for reprint. ${errorMessage(err)}`,
      });
    }
  };

  const confirmReprint = async () => {
    if (!reprintJob) return;
    setReprinting(reprintJob.id);
    try {
      const newJob = await apiFetch<Job>(`/jobs/${reprintJob.id}/reprint`, {
        method: 'POST',
        body: JSON.stringify({
          printerId: reprintJob.printerId,
          copies: reprintCopies,
          reason: reprintReason,
          confirmedDuplicateRisk: duplicateRisk,
        }),
      });
      setReprintJob(null);
      setMessage({ tone: 'ok', text: `Successfully submitted reprint as job: ${newJob.id.slice(0, 8)}` });
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `Failed to reprint job. ${errorMessage(err)}` });
    } finally {
      setReprinting(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>{t('page.jobQueue.title')}</h1>
      </div>

      {message && (
        <div style={{
          padding: '1rem',
          marginBottom: '1rem',
          borderRadius: '8px',
          background: message.tone === 'ok' ? '#dcfce7' : '#fee2e2',
          color: message.tone === 'ok' ? '#166534' : '#991b1b',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: 'inherit' }}>✕</button>
        </div>
      )}

      {pollError != null && (
        <ErrorBanner error={pollError} title={t('error.refresh.title')} />
      )}

      {loading ? <LoadingState /> : (
        <table className="data-table">
          <thead>
            <tr>
              {[
                t('page.jobQueue.status'),
                t('page.jobQueue.document'),
                t('page.jobQueue.printer'),
                t('page.jobQueue.source'),
                t('page.jobQueue.copies'),
                t('page.jobQueue.latencyMs'),
                t('page.jobQueue.created'),
                '',
              ].map((h, i) => (
                <th key={i} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={8}><EmptyState title={t('page.jobQueue.noJobs')} /></td></tr>
            )}
            {jobs.map((j) => {
              const statusColors = getStatusBadgeColors(j.status);
              const template = j.resolvedTemplateCode ?? j.templateCode;
              const hint = payloadHint(j.payloadSnapshot);
              return (
                <tr key={j.id}>
                  {/* Status badge */}
                  <td>
                    <span style={{
                      background: statusColors.bg, color: statusColors.text,
                      padding: '3px 10px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}>
                      {j.status}
                    </span>
                  </td>

                  {/* Document summary — the key column that was missing */}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <Link to={`/jobs/${j.id}`} style={{ color: '#1e66f5', fontWeight: 600, fontSize: '0.85rem' }}>
                        {template ?? t('common.noData')}
                      </Link>
                      {j.sourceReference && (
                        <span style={{ fontSize: '0.7rem', color: '#666' }}>เลขที่เอกสาร: {j.sourceReference}</span>
                      )}
                      {hint && (
                        <span style={{ fontSize: '0.65rem', color: '#999', fontFamily: 'monospace' }}>{hint}</span>
                      )}
                      <span style={{ fontSize: '0.6rem', color: '#aaa', fontFamily: 'monospace' }}>{j.id.slice(0, 12)}…</span>
                    </div>
                  </td>

                  {/* Printer */}
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    <Link to={`/printers/${j.printerId}`} style={{ color: 'var(--neutral-deep)', textDecoration: 'none' }}>
                      {j.printerCode ?? j.printerId.slice(0, 8)}
                    </Link>
                  </td>

                  {/* Source system */}
                  <td style={{ color: 'var(--neutral-text-muted)', fontSize: '0.8rem' }}>
                    {j.sourceSystem ?? t('common.noData')}
                  </td>

                  {/* Copies */}
                  <td style={{ fontWeight: 600, textAlign: 'center' }}>{j.copies}</td>

                  {/* Latency */}
                  <td style={{ color: 'var(--neutral-text-muted)', fontSize: '0.8rem' }}>
                    {j.latency?.totalLatencyMs != null ? `${j.latency.totalLatencyMs}ms` : t('common.noData')}
                  </td>

                  {/* Created */}
                  <td style={{ fontSize: '0.75rem', color: '#888' }}>
                    {new Date(j.createdAt).toLocaleString(undefined, {
                      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>

                  {/* Actions */}
                  <td>
                    <button
                      onClick={() => void openReprint(j)}
                      disabled={reprinting === j.id}
                      className="btn-secondary"
                      style={{ fontSize: '0.7rem', padding: '0.35rem 0.6rem' }}
                    >
                      {reprinting === j.id ? '…' : t('page.jobQueue.reprint')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <dialog ref={dialogRef} aria-labelledby="reprint-title" onCancel={() => setReprintJob(null)}
        style={{ maxWidth: '620px', width: 'calc(100% - 2rem)', border: 0, borderRadius: '12px', padding: '1.5rem' }}>
        {reprintJob && (
          <form method="dialog" onSubmit={(event) => { event.preventDefault(); void confirmReprint(); }}>
            <h2 id="reprint-title">Confirm additional physical copy</h2>
            <p role="alert" style={{ color: '#9a3412', fontWeight: 700 }}>
              This creates a new print job. Output may already have occurred; this is not a callback retry.
            </p>
            <dl>
              <dt>Original request ID</dt><dd><code>{reprintJob.requestId ?? 'Unavailable — reprint blocked'}</code></dd>
              <dt>Original job ID</dt><dd><code>{reprintJob.id}</code></dd>
              <dt>Print status</dt><dd>{reprintJob.status}</dd>
              <dt>Original printer / selected destination</dt><dd>{reprintJob.printerCode ?? reprintJob.printerId}</dd>
              <dt>Runner</dt><dd>{reprintJob.runnerId ?? 'Unknown — reprint blocked'}</dd>
              <dt>Print completion time</dt><dd>{reprintJob.completedAt ? new Date(reprintJob.completedAt).toLocaleString() : 'Not recorded'}</dd>
              <dt>Runner acknowledged completion</dt><dd>{reprintJob.runnerId && reprintJob.completedAt ? 'Yes' : 'No or unknown'}</dd>
              <dt>Callback delivery</dt><dd>See original job detail; callback delivery is not retried by this action.</dd>
            </dl>
            <label htmlFor="reprint-copies">Copies for new attempt</label>
            <input id="reprint-copies" type="number" min={1} step={1} value={reprintCopies}
              onChange={(e) => setReprintCopies(Number(e.target.value))} required />
            <label htmlFor="reprint-reason">Reason for reprint</label>
            <textarea id="reprint-reason" value={reprintReason}
              onChange={(e) => setReprintReason(e.target.value)} required />
            <label style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
              <input type="checkbox" checked={duplicateRisk} onChange={(e) => setDuplicateRisk(e.target.checked)} />
              I understand this action may produce an additional physical copy.
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.75rem', marginTop: '1.25rem' }}>
              <button type="button" className="btn-secondary" onClick={() => setReprintJob(null)}>Cancel</button>
              <button type="submit" disabled={!duplicateRisk || !reprintReason.trim() || !reprintJob.runnerId || !reprintJob.requestId || reprinting === reprintJob.id}>
                {reprinting === reprintJob.id ? 'Submitting…' : 'Confirm reprint'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
