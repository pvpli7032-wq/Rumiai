import {useCallback, useState} from 'react';
import {Flag, Share2} from 'lucide-react';
import {apiFetch} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {DEFAULT_LOCALE} from '@web/lib/i18n';
import {useUiConfig} from '@web/lib/settings/use-ui-config';

/**
 * 聊天页「分享」与「评理」两个入口（V3 表 15）。
 *
 * 分享：向服务端要一个只读的公开链接（/share/chat/{id}）并复制到剪贴板；没有这条
 * 对话或还没有消息时服务端会说清原因，这里原样转述，不假装成功。
 * 评理：跳到 /[locale]/disputes/new 并带上这段对话，由发起表单自己加载候选消息并
 * 勾选，这里不重复实现摘录逻辑。评理广场关闭时按设置置灰，不另写默认值。
 */
export function ChatShareAndDispute({conversationId, disabled}: {conversationId: string; disabled: boolean}) {
  const config = useUiConfig();
  // 配置未加载（首帧空对象）与明确关闭分开：前者只是还没读到，链接照常可点。
  const configLoaded = Object.keys(config).length > 0;
  const disputeEnabled = !configLoaded || config['dispute.enabled'] === true;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const share = useCallback(async () => {
    setBusy(true);
    setNotice('');
    setCopied(false);
    try {
      const data = await apiFetch<{url: string; path: string; turnCount: number}>(sharePath(conversationId), {method: 'POST', cache: 'no-store'});
      setShareUrl(data.url);
      try {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
        setNotice(`链接已复制，最近 ${data.turnCount} 条消息会公开显示。`);
      } catch {
        setNotice('链接已生成，复制失败时可以手动选中下面这条。');
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '生成分享链接失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }, [conversationId]);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void share()}
          disabled={disabled || busy}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
        >
          <Share2 aria-hidden className="h-4 w-4" />
          {busy ? '正在生成…' : '分享'}
        </button>
        <a
          href={`/${DEFAULT_LOCALE}/disputes/new?conversationId=${encodeURIComponent(conversationId)}`}
          aria-disabled={disputeEnabled ? undefined : true}
          title={disputeEnabled ? '从这段对话发起评理' : '评理广场暂未开放'}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors ${disputeEnabled ? 'text-foreground hover:bg-secondary' : 'pointer-events-none text-muted-foreground'}`}
        >
          <Flag aria-hidden className="h-4 w-4" />
          评理
        </a>
      </div>
      {notice && (
        <p role="status" className="mt-1 max-w-xl text-xs text-muted-foreground">
          {notice}
          {shareUrl && (
            <>
              {' '}
              <a href={shareUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand underline-offset-4 hover:underline">
                {shareUrl}
              </a>
              {copied && <span className="ml-1 text-muted-foreground">（已复制）</span>}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function sharePath(id: string): string {
  return API.conversations.share(id);
}
