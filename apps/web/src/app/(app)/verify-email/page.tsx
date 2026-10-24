'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {API} from '@rumiai/contracts/api-paths';

export default function VerifyEmailPage() {
  const [message, setMessage] = useState('正在验证邮箱…');
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    fetch(API.auth.verifyEmail, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token})})
      .then(async response => ({response, body: await response.json().catch(() => ({})) as {message?: string; error?: string}}))
      .then(({response, body}) => { setOk(response.ok); setMessage(body.message || body.error || '验证失败，请重新申请。'); })
      .catch(() => { setOk(false); setMessage('网络连接失败，请稍后重试。'); });
  }, []);
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-12">
    <section className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold">验证邮箱</h1>
      <p role={ok === false ? 'alert' : 'status'} className="mt-5 rounded-lg bg-muted px-4 py-3 text-sm leading-6">{message}</p>
      <Link href={ok ? '/login' : '/'} className="mt-5 inline-block text-sm text-brand hover:underline">{ok ? '前往登录' : '返回首页'}</Link>
    </section>
  </main>;
}
