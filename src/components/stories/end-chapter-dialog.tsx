'use client';

import {Button, Dialog} from '@/components/ui';

export type EndChapterDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function EndChapterDialog({open, onClose, onConfirm}: EndChapterDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="结束本次体验？"
      description="只结束本次体验，不会判定章节完成。"
      size="sm"
      footer={<><Button variant="outline" onClick={onClose}>继续聊天</Button><Button onClick={onConfirm}>结束本次体验</Button></>}
    >
      <p className="text-sm leading-relaxed text-muted-foreground">你可以回看对话片段，也可以返回原会话继续交流。</p>
    </Dialog>
  );
}
