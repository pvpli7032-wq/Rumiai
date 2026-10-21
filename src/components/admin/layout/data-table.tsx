'use client';

import type {ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {DataTable as UiDataTable, type DataTableProps as UiDataTableProps} from '@/components/ui/data-table';
import {EmptyState} from '@/components/ui/empty-state';
import {ErrorState} from '@/components/ui/error-state';

/**
 * 后台表格：在 `@/components/ui/data-table` 之上补上后台统一的空态与错误态。
 *
 * 排序、筛选、分页仍由调用方决定；表格本身只在容器内横向滚动，
 * 整页不会因为列多而出现横向溢出（V3 §18）。
 */
export interface DataTableProps<T> extends UiDataTableProps<T> {
  /** 无数据时的标题，默认「暂无数据」。 */
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  /** 字符串会渲染成带「重试」的错误态；传入节点则原样渲染。 */
  error?: ReactNode;
  onRetry?: () => void;
}

export function DataTable<T>({
  empty,
  emptyTitle = '暂无数据',
  emptyDescription,
  emptyAction,
  error,
  onRetry,
  ...rest
}: DataTableProps<T>) {
  const emptyNode = empty ?? <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  const errorNode =
    typeof error === 'string'
      ? <ErrorState title={error} action={onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>重试</Button> : undefined} />
      : error;

  return <UiDataTable {...rest} empty={emptyNode} error={errorNode} />;
}

export type {DataTableColumn, DataTableSort, DataTablePagination} from '@/components/ui/data-table';
