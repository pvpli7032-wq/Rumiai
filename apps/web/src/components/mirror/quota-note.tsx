import {Badge} from '@rumiai/ui';
import type {MirrorQuota} from '@rumiai/contracts/mirror/types';

/** 额度提示：说明今天还剩几次；额度用尽时按超额策略给出明确文案。 */
export function MirrorQuotaNote({quota}: {quota: MirrorQuota}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Badge variant={quota.remaining > 0 ? 'neutral' : 'warning'}>
        {quota.anonymous ? '匿名' : '已登录'} · 今日剩余 {quota.remaining}/{quota.limit} 次
      </Badge>
      {quota.blockedReason && <span className="text-amber-500">{quota.blockedReason}</span>}
    </div>
  );
}
