'use client';
import {useEffect, useState} from 'react';
import {api} from '@/lib/api-client';
import {API} from '@/lib/api-paths';
import {useAuth} from '@/lib/auth-context';
import {MirrorResultView} from './mirror-result-view';
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
