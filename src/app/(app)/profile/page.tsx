'use client';
import { zhError } from '@/lib/copy/zh';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ReaderPreferences } from '@/components/reader-preferences';
import { AccountClosure } from '@/components/account-closure';
import { AdminEntry } from '@/components/admin/admin-entry';
import { loginWithNext } from '@/lib/next-path';
import { User, Flame, Coins, CheckCircle2, Circle, Gift, Loader2, LogOut, Download } from 'lucide-react';

interface Mission { id: string; title: string; description?: string; rewardCoins: number; category: string; conditionTarget:number; progress:number; qualified:boolean; period:string; isCompleted: boolean; }

const TIER_COLORS: Record<string, string> = {
  ROOKIE: 'from-gray-400 to-gray-600',
  PRO: 'from-green-400 to-emerald-600',
  MASTER: 'from-blue-400 to-blue-600',
  LEGEND: 'from-yellow-400 to-amber-600',
  EPIC: 'from-purple-400 to-violet-600',
  MYTHIC: 'from-red-400 to-rose-600',
};

export default function ProfilePage() {
  const { user, token, isLoading: authLoading, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [checkinStatus, setCheckinStatus] = useState<{ checkedInToday: boolean; streakDay: number; nextCoins: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const leavingPage = useRef(false);

  async function handleExport() {
    if (!token || exporting) return;
    setExporting(true); setExportError('');
    try {
      const response = await fetch('/api/users/me/export', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '数据导出失败，请稍后重试。'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'xingban-account-data.json'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setExportError(error instanceof TypeError ? '网络连接失败，请重试。' : (error as Error).message); }
    finally { setExporting(false); }
  }

  useEffect(() => {
    if (leavingPage.current) return;
    // The provider restores the token from localStorage in its own effect, so on the first
    // pass it is still null even for someone signed in. Deciding before that settles sent
    // signed-in readers to the login form while the topbar showed their coins — the same
    // bug the chat page had.
    if (authLoading) return;
    if (!token) { router.push(loginWithNext()); return; }
    fetchData();
  }, [token, authLoading]);

  async function fetchData() {
    const headers = { Authorization: `Bearer ${token}` };
    const [missRes, checkinRes] = await Promise.all([
      fetch('/api/missions', { headers }),
      fetch('/api/checkin/status', { headers }),
    ]);
    if (missRes.ok) setMissions(await missRes.json());
    if (checkinRes.ok) setCheckinStatus(await checkinRes.json());
  }

  async function handleCheckin() {
    setCheckinLoading(true);
    const res = await fetch('/api/checkin', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setCheckinLoading(false);
    if (res.ok) {
      alert("✅ 签到成功，获得 " + (data.coinsEarned) + " 🪙，连续签到第 " + (data.streakDay) + " 天");
      await refreshUser();
      fetchData();
    } else {
      alert(zhError(data.error || '') || "操作失败");
    }
  }

  async function handleMission(missionId: string) {
    setLoading(true);
    const res = await fetch(`/api/missions/${missionId}/complete`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      alert("🎉 任务完成，获得" + (data.coinsEarned) + "🪙");
      await refreshUser();
      fetchData();
    } else if(data.error==='Mission condition not met') alert(`任务还未达成：${data.progress??0}/${data.target??0}`);
    else if(data.error) alert(data.error);
  }

  if (!user) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-8 h-8 text-purple-400 animate-spin" /></div>;

  const tierColor = TIER_COLORS[user.tier] || TIER_COLORS.ROOKIE;

  return (
    <div className="min-h-screen bg-zinc-950 text-white px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <AdminEntry />
        <Link href="/my-characters" className="flex min-h-12 items-center justify-between rounded-xl border border-border p-4">我的角色与收藏 <span>管理作品 →</span></Link>
        <Link href="/ai-usage" className="flex min-h-12 items-center justify-between rounded-xl border border-border p-4">AI 用量与额度 <span>查看 →</span></Link>
        <Link href="/my-reports" className="flex min-h-12 items-center justify-between rounded-xl border border-border p-4">我的举报 <span>查看处理状态 →</span></Link>
        <section className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-semibold">我的数据</h2><p className="mt-1 text-sm text-zinc-400">导出本人资料、聊天、社区、关注收藏、举报申诉、AI 用量和账务记录。</p></div>
            <button type="button" onClick={handleExport} disabled={exporting} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? '正在导出…' : '导出数据'}</button>
          </div>
          {exportError && <p role="alert" className="mt-2 text-sm text-red-400">{exportError}</p>}
        </section>
        {/* Profile Card */}
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-full bg-linear-to-br/srgb ${tierColor} flex items-center justify-center text-2xl font-bold text-white shadow-xl`}>
              {user.username[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold font-athiti text-white">{user.username}</h1>
              <p className="text-zinc-400 font-athiti text-sm">{user.email}</p>
              <div className={`inline-flex items-center gap-1.5 mt-1 px-3 py-1 rounded-full bg-linear-to-r/srgb ${tierColor} text-white text-xs font-bold font-athiti`}>
                ⭐ {user.tier}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-yellow-400 mb-1"><Coins className="w-4 h-4" /></div>
              <p className="text-xl font-bold text-white font-athiti">{user.coins.toLocaleString()}</p>
              <p className="text-xs text-zinc-500 font-athiti">{"金币"}</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-orange-400 mb-1"><Flame className="w-4 h-4" /></div>
              <p className="text-xl font-bold text-white font-athiti">{user.streakCount}</p>
              <p className="text-xs text-zinc-500 font-athiti">{"连续签到天数"}</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-purple-400 mb-1"><User className="w-4 h-4" /></div>
              <p className="text-xl font-bold text-white font-athiti">1</p>
              <p className="text-xs text-zinc-500 font-athiti">{"角色"}</p>
            </div>
          </div>
        </div>

        {/* Daily Check-in */}
        {checkinStatus && (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-bold font-athiti text-white mb-4 flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-400" /> {"每日签到"}</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-300 font-athiti text-sm">{"当前连续签到："}<span className="text-orange-400 font-bold">{checkinStatus.streakDay} {"天 🔥"}</span></p>
                <p className="text-zinc-500 font-athiti text-xs mt-1">{"下次奖励："}<span className="text-yellow-400">{checkinStatus.nextCoins} 🪙</span></p>
              </div>
              <button
                onClick={handleCheckin}
                disabled={checkinStatus.checkedInToday || checkinLoading}
                className="px-5 py-2.5 bg-linear-to-r/srgb from-orange-500 to-amber-500 rounded-xl text-white font-semibold font-athiti hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20 text-sm"
              >
                {checkinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : checkinStatus.checkedInToday ? "✅ 今日已签到" : "🎁 签到"}
              </button>
            </div>
          </div>
        )}

        {/* Missions */}
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-bold font-athiti text-white mb-4 flex items-center gap-2">
            <Gift className="w-5 h-5 text-purple-400" /> {"任务"}</h2>
          <div className="space-y-3">
            {missions.map(m => (
              <div key={m.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${m.isCompleted ? 'border-green-500/20 bg-green-500/5' : 'border-white/10 bg-zinc-800 hover:border-white/20'}`}>
                {m.isCompleted ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" /> : <Circle className="w-5 h-5 text-zinc-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold font-athiti ${m.isCompleted ? 'text-zinc-500 line-through' : 'text-white'}`}>{m.title}</p>
                  {m.description && <p className="text-xs text-zinc-500 font-athiti">{m.description}</p>}
                  {!m.isCompleted&&<p className="text-xs text-zinc-500">进度 {m.progress}/{m.conditionTarget} · {m.period==='ONCE'?'一次':m.period==='DAILY'?'每日':'每周'}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-yellow-400 font-bold">+{m.rewardCoins}🪙</span>
                  {!m.isCompleted && (
                    <button onClick={() => handleMission(m.id)} disabled={loading||!m.qualified} className="px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 rounded-lg text-purple-300 text-xs font-athiti hover:bg-purple-600/30 transition-all disabled:opacity-50">
                      {m.qualified?"领取":'未达成'}</button>
                  )}
                </div>
              </div>
            ))}
            {missions.length === 0 && <p className="text-zinc-500 font-athiti text-sm text-center py-4">{"暂时没有任务"}</p>}
          </div>
        </div>

        <div className="mt-6">
          <ReaderPreferences />
        </div>

        <section className="mt-6 rounded-xl border border-border p-4"><h2 className="font-semibold">安装到手机桌面</h2><p className="mt-2 text-sm text-muted-foreground">Android 可使用浏览器的安装菜单；iPhone 请在 Safari 的分享菜单选择“添加到主屏幕”。安装提示需在正式 HTTPS 地址或本机 localhost 下使用。</p><p className="mt-2 text-xs text-muted-foreground">当前为内部测试版；真实 AI 与支付取决于服务端配置。真实支付尚未完成商户验收。</p></section>
        {token && <AccountClosure token={token} onClosed={pending => { leavingPage.current = true; logout(); router.replace(`/login?closed=${pending ? 'pending' : 'complete'}`); }} />}
        {/* Signing out revokes the token server-side (tokenVersion), so it cannot be
            replayed even if it was copied out of localStorage. There was no way to reach
            that endpoint from the UI at all before this. */}
        <button
          onClick={() => { leavingPage.current = true; logout(); router.push('/'); }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/5 py-3 font-athiti text-sm font-bold text-red-400 transition-colors hover:bg-red-500/10"
        >
          <LogOut className="h-4 w-4" />
          {"退出登录"}</button>
      </div>
    </div>
  );
}
