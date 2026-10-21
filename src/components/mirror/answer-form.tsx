'use client';
import {Button, Textarea} from '@/components/ui';
import type {MirrorRules} from '@/lib/mirror/types';

/** 答题：题数与每题字数上限都来自设置中心，前端不写死。 */
export function MirrorAnswerForm({rules, answers, onChange, onSubmit, submitting, disabled, submitLabel = '看看 TA 眼中的我'}: {
  rules: Pick<MirrorRules, 'questionCount' | 'answerMaxChars'>;
  answers: string[];
  onChange: (index: number, value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
  submitLabel?: string;
}) {
  const complete = answers.length === rules.questionCount && answers.every(answer => answer.trim().length > 0 && [...answer].length <= rules.answerMaxChars);
  return (
    <div className="space-y-4">
      {Array.from({length: rules.questionCount}, (_, index) => {
        const value = answers[index] ?? '';
        const length = [...value].length;
        const tooLong = length > rules.answerMaxChars;
        return (
          <label key={index} className="block">
            <span className="flex items-baseline justify-between text-sm text-foreground">
              <span>第 {index + 1} 题</span>
              <span className={tooLong ? 'text-destructive' : 'text-muted-foreground'}>
                {length}/{rules.answerMaxChars}
              </span>
            </span>
            <Textarea
              className="mt-2"
              rows={3}
              value={value}
              disabled={disabled || submitting}
              invalid={tooLong}
              onChange={event => onChange(index, event.target.value)}
            />
          </label>
        );
      })}
      <Button onClick={onSubmit} loading={submitting} disabled={disabled || !complete} fullWidth size="lg">
        {submitLabel}
      </Button>
    </div>
  );
}
