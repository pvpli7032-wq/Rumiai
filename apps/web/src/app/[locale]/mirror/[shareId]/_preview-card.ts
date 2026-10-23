import {fetchPublicApi, PublicApiError} from '@/lib/server-api';
import type {MirrorPublicResult} from '@rumiai/contracts/mirror/types';

/**
 * 分享预览图的数据（V3 §23 表 19「用已有分享方案或 next/og 输出预览图」）。
 *
 * 只取公开视图里允许展示的字段：称号、第一条观察、角色名、站点名。
 * 公开视图本身就没有三题原回答（见 share.ts 的 toPublicResult），所以回答
 * 不可能进到图片里——这是结构上的保证，不是靠事后过滤。
 *
 * 可见性与分享页完全一致：隐藏、过期、删除后 readMirrorResult 抛 404，
 * 这里同样返回 null，由图片路由给出 404。否则图片会变成绕过分享页的侧路。
 */

export type MirrorPreviewCard = {
  title: string;
  /** 图片里只放第一条观察，长文本会把版面挤满。 */
  observation: string;
  characterName: string;
};

export const MIRROR_PREVIEW_SIZE = {width: 1200, height: 630} as const;

/** 站点名与文案固定用默认语言：预览图不做多语言排版差异。 */
export const MIRROR_PREVIEW_SITE = '星伴';

export async function readPreviewCard(shareId: string): Promise<MirrorPreviewCard | null> {
  try {
    // 以陌生人身份读：即便请求带登录态或归属凭据，预览图也只用公开字段。
    const view = await fetchPublicApi<{kind:'public'|'owner';result:MirrorPublicResult}>(`/api/mirror/${encodeURIComponent(shareId)}`);
    return {
      title: view.result.title,
      observation: view.result.observations[0] ?? '',
      characterName: view.result.characterName,
    };
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) return null;
    throw error;
  }
}
