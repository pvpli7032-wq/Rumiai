'use client';
import { zhText } from '@/lib/zh-text';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Flame, CalendarDays, MessageSquare, Archive, Cpu, NotebookPen, Check, User } from 'lucide-react';
import { compactNumber } from '@/lib/i18n';

export interface ConversationState {
  id: string;
  title: string;
  relationshipStatus?: string | null;
  romance: number;
  intimacy: number;
  notes?: string | null;
  archivedAt?: string | null;
  relationshipMode: boolean;
  aiModel?: string | null;
  messageCount: number;
  daysChatting: number;
  character?: {
    id: string;
    name: string;
    tagline?: string | null;
    avatarUrl?: string | null;
    roleTemplate?: string | null;
    scenario?: string | null;
  } | null;
}

/**
 * Relationship tiers. The live site shows "ค่าความโรแมนติก 1100" with the bar around half
 * full, so the meter is not a percentage of 100 — it fills relative to the band the value
 * currently sits in. The real thresholds are a product decision we do not have yet, so
 * these are placeholders and the raw number is always shown next to the bar.
 */
const TIERS = [
  { name: zhText("คนไม่รู้จัก"), from: 0 },
  { name: zhText("คนรู้จัก"), from: 500 },
  { name: zhText("เพื่อน"), from: 1500 },
  { name: zhText("คนสนิท"), from: 3000 },
  { name: zhText("แฟน"), from: 6000 },
  { name: zhText("คนรัก"), from: 12000 },
];

function tierOf(value: number) {
  let index = 0;
  for (let i = 0; i < TIERS.length; i++) if (value >= TIERS[i].from) index = i;
  const current = TIERS[index];
  const next = TIERS[index + 1];
  const span = next ? next.from - current.from : Math.max(1, current.from);
  const filled = next ? (value - current.from) / span : 1;
  return { name: current.name, next: next?.name ?? null, percent: Math.min(100, Math.max(0, filled * 100)) };
}

export function RelationshipPanel({
  conversationId,
  token,
  onArchived,
}: {
  conversationId: string;
  token: string;
  onArchived?: () => void;
}) {
  const [state, setState] = useState<ConversationState | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/conversations/${conversationId}`, { headers }).then((r) => (r.ok ? r.json() : null)),
      // The selectable models are whatever the server's chain is; hardcoding a list here
      // would go stale the moment AI_MODEL or AI_FALLBACK_MODELS changes.
      fetch('/api/ai/models').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([conv, modelList]) => {
        if (!alive) return;
        if (conv?.conversation) {
          setState(conv.conversation);
          setNotes(conv.conversation.notes ?? '');
          setSavedNotes(conv.conversation.notes ?? '');
        }
        if (modelList?.models) {
          setModels(modelList.models);
          setDefaultModel(modelList.default ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, token]);

  async function patch(body: Record<string, unknown>, message?: string) {
    setSaving(true);
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setNotice(zhText("บันทึกไม่สำเร็จ"));
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (data.conversation) setState((s) => (s ? { ...s, ...data.conversation } : s));
    if (message) setNotice(message);
    return data.conversation;
  }

  if (!state) {
    return (
      <aside className="hidden w-80 min-w-80 border-l border-white/10 bg-zinc-900/40 desktop:block">
        <div className="flex h-40 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        </div>
      </aside>
    );
  }

  const romance = tierOf(state.romance);
  const intimacy = tierOf(state.intimacy);
  const archived = Boolean(state.archivedAt);

  return (
    <aside className="hidden w-80 min-w-80 overflow-y-auto border-l border-white/10 bg-zinc-900/40 desktop:block">
      <div className="space-y-5 p-4">
        {/* Who you are talking to */}
        {state.character && (
          <div className="flex flex-col items-center text-center">
            {state.character.avatarUrl ? (
              <img
                src={state.character.avatarUrl}
                alt={state.character.name}
                className="h-24 w-24 rounded-2xl object-cover"
              />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-zinc-800">
                <User className="h-8 w-8 text-zinc-500" />
              </span>
            )}
            <p className="mt-2 font-athiti text-sm font-bold text-white">{state.character.name}</p>
            {state.character.tagline && (
              <p className="font-athiti text-xs text-zinc-500">{state.character.tagline}</p>
            )}
            <Link
              href={`/chat?character=${state.character.id}&new=1`}
              className="mt-2 rounded-full border border-white/15 px-3 py-1 font-athiti text-[11px] font-bold text-zinc-300 hover:bg-white/5"
            >
              {zhText("แชทใหม่")}</Link>
          </div>
        )}

        {/* Relationship meters */}
        <div className="space-y-3 rounded-2xl border border-white/10 bg-zinc-800/40 p-3">
          {state.relationshipStatus && (
            <p className="font-athiti text-xs text-zinc-400">
              {zhText("สถานะ:")}<span className="font-bold text-white">{state.relationshipStatus}</span>
            </p>
          )}
          <Meter
            icon={<Heart className="h-3.5 w-3.5 text-pink-400" />}
            label={zhText("ค่าความโรแมนติก")}
            raw={state.romance}
            tier={romance}
            barClass="bg-linear-to-r/srgb from-pink-500 to-rose-400"
          />
          <Meter
            icon={<Flame className="h-3.5 w-3.5 text-orange-400" />}
            label={zhText("ค่าความสนิทสนม")}
            raw={state.intimacy}
            tier={intimacy}
            barClass="bg-linear-to-r/srgb from-orange-500 to-amber-400"
          />
        </div>

        {/* Chat facts */}
        <div className="grid grid-cols-2 gap-2">
          <Fact icon={<CalendarDays className="h-4 w-4" />} value={`${state.daysChatting}`} label={zhText("วันที่คุยกัน")} />
          <Fact
            icon={<MessageSquare className="h-4 w-4" />}
            value={compactNumber(state.messageCount)}
            label={zhText("ข้อความ")}
          />
        </div>

        {/* Relationship mode */}
        <button
          onClick={() => patch({ relationship_mode: !state.relationshipMode })}
          className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-zinc-800/40 px-3 py-2.5 text-left hover:border-white/25"
        >
          <span className="font-athiti text-xs text-zinc-300">{zhText("โหมดความสัมพันธ์")}</span>
          <span
            className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${
              state.relationshipMode ? 'justify-end bg-[#F2572B]' : 'justify-start bg-zinc-600'
            }`}
          >
            <span className="h-4 w-4 rounded-full bg-white" />
          </span>
        </button>

        {/* Model picker */}
        {models.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-zinc-800/40 p-3">
            <p className="mb-2 flex items-center gap-1.5 font-athiti text-xs font-bold text-zinc-400">
              <Cpu className="h-3.5 w-3.5" />
              {zhText("โมเดลที่ใช้ในแชทนี้")}</p>
            <div className="space-y-1">
              <ModelOption
                label={zhText("ค่าเริ่มต้น") + (defaultModel ? ` (${defaultModel})` : '') + zhText("")}
                selected={!state.aiModel}
                onClick={() => patch({ ai_model: null }, zhText("กลับไปใช้โมเดลค่าเริ่มต้น"))}
              />
              {models.map((m) => (
                <ModelOption
                  key={m}
                  label={m}
                  selected={state.aiModel === m}
                  onClick={() => patch({ ai_model: m }, zhText("เปลี่ยนเป็น") + (m) + zhText(""))}
                />
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="rounded-2xl border border-white/10 bg-zinc-800/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 font-athiti text-xs font-bold text-zinc-400">
            <NotebookPen className="h-3.5 w-3.5" />
            {zhText("บันทึกของฉัน")}</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder={zhText("จดอะไรก็ได้เกี่ยวกับแชทนี้")}
            className="w-full resize-none rounded-xl border border-white/10 bg-zinc-900 px-2.5 py-2 font-athiti text-xs text-white placeholder-zinc-600 focus:border-[#F2572B]/50 focus:outline-hidden"
          />
          <button
            onClick={async () => {
              const updated = await patch({ notes }, zhText("บันทึกแล้ว"));
              if (updated) setSavedNotes(notes);
            }}
            disabled={saving || notes === savedNotes}
            className="mt-2 w-full rounded-full bg-zinc-700 py-1.5 font-athiti text-xs font-bold text-white hover:bg-zinc-600 disabled:opacity-40"
          >
            {notes === savedNotes ? zhText("บันทึกไว้แล้ว") : saving ? zhText("กำลังบันทึก...") : zhText("บันทึก")}
          </button>
        </div>

        <button
          onClick={async () => {
            const updated = await patch({ archived: !archived }, archived ? zhText("เอาออกจากที่จัดเก็บ") : zhText("จัดเก็บแชทแล้ว"));
            if (updated && !archived) onArchived?.();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-white/10 py-2 font-athiti text-xs font-bold text-zinc-300 hover:bg-white/5"
        >
          <Archive className="h-3.5 w-3.5" />
          {archived ? zhText("เอาออกจากที่จัดเก็บ") : zhText("จัดเก็บแชทนี้")}
        </button>

        {notice && (
          <p className="flex items-center justify-center gap-1 font-athiti text-xs text-emerald-400">
            <Check className="h-3 w-3" />
            {notice}
          </p>
        )}
      </div>
    </aside>
  );
}

function Meter({
  icon,
  label,
  raw,
  tier,
  barClass,
}: {
  icon: React.ReactNode;
  label: string;
  raw: number;
  tier: { name: string; next: string | null; percent: number };
  barClass: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between font-athiti text-xs">
        <span className="flex items-center gap-1 text-zinc-400">
          {icon}
          {label}
        </span>
        {/* The raw value, because the bar is relative to the current tier, not to 100. */}
        <span className="font-bold text-white">{raw.toLocaleString('th-TH')}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${tier.percent}%` }} />
      </div>
      <p className="mt-1 font-athiti text-[10px] text-zinc-500">
        {tier.name}
        {tier.next ? ` → ${tier.next}` : ''}
      </p>
    </div>
  );
}

function Fact({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-800/40 p-3 text-center">
      <span className="mx-auto mb-1 flex justify-center text-zinc-500">{icon}</span>
      <p className="font-athiti text-sm font-bold text-white">{value}</p>
      <p className="font-athiti text-[10px] text-zinc-500">{label}</p>
    </div>
  );
}

function ModelOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left font-barlow text-[11px] transition-colors ${
        selected ? 'bg-[#F2572B]/15 text-white' : 'text-zinc-400 hover:bg-white/5'
      }`}
    >
      <span className="truncate">{label}</span>
      {selected && <Check className="h-3 w-3 shrink-0 text-[#F2572B]" />}
    </button>
  );
}
