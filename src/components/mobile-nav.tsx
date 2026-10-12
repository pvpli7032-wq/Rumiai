'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, MessageSquare, Users, User } from 'lucide-react';
const items = [{href:'/discover',icon:Compass,label:'发现'},{href:'/chat',icon:MessageSquare,label:'聊天'},{href:'/circles',icon:Users,label:'圈子'},{href:'/profile',icon:User,label:'我的'}];
export function MobileNav(){const pathname=usePathname();return <nav aria-label="主导航" className="mobile-primary-nav fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur desktop:hidden"><div className="mx-auto flex max-w-lg">{items.map(({href,icon:Icon,label})=><Link key={href} href={href} scroll={false} aria-current={pathname.startsWith(href)?'page':undefined} className={'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-xs '+(pathname.startsWith(href)?'text-orange-500':'text-muted-foreground')}><Icon size={21}/><span>{label}</span></Link>)}</div></nav>}
