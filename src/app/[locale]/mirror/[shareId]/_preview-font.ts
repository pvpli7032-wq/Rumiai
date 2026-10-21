import {readFile} from 'node:fs/promises';

/**
 * 预览图用的中文字体。
 *
 * satori（next/og 的渲染器）只自带一份拉丁字体，中文会渲染成空白，所以必须显式
 * 提供一份含中日韩字形的字体文件。仓库里没有字体资产，也不为此新增二进制依赖，
 * 因此按平台读系统字体，第一个可用的就用；都不可用时退回内置字体（图片仍能出，
 * 只是中文会缺字形）。读到的内容在进程内缓存，不每次请求都读盘。
 *
 * 只认静态字体：satori 解析可变字体（带 fvar 表）会在 addFonts 里直接抛错，
 * 整张图出不来，所以这里先解析字体表目录把可变字体筛掉，宁可换下一个候选。
 * .ttc 字体集合同样跳过——satori 对字体集合支持不稳。
 */
const FONT_CANDIDATES = [
  // 部署机字体路径与上面都不同时，用 MIRROR_PREVIEW_FONT_PATH 指定一份静态中文 TTF/OTF。
  process.env.MIRROR_PREVIEW_FONT_PATH ?? '',
  // Windows
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\Deng.ttf',
  // macOS
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  // Linux：Noto Sans CJK 的 OTF 单字重文件（Rocky/Debian 上由 google-noto-sans-cjk-*-fonts 提供）。
  // 注意别用同包的 .ttc 集合，satori 对字体集合支持不稳；也不要装可变字体版本。
  '/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJKjp-Regular.otf',
  '/usr/share/fonts/truetype/arphic/uming.ttf',
];

/** 字体表目录里是否含某个表（如 fvar 表示可变字体）。解析失败按「含」处理，跳过该文件。 */
function hasTable(buffer: Buffer, tag: string): boolean {
  if (buffer.length < 12) return true;
  const numTables = buffer.readUInt16BE(4);
  if (numTables === 0 || numTables > 512) return true;
  for (let index = 0; index < numTables; index += 1) {
    const offset = 12 + index * 16;
    if (offset + 4 > buffer.length) return true;
    if (buffer.toString('latin1', offset, offset + 4) === tag) return true;
  }
  return false;
}

let cached: ArrayBuffer | null | undefined;

export async function readPreviewFont(): Promise<ArrayBuffer | null> {
  if (cached !== undefined) return cached;
  for (const path of FONT_CANDIDATES) {
    if (!path) continue;
    try {
      const buffer = await readFile(path);
      if (hasTable(buffer, 'fvar')) continue;
      cached = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      return cached;
    } catch {
      // 这台机器没有这个字体，换下一个候选。
    }
  }
  cached = null;
  return null;
}
