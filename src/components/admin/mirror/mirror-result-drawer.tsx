'use client';

import {EyeOff, RotateCcw, Trash2} from 'lucide-react';
import Link from 'next/link';
import {DetailDrawer, DetailRow, DetailSection} from '@/components/admin/layout/detail-drawer';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
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
}

export function MirrorResultDrawer({item, canManage, busy, onClose, onHide}: MirrorResultDrawerProps) {
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
            description="隐藏把状态置为 HIDDEN 并让分享码立即失效，记录保留以便与费用单对账。"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled leadingIcon={<RotateCcw className="h-4 w-4" />}>恢复</Button>
              <Button variant="outline" size="sm" disabled leadingIcon={<Trash2 className="h-4 w-4" />}>删除</Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              恢复与删除需要后台接口支持；当前接口只提供隐藏，按钮保持不可用，避免看起来能操作却发不出请求。
            </p>
          </DetailSection>
        </div>
      )}
    </DetailDrawer>
  );
}
