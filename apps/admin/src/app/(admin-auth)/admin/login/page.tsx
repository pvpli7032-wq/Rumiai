'use client';

import {FormEvent, Suspense, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {ArrowRight, LockKeyhole, ShieldCheck, Sparkles} from 'lucide-react';
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
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(320px,0.85fr)_1.15fr]">
      <aside className="admin-sidebar relative hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-3"><Sparkles className="h-8 w-8 text-brand" /><span className="text-2xl font-semibold tracking-wider">星伴</span><span className="ml-2 border-l border-border pl-4 text-sm text-muted-foreground">管理中心</span></div>
        <div className="max-w-md py-16">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-brand"><ShieldCheck className="h-3.5 w-3.5" />独立管理工作区</span>
          <h2 className="text-4xl font-semibold leading-normal tracking-tight">有条理地管理，<br />更专注于运营。</h2>
          <p className="mt-6 text-sm leading-7 text-muted-foreground">连接用户、内容与业务数据。所有管理操作依照账号权限执行，前台与后台会话独立。</p>
          <div className="mt-10 grid grid-cols-3 gap-3 border-t border-border pt-6 text-xs text-muted-foreground"><span>用户与权益</span><span>内容与社区</span><span>数据与运营</span></div>
        </div>
        <p className="text-xs text-muted-foreground">星伴 · 运营工作台</p>
      </aside>
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <section className="w-full max-w-sm">
          <span className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/15 bg-brand-soft text-brand"><LockKeyhole className="h-6 w-6" /></span>
          <h1 className="text-2xl font-semibold tracking-tight">登录星伴管理中心</h1>
          <p className="mb-8 mt-3 text-sm leading-6 text-muted-foreground">管理员独立登录，请使用已授权的管理账号。</p>
          <form className="space-y-5" onSubmit={submit}>
            <label className="block space-y-2 text-sm font-medium">登录邮箱<Input className="bg-card" type="email" placeholder="请输入管理员邮箱" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label className="block space-y-2 text-sm font-medium">密码<Input className="bg-card" type="password" placeholder="请输入密码" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
            {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            <Button className="w-full" type="submit" loading={busy} trailingIcon={<ArrowRight className="h-4 w-4" />}>登录管理中心</Button>
          </form>
          <p className="mt-8 flex items-center gap-2 border-t border-border pt-5 text-xs leading-5 text-muted-foreground"><ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-brand" />普通用户账号不能用于后台登录</p>
        </section>
      </div>
    </main>
  );
}


export default function AdminLoginPage() {
  return <Suspense fallback={<main className="p-8">正在加载管理登录…</main>}><AdminLoginForm /></Suspense>;
}
