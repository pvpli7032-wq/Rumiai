'use client';
import { zhText, zhError } from '@/lib/zh-text';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { afterLoginTarget } from '@/lib/next-path';
import { LogIn, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState('');
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('closed');
    if (value === 'complete' || value === 'pending') setClosed(value);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) {
      router.push(afterLoginTarget());
    } else {
      setError(zhError(result.error || '') || zhText("เข้าสู่ระบบไม่สำเร็จ"));
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="absolute inset-0">
        <div className="absolute top-1/3 left-1/3 w-64 h-64 bg-purple-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/3 w-64 h-64 bg-pink-600/15 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="bg-zinc-900 border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-purple-500/30">
              <LogIn className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-athiti text-white">{zhText("เข้าสู่ระบบ")}</h1>
            <p className="text-zinc-400 font-athiti mt-1 text-sm">{zhText("ยินดีต้อนรับกลับ!")}</p>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-athiti text-center">
              {error}
            </div>
          )}
          {closed && <p role="status" className="mb-4 rounded-sm border border-border p-3 text-sm">账号已注销，原登录凭据已失效。{closed === 'pending' ? '部分文件仍在清理或等待共享归属核查。' : '本次文件清理已完成。'}订单与审计记录按注销说明保留。</p>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5 font-athiti">{zhText("อีเมล")}</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all font-athiti"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5 font-athiti">{zhText("รหัสผ่าน")}</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all pr-12 font-athiti"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-linear-to-r/srgb from-purple-600 to-pink-600 rounded-xl text-white font-semibold font-athiti hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 mt-2"
            >
              {loading ? zhText("กำลังเข้าสู่ระบบ...") : zhText("เข้าสู่ระบบ")}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-zinc-400 text-sm font-athiti">
              {zhText("ยังไม่มีบัญชี?")}{' '}
              <Link href="/register" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
                {zhText("สมัครสมาชิกฟรี")}</Link>
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-white/5 text-center">
            <p className="text-xs text-zinc-600">内部测试版，请自行注册账号。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
