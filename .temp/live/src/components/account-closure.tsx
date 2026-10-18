'use client';
import { useState } from 'react';

export function AccountClosure({ token, onClosed }: { token: string; onClosed: (pending: boolean) => void }) {
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function close(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/users/me/close', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password, confirmation, acknowledgeRetention: acknowledged }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '注销失败，请重试。');
      sessionStorage.setItem('account-closure-reference', result.reference);
      setPassword(''); onClosed(result.fileCleanupPending === true);
    } catch (e) { setError(e instanceof TypeError ? '网络连接失败，请重新登录后核对账号状态。' : (e as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-red-500/25 p-4">
    <summary className="cursor-pointer font-semibold text-red-400">注销账号</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>注销后无法登录，个人资料和本人聊天会清除，原创角色下架并清除内容，本人帖子和评论清除。其他用户的聊天与回复会保留。建议先使用上方“导出数据”。</p>
      <p>支付订单、金币余额与流水、AI 成本、举报证据及处理记录保留用于核对；账号身份改为匿名记录。注销后不能继续使用金币，请先处理需要退款的充值。有未结束的支付、退款或 AI 请求时会暂缓注销。</p>
      <p>本人新上传文件会清理。无法确认归属的旧共享图片需核查；备份和模型服务商保存的数据须由运营方按实际保留规则处理。</p>
      <form className="space-y-3" onSubmit={close}>
        <label className="block">当前密码<input required type="password" autoComplete="current-password" maxLength={200} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 min-h-11 w-full rounded-sm border bg-background px-3" /></label>
        <label className="block">输入“注销我的账号”<input required value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1 min-h-11 w-full rounded-sm border bg-background px-3" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />我已了解删除范围和账务、举报、备份等记录的保留说明，确认注销。</label>
        {error && <p role="alert" className="text-red-400">{error}</p>}
        <button disabled={busy || !password || confirmation !== '注销我的账号' || !acknowledged} className="min-h-11 rounded-sm border border-red-500/40 px-4 text-red-400 disabled:opacity-50">{busy ? '正在注销…' : '确认注销账号'}</button>
      </form>
    </div>
  </details>;
}
