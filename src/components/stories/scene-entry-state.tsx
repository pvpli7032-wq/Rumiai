import {EmptyState} from '@/components/ui';

export type SceneEntryStateProps = {
  reason: 'missing-config' | 'disabled' | 'incomplete-copy' | 'incompatible-character';
  characterName?: string;
};

const descriptions: Record<SceneEntryStateProps['reason'], string> = {
  'missing-config': '当前角色暂未提供场景入口。',
  disabled: '这个场景暂不开放。',
  'incomplete-copy': '场景资料暂不可用，请稍后再试。',
  'incompatible-character': '这个场景暂不适用于当前角色。',
};

export function SceneEntryState({reason, characterName}: SceneEntryStateProps) {
  return <EmptyState title={characterName ? characterName + '的场景暂不可用' : '场景暂不可用'} description={descriptions[reason]} />;
}
