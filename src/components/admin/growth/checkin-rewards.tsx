'use client';

import { useEffect, useState } from 'react';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Rule = { streakDay: number; rewardCoins: number; version: number };

export function CheckinRewards({ token, canManage, onSaved }: { token: string; canManage: boolean; onSaved: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]), [reason, setReason] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/growth/checkins', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); setRules(data.rules); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [token]);

  function change(day: number, value: string) { setRules(rows => rows.map(row => row.streakDay === day ? { ...row, rewardCoins: Number(value) } : row)); }

  async function save() {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/admin/growth/checkins', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ rules, reason }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      const refreshed = await fetch('/api/admin/growth/checkins', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
      const updated = await refreshed.json();
      if (!refreshed.ok) throw Error(updated.error);
      setRules(updated.rules); setReason(''); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '签到奖励保存失败。'); } finally { setSaving(false); }
  }

  return (
    <AdminPanel aria-label="连续签到金币" title="连续签到金币" description="第 7 天及以后按第 7 天金额发放。修改将影响之后的签到，不追溯历史流水。">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rules.map(rule => (
            <label key={rule.streakDay} className="block space-y-1.5">
              <span className="text-sm font-medium">第 {rule.streakDay} 天</span>
              <Input aria-label={`第 ${rule.streakDay} 天签到奖励`} type="number" min={0} max={10000} step={1} disabled={!canManage || saving} value={rule.rewardCoins} onChange={event => change(rule.streakDay, event.target.value)} />
            </label>
          ))}
        </div>
        {canManage && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <label className="block min-w-64 flex-1 space-y-1.5">
              <span className="text-sm font-medium">操作理由</span>
              <Input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
            </label>
            <Button loading={saving} disabled={saving || !reason.trim() || rules.length !== 7} onClick={() => void save()}>保存签到奖励</Button>
          </div>
        )}
        {error && <AdminNotice tone="error" title={error} />}
      </div>
    </AdminPanel>
  );
}
