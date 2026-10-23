'use client';

import { Eye, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CharacterAssetsEditor } from './character-assets-editor';
import { buildCharacterLimits } from '@rumiai/contracts/characters/limits';
import { useUiConfig } from '@admin/lib/use-ui-config';
import { AdminNotice, AdminPanel } from '../admin-page';
import { Badge } from '@rumiai/ui/badge';
import { Button } from '@rumiai/ui/button';
import { Dialog } from '@rumiai/ui/dialog';
import { Input } from '@rumiai/ui/input';
import { Textarea } from '@rumiai/ui/textarea';
import { contentFrom, emptyContent, statusLabels, type CharacterContent, type ManagedCharacter } from './types';

const textFields = [['name', '角色名称'], ['tagline', '简介'], ['personality', '人设'], ['background', '背景'], ['greeting', '开场白'], ['scenario', '场景'], ['roleTemplate', '扮演指引'], ['tags', '标签'], ['badges', '徽章'], ['avatarUrl', '头像地址'], ['copyrightStatement', '版权声明'], ['relationshipStatus', '初始关系']] as const;
const WIDE_FIELDS = ['background', 'copyrightStatement'];

export function CharacterEditor({ character, canEdit, canPublish, busy, onSave, onPublish, onClose, onDirtyChange, error }: { character: ManagedCharacter | null; canEdit: boolean; canPublish: boolean; busy: boolean; onSave: (content: CharacterContent, reason: string) => Promise<boolean>; onPublish: (action: 'PUBLISH' | 'UNPUBLISH', reason: string) => Promise<boolean>; onClose: () => void; onDirtyChange?: (dirty: boolean) => void; error?: string }) {
  const uiConfig = useUiConfig();
  // 配置未返回时不设置 HTML maxLength；0 会禁止输入，不能当成「不限」。服务端仍校验真实配置。
  const CHARACTER_LIMITS = useMemo(() => buildCharacterLimits(key => {
    const value = uiConfig[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }), [uiConfig]);
  const [content, setContent] = useState<CharacterContent>(character ? contentFrom(character) : { ...emptyContent });
  const [reason, setReason] = useState(''), [preview, setPreview] = useState(false), [pending, setPending] = useState<'PUBLISH' | 'UNPUBLISH' | null>(null);
  const original = character ? contentFrom(character) : { ...emptyContent };
  const dirty = original !== null && JSON.stringify(content) !== JSON.stringify(original);
  const deleted = character?.reviewStatus === 'DELETED';
  useEffect(() => { onDirtyChange?.(dirty || Boolean(reason.trim())); }, [dirty, reason, onDirtyChange]);

  async function save(event: FormEvent) { event.preventDefault(); if (await onSave(content, reason)) setReason(''); }
  async function publish(action: 'PUBLISH' | 'UNPUBLISH') {
    setPending(null);
    if (!reason.trim()) return;
    if (await onPublish(action, reason)) setReason('');
  }

  return (
    <>
      <AdminPanel
        className="border-border bg-card shadow-sm"
        title={character ? `角色详情 · ${character.name}` : '新增角色'}
        description={character ? `${statusLabels[character.reviewStatus]} · 归属：${character.creator?.username ?? '系统'} · ${character.creatorId ?? '无用户归属'} · ${character.id}` : undefined}
        badge={deleted ? <Badge variant="danger">已删除</Badge> : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" leadingIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(value => !value)}>{preview ? '返回编辑' : '管理预览'}</Button>
            <Button variant="ghost" size="sm" leadingIcon={<X className="h-4 w-4" />} disabled={busy} onClick={onClose}>关闭详情</Button>
          </>
        }
      >
        <div className="space-y-5">
          {dirty && <AdminNotice tone="warning" title="内容有未保存修改" description="请先保存再发布或下架。" className="py-3" />}
          {error && <AdminNotice tone="error" title={error} />}
          {character?.reviewReason && <AdminNotice tone="info" title="最近一次审核说明" description={character.reviewReason} />}
          {preview ? (
            <div role="region" aria-label="角色管理预览" className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-start gap-4">
                {content.avatarUrl && <img className="h-32 w-32 rounded-xl object-cover" src={content.avatarUrl} alt="角色头像预览" referrerPolicy="no-referrer" />}
                <div className="min-w-0 flex-1">
                  <h3 className="text-xl font-semibold">{content.name || '未命名角色'}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{content.tagline}</p>
                </div>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                {textFields.filter(([key]) => !['name', 'tagline', 'avatarUrl'].includes(key)).map(([key, label]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{content[key] || '未填写'}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm">初始好感值 {content.initialRomance} · 初始亲密值 {content.initialIntimacy}</p>
              <div className="flex flex-wrap gap-3">
                {content.images.map((image, index) => image.kind === 'VIDEO'
                  ? <video key={image.id ?? index} controls preload="none" className="max-h-64 max-w-full" src={image.url} />
                  : <img key={image.id ?? index} className="max-h-64 max-w-full rounded-lg" src={image.url} alt="角色画廊" referrerPolicy="no-referrer" />)}
                {content.emojis.map((image, index) => <img key={image.id ?? index} className="h-24 w-24 rounded-lg object-cover" src={image.url} alt={image.emotion} referrerPolicy="no-referrer" />)}
              </div>
              {content.supportCast.map((member, index) => <p key={member.id ?? index} className="break-words text-sm">{member.name} · {member.description}</p>)}
              <p className="text-xs text-muted-foreground">管理预览不会公开角色，也不会调用 AI。</p>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={save}>
              <nav aria-label="角色编辑分区" className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/20 p-1 text-sm">
                <a className="rounded-md px-3 py-2 text-muted-foreground hover:bg-brand-soft hover:text-brand" href="#character-basic">基础资料</a>
                <a className="rounded-md px-3 py-2 text-muted-foreground hover:bg-brand-soft hover:text-brand" href="#character-assets">素材与配角</a>
                <a className="rounded-md px-3 py-2 text-muted-foreground hover:bg-brand-soft hover:text-brand" href="#character-publish">保存与发布</a>
              </nav>
              <div id="character-basic" className="scroll-mt-6">
              <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                {textFields.map(([key, label]) => (
                  <label className={`block space-y-1.5 ${WIDE_FIELDS.includes(key) ? 'lg:col-span-2' : ''}`} key={key}>
                    <span className="text-sm font-medium">{label}</span>
                    <Textarea
                      aria-label={label}
                      rows={3}
                      required={key === 'name' || key === 'personality'}
                      maxLength={key === 'relationshipStatus' ? 100 : CHARACTER_LIMITS[key] || undefined}
                      readOnly={busy || !canEdit || deleted}
                      value={content[key]}
                      onChange={event => setContent({ ...content, [key]: event.target.value })}
                    />
                  </label>
                ))}
              </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['initialRomance', 'initialIntimacy'] as const).map(key => (
                  <label key={key} className="block space-y-1.5">
                    <span className="text-sm font-medium">{key === 'initialRomance' ? '初始好感值' : '初始亲密值'}</span>
                    <Input
                      type="number"
                      required
                      min={0}
                      max={1000000}
                      step={1}
                      readOnly={busy || !canEdit || deleted}
                      value={content[key]}
                      onChange={event => setContent({ ...content, [key]: Number(event.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" disabled={busy || !canEdit || deleted} checked={content.isAdult} onChange={event => setContent({ ...content, isAdult: event.target.checked })} />
                  成人内容标记
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" disabled={!canEdit || deleted} checked={content.isExclusive} onChange={event => setContent({ ...content, isExclusive: event.target.checked })} />
                  独家角色标记
                </label>
              </div>
              </div>
              <div id="character-assets" className="scroll-mt-6"><CharacterAssetsEditor value={{ images: content.images, emojis: content.emojis, supportCast: content.supportCast }} disabled={busy || !canEdit || !!deleted} onChange={changes => setContent(previous => ({ ...previous, ...changes }))} /></div>
              {!deleted && (canEdit || (character && canPublish)) && (
                <div id="character-publish" className="scroll-mt-6 space-y-4 border-t border-border pt-5">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">操作理由</span>
                    <Textarea aria-label="操作理由" rows={3} required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {canEdit && <Button type="submit" loading={busy} disabled={busy || !reason.trim()}>保存角色内容</Button>}
                    {character && canPublish && (
                      <>
                        <Button variant="outline" disabled={busy || dirty || !reason.trim() || character.isPublic} onClick={() => setPending('PUBLISH')}>发布角色</Button>
                        <Button variant="danger" disabled={busy || dirty || !reason.trim() || !character.isPublic} onClick={() => setPending('UNPUBLISH')}>下架角色</Button>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">保存公开角色的内容会先撤下并进入待审核；编辑权限不等于发布权限。</p>
                </div>
              )}
            </form>
          )}
        </div>
      </AdminPanel>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending === 'PUBLISH' ? '确认发布角色' : '确认下架角色'}
        description={`确认${pending === 'PUBLISH' ? '公开' : '下架'}此角色？操作会写入管理审计。`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>取消</Button>
            <Button variant={pending === 'PUBLISH' ? 'primary' : 'danger'} disabled={busy} onClick={() => pending && void publish(pending)}>确认执行</Button>
          </>
        }
      />
    </>
  );
}
