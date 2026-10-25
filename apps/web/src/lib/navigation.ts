import { Compass, LayoutGrid, MessageSquare, PenLine, User, type LucideIcon } from 'lucide-react';

export interface PrimaryNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** 前台主导航：桌面侧栏与移动端底栏共用的唯一数据源。 */
export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { href: '/discover', label: '发现', icon: Compass },
  { href: '/chat', label: '聊天', icon: MessageSquare },
  { href: '/creator', label: '创作', icon: PenLine },
  { href: '/square', label: '广场', icon: LayoutGrid },
  { href: '/profile', label: '我的', icon: User },
];

/** 当前路径是否命中导航项（精确匹配或子路径，避免 /chat 误匹配 /chats）。 */
export function isPrimaryNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/** Safe direct-entry destinations; an owned in-app predecessor takes priority. */
export function backFallback(href: string): string {
  const url = new URL(href, 'https://app.invalid');
  const path = url.pathname;
  if (path === '/chat' || path === '/chat-history' || path.startsWith('/share/chat/')) return '/chat';
  if (path === '/creator') return '/creator';
  if (path === '/my-characters') return url.searchParams.get('scope') === 'bookmarked' ? '/profile' : '/creator';
  if (path === '/shop/ledger') return '/shop';
  if (['/membership','/shop','/ai-usage','/my-reports'].includes(path)) return '/profile';
  if (path === '/circles') return '/square';
  if (path.startsWith('/circles/')) return '/circles';
  if (path === '/community-appeal') return '/my-reports';
  const connections = path.match(/^(\/profile\/[^/]+)\/connections$/);
  if (connections) return connections[1];
  const dispute = path.match(/^(\/[^/]+\/disputes)(?:\/.*)?$/);
  if (dispute) return path === dispute[1] ? '/square' : dispute[1];
  const mirror = path.match(/^(\/[^/]+\/mirror)(?:\/.*)?$/);
  if (mirror) return path === mirror[1] ? '/discover' : mirror[1];
  return '/discover';
}

export function isPrimaryScreen(href: string): boolean {
  const url = new URL(href, 'https://app.invalid');
  if (!PRIMARY_NAV.some(item => item.href === url.pathname)) return false;
  if (url.pathname === '/creator' && (url.searchParams.get('edit') || url.searchParams.get('new') === '1')) return false;
  return url.pathname !== '/chat' || !['character','conversation','storyRun'].some(key => url.searchParams.get(key));
}
