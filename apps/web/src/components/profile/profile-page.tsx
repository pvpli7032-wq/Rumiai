'use client';
import { zhError } from '@rumiai/contracts/copy/zh';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@web/lib/auth-context';
import { ReaderPreferences } from './reader-preferences';
import { AccountClosure } from './account-closure';
import { AdminEntry } from './admin-entry';
import { DesignIcon } from '@/components/primitives/design-icon';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { InviteCard } from '@/components/growth';
import { loginWithNext } from '@web/lib/next-path';
import { Flame, CheckCircle2, Circle, Gift, Loader2, LogOut, Download, ArrowUpRight, ChevronRight, Crown, Coins, BookOpen, Shield, HelpCircle, Activity } from 'lucide-react';

interface Mission { id: string; title: string; description?: string; rewardCoins: number; category: string; conditionTarget:number; progress:number; qualified:boolean; period:string; isCompleted: boolean; }
interface Favorite { id: string; name: string; tagline?: string; avatarUrl?: string; }

export default function ProfilePage() {
  const { user, token, isLoading: authLoading, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [checkinStatus, setCheckinStatus] = useState<{ checkedInToday: boolean; streakDay: number; nextCoins: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [dataLoading, setDataLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [editing, setEditing] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const leavingPage = useRef(false);
  const rewardActionRef = useRef(false);

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
  async function saveProfile() {
    if (!token || profileSaving) return;
    setProfileSaving(true); setProfileSaveError('');
    try {
      const response = await fetch('/api/users/me', {method: 'PUT', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({displayName: displayNameInput, avatarUrl: avatarUrlInput || null})});
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '资料保存失败，请重试。'); }
      await refreshUser(); setEditing(false);
    } catch (error) { setProfileSaveError(error instanceof TypeError ? '网络连接失败，请重试。' : (error as Error).message); }
    finally { setProfileSaving(false); }
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
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    setProfileError(''); setDataLoading(true);
    try {
      const [missRes, checkinRes, favoritesRes] = await Promise.all([
        fetch('/api/missions', { headers }),
        fetch('/api/checkin/status', { headers }),
        fetch('/api/characters?scope=bookmarked', { headers }),
      ]);
      if (!missRes.ok || !checkinRes.ok) throw new Error('资料加载失败，请重试。');
      setMissions(await missRes.json());
      setCheckinStatus(await checkinRes.json());
      if (!favoritesRes.ok) throw new Error('收藏读取失败，请重试。');
      setFavorites((await favoritesRes.json()).slice(0, 4));
    } catch (error) {
      setProfileError(error instanceof TypeError ? '网络连接失败，请重试。' : (error as Error).message);
    } finally { setDataLoading(false); }
  }

  async function handleCheckin() {
    if (!token || checkinLoading || rewardActionRef.current) return;
    rewardActionRef.current = true;
    setCheckinLoading(true);
    try {
      const res = await fetch('/api/checkin', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(zhError(data.error || '') || '操作失败');
      alert("✅ 签到成功，获得 " + (data.coinsEarned) + " 🪙，连续签到第 " + (data.streakDay) + " 天");
      await refreshUser();
      await fetchData();
    } catch (error) {
      alert(error instanceof TypeError ? '网络连接失败，请重试。' : (error as Error).message);
    } finally {
      setCheckinLoading(false);
      rewardActionRef.current = false;
    }
  }

  async function handleMission(missionId: string) {
    if (!token || loading || rewardActionRef.current) return;
    rewardActionRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/missions/${missionId}/complete`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'Mission condition not met') throw new Error(`任务还未达成：${data.progress ?? 0}/${data.target ?? 0}`);
        throw new Error(zhError(data.error || '') || '任务领取失败，请重试。');
      }
      alert("🎉 任务完成，获得" + (data.coinsEarned) + "🪙");
      await refreshUser();
      await fetchData();
    } catch (error) {
      alert(error instanceof TypeError ? '网络连接失败，请重试。' : (error as Error).message);
    } finally {
      setLoading(false);
      rewardActionRef.current = false;
    }
  }

  if (!user) return <div role="status" aria-label="正在读取个人资料" className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 text-brand animate-spin" /></div>;

  const displayName = user.displayName?.trim() || user.username;

  return (
    <main className="min-h-screen bg-background px-4 pb-24 pt-4 text-foreground">
      <div className="mx-auto max-w-2xl space-y-5">
        <section className="relative overflow-hidden rounded-[24px] border border-border bg-secondary p-5">
          <DesignIcon name="ph:planet" size={160} className="pointer-events-none absolute -right-9 -top-5 text-brand/10" />
          <div className="relative flex items-center gap-4">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-card bg-card text-3xl font-semibold text-brand">{user.avatarUrl ? <img src={user.avatarUrl} alt={displayName} className="h-full w-full object-cover" /> : displayName.slice(0, 1)}</span>
            <div className="min-w-0 flex-1"><h1 className="break-words text-2xl font-bold">{displayName}</h1><p className="mt-1 truncate text-sm text-muted-foreground">@{user.username}</p><button type="button" className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-full bg-card px-4 text-sm font-semibold text-brand" onClick={() => { setDisplayNameInput(displayName); setAvatarUrlInput(user.avatarUrl || ''); setProfileSaveError(''); setEditing(true); }}>编辑资料 <ArrowUpRight className="h-4 w-4" /></button></div>
          </div>
        </section>
        <nav aria-label="我的内容" className="grid grid-cols-3 divide-x divide-border rounded-[20px] border border-border bg-card py-3">
          {([{href:'/my-characters?scope=bookmarked',name:'我的收藏',icon:'ph:star'}, {href:'/my-characters',name:'我的创作',icon:'ph:plus-circle'}, {href:'/circles',name:'我的圈子',icon:'ph:planet'}] as const).map((entry,index) => <Link key={entry.href} href={entry.href} className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-2 px-1 text-sm font-semibold"><DesignIcon name={entry.icon} size={25} className={index === 1 ? 'text-brand' : 'text-[var(--action)]'} /><span>{entry.name}</span></Link>)}
        </nav>
        {editing && <section className="rounded-2xl border border-border bg-card p-5"><h2 className="font-semibold">编辑资料</h2><div className="mt-4 grid gap-3"><label className="text-sm">昵称<input className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3" value={displayNameInput} onChange={event => setDisplayNameInput(event.target.value)} required /></label><label className="text-sm">头像地址<input className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3" value={avatarUrlInput} onChange={event => setAvatarUrlInput(event.target.value)} /></label>{profileSaveError && <p role="alert" className="text-sm text-destructive">{profileSaveError}</p>}<div className="flex gap-2"><button type="button" disabled={profileSaving} onClick={() => void saveProfile()} className="min-h-11 rounded-xl bg-brand-gradient px-4 text-sm font-medium text-white disabled:opacity-50">{profileSaving ? '正在保存…' : '保存资料'}</button><button type="button" disabled={profileSaving} onClick={() => setEditing(false)} className="min-h-11 rounded-xl border border-border px-4 text-sm">取消</button></div></div></section>}

        {profileError && <section role="alert" className="rounded-[20px] border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{profileError} <button type="button" className="min-h-11 underline" onClick={() => void fetchData()}>重试</button></section>}
        <section aria-labelledby="profile-favorites"><div className="mb-3 flex items-center justify-between"><h2 id="profile-favorites" className="relative pb-2 text-xl font-semibold">最近收藏<span aria-hidden className="absolute bottom-0 left-0 h-0.5 w-5 rounded-full bg-[var(--action)]" /></h2><Link className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground" href="/my-characters?scope=bookmarked">查看全部 <ArrowUpRight className="h-4 w-4" /></Link></div>
          {dataLoading ? <div role="status" aria-label="正在读取收藏" className="grid grid-cols-3 gap-3">{[0,1,2].map(item => <div key={item} className="h-36 animate-pulse rounded-[20px] bg-muted" />)}</div> : favorites.length > 0 ? <div className="flex gap-3 overflow-x-auto pb-2">{favorites.map(item => <Link key={item.id} href={'/chat?character='+encodeURIComponent(item.id)} className="w-[126px] shrink-0"><span className="block aspect-[4/5] overflow-hidden rounded-[20px] bg-muted">{item.avatarUrl ? <img className="h-full w-full object-cover" src={item.avatarUrl} alt="" /> : <span className="flex h-full items-center justify-center text-muted-foreground"><DesignIcon name="ph:user-circle" size={40} /></span>}</span><span className="mt-2 block truncate text-sm font-semibold">{item.name}</span>{item.tagline && <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{item.tagline}</span>}</Link>)}</div> : <div className="rounded-[20px] border border-dashed border-border p-4 text-sm text-muted-foreground">{profileError ? '收藏暂时无法显示，请重试读取。' : '还没有收藏，去发现喜欢的角色吧。'}<Link href="/discover" className="ml-1 inline-flex min-h-11 items-center text-brand">发现角色 <ChevronRight className="h-4 w-4" /></Link></div>}
        </section>
        <Link href="/membership" className="relative flex items-center gap-3 overflow-hidden rounded-[24px] border border-border bg-secondary p-4"><Crown className="h-10 w-10 shrink-0 text-brand" /><span className="min-w-0 flex-1"><span className="block text-xl font-semibold">星伴会员</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">查看会员权益、续费与订单状态。</span></span><span className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-card px-3 text-sm font-semibold text-brand">查看权益 <ArrowUpRight className="h-4 w-4" /></span></Link>
        <Link href="/shop" className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-[var(--action)]"><Coins className="h-6 w-6" /></span><span className="min-w-0 flex-1"><span className="block font-semibold">账户与资产</span><span className="mt-1 block text-xs text-muted-foreground">金币 {user.coins.toLocaleString()} · 订单与流水</span></span><ChevronRight className="h-5 w-5 text-muted-foreground" /></Link>
        <nav aria-label="账户设置" className="grid grid-cols-2 overflow-hidden rounded-[20px] border border-border bg-card">
          {([{href:'#profile-reading',title:'外观与阅读',desc:'主题、字体与阅读体验',Icon:BookOpen},{href:'#profile-security',title:'隐私与安全',desc:'数据导出与账户管理',Icon:Shield},{href:'/ai-usage',title:'AI 用量与额度',desc:'查看实际使用记录',Icon:Activity},{href:'#profile-help',title:'帮助与反馈',desc:'举报处理与使用帮助',Icon:HelpCircle}] as const).map(({href,title,desc,Icon},index) => <Link key={href} href={href} className={`flex min-h-24 min-w-0 items-start gap-2.5 p-3.5 ${index < 2 ? 'border-b border-border' : ''} ${index % 2 === 0 ? 'border-r border-border' : ''}`}><Icon className={`mt-0.5 h-5 w-5 shrink-0 ${index % 2 === 0 ? 'text-brand' : 'text-[var(--action)]'}`} /><span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{desc}</span></span></Link>)}
        </nav>
        <AdminEntry />
        <section aria-label="每日成长" className="space-y-4">
        {/* Daily Check-in */}
        {checkinStatus && (
          <div className="bg-card border border-border rounded-[20px] p-4">
            <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
              <Flame className="w-5 h-5 text-[var(--action)]" /> {"每日签到"}</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-foreground text-sm">{"当前连续签到："}<span className="font-bold">{checkinStatus.streakDay} {"天 🔥"}</span></p>
                <p className="text-muted-foreground text-xs mt-1">{"下次奖励："}<span className="text-foreground">{checkinStatus.nextCoins} 🪙</span></p>
              </div>
              <button
                onClick={handleCheckin}
                disabled={checkinStatus.checkedInToday || checkinLoading || loading}
                className="px-5 py-2.5 min-h-11 bg-brand rounded-xl text-brand-foreground font-semibold hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                {checkinLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : checkinStatus.checkedInToday ? "✅ 今日已签到" : "🎁 签到"}
              </button>
            </div>
          </div>
        )}

        {/* Missions */}
        <div className="bg-card border border-border rounded-[20px] p-4">
          <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
            <Gift className="w-5 h-5 text-brand" /> {"任务"}</h2>
          <div className="space-y-3">
            {missions.map(m => (
              <div key={m.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${m.isCompleted ? 'border-green-500/20 bg-green-500/5' : 'border-border bg-muted/30 hover:border-brand/30'}`}>
                {m.isCompleted ? <CheckCircle2 className="w-5 h-5 text-foreground shrink-0" /> : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${m.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{m.title}</p>
                  {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                  {!m.isCompleted&&<p className="text-xs text-muted-foreground">进度 {m.progress}/{m.conditionTarget} · {m.period==='ONCE'?'一次':m.period==='DAILY'?'每日':'每周'}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-foreground font-bold">+{m.rewardCoins}🪙</span>
                  {!m.isCompleted && (
                    <button onClick={() => handleMission(m.id)} disabled={loading || checkinLoading || !m.qualified} className="min-h-11 px-3 py-1.5 bg-secondary border border-border rounded-lg text-foreground text-xs hover:bg-muted transition-all disabled:opacity-50">
                      {m.qualified?"领取":'未达成'}</button>
                  )}
                </div>
              </div>
            ))}
            {missions.length === 0 && <p className="text-muted-foreground text-sm text-center py-4">{"暂时没有任务"}</p>}
          </div>
        </div>


        </section>
        <InviteCard />
        <section id="profile-reading" className="scroll-mt-24 space-y-4"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">外观与阅读</h2><ThemeToggle /></div><ReaderPreferences /></section>
        <section id="profile-help" className="scroll-mt-24 rounded-[20px] border border-border bg-card p-4"><h2 className="font-semibold">帮助与反馈</h2><div className="mt-2 flex flex-wrap gap-x-5"><Link href="/my-reports" className="inline-flex min-h-11 items-center text-sm text-brand">我的举报 <ChevronRight className="h-4 w-4" /></Link><Link href="/zh/terms-and-policy" className="inline-flex min-h-11 items-center text-sm text-brand">条款与隐私政策 <ChevronRight className="h-4 w-4" /></Link></div><details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">安装到手机桌面</summary><p className="text-sm leading-6 text-muted-foreground">Android 可使用浏览器的安装菜单；iPhone 请在 Safari 的分享菜单选择“添加到主屏幕”。安装提示需在正式 HTTPS 地址或本机 localhost 下使用。</p><p className="mt-2 text-xs leading-5 text-muted-foreground">当前为内部测试版；真实 AI 与支付取决于服务端配置。真实支付尚未完成商户验收。</p></details></section>
        <section id="profile-security" className="scroll-mt-24 space-y-4"><div className="rounded-[20px] border border-border bg-card p-4"><h2 className="font-semibold">我的数据</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">导出本人资料、聊天、社区、关注收藏、举报申诉、AI 用量和账务记录。</p><button type="button" onClick={handleExport} disabled={exporting} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? '正在导出…' : '导出数据'}</button>{exportError && <p role="alert" className="mt-2 text-sm text-destructive">{exportError}</p>}</div>
        {token && <AccountClosure token={token} onClosed={pending => { leavingPage.current = true; logout(); router.replace(`/login?closed=${pending ? 'pending' : 'complete'}`); }} />}
        {/* Signing out revokes the token server-side (tokenVersion), so it cannot be
            replayed even if it was copied out of localStorage. There was no way to reach
            that endpoint from the UI at all before this. */}
        <button
          onClick={() => { leavingPage.current = true; logout(); router.push('/'); }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 py-3 text-sm font-bold text-destructive transition-colors hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4" />
          {"退出登录"}</button>

        </section>
      </div>
    </main>
  );
}
