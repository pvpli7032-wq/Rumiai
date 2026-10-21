import React from 'react';
import {ImageResponse} from 'next/og';
import {MIRROR_PREVIEW_SITE, MIRROR_PREVIEW_SIZE, readPreviewCard} from './_preview-card';
import {readPreviewFont} from './_preview-font';

/**
 * 分享预览图（V3 §23 表 19）：next/og 的 ImageResponse 输出 1200×630。
 *
 * 内容只有称号 + 第一条观察 + 角色名 + 站点名。三题原回答不在公开视图里，
 * 所以图片不可能带上它们（见 _preview-card.ts 的说明）。
 *
 * 可见性与分享页同一个判断：结果隐藏、过期、删除后这里同样返回 404，
 * 不让图片成为绕过分享页的内容侧路。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const size = MIRROR_PREVIEW_SIZE;
export const contentType = 'image/png';
export const alt = '他眼中的你 · 分享预览';

export default async function Image({params}: {params: Promise<{locale: string; shareId: string}>}) {
  const {shareId} = await params;
  const card = await readPreviewCard(shareId);
  if (!card) return new Response('Not Found', {status: 404, headers: {'Cache-Control': 'no-store'}});
  const font = await readPreviewFont();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: 'linear-gradient(135deg, #1b1230 0%, #0b0b12 55%, #14101f 100%)',
          color: '#ffffff',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
          <span style={{fontSize: 30, color: '#c4b5fd', letterSpacing: 2}}>{MIRROR_PREVIEW_SITE}</span>
          <span style={{fontSize: 28, color: '#71717a'}}>· 他眼中的你</span>
        </div>

        <div style={{display: 'flex', flexDirection: 'column'}}>
          <span style={{fontSize: 84, fontWeight: 700, lineHeight: 1.15}}>{card.title}</span>
          <span style={{marginTop: 28, fontSize: 40, lineHeight: 1.5, color: '#d4d4d8'}}>{card.observation}</span>
        </div>

        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <span style={{fontSize: 32, color: '#a1a1aa'}}>{card.characterName} 眼中的你</span>
          <span style={{fontSize: 26, color: '#52525b'}}>结果由 AI 生成</span>
        </div>
      </div>
    ),
    {
      ...MIRROR_PREVIEW_SIZE,
      fonts: font ? [{name: 'MirrorPreview', data: font, weight: 400, style: 'normal'}] : undefined,
      headers: {'Cache-Control': 'no-store'},
    },
  );
}
