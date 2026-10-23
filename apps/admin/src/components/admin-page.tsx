import type { ComponentPropsWithRef, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@rumiai/ui/cn';

/**
 * 管理后台的版式骨架。
 *
 * 后台有二十个栏目，早先每个栏目自己写 `<main>`、`<h1>` 和标题区，
 * 于是出现了五种最大宽度、三种内边距和两套强调色。这里把版式收敛成一组
 * 纯展示组件：宽度、留白、标题层级、卡片分节、状态提示各只有一个出处，
 * 栏目组件只负责业务内容。
 *
 * 全部为无状态展示组件，服务端组件和客户端组件都可以直接渲染。
 */

const WIDTHS = {
  /** 数据密集型页面：宽表、多列图表。 */
  wide: 'max-w-[1680px]',
  /** 表单与配置页。 */
  default: 'max-w-6xl',
  /** 单列表单、政策类内容。 */
  narrow: 'max-w-4xl',
  /** 正文阅读宽度。 */
  reading: 'max-w-3xl',
  /** 不限宽，由调用方自行分栏。 */
  full: '',
} as const;

export type AdminPageWidth = keyof typeof WIDTHS;

export interface AdminPageProps extends ComponentPropsWithRef<'main'> {
  width?: AdminPageWidth;
}

/** 后台唯一的内容容器：决定宽度、竖向节奏与页面留白。 */
export function AdminPage({ width = 'wide', className, children, ...props }: AdminPageProps) {
  return (
    <main
      className={cn('admin-page mx-auto flex w-full flex-col gap-6 p-4 md:p-6 xl:px-8 xl:py-7', WIDTHS[width], className)}
      {...props}
    >
      {children}
    </main>
  );
}

export interface AdminPageHeaderProps {
  /** 所属分组，例如「财务与支付」。渲染成小号标签字。 */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 标题右侧的操作区：新增、导出、刷新等。 */
  actions?: ReactNode;
  /** 标题旁的补充信息，例如状态徽标。 */
  meta?: ReactNode;
  className?: string;
}

/** 页面标题区：眉标、标题、说明、操作区，四个位置全网后台一致。 */
export function AdminPageHeader({ eyebrow, title, description, actions, meta, className }: AdminPageHeaderProps) {
  return (
    <header
      className={cn(
        'admin-page-header flex flex-col gap-4 pb-1 md:flex-row md:items-start md:justify-between md:gap-6',
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow && <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px] md:leading-9">{title}</h1>
          {meta}
        </div>
        {description && <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export interface AdminPanelProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  /** 面板右上角操作区。 */
  actions?: ReactNode;
  /** 标题旁的徽标，例如记录条数。 */
  badge?: ReactNode;
  children?: ReactNode;
  /**
   * 关闭内边距，交给调用方自己控制（表格、全宽工具条常用）。
   *
   * 注意：`<section>` 只有在具备可访问名时才成为 landmark region。需要按名称定位
   * 某个面板时（例如验收脚本查找「用户详情」），给该面板传 `aria-label`。
   */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
}

/** 卡片分节：一个后台面板 = 一个带标题条的圆角卡片。 */
export function AdminPanel({
  title,
  description,
  actions,
  badge,
  children,
  flush = false,
  className,
  bodyClassName,
  ...props
}: AdminPanelProps) {
  return (
    <section className={cn('admin-panel min-w-0 overflow-hidden rounded-xl border border-border bg-card', className)} {...props}>
      {(title || actions) && (
        <header className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {title && <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>}
              {badge}
            </div>
            {description && <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('admin-panel-body', flush ? '' : 'p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** 同层级面板的间距容器。 */
export function AdminPanelGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-5', className)}>{children}</div>;
}

const STAT_TONES = {
  default: 'bg-muted text-muted-foreground',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-emerald-500/12 text-emerald-600',
  warning: 'bg-amber-500/15 text-amber-600',
  danger: 'bg-destructive/12 text-destructive',
} as const;

export type AdminStatTone = keyof typeof STAT_TONES;

export interface AdminStatProps {
  label: ReactNode;
  value: ReactNode;
  /** 数值下方的补充说明或同比信息。 */
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: AdminStatTone;
  className?: string;
}

/** 单个指标卡：数值突出、说明收敛。 */
export function AdminStat({ label, value, hint, icon, tone = 'default', className }: AdminStatProps) {
  return (
    <div className={cn('admin-stat rounded-xl border border-border bg-card p-4 sm:p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', STAT_TONES[tone])} aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <p className="admin-stat-value mt-3 text-[28px] font-semibold tabular-nums leading-tight text-foreground">{value}</p>
      {hint && <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 指标卡栅格：窄屏一列、中屏两列、宽屏四列。 */
export function AdminStatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>;
}

/** 筛选条：搜索、下拉、日期等控件的统一排布容器。 */
export function AdminToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3', className)}>
      {children}
    </div>
  );
}

const NOTICE_STYLES = {
  loading: { box: 'border-border bg-card text-foreground', icon: <Loader2 aria-hidden className="h-5 w-5 animate-spin text-brand" />, role: 'status' },
  info: { box: 'border-border bg-card text-foreground', icon: <Info aria-hidden className="h-5 w-5 text-brand" />, role: 'status' },
  success: { box: 'border-emerald-500/30 bg-emerald-500/5 text-foreground', icon: <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-600" />, role: 'status' },
  warning: { box: 'border-amber-500/30 bg-amber-500/5 text-foreground', icon: <AlertCircle aria-hidden className="h-5 w-5 text-amber-600" />, role: 'status' },
  error: { box: 'border-destructive/30 bg-destructive/5 text-foreground', icon: <AlertCircle aria-hidden className="h-5 w-5 text-destructive" />, role: 'alert' },
  denied: { box: 'border-destructive/30 bg-destructive/5 text-foreground', icon: <ShieldAlert aria-hidden className="h-5 w-5 text-destructive" />, role: 'alert' },
} as const;

export type AdminNoticeTone = keyof typeof NOTICE_STYLES;

export interface AdminNoticeProps {
  tone?: AdminNoticeTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * 状态提示：加载中、无权限、出错统一用它。
 * 取代原先散落在各栏目里的裸 `<p role="alert">`，保证可访问性语义与外形一致。
 */
export function AdminNotice({ tone = 'info', title, description, action, className }: AdminNoticeProps) {
  const style = NOTICE_STYLES[tone];
  return (
    <div
      role={style.role}
      className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border px-6 py-12 text-center', style.box, className)}
    >
      {style.icon}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** 栏目页尚未接入真实数据时占位用的说明文字，保持全站一致。 */
export function AdminPlaceholder({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-muted-foreground">{children}</p>;
}
