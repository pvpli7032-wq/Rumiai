'use client';
import { CHARACTER_LIMITS } from '@/lib/characters/validation';
import { zhText, zhError } from '@/lib/zh-text';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { loginWithNext } from '@/lib/next-path';
import { Checklist, Counter, Field, Toggle } from '@/components/creator/fields';
import { ImageUpload } from '@/components/creator/image-upload';
import { LivePreview } from '@/components/creator/live-preview';
import { useSiteContent } from '@/lib/use-site-content';
import {
  ArrowLeft, Check, Eye, Loader2, MessageSquareQuote,
  RotateCcw, Search, Sparkles, Tags, UserRound, X,
} from 'lucide-react';

const DRAFT_KEY = 'khuiai:character-draft';

const LIMITS = { ...CHARACTER_LIMITS, description: CHARACTER_LIMITS.personality, bio: CHARACTER_LIMITS.background };

const SECTIONS = [
  { id: 'identity', label: zhText("ตัวตน"), desc: zhText("ชื่อ คำโปรย รูป"), icon: UserRound },
  { id: 'persona', label: zhText("บุคลิก"), desc: zhText("นิสัยและฉากหลัง"), icon: Sparkles },
  { id: 'opening', label: zhText("บทเปิด"), desc: zhText("ประโยคแรกที่พูด"), icon: MessageSquareQuote },
  { id: 'tags', label: zhText("แท็ก"), desc: zhText("ช่วยให้คนหาเจอ"), icon: Tags },
  { id: 'publish', label: zhText("เผยแพร่"), desc: zhText("สาธารณะหรือส่วนตัว"), icon: Eye },
] as const;

interface Draft {
  name: string; tagline: string; description: string; bio: string; greeting: string;
  avatarUrl: string; tags: string[]; badges: string[]; isExclusive: boolean; isPublic: boolean;
  /** Both reach the model's system prompt; neither was collectable before. */
  scenario: string; roleTemplate: string;
  /** Unlocks the adult direction in the system prompt. */
  isAdult: boolean; copyrightStatement: string;
}

const EMPTY: Draft = {
  name: '', tagline: '', description: '', bio: '', greeting: '',
  avatarUrl: '', tags: [], badges: [], isExclusive: false, isPublic: true,
  scenario: '', roleTemplate: '', isAdult: false, copyrightStatement: '',
};

export default function CreatorForm({ editId }: { editId?: string }) {
  const draftKey = editId ? DRAFT_KEY + ':edit:' + editId : DRAFT_KEY;
  const [loaded, setLoaded] = useState(!editId);
  const { token, user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { tags: allTags, badges } = useSiteContent();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const [tagQuery, setTagQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const scrollRoot = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const blur = (key: string) => setTouched((t) => ({ ...t, [key]: true }));

  const toggleIn = (key: 'tags' | 'badges', value: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value],
    }));

  // Only the current load may update the form; stale StrictMode/navigation requests are cancelled.
  useEffect(() => {
    if (!editId) {
      const raw = localStorage.getItem(draftKey);
      if (raw) try { setDraft({ ...EMPTY, ...JSON.parse(raw) }); } catch {}
      return;
    }
    if (authLoading) return;
    if (!token || !user) { setError('请先登录后编辑角色。'); return; }
    const controller = new AbortController();
    setLoaded(false);
    setError(null);
    fetch('/api/characters/' + encodeURIComponent(editId), { signal: controller.signal, headers: { Authorization: 'Bearer ' + token } })
      .then(async res => { const data = await res.json(); if (!res.ok) throw Error('无法加载角色或没有访问权限。'); return data.character; })
      .then(c => {
        if (controller.signal.aborted) return;
        if (c.creatorId !== user.id) throw Error('只有作者可以编辑这个角色。');
        let cached = {};
        const local = localStorage.getItem(draftKey);
        if (local) try { const parsed = JSON.parse(local); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cached = parsed; } catch {}
        setDraft({ ...EMPTY, name:c.name, tagline:c.tagline||'', description:c.personality, bio:c.background||'', greeting:c.greeting||'', avatarUrl:c.avatarUrl||'', tags:(c.tags||'').split(',').filter(Boolean), badges:(c.badges||'').split(',').filter(Boolean), isExclusive:c.isExclusive, isPublic:c.publicationRequested, isAdult:c.isAdult, scenario:c.scenario||'', roleTemplate:c.roleTemplate||'', copyrightStatement:c.copyrightStatement||'', ...cached });
        setLoaded(true);
      })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [editId, token, draftKey, authLoading, user?.id]);

  const persist = useCallback((d: Draft) => {
    localStorage.setItem(draftKey, JSON.stringify(d));
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  }, [draftKey]);

  // Autosave a second after typing stops, so nothing is ever lost on reload.
  useEffect(() => {
    if (draft === EMPTY) return;
    const t = setTimeout(() => persist(draft), 1000);
    return () => clearTimeout(t);
  }, [draft, persist]);

  // ⌘S / Ctrl+S saves immediately.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        persist(draft);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, persist]);

  // ── scroll spy over the layout's scroll container ────────────────────
  useEffect(() => {
    const root = scrollRoot.current?.closest('.overflow-y-auto') as HTMLElement | null;
    const target: HTMLElement | Window = root ?? window;
    const onScroll = () => {
      const top = root ? root.getBoundingClientRect().top + 140 : 140;
      let current: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = sectionRefs.current[s.id];
        if (el && el.getBoundingClientRect().top <= top) current = s.id;
      }
      setActive(current);
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener('scroll', onScroll);
  }, []);

  const goTo = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  // ── validation & completeness ────────────────────────────────────────
  const errors = useMemo(() => {
    const e: Record<string, string | null> = {};
    e.name = draft.name.trim() ? null : zhText("ต้องมีชื่อตัวละคร");
    e.tagline = draft.tagline.trim() ? null : zhText("ต้องมีคำโปรย");
    e.description =
      draft.description.trim().length >= 40 ? null : zhText("อธิบายบุคลิกอย่างน้อย 40 ตัวอักษร เพื่อให้ AI จับโทนได้");
    return e;
  }, [draft]);

  const done = useMemo(
    () => ({
      identity: !errors.name && !errors.tagline,
      persona: !errors.description,
      opening: draft.greeting.trim().length > 0,
      tags: draft.tags.length > 0,
      publish: true,
    }),
    [errors, draft],
  );

  const requiredOk = !errors.name && !errors.tagline && !errors.description;
  const progress = Math.round((Object.values(done).filter(Boolean).length / SECTIONS.length) * 100);

  // ── submit ───────────────────────────────────────────────────────────
  async function submit() {
    persist(draft);
    if (!token) {
      router.push(loginWithNext());
      return;
    }
    if (!requiredOk) {
      setTouched({ name: true, tagline: true, description: true });
      setError(zhText("ยังกรอกข้อมูลที่จำเป็นไม่ครบ"));
      goTo(errors.name || errors.tagline ? 'identity' : 'persona');
      return;
    }
    if(draft.isPublic&&!draft.copyrightStatement.trim()){setError('申请公开前请填写角色及素材版权声明。');goTo('publish');return;}
    setSaving(true);
    setError(null);
    try {
    const res = await fetch(editId ? '/api/characters/' + encodeURIComponent(editId) : '/api/characters', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: draft.name,
        tagline: draft.tagline,
        personality: draft.description,
        background: draft.bio,
        greeting: draft.greeting,
        avatarUrl: draft.avatarUrl || null,
        tags: draft.tags.join(','),
        badges: draft.badges.join(','),
        isExclusive: draft.isExclusive,
        isPublic: draft.isPublic,
        copyrightStatement: draft.copyrightStatement,
        scenario: draft.scenario || null,
        roleTemplate: draft.roleTemplate || null,
        isAdult: draft.isAdult,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      localStorage.removeItem(draftKey);
      router.push(editId || draft.isPublic ? '/my-characters' : `/chat?character=${data.character.id}`);
    } else {
      setError(zhError(data.error || '') || '保存角色失败。');
    }
    } catch { setError('网络连接失败，草稿已保留，请重试。'); } finally { setSaving(false); }
  }

  function reset() {
    if (!confirm(zhText("ล้างข้อมูลทั้งหมดและเริ่มใหม่?"))) return;
    localStorage.removeItem(draftKey);
    setDraft(EMPTY);
    setTouched({});
    setSavedAt(null);
  }

  // Tag catalog is grouped straight out of the database.
  const filteredGroups = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    const groups = new Map<string, { key: string; label: string }[]>();
    for (const t of allTags) {
      if (q && !t.label.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)) continue;
      groups.set(t.group, [...(groups.get(t.group) ?? []), { key: t.key, label: t.label }]);
    }
    return [...groups.entries()].map(([label, tags]) => ({ label, tags }));
  }, [allTags, tagQuery]);

  const labelOf = (key: string) => allTags.find((t) => t.key === key)?.label ?? key;

  const inputCls =
    'w-full rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-base shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[#F2572B] focus-visible:outline-none';

  return (
    <div ref={scrollRoot} className="min-h-screen bg-background pb-40 desktop:pb-24">
      {/* Toolbar */}
      <div className="sticky top-16 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:px-8">
          <Link href="/" aria-label={zhText("กลับหน้าหลัก")} className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-athiti text-base font-bold leading-tight">{editId ? '编辑角色' : '创建角色'}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {savedAt ? zhText("บันทึกร่างอัตโนมัติ") + (savedAt) + zhText("น.") : zhText("ร่างจะถูกบันทึกให้อัตโนมัติ")}
            </p>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#EE4036] to-[#FAAF40] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
          </div>

          <button onClick={reset} aria-label={zhText("ล้างข้อมูล")} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-red-500">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowPreview(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-xs font-medium transition-colors hover:bg-accent xl:hidden"
          >
            <Eye className="h-3.5 w-3.5" />
            {zhText("ตัวอย่าง")}</button>
          <button
            onClick={submit}
            disabled={saving || !loaded}
            className="hidden h-9 items-center gap-1.5 rounded-lg bg-[linear-gradient(90deg,#FFA202,#FF1300)] px-4 text-sm font-semibold text-white shadow-[0_6px_20px_-8px_rgba(255,47,0,0.7)] transition-opacity hover:opacity-95 disabled:opacity-60 desktop:inline-flex"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {editId ? '保存修改' : draft.isPublic ? '提交审核' : '保存私有角色'}</button>
        </div>

        {/* Section nav — chips on mobile */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] desktop:hidden [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => goTo(s.id)}
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-athiti text-sm font-semibold transition-all ${
                active === s.id ? 'bg-gradient-to-r from-[#EE4036] to-[#FAAF40] text-white' : 'border border-zinc-200 dark:border-[#2A2A2A]'
              }`}
            >
              {done[s.id as keyof typeof done] && <Check className="h-3 w-3" />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 md:px-8 desktop:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_280px]">
        {/* Rail */}
        <nav className="sticky top-36 hidden h-fit space-y-1 desktop:block">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            const isDone = done[s.id as keyof typeof done];
            return (
              <button
                key={s.id}
                onClick={() => goTo(s.id)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-accent' : 'hover:bg-accent/60'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${
                    isDone ? 'bg-emerald-500/15 text-emerald-500' : isActive ? 'bg-[#F2572B]/15 text-[#F2572B]' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className={`block font-athiti text-sm font-bold ${isActive ? '' : 'text-muted-foreground'}`}>{s.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{s.desc}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Form */}
        <div className="min-w-0 space-y-6">
          {error && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</p>
          )}

          {/* 1 ── identity */}
          <Card refFn={(el) => (sectionRefs.current.identity = el)} id="identity" title={zhText("ตัวตน")} desc={zhText("สิ่งที่คนเห็นก่อนกดเข้ามาคุย")}>
            <Field label={zhText("ชื่อตัวละคร")} required error={touched.name ? errors.name : null} hint={zhText("แสดงบนการ์ดและในห้องแชท")}>
              <input
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => blur('name')}
                maxLength={LIMITS.name}
                placeholder={zhText("เช่น เซียวเฉิงเยี่ยน, มิรุโกะ, คริส — NOIR")}
                className={inputCls}
              />
              <Counter value={draft.name.length} max={LIMITS.name} />
            </Field>

            <Field label={zhText("คำโปรย")} required error={touched.tagline ? errors.tagline : null} hint={zhText("ประโยคเดียวที่ทำให้คนอยากกดเข้ามา")}>
              <input
                value={draft.tagline}
                onChange={(e) => set('tagline', e.target.value)}
                onBlur={() => blur('tagline')}
                maxLength={LIMITS.tagline}
                placeholder={zhText("เช่น \"ถ้าเธอคิดมาก… อย่าเริ่ม\"")}
                className={inputCls}
              />
              <Counter value={draft.tagline.length} max={LIMITS.tagline} />
            </Field>

            <Field label={zhText("รูปโปรไฟล์")} hint={zhText("ภาพโปสเตอร์แนวตั้งที่โชว์บนการ์ดในหน้าหลัก")}>
              <ImageUpload value={draft.avatarUrl} onChange={(url) => set('avatarUrl', url)} token={token} />
            </Field>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 dark:border-[#2A2A2A] dark:bg-[#141414]">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium leading-tight">{zhText("มีแค่ที่ Khui AI เท่านั้น")}</span>
                <span className="text-xs text-muted-foreground">{zhText("ติดป้าย Only on Khui AI บนการ์ด")}</span>
              </span>
              <Toggle checked={draft.isExclusive} onChange={(v) => set('isExclusive', v)} label={zhText("Only on Khui AI")} />
            </label>
          </Card>

          {/* 2 ── persona */}
          <Card refFn={(el) => (sectionRefs.current.persona = el)} id="persona" title={zhText("บุคลิก")} desc={zhText("ส่วนนี้ถูกส่งให้ AI ใช้สวมบทบาทโดยตรง")}>
            <Field label={zhText("นิสัยและน้ำเสียง")} required error={touched.description ? errors.description : null}>
              <textarea
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                onBlur={() => blur('description')}
                maxLength={LIMITS.description}
                placeholder={zhText("เย็นชา พูดสั้น ไม่สัญญาอะไรกับใคร ซื่อสัตย์แบบโหดร้าย เรียกตัวเองว่า 'ฉัน' และเรียกผู้เล่นว่า 'เธอ'")}
                className={`${inputCls} h-44 resize-y`}
              />
              <Counter value={draft.description.length} max={LIMITS.description} />
              <Checklist
                items={[
                  { done: draft.description.trim().length >= 40, label: zhText("ยาวพอให้ AI จับโทนได้ (40+ ตัวอักษร)") },
                  { done: /['"‘“]/.test(draft.description) || draft.description.includes(zhText("เรียก")), label: zhText("ระบุคำแทนตัว / วิธีเรียกผู้เล่น") },
                  { done: draft.description.split(/[ ,\n]+/).filter(Boolean).length >= 8, label: zhText("มีลักษณะนิสัยหลายด้าน ไม่ใช่คำเดียว") },
                ]}
              />
            </Field>

            <Field label={zhText("ฉากหลังและปมเรื่อง")} hint={zhText("ความสัมพันธ์กับผู้เล่น สถานการณ์ตั้งต้น")}>
              <textarea
                value={draft.bio}
                onChange={(e) => set('bio', e.target.value)}
                maxLength={LIMITS.bio}
                placeholder={zhText("บาร์เทนเดอร์กะดึกของบาร์ NOIR ที่ไม่คบใครนานเกินสองสัปดาห์ ผู้เล่นมานั่งเก้าอี้ตัวเดิมทุกคืนศุกร์มาสองเดือนแล้ว")}
                className={`${inputCls} h-40 resize-y`}
              />
              <Counter value={draft.bio.length} max={LIMITS.bio} />
            </Field>
          </Card>

          {/* 3 ── opening */}
          <Card refFn={(el) => (sectionRefs.current.opening = el)} id="opening" title={zhText("บทเปิด")} desc={zhText("ประโยคแรกกำหนดว่าบทสนทนาจะไปทางไหน")}>
            <Field label={zhText("คำทักทาย")} hint={zhText("ใช้ *ข้อความ* สำหรับบรรยายท่าทาง")}>
              <textarea
                value={draft.greeting}
                onChange={(e) => set('greeting', e.target.value)}
                maxLength={LIMITS.greeting}
                placeholder={zhText("*เขาดันแก้วมาให้โดยไม่ต้องถามว่าจะสั่งอะไร*\n\n\"เธอมาที่นี่บ่อยเกินไปแล้วนะ\"")}
                className={`${inputCls} h-48 resize-y`}
              />
              <Counter value={draft.greeting.length} max={LIMITS.greeting} />
              <Checklist
                items={[
                  { done: draft.greeting.includes('*'), label: zhText("มีบรรยายท่าทางด้วย *ดอกจัน*") },
                  { done: /["“]/.test(draft.greeting), label: zhText("มีบทพูดในเครื่องหมายคำพูด") },
                  { done: draft.greeting.trim().length >= 30, label: zhText("ยาวพอให้เห็นภาพฉาก") },
                ]}
              />
            </Field>

            <Field label={zhText("สถานการณ์ตอนนี้")} hint={zhText("ฉากที่บทสนทนาเริ่มขึ้น — ส่งเข้าโมเดลด้วย ตัวละครจะรับรู้ฉากนี้")}>
              <textarea
                value={draft.scenario}
                onChange={(e) => set('scenario', e.target.value)}
                maxLength={LIMITS.scenario}
                placeholder={zhText("เราเป็นรูมเมทกัน คุณเพิ่งกลับห้องตอนตีสอง และเขายังไม่นอน")}
                className={`${inputCls} h-28 resize-y`}
              />
              <Counter value={draft.scenario.length} max={LIMITS.scenario} />
            </Field>

            <Field label={zhText("แนวทางการสวมบทบาท")} hint={zhText("บอกโมเดลว่าจะเล่นบทนี้ยังไง เช่น เล่นสองคนสลับกัน หรือเป็นผู้บรรยาย")}>
              <textarea
                value={draft.roleTemplate}
                onChange={(e) => set('roleTemplate', e.target.value)}
                maxLength={LIMITS.roleTemplate}
                placeholder={zhText("เล่นเป็นอลันและไทเปสลับกัน ระบุชื่อก่อนบทพูดทุกครั้ง")}
                className={`${inputCls} h-24 resize-y`}
              />
              <Counter value={draft.roleTemplate.length} max={LIMITS.roleTemplate} />
            </Field>
          </Card>

          {/* 4 ── tags */}
          <Card refFn={(el) => (sectionRefs.current.tags = el)} id="tags" title={zhText("แท็ก")} desc={zhText("เลือกแล้ว") + (draft.tags.length) + zhText("แท็ก")}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                placeholder={zhText("ค้นหาแท็ก…")}
                className={`${inputCls} pl-9`}
              />
            </div>

            {draft.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {draft.tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleIn('tags', t)}
                    className="flex h-8 items-center gap-1 rounded-full bg-gradient-to-r from-[#EE4036] to-[#FAAF40] px-3 font-athiti text-sm font-semibold text-white"
                  >
                    {labelOf(t)}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}

            {filteredGroups.map((g) => (
              <div key={g.label} className="space-y-2">
                <p className="font-athiti text-sm font-bold text-muted-foreground">{g.label}</p>
                <div className="flex flex-wrap gap-2">
                  {g.tags.map((t) => {
                    const on = draft.tags.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        onClick={() => toggleIn('tags', t.key)}
                        className={`flex h-8 items-center rounded-full px-3 font-athiti text-sm font-semibold transition-all ${
                          on ? 'bg-[#F2572B]/15 text-[#F2572B] ring-1 ring-[#F2572B]/40' : 'border border-zinc-200 hover:bg-accent dark:border-[#2A2A2A]'
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {filteredGroups.length === 0 && <p className="text-sm text-muted-foreground">{zhText("ไม่พบแท็กที่ตรงกับ “")}{tagQuery}”</p>}
          </Card>

          {/* 5 ── publish */}
          <Card refFn={(el) => (sectionRefs.current.publish = el)} id="publish" title={zhText("เผยแพร่")} desc={zhText("ตรวจครั้งสุดท้ายก่อนปล่อยออกไป")}>
            <div className="space-y-2">
              <p className="text-sm font-medium">{zhText("ฟีเจอร์ที่ติดบนการ์ด")}</p>
              <div className="flex flex-wrap gap-2">
                {badges.map((b) => {
                  const on = draft.badges.includes(b.emoji);
                  return (
                    <button
                      key={b.emoji}
                      onClick={() => toggleIn('badges', b.emoji)}
                      className={`flex h-9 items-center gap-2 rounded-full px-3 font-athiti text-sm transition-all ${
                        on ? 'bg-[#F2572B]/15 text-[#F2572B] ring-1 ring-[#F2572B]/40' : 'border border-zinc-200 dark:border-[#2A2A2A]'
                      }`}
                    >
                      <span>{b.emoji}</span>
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>

              <Field label="角色与素材版权声明" hint="说明角色设定、头像的原创归属或授权来源；申请公开时必填。">
                <textarea value={draft.copyrightStatement} onChange={e=>set('copyrightStatement',e.target.value)} maxLength={1000} className={`${inputCls} h-24 resize-y`} />
              </Field>
              <p className="text-sm text-muted-foreground">申请公开后进入审核，通过后才会展示在广场。修改公开内容需重新审核。</p>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 dark:border-[#2A2A2A] dark:bg-[#141414]">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium leading-tight">{zhText("เผยแพร่สู่สาธารณะ")}</span>
                <span className="text-xs text-muted-foreground">{zhText("ปิดไว้ถ้าอยากเก็บตัวละครนี้ไว้คุยคนเดียว")}</span>
              </span>
              <Toggle checked={draft.isPublic} onChange={(v) => set('isPublic', v)} label={zhText("เผยแพร่สู่สาธารณะ")} />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 dark:border-[#2A2A2A] dark:bg-[#141414]">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium leading-tight">{zhText("เนื้อหาผู้ใหญ่ (18+)")}</span>
                <span className="text-xs text-muted-foreground">
                  {zhText("ตัวละครจะคุยเรื่องผู้ใหญ่ตามบริบทของฉากได้ ไม่เลี่ยงโดยไม่มีเหตุผล")}</span>
              </span>
              <Toggle checked={draft.isAdult} onChange={(v) => set('isAdult', v)} label={zhText("เนื้อหาผู้ใหญ่ 18+")} />
            </label>

            <ul className="space-y-1.5 rounded-xl border bg-muted/20 p-3.5">
              {SECTIONS.map((s) => {
                const ok = done[s.id as keyof typeof done];
                return (
                  <li key={s.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className={ok ? 'text-emerald-500' : 'text-amber-500'}>{ok ? zhText("ครบแล้ว") : zhText("ยังไม่ครบ")}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* Live preview — desktop */}
        <aside className="sticky top-36 hidden h-fit xl:block">
          <p className="mb-3 font-athiti text-sm font-bold text-muted-foreground">{zhText("ตัวอย่างจริง")}</p>
          <LivePreview data={draft} tagLabel={labelOf} />
        </aside>
      </div>

      {/* Mobile submit bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 pb-[calc(68px+env(safe-area-inset-bottom))] backdrop-blur desktop:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-[#EE4036] to-[#FAAF40] transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{zhText("กรอกแล้ว")}{progress}%</p>
          </div>
          <button
            onClick={submit}
            disabled={saving || !loaded}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[linear-gradient(90deg,#FFA202,#FF1300)] px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_20px_-6px_rgba(255,47,0,0.6)] transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {editId ? '保存修改' : draft.isPublic ? '提交审核' : '保存私有角色'}</button>
        </div>
      </div>

      {/* Live preview — mobile sheet */}
      {showPreview && (
        <div className="fixed inset-0 z-[70] flex items-end xl:hidden" role="dialog" aria-modal="true" aria-label={zhText("ตัวอย่างตัวละคร")}>
          <button className="absolute inset-0 bg-black/60" aria-label={zhText("ปิด")} onClick={() => setShowPreview(false)} />
          <div className="relative max-h-[85svh] w-full overflow-y-auto rounded-t-3xl border-t bg-background p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            <LivePreview data={draft} tagLabel={labelOf} />
            <button
              onClick={() => setShowPreview(false)}
              className="mt-5 h-11 w-full rounded-xl border border-input font-athiti font-bold transition-colors hover:bg-accent"
            >
              {zhText("ปิด")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  id, title, desc, children, refFn,
}: {
  id: string;
  title: string;
  desc: string;
  children: React.ReactNode;
  refFn: (el: HTMLElement | null) => void;
}) {
  return (
    <section
      id={id}
      ref={refFn}
      className="scroll-mt-40 space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-[#2A2A2A] dark:bg-[#141414]"
    >
      <header>
        <h2 className="font-athiti text-lg font-bold">{title}</h2>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </header>
      {children}
    </section>
  );
}

