'use client';
import { zhText, zhError } from '@/lib/zh-text';

import { useState } from 'react';
import { X, Flag, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { loginWithNext } from '@/lib/next-path';
import { useRouter } from 'next/navigation';
import { REPORT_CATEGORIES, IMAGE_REASONS, COPYRIGHT_RELATIONSHIPS, MAX_DETAILS } from '@/lib/community/report-types';
import { CATEGORY_LABELS, IMAGE_REASON_LABELS, RELATIONSHIP_LABELS } from '@/lib/report-labels';

type Category = (typeof REPORT_CATEGORIES)[number];

/**
 * Filing a report. The category list is the platform's, not this component's — it maps
 * over REPORT_CATEGORIES so the form and the API can never drift apart.
 *
 * Two categories ask for more: an image report needs to say what is wrong with the image,
 * and a copyright claim needs to say who is claiming and on what basis.
 */
export function ReportDialog({
  targetType,
  targetId,
  targetName,
  onClose,
}: {
  targetType: 'CHARACTER' | 'USER' | 'COMMENT' | 'POST' | 'POST_COMMENT' | 'UNIVERSE' | 'MESSAGE';
  targetId: string;
  targetName?: string;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const router = useRouter();
  const [category, setCategory] = useState<Category | ''>('');
  const [details, setDetails] = useState('');
  const [imageReason, setImageReason] = useState<string>('');
  const [workTitle, setWorkTitle] = useState('');
  const [relationship, setRelationship] = useState<string>('');
  const [sourceLink, setSourceLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { updated: boolean }>(null);

  async function submit() {
    if (!token) { router.push(loginWithNext()); return; }
    if (!category) { setError(zhText("เลือกเหตุผลก่อนนะครับ")); return; }
    setBusy(true);
    setError('');

    try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        target_type: targetType,
        target_id: targetId,
        category,
        details: details.trim() || undefined,
        ...(category === 'inappropriateImage' && imageReason ? { image_reason: imageReason } : {}),
        ...(category === 'copyright'
          ? {
              work_title: workTitle.trim() || undefined,
              relationship: relationship || undefined,
              source_link: sourceLink.trim() || undefined,
            }
          : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(zhError(body.error || '') || zhText("ส่งรายงานไม่สำเร็จ ลองอีกครั้ง"));
      return;
    }
    const body = await res.json().catch(() => ({}));
    setDone({ updated: Boolean(body.updated) });
    } catch {setError('网络连接失败，请重试。');} finally {setBusy(false);}
  }

  if (done) {
    return (
      <Shell onClose={onClose} title={zhText("ส่งรายงานแล้ว")}>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="h-6 w-6 text-emerald-400" />
          </span>
          <p className="font-athiti text-sm text-zinc-300">
            {done.updated
              ? zhText("อัปเดตรายงานที่คุณเคยส่งไว้แล้ว ทีมงานจะตรวจสอบอีกครั้ง")
              : zhText("ขอบคุณครับ ทีมงานจะตรวจสอบโดยเร็วที่สุด")}
          </p>
          <a href="/my-reports" className="text-sm text-orange-400 underline">查看我的举报</a>
          <button
            onClick={onClose}
            className="mt-2 rounded-full bg-zinc-800 px-6 py-2 font-athiti text-sm font-bold text-white hover:bg-zinc-700"
          >
            {zhText("ปิด")}</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title={targetName ? zhText("รายงาน") + (targetName) + zhText("") : zhText("รายงาน")}>
      {(targetType==='MESSAGE'||targetType==='POST'||targetType==='POST_COMMENT')&&<p className="mb-3 text-sm text-zinc-400">提交时会保存所选内容作为处理依据；内容删除后，这份举报依据仍会保留。</p>}
      {error && (
        <p className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 font-athiti text-sm text-red-400">
          {error}
        </p>
      )}

      <p className="mb-2 font-athiti text-xs font-bold text-zinc-400">{zhText("เหตุผล")}</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {REPORT_CATEGORIES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key)}
            className={`rounded-xl border px-3 py-2 text-left font-athiti text-xs transition-colors ${
              category === key
                ? 'border-[#F2572B] bg-[#F2572B]/10 text-white'
                : 'border-white/10 bg-zinc-800/60 text-zinc-300 hover:border-white/25'
            }`}
          >
            {CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>

      {category === 'inappropriateImage' && (
        <div className="mb-4">
          <p className="mb-2 font-athiti text-xs font-bold text-zinc-400">{zhText("รูปภาพมีปัญหาอะไร")}</p>
          <div className="flex flex-wrap gap-2">
            {IMAGE_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setImageReason(reason)}
                className={`rounded-full border px-3 py-1 font-athiti text-xs ${
                  imageReason === reason
                    ? 'border-[#F2572B] bg-[#F2572B]/10 text-white'
                    : 'border-white/10 text-zinc-300 hover:border-white/25'
                }`}
              >
                {IMAGE_REASON_LABELS[reason]}
              </button>
            ))}
          </div>
        </div>
      )}

      {category === 'copyright' && (
        <div className="mb-4 space-y-3">
          <div>
            <p className="mb-1 font-athiti text-xs font-bold text-zinc-400">{zhText("ชื่อผลงาน")}</p>
            <input
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 font-athiti text-sm text-white placeholder-zinc-500 focus:border-[#F2572B]/60 focus:outline-hidden"
              placeholder={zhText("ผลงานที่ถูกละเมิด")}
            />
          </div>
          <div>
            <p className="mb-1 font-athiti text-xs font-bold text-zinc-400">{zhText("คุณเกี่ยวข้องอย่างไร")}</p>
            <div className="flex flex-wrap gap-2">
              {COPYRIGHT_RELATIONSHIPS.map((rel) => (
                <button
                  key={rel}
                  type="button"
                  onClick={() => setRelationship(rel)}
                  className={`rounded-full border px-3 py-1 font-athiti text-xs ${
                    relationship === rel
                      ? 'border-[#F2572B] bg-[#F2572B]/10 text-white'
                      : 'border-white/10 text-zinc-300 hover:border-white/25'
                  }`}
                >
                  {RELATIONSHIP_LABELS[rel]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 font-athiti text-xs font-bold text-zinc-400">{zhText("ลิงก์ต้นฉบับ")}</p>
            <input
              value={sourceLink}
              onChange={(e) => setSourceLink(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 font-athiti text-sm text-white placeholder-zinc-500 focus:border-[#F2572B]/60 focus:outline-hidden"
              placeholder="https://..."
            />
          </div>
        </div>
      )}

      <p className="mb-1 font-athiti text-xs font-bold text-zinc-400">{zhText("รายละเอียดเพิ่มเติม (ไม่บังคับ)")}</p>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value.slice(0, MAX_DETAILS))}
        rows={4}
        className="w-full resize-none rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 font-athiti text-sm text-white placeholder-zinc-500 focus:border-[#F2572B]/60 focus:outline-hidden"
        placeholder={zhText("เล่าให้ทีมงานฟังว่าเกิดอะไรขึ้น")}
      />
      <p className="mt-1 text-right font-barlow text-[11px] text-zinc-500">
        {details.length}/{MAX_DETAILS}
      </p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-full border border-white/10 py-2.5 font-athiti text-sm font-bold text-zinc-300 hover:bg-white/5"
        >
          {zhText("ยกเลิก")}</button>
        <button
          onClick={submit}
          disabled={busy || !category}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#F2572B] py-2.5 font-athiti text-sm font-bold text-white transition-colors hover:bg-[#d94a22] disabled:opacity-40"
        >
          <Flag className="h-4 w-4" />
          {busy ? zhText("กำลังส่ง...") : zhText("ส่งรายงาน")}
        </button>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-athiti text-lg font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label={zhText("ปิด")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
