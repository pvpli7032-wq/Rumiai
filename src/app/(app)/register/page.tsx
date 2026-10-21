'use client';
import { zhError } from '@/lib/copy/zh';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { afterLoginTarget } from '@/lib/next-path';
import { useUiConfig, readNumber } from '@/lib/settings/use-ui-config';
import { UserPlus, Eye, EyeOff } from 'lucide-react';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  // 密码位数由设置中心决定（accounts.passwordMinLength），前端提示与服务端校验同一份值。
  const passwordMinLength = readNumber(useUiConfig(), 'accounts.passwordMinLength');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [policy,setPolicy]=useState<{ageGate:{enabled:boolean;minimumAge:number|null;version:string|null};termsVersion:string|null;privacyVersion:string|null}>({ageGate:{enabled:false,minimumAge:null,version:null},termsVersion:null,privacyVersion:null});
  const [policyReady,setPolicyReady]=useState(false);
  const [policyLoadError,setPolicyLoadError]=useState(false);
  const [ageConfirmed,setAgeConfirmed]=useState(false),[termsAccepted,setTermsAccepted]=useState(false),[privacyAccepted,setPrivacyAccepted]=useState(false);
  useEffect(()=>{let active=true;void fetch('/api/compliance/registration-policy',{cache:'no-store'}).then(response=>response.ok?response.json():Promise.reject()).then(data=>{if(active){setPolicy(data);setPolicyReady(true);}}).catch(()=>{if(active){setPolicyLoadError(true);setError('无法读取注册确认要求，请刷新页面后重试。');}});return()=>{active=false;};},[]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (passwordMinLength !== undefined && password.length < passwordMinLength) { setError(`密码至少需要 ${passwordMinLength} 个字符`); return; }
    setLoading(true);
    const result = await register(username, email, password, {ageConfirmed,termsAccepted,privacyAccepted});
    setLoading(false);
    if (result.success) {
      router.push(afterLoginTarget());
    } else {
      setError(zhError(result.error || '') || "注册失败");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="absolute inset-0">
        <div className="absolute top-1/3 right-1/3 w-64 h-64 bg-purple-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-1/3 w-64 h-64 bg-pink-600/15 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="bg-zinc-900 border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-purple-500/30">
              <UserPlus className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">{"注册"}</h1>
            <p className="text-zinc-400 mt-1 text-sm">{"开始你的角色故事"}</p>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{"用户名"}</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                placeholder="username123"
                className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
              />
            </div>
            {policy.ageGate.enabled&&<label className="flex items-start gap-3 text-sm text-zinc-300"><input type="checkbox" checked={ageConfirmed} onChange={e=>setAgeConfirmed(e.target.checked)} required className="mt-1"/><span>我确认已年满 {policy.ageGate.minimumAge} 周岁（政策版本：{policy.ageGate.version}）。</span></label>}
            {policy.termsVersion&&<label className="flex items-start gap-3 text-sm text-zinc-300"><input type="checkbox" checked={termsAccepted} onChange={e=>setTermsAccepted(e.target.checked)} required className="mt-1"/><span>我已阅读并接受服务条款（版本：{policy.termsVersion}）。<Link className="text-purple-400 underline" href="/terms-and-policy">查看政策</Link></span></label>}
            {policy.privacyVersion&&<label className="flex items-start gap-3 text-sm text-zinc-300"><input type="checkbox" checked={privacyAccepted} onChange={e=>setPrivacyAccepted(e.target.checked)} required className="mt-1"/><span>我已阅读隐私政策（版本：{policy.privacyVersion}）。<Link className="text-purple-400 underline" href="/terms-and-policy">查看政策</Link></span></label>}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{"邮箱"}</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{"密码"}</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={passwordMinLength}
                  placeholder={passwordMinLength !== undefined ? `至少 ${passwordMinLength} 个字符` : '请输入密码'}
                  className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-hidden focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all pr-12"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading||!policyReady||policyLoadError}
              className="w-full py-3 bg-linear-to-r/srgb from-purple-600 to-pink-600 rounded-xl text-white font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 mt-2"
            >
              {loading ? "正在注册…" : policyLoadError ? '注册要求读取失败' : !policyReady ? '正在读取注册要求…' : "免费注册 🎉"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-zinc-400 text-sm">
              {"已有账号？"}{' '}
              <Link href="/login" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
                {"登录"}</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
