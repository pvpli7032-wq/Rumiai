'use client';
import {useState} from 'react';
import Link from 'next/link';
import {API} from '@rumiai/contracts/api-paths';
import {Button} from '@rumiai/ui/button';
import {Input} from '@rumiai/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const response = await fetch(API.auth.forgotPassword, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email})}).catch(() => null);
    const body = await response?.json().catch(() => ({})) as {message?: string; error?: string} | undefined;
    setBusy(false);
    setMessage(response?.ok ? (body?.message || '如果该邮箱已注册，我们会发送一封重置邮件。请检查收件箱和垃圾邮件。') : (body?.error || '网络连接失败，请稍后重试。'));
  }
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-12">
    <section className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold">找回密码</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">输入注册邮箱。为保护账号安全，无论邮箱是否存在，页面都会显示相同结果。</p>
      {message && <p role="status" className="mt-5 rounded-lg bg-muted px-4 py-3 text-sm leading-6">{message}</p>}
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label htmlFor="recovery-email" className="block text-sm font-medium">邮箱</label>
        <Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
        <Button type="submit" fullWidth loading={busy}>{busy ? '正在提交…' : '发送重置邮件'}</Button>
      </form>
      <Link href="/login" className="mt-5 block text-center text-sm text-brand hover:underline">返回登录</Link>
    </section>
  </main>;
}
