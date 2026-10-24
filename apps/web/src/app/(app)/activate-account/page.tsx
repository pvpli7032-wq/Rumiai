'use client';
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {API} from '@rumiai/contracts/api-paths';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';

export default function ActivateAccountPage() {
  const [token, setToken] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false), [busy, setBusy] = useState(false); const busyRef = useRef(false);
  useEffect(() => setToken(new URLSearchParams(window.location.search).get('token') || ''), []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busyRef.current) return; if (password !== confirm) {setMessage('两次输入的密码不一致。'); return;}
    busyRef.current = true; setBusy(true); setMessage('');
    const response = await fetch(API.auth.activateAccount, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token, password})}).catch(() => null);
    const body = await response?.json().catch(() => ({})) as {error?: string} | undefined;
    setSuccess(Boolean(response?.ok)); setMessage(response?.ok ? '账号已激活，可以登录。' : body?.error || '网络连接失败，请稍后重试。'); setBusy(false); busyRef.current = false;
  }
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-12"><section className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
    <h1 className="text-2xl font-bold">激活账号</h1>{message && <p role={success ? 'status' : 'alert'} className="mt-5 rounded-lg bg-muted px-4 py-3 text-sm">{message}</p>}
    {!success && <form className="mt-5 space-y-4" onSubmit={submit}>{!token && <p role="alert" className="text-sm text-destructive">激活链接缺少令牌。</p>}<label className="block text-sm font-medium" htmlFor="activation-password">设置密码</label><Input id="activation-password" type="password" autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)} /><label className="block text-sm font-medium" htmlFor="activation-confirm">确认密码</label><Input id="activation-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} /><Button type="submit" fullWidth loading={busy} disabled={!token}>{busy ? '激活中…' : '激活账号'}</Button></form>}
    <Link href="/login" className="mt-5 block text-center text-sm text-brand hover:underline">返回登录</Link>
  </section></main>;
}
