import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {useCompositionGuard} from '../src/components/chat/chat-interaction.tsx';

/**
 * 组合输入保护的回归测试（V3 §19）。
 *
 * 这条链路的失败方式是静默的：组合输入回归不会报错、不会崩，只会让中文用户把半截
 * 拼音发出去，后台看不到任何异常。所以必须在 CI 里钉住。
 *
 * hook 用 react-dom/server 渲染一次取出返回值——不需要 jsdom，也就不用假装有布局。
 * 只测组合输入：滚动依赖真实布局（jsdom 里 clientHeight 恒为 0），断言会是假的。
 */

/** 渲染一个只调用 hook 的空组件，拿回 guard。 */
function captureGuard() {
  let guard;
  function Probe() { guard = useCompositionGuard(); return null; }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(guard, 'hook 没有返回 guard');
  return guard;
}

/** 伪造一次 Enter 按键；返回这次按键是否被拦下。 */
function pressEnter(guard, isComposing = false) {
  let prevented = false;
  guard.inputProps.onKeyDown({
    key: 'Enter',
    nativeEvent: {isComposing},
    preventDefault() { prevented = true; },
  });
  return prevented;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('组合输入：候选词阶段按回车不发送，收尾窗口内也不发送，之后才发送', async () => {
  const guard = captureGuard();
  assert.equal(guard.isComposing(), false, '初始不在组合中');
  assert.equal(pressEnter(guard), false, '没在组合输入时回车照常发送');

  // 1) 组合开始 → 回车是在确认候选词，必须拦下。
  guard.inputProps.onCompositionStart();
  assert.equal(guard.isComposing(), true);
  assert.equal(pressEnter(guard), true, '组合输入中回车不能发送');
  // 提交路径也要挡住：点发送按钮时不会经过 keydown。
  assert.equal(guard.isComposing(), true, '提交前 isComposing 仍为真');

  // 2) 组合结束的同一瞬间 → 桌面 Chrome 与部分安卓输入法先 compositionend 再发 Enter，
  //    此刻 isComposing 已是 false，只靠标记拦不住。
  guard.inputProps.onCompositionEnd();
  assert.equal(guard.isComposing(), false);
  assert.equal(pressEnter(guard), true, 'compositionend 之后的 120ms 内回车仍算确认候选词');

  // 3) 收尾窗口过后 → 回车就是真的发送。
  await wait(160);
  assert.equal(pressEnter(guard), false, '窗口过后回车应正常发送');
});

test('组合输入：浏览器只在 keydown 上标 isComposing 时同样不发送', () => {
  const guard = captureGuard();
  // 有的浏览器不发 compositionstart，只在按键事件里标记，这条兜底不能丢。
  assert.equal(pressEnter(guard, true), true, 'nativeEvent.isComposing 为真时不能发送');
  assert.equal(pressEnter(guard, false), false, '没有标记时照常发送');
});

test('组合输入：连续多轮组合都能正确复位，不会一直卡在「不发送」', async () => {
  const guard = captureGuard();
  for (let round = 0; round < 3; round += 1) {
    guard.inputProps.onCompositionStart();
    assert.equal(pressEnter(guard), true, '第 ' + (round + 1) + ' 轮组合中应拦下');
    guard.inputProps.onCompositionEnd();
  }
  await wait(160);
  assert.equal(pressEnter(guard), false, '多轮之后仍能正常发送');
});
