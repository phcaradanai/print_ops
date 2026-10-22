/**
 * Short absolute timestamp for dense list rows ("Oct 22, 14:05").
 * Shared by the dashboard's recent-jobs table and the queue's created column
 * so the same instant never renders two different ways.
 */
export function formatCreatedAt(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}