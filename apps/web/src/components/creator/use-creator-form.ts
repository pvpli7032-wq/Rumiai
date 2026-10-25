'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@web/lib/auth-context';
import { loginWithNext } from '@web/lib/next-path';
import { zhError } from '@rumiai/contracts/copy/zh';
import { useSiteContent } from '@web/lib/use-site-content';
import { useUiConfig } from '@web/lib/settings/use-ui-config';
import { DRAFT_KEY, EMPTY, SECTIONS, limitsFromConfig, type Draft } from './creator-draft';

/**
 * 角色编辑器的表单状态：草稿读写、自动保存、校验、分步导航与提交。
 * 渲染在 creator-form.tsx / creator-steps.tsx / creator-chrome.tsx，这里不含 JSX。
 */
export function useCreatorForm(editId?: string) {
  const uiConfig = useUiConfig();
  const LIMITS = useMemo(() => limitsFromConfig(uiConfig), [uiConfig]);
  const [loaded, setLoaded] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const savedSnapshot = useRef<string | null>(null);
  const { token, user, isLoading: authLoading } = useAuth();
  const draftKey = user?.id ? DRAFT_KEY + ':user:' + user.id + (editId ? ':edit:' + editId : ':new') : null;
  const router = useRouter();
  const { tags: allTags, badges } = useSiteContent();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const [tagQuery, setTagQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const blur = (key: string) => setTouched((t) => ({ ...t, [key]: true }));

  const toggleIn = (key: 'tags' | 'badges', value: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value],
    }));

  // Only the current load may update the form; stale StrictMode/navigation requests are cancelled.
  useEffect(() => {
    if (authLoading) return;
    setLoaded(false);
    setLoadedKey(null);
    savedSnapshot.current = null;
    setDraft(EMPTY);
    setTouched({});
    setSavedAt(null);
    if (!token || !user || !draftKey) {
      setError('登录后可保存个人草稿和角色。');
      setLoaded(!editId);
      return;
    }
    if (!editId) {
      let next = EMPTY;
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) next = {...EMPTY, ...parsed}; }
      } catch { setError('草稿暂时无法读取，可继续编辑；请确认浏览器允许保存数据。'); }
      savedSnapshot.current = JSON.stringify(next);
      setDraft(next);
      setLoadedKey(draftKey);
      setLoaded(true);
      return;
    }
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
        const restored = { ...EMPTY, name:c.name, tagline:c.tagline||'', description:c.personality, bio:c.background||'', greeting:c.greeting||'', avatarUrl:c.avatarUrl||'', tags:(c.tags||'').split(',').filter(Boolean), badges:(c.badges||'').split(',').filter(Boolean), isExclusive:c.isExclusive, isPublic:c.publicationRequested, isAdult:c.isAdult, scenario:c.scenario||'', roleTemplate:c.roleTemplate||'', copyrightStatement:c.copyrightStatement||'', ...cached };
        savedSnapshot.current = JSON.stringify(restored);
        setDraft(restored);
        setLoadedKey(draftKey);
        setLoaded(true);
      })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [editId, token, draftKey, authLoading, user?.id]);

  const persist = useCallback((d: Draft) => {
    if (!draftKey || loadedKey !== draftKey) return false;
    try {
      const serialized = JSON.stringify(d);
      localStorage.setItem(draftKey, serialized);
      savedSnapshot.current = serialized;
      setSavedAt(new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'}));
      return true;
    } catch { setError('草稿未能保存到此设备，请保留页面并重试。'); return false; }
  }, [draftKey, loadedKey]);

  // Autosave a second after typing stops, so nothing is ever lost on reload.
  useEffect(() => {
    if (draft === EMPTY || !loaded || loadedKey !== draftKey) return;
    const t = setTimeout(() => persist(draft), 1000);
    return () => clearTimeout(t);
  }, [draft, persist, loaded, loadedKey, draftKey]);

  // Only an actually unsaved draft asks before leaving; already-saved local drafts remain available.
  useEffect(() => {
    const isDirty = () => loaded && loadedKey === draftKey && savedSnapshot.current !== null && savedSnapshot.current !== JSON.stringify(draft);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      persist(draft);
      event.preventDefault();
      event.returnValue = '';
    };
    const onNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !isDirty()) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.href === window.location.href || target.pathname === window.location.pathname && target.search === window.location.search) return;
      const saved = persist(draft);
      if (!window.confirm(saved ? '草稿已保存在当前账号的此设备中。现在离开创作页？' : '草稿暂未保存成功，离开可能丢失修改。仍要离开？')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    const flush = () => {if (isDirty()) persist(draft);};
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onNavigate, true);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onNavigate, true);
      window.removeEventListener('pagehide', flush);
    };
  }, [draft, draftKey, loaded, loadedKey, persist]);

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
      draft.description.trim() ? null : "请填写角色个性";
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
    if (uploadBusy) { setError('图片仍在上传，请完成后再保存。'); return; }
    if (!token) {
      router.push(loginWithNext());
      return;
    }
    if (!requiredOk) {
      setTouched({ name: true, tagline: true, description: true });
      goTo(errors.name || errors.tagline ? 'identity' : 'persona');
      setError("请补全必填信息");
      return;
    }
    if(draft.isPublic&&!draft.copyrightStatement.trim()){goTo('publish');setError('申请公开前请填写角色及素材版权声明。');return;}
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
      if (draftKey) try { localStorage.removeItem(draftKey); } catch {}
      router.push(editId || draft.isPublic ? '/my-characters' : `/chat?character=${data.character.id}`);
    } else {
      setError(zhError(data.error || '') || '保存角色失败。');
    }
    } catch { setError('网络连接失败，草稿已保留，请重试。'); } finally { setSaving(false); }
  }

  async function previewChat(){
    persist(draft);
    if(!token){router.push(loginWithNext());return;}
    if(!draft.name.trim()||!draft.description.trim()){setError('试聊前请填写角色名称和个性。');return;}
    if(uploadBusy||saving)return;
    if(!window.confirm('将创建一个仅自己可见的试聊副本，占用角色创建额度；当前角色不会被改动。进入聊天并发送消息后，按页面显示的服务端费用规则结算。是否继续？'))return;
    setSaving(true);setError(null);
    try{const response=await fetch('/api/characters',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:draft.name,tagline:draft.tagline,personality:draft.description,background:draft.bio,greeting:draft.greeting,avatarUrl:draft.avatarUrl||null,tags:draft.tags.join(','),badges:draft.badges.join(','),isPublic:false,isExclusive:false,scenario:draft.scenario||null,roleTemplate:draft.roleTemplate||null,isAdult:draft.isAdult,copyrightStatement:draft.copyrightStatement})});const data=await response.json();if(!response.ok)throw Error(data.error||'试聊副本创建失败。');router.push('/chat?character='+encodeURIComponent(data.character.id)+'&new=1');}
    catch(e){setError(e instanceof Error?e.message:'网络连接失败，草稿仍保留。');}finally{setSaving(false);}
  }

  function reset() {
    if (!confirm("清空草稿并重新开始？")) return;
    if (draftKey) try { localStorage.removeItem(draftKey); } catch {}
    savedSnapshot.current = JSON.stringify(EMPTY);
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
    draft, setDraft, previewChat, set, blur, toggleIn, touched, active, goTo, error, setError, saving, savedAt, loaded,
    tagQuery, setTagQuery, filteredGroups, labelOf, badges, LIMITS, token,
    errors, done, progress, stepIndex, isLast, nextStep, prevStep, submit, reset, uploadBusy, setUploadBusy,
  };
}
