'use client';

import {useCallback, useRef, useState} from 'react';
import type {KeyboardEvent, RefObject, UIEvent} from 'react';
import {ArrowDown} from 'lucide-react';

/**
 * 聊天页的输入与滚动细节（V3 §19）。
 *
 * 两条都是中文手机用户的必现问题：回车确认候选词会把半截拼音发出去；
 * 流式输出期间无条件滚到底，把正在往上回看的用户一次次弹回去。
 * 逻辑放这里而不是页面里，页面只管把它们接到 JSX 上。
 */

/** 距底部小于这个像素数就算「贴着底部」。留余量，避免平滑滚动中的抖动被判成上翻。 */
const BOTTOM_THRESHOLD = 56;

/**
 * 组合输入收尾的时间窗。
 *
 * 桌面 Chrome 与部分安卓输入法在回车确认候选词时，先发 compositionend 再发 Enter 的
 * keydown，此时 isComposing 已经是 false。只靠标记会把这一下当成发送，
 * 所以结束后的这一小段窗口内仍按组合输入处理。
 */
const COMPOSITION_TAIL_MS = 120;

export interface ChatScroll {
  /** 当前是否贴着底部；false 时显示「回到最新」。 */
  atBottom: boolean;
  /** 展开到滚动容器上：位置真相只来自容器自己的 scroll 事件。 */
  listProps: {onScroll: (event: UIEvent<HTMLDivElement>) => void};
  /** 内容变化后调用：贴底才把最新内容滚进视野。 */
  followTail: () => void;
  /** 「回到最新」：滚到底并恢复跟随。 */
  jumpToLatest: () => void;
  /** 加载更早历史前调用：这一次不要跟随。 */
  skipNextFollow: () => void;
  /** 输入框获得焦点：把最新内容顶进可视区，避免被软键盘盖住。 */
  revealComposer: () => void;
}

export function useChatScroll(
  endRef: RefObject<HTMLDivElement | null>,
): ChatScroll {
  const [atBottom, setAtBottom] = useState(true);
  // 与 atBottom 同步的 ref：followTail 在事件回调里读，不能等一次渲染。
  const atBottomRef = useRef(true);
  const skipRef = useRef(false);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    if (atBottomRef.current === next) return;
    atBottomRef.current = next;
    setAtBottom(next);
  }, []);

  const followTail = useCallback(() => {
    // 加载更早的历史会把视口钉在原处，这一次不能跟随。
    if (skipRef.current) { skipRef.current = false; return; }
    if (!atBottomRef.current) return;
    endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [endRef]);

  const jumpToLatest = useCallback(() => {
    atBottomRef.current = true;
    setAtBottom(true);
    endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [endRef]);

  const skipNextFollow = useCallback(() => { skipRef.current = true; }, []);

  /**
   * 软键盘弹出后容器变矮，最后一条消息可能被顶出可视区。
   * 等一帧再滚：焦点事件先于键盘动画完成，立刻滚会滚到旧位置。
   */
  const revealComposer = useCallback(() => {
    atBottomRef.current = true;
    setAtBottom(true);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({block: 'end'}));
  }, [endRef]);

  return {atBottom, listProps: {onScroll}, followTail, jumpToLatest, skipNextFollow, revealComposer};
}

export interface CompositionGuard {
  /** 展开到 <input> 上：composition 事件、回车拦截、聚焦回位一次接好。 */
  inputProps: {
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onFocus: () => void;
  };
  /** 提交前调用：仍在组合中就不要发出去。 */
  isComposing: () => boolean;
}

/**
 * 中文输入法的组合输入保护。
 *
 * 状态必须放 ref：组合输入期间每敲一个字都会改值，用 state 会让整页多渲染一次。
 * 回车拦截放在 keydown：确认候选词时 keydown 先于 compositionend 到达，
 * 那也是表单提交之前唯一来得及拦下来的时机。
 */
export function useCompositionGuard(revealComposer?: () => void): CompositionGuard {
  const composing = useRef(false);
  const endedAt = useRef(0);

  const onCompositionStart = useCallback(() => { composing.current = true; }, []);
  const onCompositionEnd = useCallback(() => { composing.current = false; endedAt.current = Date.now(); }, []);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const justEnded = Date.now() - endedAt.current < COMPOSITION_TAIL_MS;
    // nativeEvent.isComposing 兜底：有的浏览器在组合期间也报 keydown，但标记不同。
    if (composing.current || event.nativeEvent.isComposing || justEnded) event.preventDefault();
  }, []);
  const onFocus = useCallback(() => { revealComposer?.(); }, [revealComposer]);
  const isComposing = useCallback(() => composing.current, []);

  return {inputProps: {onCompositionStart, onCompositionEnd, onKeyDown, onFocus}, isComposing};
}

/**
 * 「回到最新」：用户上翻回看时不再自动跟随，给一个明确的出口。
 * 点了才滚到底并恢复跟随，不抢用户正在读的位置。
 */
export function ScrollToLatest({onJump}: {onJump: () => void}) {
  // sticky 而不是 absolute：按钮就在滚动容器里，贴在可视区底部，
  // 既不会压到输入框，也不会跟着内容滚出屏幕。
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label="回到最新消息"
      className="sticky bottom-2 z-10 mx-auto flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-zinc-800/95 px-4 py-2 text-xs text-zinc-200 shadow-lg backdrop-blur-xs transition-colors hover:bg-zinc-700 hover:text-white"
    >
      <ArrowDown className="h-3.5 w-3.5" />
      回到最新
    </button>
  );
}