'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@web/lib/auth-context';

/**
 * Sends a visitor who already has a session from the splash into the app, once the
 * provider has finished restoring the token — checking before that would bounce
 * signed-in users, which is exactly the bug the chat page had.
 */
export function SignedInRedirect({ to = '/discover' }: { to?: string }) {
  const { token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !token) return;
    router.replace(to);
  }, [isLoading, token, router, to]);

  return null;
}
