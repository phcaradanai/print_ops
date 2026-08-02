import { useMemo, useRef } from 'react';
import { useLocale } from '../../../i18n/index.js';
import { useTemplateWorkspace } from '../hooks/useTemplateWorkspace.js';
import {
  Badge, Button, Card, Chip, DataCell, DataHead, DataTable, EmptyState,
  Heading, IconButton, Inline, LoadingState, Mono, Select, TableEmpty, Text, type BadgeTone
} from '../../../components/ui/index.js';
import { TemplateIcon } from './TemplateIcon.js';
import { TemplateRowMenu } from './TemplateRowMenu.js';
import type { Template } from '../model/types.js';

const STATUS_BADGE_TONE: Record<string, BadgeTone> = {
  PUBLISHED: 'success',
  DRAFT: 'neutral',
  DISABLED: 'warning',
  ARCHIVED: 'neutral',
};

function formatDate(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale === 'th' ? 'th-TH' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TemplateLibrary() {
  const { t, locale } = useLocale();
  const {
    templates, templatesResource, load,
    search, chip, setChip, sortDesc, setSortDesc,
    page, setPage, pageSize, setPageSize,
    selectedId, startEdit, newTemplate, duplicate, renderServerPreview, publish,
    setPendingDelete
  } = useTemplateWorkspace();

  const libraryRef = useRef<HTMLElement | null>(null);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tpl of templates) counts[tpl.status] = (counts[tpl.status] ?? 0) + 1;
    return counts;
  }, [templates]);

  const engineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tpl of templates) counts[tpl.engine] = (counts[tpl.engine] ?? 0) + 1;
    return counts;
  }, [templates]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = templates.filter((tpl) => {
      if (chip !== 'ALL' && tpl.status !== chip && tpl.engine !== chip) return false;
      if (!needle) return true;
      const haystack = `${tpl.templateCode} ${tpl.name} ${tpl.engine} ${tpl.status}`.toLowerCase();
      return haystack.includes(needle);
    });
    return rows.sort((a, b) => {
      const av = a.updatedAt ?? a.createdAt ?? '';
      const bv = b.updatedAt ?? b.createdAt ?? '';
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  }, [templates, chip, search, sortDesc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const from = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, filtered.length);
  
  const visiblePages = useMemo<(number | 'gap-start' | 'gap-end')[]>(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(pageCount - 1, currentPage + 1);
    const items: (number | 'gap-start' | 'gap-end')[] = [1];
    if (start > 2) items.push('gap-start');
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) items.push(pageNumber);
    if (end < pageCount - 1) items.push('gap-end');
    items.push(pageCount);
    return items;
  }, [currentPage, pageCount]);

  return (
    <Card ref={libraryRef}>
      <Inline style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--spacing-md)' }}>
        <Heading level={2}>{t('page.templates.listTitle')}</Heading>
        <Inline gap="xs">
          <IconButton
            label={t('common.refresh')}
            onClick={() => void load()}
            busy={templatesResource.refreshing}
          >
            <TemplateIcon name="refresh" spin={templatesResource.refreshing} />
          </IconButton>
          <IconButton
            label={t('page.templates.sortByUpdated')}
            title={t('page.templates.updated')}
            onClick={() => setSortDesc(!sortDesc)}
            aria-pressed={sortDesc}
          >
            <TemplateIcon name={sortDesc ? 'sortDesc' : 'sortAsc'} />
          </IconButton>
        </Inline>
      </Inline>

      {templatesResource.loading && templatesResource.data === undefined ? (
        <LoadingState />
      ) : templatesResource.error != null && templatesResource.data === undefined ? null : templates.length === 0 ? (
        <EmptyState
          title={t('page.templates.emptyTitle')}
          hint={t('page.templates.emptyHint')}
          action={<Button onClick={newTemplate}><TemplateIcon name="plus" /> {t('page.templates.newTemplate')}</Button>}
        />
      ) : <>
        <Inline gap="xs" aria-label={t('page.templates.filters')} style={{ padding: '0 var(--spacing-md) var(--spacing-md)' }}>
          <Chip selected={chip === 'ALL'} onClick={() => setChip('ALL')}>
            {t('page.templates.filterAll')} <Text size="label" weight="bold">{templates.length}</Text>
          </Chip>
          {Object.entries(statusCounts).map(([status, count]) => (
            <Chip key={status} selected={chip === status} onClick={() => setChip(status)}>
              {status} <Text size="label" weight="bold">{count}</Text>
            </Chip>
          ))}
          {Object.entries(engineCounts).map(([engine, count]) => (
            <Chip key={engine} selected={chip === engine} onClick={() => setChip(engine)}>
              {engine} <Text size="label" weight="bold">{count}</Text>
            </Chip>
          ))}
        </Inline>

        <DataTable label={t('page.templates.listTitle')} responsive>
          <thead>
            <tr>
              <DataHead>{t('page.templates.code')}</DataHead>
              <DataHead>{t('page.templates.name')}</DataHead>
              <DataHead>{t('page.templates.engine')}</DataHead>
              <DataHead>{t('page.templates.version')}</DataHead>
              <DataHead>{t('page.templates.status')}</DataHead>
              <DataHead>{t('page.templates.updated')}</DataHead>
              <DataHead>{t('page.templates.actions')}</DataHead>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((tpl: Template) => (
              <tr key={tpl.id} className={tpl.id === selectedId ? 'is-selected' : undefined}>
                <DataCell label={t('page.templates.code')}><Mono>{tpl.templateCode}</Mono></DataCell>
                <DataCell label={t('page.templates.name')}>
                  <Text truncate title={tpl.name}>{tpl.name}</Text>
                </DataCell>
                <DataCell label={t('page.templates.engine')}><Badge>{tpl.engine}</Badge></DataCell>
                <DataCell label={t('page.templates.version')}><Mono>{tpl.version}</Mono></DataCell>
                <DataCell label={t('page.templates.status')}>
                  <Badge tone={STATUS_BADGE_TONE[tpl.status] ?? 'neutral'}>{tpl.status}</Badge>
                </DataCell>
                <DataCell label={t('page.templates.updated')}>
                  <Text size="label" tone="muted" nowrap>{formatDate(tpl.updatedAt ?? tpl.createdAt, locale)}</Text>
                </DataCell>
                <DataCell label={t('page.templates.actions')} actions>
                  <Inline gap="xs">
                    <IconButton
                      size="sm"
                      label={t('page.templates.previewTemplate').replace('{name}', tpl.name)}
                      title={t('common.preview')}
                      onClick={() => void renderServerPreview(tpl)}
                    ><TemplateIcon name="preview" /></IconButton>
                    <IconButton
                      size="sm"
                      label={t('page.templates.duplicateTemplate').replace('{name}', tpl.name)}
                      title={t('page.templates.duplicate')}
                      onClick={() => void duplicate(tpl)}
                    ><TemplateIcon name="duplicate" /></IconButton>
                    <IconButton
                      size="sm"
                      label={t('page.templates.editTemplateNamed').replace('{name}', tpl.name)}
                      title={t('page.templates.edit')}
                      onClick={() => startEdit(tpl)}
                    ><TemplateIcon name="edit" /></IconButton>
                    <TemplateRowMenu
                      label={t('page.templates.moreTemplateActions').replace('{name}', tpl.name)}
                      icon={<TemplateIcon name="more" />}
                      items={[
                        {
                          id: 'publish',
                          label: t('common.publish'),
                          icon: <TemplateIcon name="check" />,
                          onSelect: () => void publish(tpl.id),
                        },
                        {
                          id: 'delete',
                          label: t('page.templates.delete'),
                          icon: <TemplateIcon name="delete" />,
                          danger: true,
                          restoreFocus: false,
                          onSelect: () => setPendingDelete(tpl),
                        },
                      ]}
                    />
                  </Inline>
                </DataCell>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <TableEmpty columns={7}>
                <EmptyState title={t('page.templates.noResults')} />
              </TableEmpty>
            )}
          </tbody>
        </DataTable>

        <Inline style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--spacing-md)' }}>
          <Text size="label" tone="muted">
            {t('page.templates.showing')
              .replace('{from}', String(from))
              .replace('{to}', String(to))
              .replace('{total}', String(filtered.length))}
          </Text>
          <Inline gap="xs">
            <IconButton
              size="sm"
              label={t('page.templates.previousPage')}
              onClick={() => setPage((p: number) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            ><TemplateIcon name="back" /></IconButton>
            {visiblePages.map((item) => typeof item === 'number' ? (
              <Chip
                key={item}
                selected={item === currentPage}
                aria-current={item === currentPage ? 'page' : undefined}
                aria-label={t('page.templates.pageNumber').replace('{n}', String(item))}
                onClick={() => setPage(item)}
              >{item}</Chip>
            ) : <Text key={item} tone="muted" aria-hidden="true">…</Text>
            )}
            <IconButton
              size="sm"
              label={t('page.templates.nextPage')}
              onClick={() => setPage((p: number) => Math.min(pageCount, p + 1))}
              disabled={currentPage >= pageCount}
            ><TemplateIcon name="next" /></IconButton>
          </Inline>
          <Select
            controlSize="sm"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label={t('page.templates.rowsPerPage').replace('{n}', String(pageSize))}
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>{t('page.templates.rowsPerPage').replace('{n}', String(n))}</option>
            ))}
          </Select>
        </Inline>
      </>}
    </Card>
  );
}
