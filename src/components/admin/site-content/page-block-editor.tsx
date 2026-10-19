'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { SitePageBlock } from '@/lib/use-site-content';

type DraftBlock = Record<string, unknown>;
type BlockKind = SitePageBlock['type'];

const kinds: Array<{ value: BlockKind; label: string }> = [
  { value: 'PARAGRAPH', label: '正文段落' },
  { value: 'HEADING', label: '标题' },
  { value: 'LINK', label: '站内文本链接' },
  { value: 'IMAGE', label: '站点图片' },
  { value: 'LIST', label: '项目列表' },
  { value: 'BUTTON', label: '行动按钮' },
  { value: 'NOTICE', label: '提示框' },
  { value: 'CARD_GRID', label: '卡片网格' },
];
const emptyCard = () => ({ title: '', description: '', href: '/discover', actionLabel: '了解更多' });

function emptyBlock(kind: string): DraftBlock {
  if (kind === 'HEADING') return { type: kind, text: '', level: 2 };
  if (kind === 'LINK') return { type: kind, text: '', href: '/discover' };
  if (kind === 'IMAGE') return { type: kind, src: '/brand/icon.svg', alt: '站点图片', caption: '' };
  if (kind === 'LIST') return { type: kind, ordered: false, items: [''] };
  if (kind === 'BUTTON') return { type: kind, text: '了解更多', href: '/discover', variant: 'PRIMARY' };
  if (kind === 'NOTICE') return { type: kind, text: '', tone: 'INFO' };
  if (kind === 'CARD_GRID') return { type: kind, heading: '功能介绍', cards: [emptyCard()] };
  return { type: 'PARAGRAPH', text: '' };
}

const TEXT_LIMIT = (kind: unknown) => kind === 'NOTICE' ? 1000 : kind === 'HEADING' ? 100 : 3000;

export function PageBlockEditor({ value, onChange }: { value: SitePageBlock[]; onChange: (blocks: SitePageBlock[]) => void }) {
  const blocks = (Array.isArray(value) ? value : []) as DraftBlock[];
  const commit = (next: DraftBlock[]) => onChange(next as unknown as SitePageBlock[]);
  const update = (index: number, patch: DraftBlock) => commit(blocks.map((block, i) => i === index ? { ...block, ...patch } : block));

  return (
    <div className="mt-2 space-y-3">
      {blocks.map((block, index) => {
        const items = (Array.isArray(block.items) ? block.items : []) as string[];
        const cards = (Array.isArray(block.cards) ? block.cards : []) as DraftBlock[];
        return (
          <section key={index} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">组件 {index + 1}</span>
              <Select size="sm" aria-label={`页面组件类型 ${index + 1}`} className="min-w-0 flex-1" value={String(block.type)} onChange={event => commit(blocks.map((item, i) => i === index ? emptyBlock(event.target.value) : item))}>
                {kinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </Select>
              <Button type="button" variant="ghost" size="sm" leadingIcon={<Trash2 className="h-3.5 w-3.5" />} className="text-destructive" onClick={() => commit(blocks.filter((_, i) => i !== index))}>移除组件</Button>
            </div>

            {block.type === 'CARD_GRID' ? (
              <>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">卡片区标题</span>
                  <Input aria-label={`卡片区标题 ${index + 1}`} maxLength={80} value={String(block.heading ?? '')} onChange={event => update(index, { heading: event.target.value })} />
                </label>
                {cards.map((card, cardIndex) => {
                  const updateCard = (patch: DraftBlock) => update(index, { cards: cards.map((item, i) => i === cardIndex ? { ...item, ...patch } : item) });
                  return (
                    <article key={cardIndex} className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-2">
                      <div className="flex items-center justify-between gap-2 md:col-span-2">
                        <p className="text-sm font-medium">卡片 {cardIndex + 1}</p>
                        <Button type="button" variant="ghost" size="sm" disabled={cards.length <= 1} onClick={() => update(index, { cards: cards.filter((_, i) => i !== cardIndex) })}>移除卡片</Button>
                      </div>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium">卡片标题</span>
                        <Input aria-label={`卡片标题 ${index + 1}-${cardIndex + 1}`} maxLength={80} value={String(card.title ?? '')} onChange={event => updateCard({ title: event.target.value })} />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium">按钮文字</span>
                        <Input aria-label={`卡片按钮文字 ${index + 1}-${cardIndex + 1}`} maxLength={40} value={String(card.actionLabel ?? '')} onChange={event => updateCard({ actionLabel: event.target.value })} />
                      </label>
                      <label className="block space-y-1.5 md:col-span-2">
                        <span className="text-sm font-medium">卡片说明</span>
                        <Textarea aria-label={`卡片说明 ${index + 1}-${cardIndex + 1}`} rows={3} maxLength={300} value={String(card.description ?? '')} onChange={event => updateCard({ description: event.target.value })} />
                      </label>
                      <label className="block space-y-1.5 md:col-span-2">
                        <span className="text-sm font-medium">站内跳转路径</span>
                        <Input aria-label={`卡片链接 ${index + 1}-${cardIndex + 1}`} maxLength={200} value={String(card.href ?? '/')} onChange={event => updateCard({ href: event.target.value })} />
                      </label>
                    </article>
                  );
                })}
                <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />} disabled={cards.length >= 6} onClick={() => update(index, { cards: [...cards, emptyCard()] })}>添加卡片</Button>
              </>
            ) : block.type === 'IMAGE' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">站内图片路径</span>
                  <Input aria-label={`页面图片路径 ${index + 1}`} maxLength={300} placeholder="/brand/cover.svg 或 /uploads/站点素材.png" value={String(block.src ?? '')} onChange={event => update(index, { src: event.target.value })} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">图片替代文字</span>
                  <Input aria-label={`图片替代文字 ${index + 1}`} maxLength={160} value={String(block.alt ?? '')} onChange={event => update(index, { alt: event.target.value })} />
                </label>
                <label className="block space-y-1.5 sm:col-span-2">
                  <span className="text-sm font-medium">图片说明</span>
                  <Input aria-label={`图片说明 ${index + 1}`} maxLength={240} value={String(block.caption ?? '')} onChange={event => update(index, { caption: event.target.value })} />
                </label>
              </div>
            ) : block.type === 'LIST' ? (
              <>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand" checked={Boolean(block.ordered)} onChange={event => update(index, { ordered: event.target.checked })} />
                  使用编号列表
                </label>
                <div className="space-y-2">
                  {items.map((item, itemIndex) => (
                    <div key={itemIndex} className="flex min-w-0 gap-2">
                      <Input
                        aria-label={`列表内容 ${index + 1}-${itemIndex + 1}`}
                        maxLength={240}
                        value={String(item)}
                        onChange={event => update(index, { items: items.map((value, i) => i === itemIndex ? event.target.value : value) })}
                      />
                      <Button type="button" variant="ghost" size="sm" disabled={items.length <= 1} onClick={() => update(index, { items: items.filter((_, i) => i !== itemIndex) })}>移除</Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />} disabled={items.length >= 20} onClick={() => update(index, { items: [...items, ''] })}>添加列表项</Button>
              </>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">
                    {block.type === 'BUTTON' ? '按钮文字' : block.type === 'LINK' ? '链接文字' : block.type === 'HEADING' ? '标题文字' : block.type === 'NOTICE' ? '提示内容' : '正文文字'}
                  </span>
                  <Textarea aria-label={`页面组件文字 ${index + 1}`} rows={3} maxLength={TEXT_LIMIT(block.type)} value={String(block.text ?? '')} onChange={event => update(index, { text: event.target.value })} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {block.type === 'HEADING' && (
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">标题级别</span>
                      <Select aria-label={`页面标题级别 ${index + 1}`} value={String(block.level ?? 2)} onChange={event => update(index, { level: Number(event.target.value) })}>
                        <option value="2">二级标题</option><option value="3">三级标题</option>
                      </Select>
                    </label>
                  )}
                  {(block.type === 'LINK' || block.type === 'BUTTON') && (
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">站内跳转路径</span>
                      <Input aria-label={`页面组件链接 ${index + 1}`} maxLength={200} value={String(block.href ?? '/')} onChange={event => update(index, { href: event.target.value })} />
                    </label>
                  )}
                  {block.type === 'BUTTON' && (
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">按钮样式</span>
                      <Select aria-label={`按钮样式 ${index + 1}`} value={String(block.variant ?? 'PRIMARY')} onChange={event => update(index, { variant: event.target.value })}>
                        <option value="PRIMARY">主按钮</option><option value="SECONDARY">次按钮</option>
                      </Select>
                    </label>
                  )}
                  {block.type === 'NOTICE' && (
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">提示样式</span>
                      <Select aria-label={`提示样式 ${index + 1}`} value={String(block.tone ?? 'INFO')} onChange={event => update(index, { tone: event.target.value })}>
                        <option value="INFO">普通提示</option><option value="WARNING">提醒</option>
                      </Select>
                    </label>
                  )}
                </div>
              </>
            )}
          </section>
        );
      })}
      <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />} disabled={blocks.length >= 30} onClick={() => commit([...blocks, emptyBlock('PARAGRAPH')])}>添加内容组件</Button>
      <p className="text-xs text-muted-foreground">组件仅生成标题、正文、图片、列表、站内链接、行动按钮、提示和卡片网格，不接受 HTML、脚本或任意 React 代码；图片只接受站点素材，链接只接受站内路径。</p>
    </div>
  );
}
