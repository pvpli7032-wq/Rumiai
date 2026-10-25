'use client';
import {useSearchParams} from 'next/navigation';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {authPageHref} from '@web/lib/next-path';
import {API} from '@rumiai/contracts/api-paths';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';

export default function ResetPasswordPage() {
  const authSearch=useSearchParams().toString();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setToken(new URLSearchParams(window.location.search).get('token') || ''), []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) { setMessage('两次输入的密码不一致。'); return; }
    setBusy(true);
    const response = await fetch(API.auth.resetPassword, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token, password})}).catch(() => null);
    const body = await response?.json().catch(() => ({})) as {message?: string; error?: string} | undefined;
    setBusy(false);
    setSuccess(Boolean(response?.ok));
    setMessage(body?.message || body?.error || '网络连接失败，请稍后重试。');
  }
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-12">
    <section className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold">设置新密码</h1>
      {message && <p role={success ? 'status' : 'alert'} className="mt-5 rounded-lg bg-muted px-4 py-3 text-sm leading-6">{message}</p>}
      {!success && <form onSubmit={submit} className="mt-5 space-y-4">
        {!token && <p role="alert" className="text-sm text-destructive">重置链接缺少令牌，请重新申请。</p>}
        <label htmlFor="new-password" className="block text-sm font-medium">新密码</label>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required />
        <label htmlFor="confirm-password" className="block text-sm font-medium">确认新密码</label>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required />
        <Button type="submit" fullWidth loading={busy} disabled={!token}>{busy ? '正在重置…' : '重置密码'}</Button>
      </form>}
      <Link replace href={authPageHref('/login',authSearch)} className="mt-5 block text-center text-sm text-brand hover:underline">返回登录</Link>
    </section>
  </main>;
}
