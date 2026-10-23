'use client';
import {createContext, createElement, Fragment, useContext, useEffect, useState, type ReactNode} from 'react';
import type {AdminPermission} from '@rumiai/contracts/admin/permissions';

export type AdminSession = {user?: {id: string; username: string; email: string}; permissions: AdminPermission[]; roles: string[]; enabled: boolean; managed: boolean; owner: boolean};
function useSessionState(enabled = true) {
  const [result, setResult] = useState<{session?: AdminSession; error?: string} | null>(null);
  const [loading, setIsLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const check = () => setRefresh(value => value + 1);
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) {setResult(null); setIsLoading(false); return;}
    const controller = new AbortController();
    setIsLoading(true);
    void (async () => {
      try {
        const response = await fetch('/api/admin/auth/session', {credentials: 'include', cache: 'no-store', signal: controller.signal});
        const data = await response.json();
        if (response.status === 401) { if (!controller.signal.aborted) setResult(null); return; }
        if (!response.ok) throw Error(data.error || '无法读取管理权限，请刷新页面重试。');
        if (!Array.isArray(data.permissions) || !Array.isArray(data.roles) || typeof data.enabled !== 'boolean') throw Error('管理权限响应异常，请稍后重试。');
        if (!controller.signal.aborted) setResult({session: data});
      } catch {
        if (!controller.signal.aborted) setResult({error: '无法读取管理权限，请刷新页面重试。'});
      } finally { if (!controller.signal.aborted) setIsLoading(false); }
    })();
    return () => controller.abort();
  }, [enabled, refresh]);
  const current = result;
  const permissions = current?.session?.permissions ?? [];
  const access = current?.session ? {moderation: permissions.includes('moderation.read'), finance: permissions.includes('finance.read'), analytics:permissions.includes('analytics.read'), growth:permissions.includes('growth.read'),operations:permissions.includes('operations.read'),compliance:permissions.includes('compliance.read'), characters: permissions.includes('characters.read'), community: permissions.includes('community.read'), siteContent: permissions.includes('site.content.read'), aiProviders: permissions.includes('ai.providers.read'), aiModels: permissions.includes('ai.models.read'), aiCosts:permissions.includes('ai.costs.read'),paymentMerchants:permissions.includes('payments.merchants.read'),accounts: permissions.includes('accounts.read'), staff: permissions.includes('admin.staff.read'), audit: permissions.includes('admin.audit.read')} : undefined;
  return {sessionActive: Boolean(current?.session), access, permissions, session: current?.session, error: current?.error, loading, refreshAccess: () => {setResult(null); setRefresh(value => value + 1);}};
}

const AdminAccessContext = createContext<ReturnType<typeof useSessionState> | null>(null);
export function AdminAccessProvider({children}: {children: ReactNode}) {
  const value = useSessionState();
  return createElement(AdminAccessContext.Provider, {value}, createElement(Fragment, {key: value.session?.user?.id ?? 'signed-out'}, children));
}
export function useAdminAccess() {
  const shared = useContext(AdminAccessContext);
  const local = useSessionState(shared === null);
  return shared ?? local;
}
