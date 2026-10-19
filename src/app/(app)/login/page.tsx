'use client';
import { zhError } from '@/lib/copy/zh';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { afterLoginTarget } from '@/lib/next-path';
import { AlertCircle, ArrowRight, Bot, Eye, EyeOff, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * 站点登录界面（PC 优先）。
 *
 * 管理员从 /login?next=/admin 进入后台，走的也是这个页面，所以这里不使用
 * 临时配色：左侧品牌主视觉、右侧表单卡，颜色全部取自 globals.css 的品牌令牌。
 */
const HIGHLIGHTS = [
  { icon: Sparkles, title: '角色扮演', text: '数千个角色设定与世界观，随时开聊。' },
  { icon: MessagesSquare, title: '圈子社区', text: '按兴趣加入圈子，发布帖子与同好交流。' },
  { icon: ShieldCheck, title: '数据与合规', text: '内容年龄分级，注册即确认条款与隐私政策。' },
];

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
      setError(zhError(result.error || '') || "登录失败");
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* 品牌主视觉：窄屏隐藏，只在桌面展开成双栏。 */}
      <aside className="relative hidden w-[45%] max-w-[640px] shrink-0 overflow-hidden lg:block">
        <div aria-hidden className="absolute inset-0 bg-brand-gradient" />
        <div aria-hidden className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.5),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.35),transparent_40%)]" />
        <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <Bot className="h-6 w-6 text-white" />
            </span>
            <span className="text-lg font-semibold text-white">星伴 AI 角色社区</span>
          </div>
          <div className="max-w-md">
            <h2 className="text-3xl font-bold leading-tight text-white xl:text-4xl">和喜欢的角色，聊到天亮</h2>
            <p className="mt-4 text-sm leading-7 text-white/85">
              登录后可继续对话、管理自己的角色与钱包；运营人员从这里进入管理中心。
            </p>
            <ul className="mt-8 space-y-5">
              {HIGHLIGHTS.map(item => (
                <li key={item.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white backdrop-blur">
                    <item.icon className="h-[18px] w-[18px]" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{item.title}</span>
                    <span className="block text-sm leading-6 text-white/80">{item.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs leading-6 text-white/70">
            未满 18 周岁请在监护人指导下使用。使用即表示同意服务条款与隐私政策。
          </p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col gap-4 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-brand-foreground">
              <Bot className="h-6 w-6" />
            </span>
            <span className="text-xl font-semibold tracking-tight text-foreground">星伴 AI 角色社区</span>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">登录</h1>
              <p className="mt-2 text-sm text-muted-foreground">欢迎回来，请输入邮箱和密码。</p>
            </div>

            {error && (
              <div role="alert" className="mb-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {closed && (
              <p role="status" className="mb-5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
                账号已注销，原登录凭据已失效。{closed === 'pending' ? '部分文件仍在清理或等待共享归属核查。' : '本次文件清理已完成。'}订单与审计记录按注销说明保留。
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="login-email" className="block text-sm font-medium text-foreground">邮箱</label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="your@email.com"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="login-password" className="block text-sm font-medium text-foreground">密码</label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" size="lg" fullWidth loading={loading} trailingIcon={loading ? undefined : <ArrowRight className="h-4 w-4" />}>
                {loading ? '正在登录…' : '登录'}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              还没有账号？{' '}
              <Link href="/register" className="font-medium text-brand underline-offset-4 transition-colors hover:underline">
                免费注册
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-xs leading-6 text-muted-foreground">
            内部测试版，请自行注册账号。前台页面可在{' '}
            <Link href="/" className="underline-offset-4 hover:underline">首页</Link>{' '}
            浏览。
          </p>
        </div>
      </main>
    </div>
  );
}
