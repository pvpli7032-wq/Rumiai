'use client';
import {ThemeProvider} from 'next-themes';
export function AdminProviders({children}: {children: React.ReactNode}) { return <ThemeProvider attribute="class" storageKey="rumiai-admin-theme" defaultTheme="light" enableSystem>{children}</ThemeProvider>; }
