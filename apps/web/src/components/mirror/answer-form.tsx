'use client';
import {Button, Textarea} from '@rumiai/ui';
import type {MirrorRules} from '@rumiai/contracts/mirror/types';

/**
 * 答题：题数、每题字数上限与题目文本全部来自设置中心，前端不写死任何一道题。
 * questions 必须够 questionCount 条——条数不足时上层直接提示待配置，不渲染这个表单，
 * 所以这里不会出现「用默认题顶上」的情况。
 */
export function MirrorAnswerForm({rules, questions, answers, onChange, onSubmit, submitting, disabled, submitLabel = '看看 TA 眼中的我'}: {
  rules: Pick<MirrorRules, 'questionCount' | 'answerMaxChars'>;
  questions: string[];
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
            <span className="flex items-baseline justify-between gap-3 text-sm text-foreground">
              <span className="min-w-0 break-words font-medium">{questions[index]}</span>
              <span className={tooLong ? 'shrink-0 text-xs text-destructive' : 'shrink-0 text-xs text-muted-foreground'}>
                第 {index + 1} 题 · {length}/{rules.answerMaxChars}
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
