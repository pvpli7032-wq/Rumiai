import type {DisputeExcerptMessage} from '@rumiai/contracts/disputes/types';

/** 摘录快照：只读创建时选中的消息，不回读实时对话，也不冒充真人对话。 */
export function ExcerptView({excerpt}: {excerpt: DisputeExcerptMessage[]}) {
  return (
    <ol className="space-y-2">
      {excerpt.map(message => (
        <li key={message.messageId} className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="mb-1 text-xs text-muted-foreground">{message.role === 'USER' ? '发起人' : '角色'}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        </li>
      ))}
    </ol>
  );
}
