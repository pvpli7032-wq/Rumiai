'use client';
import { zhError } from '@rumiai/contracts/copy/zh';

import { useRef, useState } from 'react';
import { AlertCircle, Check, Link2, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { API } from '@rumiai/contracts/api-paths';

/** Poster ratio used by every character card on the site. */
const RATIO = 160 / 213;
const SPEC = {
  ratio: '3:4 (160 × 213)',
  recommended: { w: 640, h: 852 },
  min: { w: 320, h: 426 },
  maxMB: 5,
  types: 'JPG · PNG · WebP',
};

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

interface Meta {
  w: number;
  h: number;
  kb: number;
}

/** Reads intrinsic size so we can warn about crops before anything is saved. */
function readSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    img.src = url;
  });
}

export function ImageUpload({
  value,
  onChange,
  token,
}: {
  value: string;
  onChange: (url: string) => void;
  token: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [showUrl, setShowUrl] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setWarn(null);

    if (!ACCEPT.includes(file.type)) {
      setError("仅支持 " + (SPEC.types));
      return;
    }
    if (file.size > SPEC.maxMB * 1024 * 1024) {
      setError("文件大小为" + ((file.size / 1024 / 1024).toFixed(1)) + "MB，最多" + (SPEC.maxMB) + "MB");
      return;
    }

    let size: { w: number; h: number };
    try {
      size = await readSize(file);
    } catch (e) {
      setError((e as Error).message);
      return;
    }

    if (size.w < SPEC.min.w || size.h < SPEC.min.h) {
      setError("图片尺寸过小（" + (size.w) + "×" + (size.h) + "），至少需要" + (SPEC.min.w) + "×" + (SPEC.min.h) + "px");
      return;
    }
    const ratio = size.w / size.h;
    if (Math.abs(ratio - RATIO) > 0.12) {
      setWarn(
        "图片比例为" + (ratio.toFixed(2)) + ":1，角色卡比例为" + (SPEC.ratio) + "，图片边缘会被裁剪",
      );
    }

    if (!token) {
      setError("请先登录再上传图片");
      return;
    }

    setBusy(true);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(API.upload, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(zhError(data.error || '') || "图片上传失败");
      return;
    }
    setMeta({ w: size.w, h: size.h, kb: Math.round(file.size / 1024) });
    onChange(data.url);
  }

  return (
    <div className="space-y-3">
      {/* Dropzone / preview */}
      {value ? (
        <div className="flex gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-[#2A2A2A] dark:bg-[#141414]">
          <div className="relative h-[104px] w-[78px] shrink-0 overflow-hidden rounded-lg bg-[#1A1A2E]">
            <img src={value} alt={"已选图片"} className="h-full w-full object-cover" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-sm font-medium text-emerald-500">
                <Check className="h-3.5 w-3.5" /> {"已添加图片"}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{value}</p>
              {meta && (
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {meta.w} × {meta.h} px · {meta.kb.toLocaleString()} KB
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="h-8 rounded-lg border border-input px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                {"更换图片"}</button>
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setMeta(null);
                  setWarn(null);
                }}
                className="flex h-8 items-center gap-1 rounded-lg border border-input px-3 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
              >
                <Trash2 className="h-3 w-3" /> {"删除"}</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? 'border-brand-strong bg-brand-strong/5' : 'border-zinc-300 hover:bg-accent/40 dark:border-[#2A2A2A]'
          }`}
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-brand-strong" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-strong/12 text-brand-strong">
              <UploadCloud className="h-5 w-5" />
            </span>
          )}
          <span className="text-sm font-bold">
            {busy ? "正在上传…" : "拖放图片，或点击选择文件"}
          </span>
          <span className="text-xs text-muted-foreground">
            {"建议"}{SPEC.recommended.w} × {SPEC.recommended.h} {"px，比例"}{SPEC.ratio} {"，不超过"}{SPEC.maxMB} MB
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-500">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
      {warn && !error && (
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {warn}
        </p>
      )}

      {/* Spec sheet */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border bg-muted/20 p-3 text-xs">
        <dt className="text-muted-foreground">{"建议尺寸"}</dt>
        <dd className="text-right tabular-nums font-medium">{SPEC.recommended.w} × {SPEC.recommended.h} px</dd>
        <dt className="text-muted-foreground">{"图片比例"}</dt>
        <dd className="text-right font-medium">{SPEC.ratio} {"竖版"}</dd>
        <dt className="text-muted-foreground">{"最小尺寸"}</dt>
        <dd className="text-right tabular-nums font-medium">{SPEC.min.w} × {SPEC.min.h} px</dd>
        <dt className="text-muted-foreground">{"文件"}</dt>
        <dd className="text-right font-medium">{SPEC.types} · ≤ {SPEC.maxMB} MB</dd>
      </dl>

      {/* URL fallback */}
      {showUrl ? (
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={"https://… 或 /uploads/你的图片.png"}
            className="w-full rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-sm shadow-xs focus-visible:border-brand-strong focus-visible:outline-hidden"
          />
          <button
            type="button"
            onClick={() => setShowUrl(false)}
            className="shrink-0 rounded-xl border border-input px-3 text-xs transition-colors hover:bg-accent"
          >
            {"关闭"}</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowUrl(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Link2 className="h-3 w-3" />
          {"也可以填写图片链接"}</button>
      )}
    </div>
  );
}

