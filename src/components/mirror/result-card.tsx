import {Badge, Card, CardContent, CardHeader} from '@/components/ui';
import {Sparkles} from 'lucide-react';
import type {MirrorResultFields} from '@/lib/mirror/types';

/** 结果展示：称号、三条观察、金句、两个娱乐指数。只读字段，回答不在这里。 */
export function MirrorResultCard({fields, aiNote = true}: {fields: MirrorResultFields; aiNote?: boolean}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">{fields.title}</Badge>
          {aiNote && <span className="text-xs text-muted-foreground">AI 生成</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="space-y-2">
          {fields.observations.map((observation, index) => (
            <li key={index} className="flex gap-2 text-sm text-foreground">
              <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span>{observation}</span>
            </li>
          ))}
        </ul>
        <blockquote className="rounded-lg border-l-4 border-brand bg-muted p-3 text-sm italic text-foreground">{fields.quote}</blockquote>
        <div className="grid grid-cols-2 gap-3">
          <MirrorIndex label="氛围感" value={fields.indices.atmosphere} />
          <MirrorIndex label="默契度" value={fields.indices.rapport} />
        </div>
      </CardContent>
    </Card>
  );
}

function MirrorIndex({label, value}: {label: string; value: number}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold text-foreground">{clamped}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
        <div className="h-full rounded-full bg-brand" style={{width: `${clamped}%`}} />
      </div>
    </div>
  );
}
