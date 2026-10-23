'use client';

import {AlertTriangle, EyeOff, Gavel} from 'lucide-react';
import Link from 'next/link';
import {DetailDrawer, DetailRow, DetailSection} from '@admin/components/layout/detail-drawer';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {
  DISPUTE_STATUS_LABELS,
  DISPUTE_STATUS_VARIANTS,
  describeDeadline,
  disputePostPath,
  formatDateTime,
  type DisputeCaseItem,
} from './types';

/**
 * 案例详情抽屉：诉求、票数、截止时间与最近失败原因；
 * 「立即结案」只在这里出现，列表每行不重复放动作按钮。
 */
export interface DisputeCaseDrawerProps {
  item: DisputeCaseItem | null;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onCloseCase: (item: DisputeCaseItem) => void;
  onHide: (item: DisputeCaseItem) => void;
}

export function DisputeCaseDrawer({item, canManage, busy, onClose, onCloseCase, onHide}: DisputeCaseDrawerProps) {
  const closable = Boolean(item && (item.status === 'OPEN' || item.status === 'CLOSING'));
  const hideable = Boolean(item && !item.hidden && item.status !== 'CLOSED' && item.status !== 'CLOSING');
  return (
    <DetailDrawer
      open={Boolean(item)}
      onClose={onClose}
      title={item ? `案例 ${item.id}` : '案例详情'}
      description="结案走与自动结案相同的路径：仍会生成一次角色回应，失败时使用明确的非 AI 兜底。"
      footer={item && canManage ? (
        <>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button variant="outline" disabled={!hideable || busy} leadingIcon={<EyeOff className="h-4 w-4" />} onClick={() => onHide(item)}>
            {item.hidden ? '已隐藏' : '隐藏案例'}
          </Button>
          {closable && <Button loading={busy} leadingIcon={<Gavel className="h-4 w-4" />} onClick={() => onCloseCase(item)}>立即结案</Button>}
        </>
      ) : undefined}
    >
      {item && (
        <div className="space-y-5">
          <DetailSection title="诉求">
            <div className="space-y-2 rounded-2xl border border-border/80 bg-muted/30 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={DISPUTE_STATUS_VARIANTS[item.status]}>{DISPUTE_STATUS_LABELS[item.status]}</Badge>
                {item.hidden && <Badge variant="neutral">后台已隐藏</Badge>}
                {item.overdue && <Badge variant="danger">已到截止时间</Badge>}
              </p>
              <p className="break-words text-sm text-foreground">{item.claim}</p>
            </div>
          </DetailSection>

          <DetailSection title="投票与时间">
            <div className="space-y-1.5">
              <DetailRow label="票数">{item.voteCount} 票</DetailRow>
              <DetailRow label="截止时间">
                {formatDateTime(item.deadlineAt)}
                <span className="ml-2 text-xs text-muted-foreground">{describeDeadline(item.deadlineAt)}</span>
              </DetailRow>
              <DetailRow label="发起时间">{formatDateTime(item.createdAt)}</DetailRow>
              <DetailRow label="结案时间">{formatDateTime(item.closedAt)}</DetailRow>
            </div>
          </DetailSection>

          <DetailSection title="参与方">
            <div className="space-y-1.5">
              <DetailRow label="发起人">{item.author ? `${item.author.name}（${item.author.id}）` : '账号已注销'}</DetailRow>
              <DetailRow label="涉及角色">{item.character?.name ?? '未绑定角色'}</DetailRow>
              <DetailRow label="帖子">
                <Link href={disputePostPath(item.id)} className="break-all text-brand underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
                  打开公开案例页
                </Link>
              </DetailRow>
            </div>
          </DetailSection>

          <DetailSection title="隐藏记录" description="来自管理操作日志；隐藏后停止公开访问，也不再进入结案任务。">
            {item.hidden ? (
              <div className="space-y-1 rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm">
                <p className="break-words text-foreground">{item.hidden.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {item.hidden.actor ? `操作人 ${item.hidden.actor.name}（${item.hidden.actor.id}）` : '操作人账号已注销'} · {formatDateTime(item.hidden.at)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">这个案例没有被后台隐藏{item.status === 'WITHDRAWN' ? '（状态为已撤回，可能是发起人自己撤回的）' : ''}。</p>
            )}
          </DetailSection>

          <DetailSection title="最近一次失败" description="来自后台任务的失败记录；重试次数与上限在设置中心「增长玩法」。">
            {item.lastFailure ? (
              <div className="space-y-1 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p className="flex items-start gap-2 break-words">
                  <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  {item.lastFailure.message}
                </p>
                <p className="text-xs text-muted-foreground">第 {item.lastFailure.attempts} 次失败 · {formatDateTime(item.lastFailure.at)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">这个案例没有失败记录。</p>
            )}
          </DetailSection>
        </div>
      )}
    </DetailDrawer>
  );
}
