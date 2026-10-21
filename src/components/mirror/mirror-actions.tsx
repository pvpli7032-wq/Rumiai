'use client';
import Link from 'next/link';
import {Button} from '@/components/ui';
import {MessageCircle, RefreshCw, Share2} from 'lucide-react';
import {useAuth} from '@/lib/auth-context';
import {trackProductEvent} from '@/lib/analytics/product-events-client';

/** 结果页三个动作：和 TA 聊聊、换角色、分享。 */
export function MirrorActions({characterId, onAgain, onShare, canShare}: {characterId: string; onAgain?: () => void; onShare: () => void; canShare: boolean}) {
  const {token} = useAuth();
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={'/chat?character=' + encodeURIComponent(characterId)} className="inline-flex" onClick={() => trackProductEvent(token, 'mirror_to_chat', {subjectKey: characterId})}>
        <Button leadingIcon={<MessageCircle aria-hidden className="h-4 w-4" />}>和 TA 聊聊</Button>
      </Link>
      {onAgain && <Button variant="outline" leadingIcon={<RefreshCw aria-hidden className="h-4 w-4" />} onClick={onAgain}>换角色</Button>}
      {canShare && <Button variant="outline" leadingIcon={<Share2 aria-hidden className="h-4 w-4" />} onClick={onShare}>分享</Button>}
    </div>
  );
}
