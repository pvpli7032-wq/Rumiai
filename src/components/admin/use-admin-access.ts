'use client';
import {createContext, createElement, useContext, useEffect, useState, type ReactNode} from 'react';
import {useAuth} from '@/lib/auth-context';
import type {AdminPermission} from '@/lib/admin/permissions';

type Session = {permissions: AdminPermission[]; roles: string[]; enabled: boolean; managed: boolean; owner: boolean};
function useSessionState(enabled = true) {
  const {token, isLoading} = useAuth();
  const [result, setResult] = useState<{token: string; session?: Session; error?: string} | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled || !token) {setResult(null); return;}
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/admin/session', {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store', signal: controller.signal});
        const data = await response.json();
        if (!response.ok) throw Error('无法读取管理权限，请刷新页面重试。');
        if (!Array.isArray(data.permissions) || !Array.isArray(data.roles) || typeof data.enabled !== 'boolean') throw Error('管理权限响应异常，请稍后重试。');
        if (!controller.signal.aborted) setResult({token, session: data});
      } catch {
        if (!controller.signal.aborted) setResult({token, error: '无法读取管理权限，请刷新页面重试。'});
      }
    })();
    return () => controller.abort();
  }, [token, enabled, refresh]);
  const current = result?.token === token ? result : null;
  const permissions = current?.session?.permissions ?? [];
  const access = current?.session ? {moderation: permissions.includes('moderation.read'), finance: permissions.includes('finance.read'), characters: permissions.includes('characters.read'), accounts: permissions.includes('accounts.read'), staff: permissions.includes('admin.staff.read'), audit: permissions.includes('admin.audit.read')} : undefined;
  return {token, access, permissions, session: current?.session, error: current?.error, loading: isLoading || Boolean(enabled && token && !current), refreshAccess: () => {setResult(null); setRefresh(value => value + 1);}};
}

const AdminAccessContext = createContext<ReturnType<typeof useSessionState> | null>(null);
export function AdminAccessProvider({children}: {children: ReactNode}) {
  const value = useSessionState();
  return createElement(AdminAccessContext.Provider, {value}, children);
}
export function useAdminAccess() {
  const shared = useContext(AdminAccessContext);
  const local = useSessionState(shared === null);
  return shared ?? local;
}
