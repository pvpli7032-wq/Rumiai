'use client';

import {FormEvent, Suspense, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {ShieldCheck} from 'lucide-react';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';

function safeNext(value: string | null) {
  if (!value || value.includes('\\') || /[\r\n]/.test(value)) return '/admin';
  const parsed = new URL(value, 'https://admin.local');
  return parsed.origin === 'https://admin.local' && (parsed.pathname === '/admin' || parsed.pathname.startsWith('/admin/')) && parsed.pathname !== '/admin/login' ? parsed.pathname + parsed.search : '/admin';
}

function AdminLoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/auth/login', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '管理员登录失败，请检查账号。');
      router.replace(next);
    } catch (value) { setError(value instanceof Error ? value.message : '管理员登录失败，请稍后重试。'); setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4"><section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm"><div className="mb-6 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-brand-foreground"><ShieldCheck className="h-5 w-5" /></span><div><h1 className="text-xl font-semibold">星伴管理中心</h1><p className="text-sm text-muted-foreground">管理员独立登录</p></div></div><form className="space-y-4" onSubmit={submit}><label className="block space-y-1.5 text-sm font-medium">登录邮箱<Input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label><label className="block space-y-1.5 text-sm font-medium">密码<Input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<Button className="w-full" type="submit" loading={busy}>登录管理中心</Button></form></section></main>;
}


export default function AdminLoginPage() {
  return <Suspense fallback={<main className="p-8">正在加载管理登录…</main>}><AdminLoginForm /></Suspense>;
}
