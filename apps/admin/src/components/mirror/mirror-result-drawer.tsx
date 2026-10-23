'use client';

import {EyeOff, RotateCcw} from 'lucide-react';
import Link from 'next/link';
import {DetailDrawer, DetailRow, DetailSection} from '@admin/components/layout/detail-drawer';
import {Badge} from '@rumiai/ui/badge';
import {Button} from '@rumiai/ui/button';
import {MIRROR_STATUS_LABELS, MIRROR_STATUS_VARIANTS, formatDateTime, mirrorSharePath, type MirrorResultItem} from './types';

/**
 * 结果详情抽屉：内容、归属、时间与分享码都在这里看；
 * 隐藏/恢复/删除这类会改变对外可见性的动作也只在这里出现，不在列表每行重复一遍。
 */
export interface MirrorResultDrawerProps {
  item: MirrorResultItem | null;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onHide: (item: MirrorResultItem) => void;
  onRestore: (item: MirrorResultItem) => void;
}

export function MirrorResultDrawer({item, canManage, busy, onClose, onHide, onRestore}: MirrorResultDrawerProps) {
  return (
    <DetailDrawer
      open={Boolean(item)}
      onClose={onClose}
      title={item ? `结果 ${item.shareId}` : '结果详情'}
      description="结果字段由生成时校验并保存；分享页只读这些字段，不展示三题原回答。"
      footer={item && canManage ? (
        <>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={item.status === 'HIDDEN'}
            leadingIcon={<EyeOff className="h-4 w-4" />}
            onClick={() => onHide(item)}
          >
            {item.status === 'HIDDEN' ? '已隐藏' : '隐藏结果'}
          </Button>
        </>
      ) : undefined}
    >
      {item && (
        <div className="space-y-5">
          <DetailSection title="结果内容" description="称号、金句为保存时校验后的值。">
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {item.title}
                <Badge variant={MIRROR_STATUS_VARIANTS[item.status]}>{MIRROR_STATUS_LABELS[item.status]}</Badge>
                {item.expired && item.status !== 'EXPIRED' && <Badge variant="warning">已过期</Badge>}
              </p>
              <p className="break-words text-sm text-muted-foreground">{item.quote}</p>
            </div>
          </DetailSection>

          <DetailSection title="归属">
            <div className="space-y-1.5">
              <DetailRow label="角色">{item.character ? item.character.name : '角色已不存在'}</DetailRow>
              <DetailRow label="作者">
                {item.anonymous ? '匿名访客' : item.author ? `${item.author.name}（${item.author.id}）` : '账号已注销'}
              </DetailRow>
              <DetailRow label="分享码"><span className="break-all font-mono text-xs">{item.shareId}</span></DetailRow>
              <DetailRow label="分享页">
                <Link href={mirrorSharePath(item.shareId)} className="break-all text-brand underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
                  打开公开页
                </Link>
              </DetailRow>
            </div>
          </DetailSection>

          <DetailSection title="时间">
            <div className="space-y-1.5">
              <DetailRow label="创建时间">{formatDateTime(item.createdAt)}</DetailRow>
              <DetailRow label="过期时间">{formatDateTime(item.expiresAt)}</DetailRow>
            </div>
          </DetailSection>

          <DetailSection
            title="管理动作"
            description="隐藏把状态置为 HIDDEN 并让分享码立即失效，记录保留以便与费用单对账；恢复按过期时间还原成已生成或已过期。"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                disabled={item.status !== 'HIDDEN'}
                leadingIcon={<RotateCcw className="h-4 w-4" />}
                onClick={() => onRestore(item)}
              >
                {item.status === 'HIDDEN' ? '恢复结果' : '未隐藏，无需恢复'}
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              隐藏与删除在这张表上是同一个状态转换（置 HIDDEN、不删行），所以这里只有一个按钮；
              前台作者删除走 /api/mirror/[shareId]。已过期的结果恢复后仍是已过期，不会重新公开。
            </p>
          </DetailSection>
        </div>
      )}
    </DetailDrawer>
  );
}
