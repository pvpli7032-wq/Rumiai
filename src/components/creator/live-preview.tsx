'use client';
import { zhText } from '@/lib/zh-text';

import { Tag, User } from 'lucide-react';

export interface PreviewData {
  name: string;
  tagline: string;
  greeting: string;
  avatarUrl: string;
  tags: string[];
  badges: string[];
  isExclusive: boolean;
}

/**
 * Exactly what the character will look like on the explore page and in the
 * first message of a chat — rendered live while the creator types.
 */
export function LivePreview({ data, tagLabel }: { data: PreviewData; tagLabel?: (key: string) => string }) {
  return (
    <div className="space-y-4">
      <div className="mx-auto w-[190px]">
        <div className="relative aspect-[160/213] w-full overflow-hidden rounded-2xl bg-[#1A1A2E]">
          {data.avatarUrl ? (
            <img src={data.avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#3b1d4d] to-[#141428] text-white/40">
              <User className="h-8 w-8" />
              <span className="text-[11px]">{zhText("ยังไม่มีรูป")}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

          {data.isExclusive && (
            <span className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-[#1A1A1A]/90 py-0.5 pl-2 pr-1 text-[9px] font-semibold text-white ring-1 ring-[#2A2A2A]">
              <span>{zhText("Only on")}</span>
              <span className="text-[#F2572B]">{zhText("Khui AI")}</span>
            </span>
          )}

          <span className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50">
            <Tag className="h-3 w-3 text-white" />
          </span>

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5">
            <div className="flex gap-1">
              {data.badges.map((b) => (
                <span key={b} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs">{b}</span>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5">
              <span className="text-[10px]">💬</span>
              <span className="font-athiti text-[10px] font-semibold text-white">0</span>
            </div>
          </div>
        </div>

        <p className="mt-2 line-clamp-1 font-athiti text-sm font-bold md:text-base">{data.name || zhText("ชื่อตัวละคร")}</p>
        <p className="mt-0.5 line-clamp-2 font-athiti text-xs text-muted-foreground md:text-sm">
          {data.tagline || zhText("คำโปรยตัวละคร")}
        </p>
      </div>

      {data.tags.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {data.tags.slice(0, 8).map((t) => (
            <span key={t} className="rounded-full border border-zinc-200 px-2 py-0.5 font-athiti text-[11px] dark:border-[#2A2A2A]">
              {tagLabel ? tagLabel(t) : t}
            </span>
          ))}
          {data.tags.length > 8 && <span className="text-[11px] text-muted-foreground">+{data.tags.length - 8}</span>}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-[#2A2A2A] dark:bg-[#141414]">
        <p className="mb-2 font-athiti text-xs font-bold text-muted-foreground">{zhText("ข้อความแรกในห้องแชท")}</p>
        <div className="flex gap-2">
          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-[#EE4036] to-[#FAAF40]">
            {data.avatarUrl && <img src={data.avatarUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm leading-relaxed dark:bg-[#1F1F1F]">
            {data.greeting ? (
              data.greeting.split('\n').map((line, i) =>
                line.trim() ? (
                  <p key={i} className={line.trim().startsWith('*') ? 'italic text-muted-foreground' : ''}>
                    {line.replaceAll('*', '')}
                  </p>
                ) : (
                  <div key={i} className="h-2" />
                ),
              )
            ) : (
              <p className="text-muted-foreground">{zhText("ยังไม่ได้เขียนคำทักทาย…")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
