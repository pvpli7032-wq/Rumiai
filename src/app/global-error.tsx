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
      <body className="flex min-h-[100svh] flex-col items-center justify-center gap-5 bg-zinc-950 px-6 text-center">
        <h1 className="text-xl font-semibold text-white">页面出了点问题</h1>
        <p className="max-w-sm text-zinc-400">请重新加载这个页面</p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-linear-to-r/srgb from-purple-600 to-pink-600 px-6 py-2.5 font-semibold text-white"
        >
          重试
        </button>
      </body>
    </html>
  );
}
