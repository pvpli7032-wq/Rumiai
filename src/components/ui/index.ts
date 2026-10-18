/**
 * Shared design-system primitives. Presentation only: no fetching, no business
 * rules, no persistence. Business components compose these.
 */
export { cn } from './cn';
export { createVariants } from './variants';

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './button';
export { Badge, type BadgeProps, type BadgeVariant } from './badge';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';
export { Dialog, type DialogProps } from './dialog';
export { Sheet, type SheetProps } from './sheet';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
export { Tooltip, type TooltipProps } from './tooltip';
export { Skeleton, SkeletonText } from './skeleton';
export { EmptyState, type EmptyStateProps } from './empty-state';
export { ErrorState, type ErrorStateProps } from './error-state';
export { ToastProvider, useToast, type ToastOptions, type ToastVariant } from './toast';
export { Avatar, type AvatarProps } from './avatar';
export { Input, type InputProps } from './input';
export { Select, type SelectProps } from './select';
export { Textarea, type TextareaProps } from './textarea';
export { Pagination, type PaginationProps } from './pagination';
export {
  DataTable,
  type DataTableProps,
  type DataTableColumn,
  type DataTableSort,
  type DataTablePagination,
  type SortDirection,
} from './data-table';
