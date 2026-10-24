'use client';
import {useState} from 'react';
import {Button, Dialog} from '@rumiai/ui';
import {Trash2} from 'lucide-react';

/** 删除自己的结果：本人或匿名归属凭据持有人才会看到这个按钮。 */
export function DeleteResultButton({onDelete, label = '删除这条结果'}: {onDelete: () => Promise<void>; label?: string}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function remove() { setBusy(true); try { await onDelete(); setConfirming(false); } finally { setBusy(false); } }
  return <><Button variant="danger" size="sm" leadingIcon={<Trash2 aria-hidden className="h-4 w-4" />} onClick={() => setConfirming(true)}>{label}</Button><Dialog open={confirming} onClose={() => !busy && setConfirming(false)} title="删除这条结果" description="删除后分享链接会失效，其他人也无法再查看。" footer={<><Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>取消</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>确认删除</Button></>}>此操作无法撤销。</Dialog></>;
}