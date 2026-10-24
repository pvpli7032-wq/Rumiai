'use client';

import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { EmptyState } from './empty-state';
import { Pagination } from './pagination';
import { Skeleton } from './skeleton';

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, rowIndex: number) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
  className?: string;
  headerClassName?: string;
}

export interface DataTablePagination {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  summary?: ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId?: (row: T, index: number) => string;
  caption?: string;
  /** Filter bar slot rendered above the table. */
  filters?: ReactNode;
  /** Right-aligned toolbar slot (search, create button, export...). */
  toolbar?: ReactNode;
  /** Rendered as a selection bar once at least one row is checked. */
  bulkActions?: (selectedRows: T[]) => ReactNode;
  /** Replaces the body when there are no rows. Defaults to a generic EmptyState. */
  empty?: ReactNode;
  /** Replaces the body when set. Defaults to a generic ErrorState. */
  error?: ReactNode;
  selectable?: boolean;
  /** Controlled selection. Omit to let the table track it. */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Controlled sort. Omit to let the table track it. */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  pagination?: DataTablePagination;
  loading?: boolean;
  loadingRows?: number;
  dense?: boolean;
  className?: string;
  rowClassName?: (row: T, index: number) => string | undefined;
  /** Extra DOM attributes per row, for example `data-*` hooks used by tests. */
  rowAttributes?: (row: T, index: number) => Record<string, string | undefined>;
}

const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

/**
 * Presentation-only table shell: filter bar, sortable headers, selection with a bulk
 * action bar, empty/error slots and pagination. It never sorts, filters or fetches
 * data itself — it reports sort and selection intent and the caller decides.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  filters,
  toolbar,
  bulkActions,
  empty,
  error,
  selectable = false,
  selectedIds,
  onSelectionChange,
  sort,
  onSortChange,
  pagination,
  loading = false,
  loadingRows = 5,
  dense = false,
  className,
  rowClassName,
  rowAttributes,
}: DataTableProps<T>) {
  const [internalSelection, setInternalSelection] = useState<string[]>([]);
  const [internalSort, setInternalSort] = useState<DataTableSort | null>(null);

  const selected = selectedIds ?? internalSelection;
  const activeSort = sort !== undefined ? sort : internalSort;
  const selectedSet = new Set(selected);

  const rowId = (row: T, index: number) => (getRowId ? getRowId(row, index) : String(index));
  const selectedRows = rows.filter((row, index) => selectedSet.has(rowId(row, index)));
  const pageIds = rows.map((row, index) => rowId(row, index));
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));

  function updateSelection(ids: string[]) {
    if (selectedIds === undefined) setInternalSelection(ids);
    onSelectionChange?.(ids);
  }

  function toggleRow(id: string, checked: boolean) {
    updateSelection(checked ? [...selected, id] : selected.filter((item) => item !== id));
  }

  function toggleAll(checked: boolean) {
    updateSelection(checked ? [...new Set([...selected, ...pageIds])] : selected.filter((id) => !pageIds.includes(id)));
  }

  function toggleSort(columnId: string) {
    const next: DataTableSort | null =
      activeSort?.columnId !== columnId
        ? { columnId, direction: 'asc' }
        : activeSort.direction === 'asc'
          ? { columnId, direction: 'desc' }
          : null;
    if (sort === undefined) setInternalSort(next);
    onSortChange?.(next);
  }

  const columnCount = columns.length + (selectable ? 1 : 0);
  const cellPadding = dense ? 'px-3 py-2' : 'px-4 py-3';

  function renderBody() {
    if (error) {
      return (
        <tr>
          <td colSpan={columnCount} className="p-4">
            {error}
          </td>
        </tr>
      );
    }

    if (loading) {
      return Array.from({ length: loadingRows }, (_, rowIndex) => (
        <tr key={`skeleton-${rowIndex}`} className="border-t border-border">
          {selectable && (
            <td className={cellPadding}>
              <Skeleton className="h-4 w-4" />
            </td>
          )}
          {columns.map((column) => (
            <td key={column.id} className={cellPadding}>
              <Skeleton shape="text" />
            </td>
          ))}
        </tr>
      ));
    }

    if (rows.length === 0) {
      return (
        <tr>
          <td colSpan={columnCount} className="p-4">
            {empty ?? <EmptyState title="暂无数据" />}
          </td>
        </tr>
      );
    }

    return rows.map((row, index) => {
      const id = rowId(row, index);
      return (
        <tr key={id} {...rowAttributes?.(row, index)} className={cn('border-t border-border transition-colors hover:bg-muted/40', rowClassName?.(row, index))}>
          {selectable && (
            <td className={cn(cellPadding, 'w-10')}>
              <input
                type="checkbox"
                aria-label="选择此行"
                checked={selectedSet.has(id)}
                onChange={(event) => toggleRow(id, event.target.checked)}
                className="h-4 w-4 rounded border-border accent-brand"
              />
            </td>
          )}
          {columns.map((column) => (
            <td key={column.id} className={cn(cellPadding, 'align-middle text-sm text-foreground', alignClass[column.align ?? 'left'], column.className)}>
              {column.cell(row, index)}
            </td>
          ))}
        </tr>
      );
    });
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(filters || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {filters}
          {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {selectable && bulkActions && selected.length > 0 && (
        <div
          role="region"
          aria-label="批量操作"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm text-foreground"
        >
          <span className="font-medium">已选择 {selected.length} 项</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">{bulkActions(selectedRows)}</div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="caption-top px-4 py-2 text-left text-xs text-muted-foreground">{caption}</caption>}
          <thead className="bg-muted/60">
            <tr>
              {selectable && (
                <th scope="col" className={cn(cellPadding, 'w-10 text-left')}>
                  <input
                    type="checkbox"
                    aria-label="选择本页全部"
                    checked={allSelected}
                    ref={(element) => {
                      if (element) element.indeterminate = selected.length > 0 && !allSelected;
                    }}
                    onChange={(event) => toggleAll(event.target.checked)}
                    className="h-4 w-4 rounded border-border accent-brand"
                  />
                </th>
              )}
              {columns.map((column) => {
                const sorted = activeSort?.columnId === column.id ? activeSort.direction : null;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : column.sortable ? 'none' : undefined}
                    className={cn(
                      cellPadding,
                      'text-xs font-medium uppercase tracking-wide text-muted-foreground',
                      alignClass[column.align ?? 'left'],
                      column.headerClassName,
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          sorted && 'text-foreground',
                        )}
                      >
                        {column.header}
                        {sorted === 'asc' ? (
                          <ChevronUp aria-hidden className="h-3 w-3" />
                        ) : sorted === 'desc' ? (
                          <ChevronDown aria-hidden className="h-3 w-3" />
                        ) : (
                          <ChevronsUpDown aria-hidden className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{renderBody()}</tbody>
        </table>
      </div>

      {pagination && (
        <Pagination
          page={pagination.page}
          pageCount={pagination.pageCount}
          onPageChange={pagination.onPageChange}
          summary={pagination.summary}
          disabled={loading}
        />
      )}
    </div>
  );
}
