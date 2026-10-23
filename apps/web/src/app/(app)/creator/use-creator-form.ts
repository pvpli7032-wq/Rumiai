'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@web/lib/auth-context';
import { loginWithNext } from '@web/lib/next-path';
import { zhError } from '@rumiai/contracts/copy/zh';
import { useSiteContent } from '@web/lib/use-site-content';
import { useUiConfig } from '@web/lib/settings/use-ui-config';
import { DRAFT_KEY, EMPTY, SECTIONS, limitsFromConfig, migrateLegacyDraft, type Draft } from './creator-draft';

/**
 * 角色编辑器的表单状态：草稿读写、自动保存、校验、分步导航与提交。
 * 渲染在 creator-form.tsx / creator-steps.tsx / creator-chrome.tsx，这里不含 JSX。
 */
export function useCreatorForm(editId?: string) {
  const draftKey = editId ? DRAFT_KEY + ':edit:' + editId : DRAFT_KEY;
  const uiConfig = useUiConfig();
  const LIMITS = useMemo(() => limitsFromConfig(uiConfig), [uiConfig]);
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
      const raw = localStorage.getItem(draftKey) ?? migrateLegacyDraft(draftKey);
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

  /** 步骤导航：切到某一步，并回到顶部，免得停在上一步的滚动位置。 */
  const goTo = (id: string) => {
    setActive(id);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── validation & completeness ────────────────────────────────────────
  const errors = useMemo(() => {
    const e: Record<string, string | null> = {};
    e.name = draft.name.trim() ? null : "请填写角色名称";
    e.tagline = draft.tagline.trim() ? null : "请填写一句话简介";
    e.description =
      draft.description.trim().length >= 40 ? null : "请用至少 40 个字符描述角色个性";
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

  // ── 分步向导 ─────────────────────────────────────────────────────────
  const stepIndex = Math.max(0, SECTIONS.findIndex((section) => section.id === active));
  const isLast = stepIndex === SECTIONS.length - 1;

  /** 每步的必填项：不满足就停在原地，别让人走到最后才发现缺东西。 */
  function stepBlocker(id: string): string | null {
    if (id === 'identity') return errors.name || errors.tagline;
    if (id === 'persona') return errors.description;
    if (id === 'opening') return draft.greeting.trim() ? null : '请填写开场白，它是故事的起点。';
    if (id === 'tags') return draft.tags.length ? null : '至少选择一个标签，方便别人找到这个角色。';
    if (draft.isPublic && !draft.copyrightStatement.trim()) return '申请公开前请填写角色及素材版权声明。';
    return null;
  }
  function nextStep() {
    const blocker = stepBlocker(active);
    if (blocker) {
      setTouched({ name: true, tagline: true, description: true });
      setError(blocker);
      return;
    }
    setError(null);
    setActive(SECTIONS[Math.min(stepIndex + 1, SECTIONS.length - 1)].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function prevStep() {
    setError(null);
    setActive(SECTIONS[Math.max(stepIndex - 1, 0)].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── submit ───────────────────────────────────────────────────────────
  async function submit() {
    persist(draft);
    if (!token) {
      router.push(loginWithNext());
      return;
    }
    if (!requiredOk) {
      setTouched({ name: true, tagline: true, description: true });
      setError("请补全必填信息");
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
    if (!confirm("清空草稿并重新开始？")) return;
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

  return {
    draft, set, blur, toggleIn, touched, active, goTo, error, setError, saving, savedAt, loaded,
    tagQuery, setTagQuery, filteredGroups, labelOf, badges, LIMITS, token,
    errors, done, progress, stepIndex, isLast, nextStep, prevStep, submit, reset,
  };
}
