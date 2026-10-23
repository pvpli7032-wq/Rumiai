'use client';
import {useEffect, useState} from 'react';
import {api} from '@web/lib/api-client';
import {API} from '@rumiai/contracts/api-paths';
import {useAuth} from '@web/lib/auth-context';
import {MirrorResultView} from './mirror-result-view';
import {trackProductEvent} from '@/lib/analytics-client/product-events-client';
import type {MirrorView} from './client-types';

/**
 * 结果页的登录态升级。
 *
 * 服务端渲染时拿不到浏览器里的登录 token（本仓库只在 localStorage 里存 Bearer），
 * 所以先按服务端算出的视图渲染，等客户端拿到 token 后再请求一次接口：
 * 本人会升级成带三题原回答与删除按钮的视图，其他人仍然是公开只读。
 */
export function MirrorResultLoader({shareId, locale, initialView}: {shareId: string; locale: string; initialView: MirrorView}) {
  const {token, isLoading} = useAuth();
  const [view, setView] = useState<MirrorView>(initialView);

  // 分享访问埋点：只有「看别人的结果」才算分享访问，本人打开自己的结果不计。
  useEffect(() => {
    if (initialView.kind !== 'owner') trackProductEvent(token, 'mirror_share_viewed', {subjectKey: shareId});
  }, [initialView.kind, shareId, token]);

  useEffect(() => {
    if (!token || isLoading) return;
    let stopped = false;
    api.get<MirrorView>(API.mirror.result(shareId), {token})
      .then(next => { if (!stopped && next?.result) setView(next); })
      .catch(() => { /* 打不开就保持服务端视图，不打扰读者 */ });
    return () => { stopped = true; };
  }, [token, isLoading, shareId]);

  return <MirrorResultView view={view} locale={locale} />;
}
