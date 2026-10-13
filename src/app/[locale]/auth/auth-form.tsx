'use client';
import { zhError } from '@/lib/zh-text';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { afterLoginTarget } from '@/lib/next-path';

export interface AuthCopy {
  heading: string;
  subhead: string;
  signIn: string;
  signUp: string;
  emailLabel: string;
  passwordLabel: string;
  displayNameLabel: string;
  switchToSignUp: string;
  switchToSignIn: string;
  submitting: string;
  genericError: string;
}

/**
 * The combined sign-in / sign-up form the live site serves at /{locale}/auth. This route
 * used to redirect to /login, so every localised call to action dropped the reader onto an
 * untranslated screen.
 *
 * Like /login and /register, the post-auth destination is read from window.location rather
 * than useSearchParams — that hook would force a Suspense boundary and break the
 * production prerender of this page.
 */
export function AuthForm({ copy }: { copy: AuthCopy }) {
  const { login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result =
      mode === 'signIn' ? await login(email, password) : await register(name, email, password);
    setLoading(false);
    if (result.success) router.push(afterLoginTarget());
    else setError(zhError(result.error || '') || copy.genericError);
  }

  return (
    <div className="relative w-full max-w-md">
      <div className="rounded-3xl border border-white/10 bg-zinc-900 p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500 shadow-xl shadow-purple-500/30">
            <LogIn className="h-7 w-7 text-white" />
          </div>
          <h1 className="font-athiti text-2xl font-bold text-white">{copy.heading}</h1>
          <p className="mt-1 font-athiti text-sm text-zinc-400">{copy.subhead}</p>
        </div>

        {/* Both forms live on one route, so the toggle is a tab rather than a link. */}
        <div className="mb-5 flex rounded-full bg-zinc-800 p-1">
          {(['signIn', 'signUp'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => { setMode(key); setError(''); }}
              className={`flex-1 rounded-full py-2 font-athiti text-sm font-bold transition-colors ${
                mode === key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {key === 'signIn' ? copy.signIn : copy.signUp}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center font-athiti text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signUp' && (
            <div>
              <label className="mb-1.5 block font-athiti text-sm font-medium text-zinc-300">
                {copy.displayNameLabel}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-zinc-800 px-4 py-3 font-athiti text-white placeholder-zinc-500 transition-all focus:border-purple-500/50 focus:outline-hidden focus:ring-1 focus:ring-purple-500/30"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block font-athiti text-sm font-medium text-zinc-300">
              {copy.emailLabel}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              className="w-full rounded-xl border border-white/10 bg-zinc-800 px-4 py-3 font-athiti text-white placeholder-zinc-500 transition-all focus:border-purple-500/50 focus:outline-hidden focus:ring-1 focus:ring-purple-500/30"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-athiti text-sm font-medium text-zinc-300">
              {copy.passwordLabel}
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full rounded-xl border border-white/10 bg-zinc-800 px-4 py-3 pr-11 font-athiti text-white placeholder-zinc-500 transition-all focus:border-purple-500/50 focus:outline-hidden focus:ring-1 focus:ring-purple-500/30"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-linear-to-r/srgb from-purple-600 to-pink-600 py-3 font-athiti font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? copy.submitting : mode === 'signIn' ? copy.signIn : copy.signUp}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(''); }}
          className="mt-4 w-full font-athiti text-sm text-purple-400 hover:text-purple-300"
        >
          {mode === 'signIn' ? copy.switchToSignUp : copy.switchToSignIn}
        </button>
      </div>
    </div>
  );
}
