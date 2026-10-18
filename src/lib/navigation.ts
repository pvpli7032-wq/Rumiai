import { Compass, MessageSquare, PenLine, User, Users, type LucideIcon } from 'lucide-react';

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
  { href: '/circles', label: '圈子', icon: Users },
  { href: '/profile', label: '我的', icon: User },
];

/** 当前路径是否命中导航项（精确匹配或子路径，避免 /chat 误匹配 /chats）。 */
export function isPrimaryNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}
