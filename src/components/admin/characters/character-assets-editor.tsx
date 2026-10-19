import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { CharacterContent } from './types';

type Assets = Pick<CharacterContent, 'images' | 'emojis' | 'supportCast'>;

function SubBlock({ title, count, limit, children }: { title: string; count: number; limit: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}（{count}/{limit}）</h3>
      {children}
    </section>
  );
}

export function CharacterAssetsEditor({ value, disabled, onChange }: { value: Assets; disabled: boolean; onChange: (changes: Partial<Assets>) => void }) {
  return (
    <div className="space-y-5 border-t border-border pt-5">
      <SubBlock title="角色画廊" count={value.images.length} limit={12}>
        {value.images.map((row, index) => (
          <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-4" key={row.id ?? `new-${index}`}>
            <label className="block space-y-1.5 md:col-span-2">
              <span className="text-sm font-medium">画廊地址 {index + 1}</span>
              <Input required readOnly={disabled} maxLength={2048} value={row.url} onChange={event => onChange({ images: value.images.map((item, at) => at === index ? { ...item, url: event.target.value } : item) })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">画廊类型</span>
              <Select aria-label={`画廊类型 ${index + 1}`} disabled={disabled} value={row.kind} onChange={event => onChange({ images: value.images.map((item, at) => at === index ? { ...item, kind: event.target.value as 'IMAGE' | 'VIDEO' } : item) })}>
                <option value="IMAGE">图片</option><option value="VIDEO">视频</option>
              </Select>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={disabled || index === 0} onClick={() => { const next = [...value.images]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange({ images: next }); }}>上移</Button>
              <Button type="button" variant="outline" size="sm" leadingIcon={<Trash2 className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => onChange({ images: value.images.filter((_, at) => at !== index) })}>删除</Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />} disabled={disabled || value.images.length >= 12} onClick={() => onChange({ images: [...value.images, { url: '', kind: 'IMAGE' }] })}>新增画廊项</Button>
      </SubBlock>

      <SubBlock title="表情立绘" count={value.emojis.length} limit={20}>
        {value.emojis.map((row, index) => (
          <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-3" key={row.id ?? `new-${index}`}>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">表情名称 {index + 1}</span>
              <Input required readOnly={disabled} maxLength={40} value={row.emotion} onChange={event => onChange({ emojis: value.emojis.map((item, at) => at === index ? { ...item, emotion: event.target.value } : item) })} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">表情图片 {index + 1}</span>
              <Input required readOnly={disabled} maxLength={2048} value={row.url} onChange={event => onChange({ emojis: value.emojis.map((item, at) => at === index ? { ...item, url: event.target.value } : item) })} />
            </label>
            <Button type="button" variant="outline" size="sm" className="self-end" leadingIcon={<Trash2 className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => onChange({ emojis: value.emojis.filter((_, at) => at !== index) })}>删除表情项</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />} disabled={disabled || value.emojis.length >= 20} onClick={() => onChange({ emojis: [...value.emojis, { emotion: '', url: '' }] })}>新增表情项</Button>
      </SubBlock>

      <SubBlock title="配角" count={value.supportCast.length} limit={10}>
        {value.supportCast.map((row, index) => (
          <div className="space-y-3 rounded-lg border border-border p-3" key={row.id ?? `new-${index}`}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">配角名称 {index + 1}</span>
                <Input required readOnly={disabled} maxLength={40} value={row.name} onChange={event => onChange({ supportCast: value.supportCast.map((item, at) => at === index ? { ...item, name: event.target.value } : item) })} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">配角头像 {index + 1}</span>
                <Input readOnly={disabled} maxLength={2048} value={row.avatarUrl ?? ''} onChange={event => onChange({ supportCast: value.supportCast.map((item, at) => at === index ? { ...item, avatarUrl: event.target.value } : item) })} />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">配角说明 {index + 1}</span>
              <Textarea aria-label={`配角说明 ${index + 1}`} readOnly={disabled} rows={3} maxLength={2000} value={row.description} onChange={event => onChange({ supportCast: value.supportCast.map((item, at) => at === index ? { ...item, description: event.target.value } : item) })} />
            </label>
            <Button type="button" variant="outline" size="sm" leadingIcon={<Trash2 className="h-3.5 w-3.5" />} disabled={disabled} onClick={() => onChange({ supportCast: value.supportCast.filter((_, at) => at !== index) })}>删除配角</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />} disabled={disabled || value.supportCast.length >= 10} onClick={() => onChange({ supportCast: [...value.supportCast, { name: '', description: '', avatarUrl: '' }] })}>新增配角</Button>
      </SubBlock>
    </div>
  );
}
