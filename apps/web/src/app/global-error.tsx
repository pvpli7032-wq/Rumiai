'use client';

/**
 * Last-resort boundary for errors thrown in the root layout itself. It has to render
 * its own <html> and <body>, because at this point the layout that would normally
 * provide them is the thing that failed.
 *
 * Like not-found.tsx, having this keeps Next from synthesising the Pages Router /500.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body className="flex min-h-[100svh] flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
        <h1 className="text-xl font-semibold text-foreground">页面出了点问题</h1>
        <p className="max-w-sm text-muted-foreground">请重新加载这个页面</p>
        <button
          type="button"
          onClick={() => reset()}
          className="web-control rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          重试
        </button>
      </body>
    </html>
  );
}
