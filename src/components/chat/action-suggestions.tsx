'use client';

import {Button} from '@/components/ui';

export type ActionSuggestionsProps = {
  suggestions: readonly {id: string; text: string}[];
  onPick: (text: string) => void;
  disabled?: boolean;
};

export function ActionSuggestions({suggestions, onPick, disabled = false}: ActionSuggestionsProps) {
  if (!suggestions.length) return null;
  return (
    <div role="group" aria-label="建议动作，可填入草稿后修改" className="flex flex-wrap gap-2">
      {suggestions.slice(0, 3).map(suggestion => (
        <Button key={suggestion.id} variant="outline" disabled={disabled} onClick={() => onPick(suggestion.text)} className="h-auto min-h-10 whitespace-normal py-2 text-left">
          {suggestion.text}
        </Button>
      ))}
    </div>
  );
}
