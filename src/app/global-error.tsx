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
    <html lang="th">
      <body className="flex min-h-[100svh] flex-col items-center justify-center gap-5 bg-zinc-950 px-6 text-center">
        <h1 className="text-xl font-semibold text-white">เกิดข้อผิดพลาดบางอย่าง</h1>
        <p className="max-w-sm text-zinc-400">ลองโหลดหน้านี้ใหม่อีกครั้ง</p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2.5 font-semibold text-white"
        >
          ลองอีกครั้ง
        </button>
      </body>
    </html>
  );
}
