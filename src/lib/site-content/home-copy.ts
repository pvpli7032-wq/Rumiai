import {readPublishedSitePage} from './public-service';
import type {LandingCopy} from '@/lib/i18n/landing-copy';

/**
 * 首页文案的后台覆盖（V3 §150：首页标题、横幅、按钮文案从现有站点内容读取）。
 *
 * 为什么用站点内容的「固定页面」而不是再加一批设置键：首页文案已经有一整套多语言
 * 字典兜底，差的只是「运营能改」。站点内容本来就在管这件事——有草稿、定时发布、
 * 版本恢复和 SITE_CONTENT_MANAGER 权限，再开设置键等于把同一件事做两遍。
 * 运营把区块填进 slug 为 `home` 的页面，首页就用它；没填就用字典。
 *
 * 只认三种区块，各覆盖一小块文案，不接管整页结构：
 * PARAGRAPH 第 1 段→主标题、第 2 段→副标题；BUTTON 第 1 个→主按钮、第 2 个→次按钮；
 * CARD_GRID 第 1 张卡→「他眼中的你」入口的标题／说明／按钮。
 * 首页横幅本来就读站点内容的 banner，这里不重复。
 */
export const HOME_PAGE_SLUG = 'home';

export async function readHomeCopyOverrides(): Promise<Partial<LandingCopy>> {
  const page = await readPublishedSitePage(HOME_PAGE_SLUG);
  if (!page) return {};
  const overrides: Partial<LandingCopy> = {};

  const paragraphs = page.blocks.flatMap(block => block.type === 'PARAGRAPH' ? [block.text.trim()] : []);
  if (paragraphs[0]) overrides.headline = paragraphs[0];
  if (paragraphs[1]) overrides.subhead = paragraphs[1];

  const buttons = page.blocks.flatMap(block => block.type === 'BUTTON' ? [block.text.trim()] : []);
  if (buttons[0]) overrides.primaryCta = buttons[0];
  if (buttons[1]) overrides.secondaryCta = buttons[1];

  const card = page.blocks.flatMap(block => block.type === 'CARD_GRID' ? block.cards.slice(0, 1) : [])[0];
  if (card) {
    if (card.title.trim()) overrides.mirrorTitle = card.title.trim();
    if (card.description.trim()) overrides.mirrorBody = card.description.trim();
    if (card.actionLabel.trim()) overrides.mirrorCta = card.actionLabel.trim();
  }
  return overrides;
}
