'use client';
import {useEffect, useState} from 'react';
import {useAuth} from '@/lib/auth-context';

type Access = {moderation: boolean; finance: boolean};
export function useAdminAccess() {
  const {token, isLoading} = useAuth();
  const [result, setResult] = useState<{token: string; access?: Access; error?: string} | null>(null);
  useEffect(() => {
    if (!token) {setResult(null); return;}
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/admin/access', {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal: controller.signal});
        const data = await response.json();
        if (!response.ok) throw Error('无法读取管理权限，请刷新页面重试。');
        if (typeof data.moderation !== 'boolean' || typeof data.finance !== 'boolean') throw Error('管理权限响应异常，请稍后重试。');
        if (!controller.signal.aborted) setResult({token, access: data});
      } catch {
        if (!controller.signal.aborted) setResult({token, error: '无法读取管理权限，请刷新页面重试。'});
      }
    })();
    return () => controller.abort();
  }, [token]);
  const current = result?.token === token ? result : null;
  return {token, access: current?.access, error: current?.error, loading: isLoading || Boolean(token && !current)};
}
