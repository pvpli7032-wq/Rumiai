'use client';
import {useState} from 'react';
import {Button} from '@rumiai/ui';
import {Trash2} from 'lucide-react';

/** 删除自己的结果：本人或匿名归属凭据持有人才会看到这个按钮。 */
export function DeleteResultButton({onDelete, label = '删除这条结果'}: {onDelete: () => Promise<void>; label?: string}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="danger"
      size="sm"
      loading={busy}
      leadingIcon={<Trash2 aria-hidden className="h-4 w-4" />}
      onClick={async () => {
        setBusy(true);
        try { await onDelete(); } finally { setBusy(false); }
      }}
    >
      {label}
    </Button>
  );
}
