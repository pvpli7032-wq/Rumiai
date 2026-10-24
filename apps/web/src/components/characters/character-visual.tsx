import Image from 'next/image';

export type CharacterVisualInput = Readonly<{ id: string; avatarUrl?: string | null; imageUrl?: string | null }>;

/**
 * Display the backend gallery image when supplied, otherwise its stored avatar.
 * Default avatars are backend content too; never replace them with invented portraits.
 */
export function resolveCharacterVisual({ avatarUrl, imageUrl }: CharacterVisualInput): string | null {
  if (imageUrl) return imageUrl;
  return avatarUrl ?? null;
}

export function CharacterVisual({ id, avatarUrl, imageUrl, alt, sizes, className }: CharacterVisualInput & { alt: string; sizes: string; className: string }) {
  const source = resolveCharacterVisual({ id, avatarUrl, imageUrl });
  if (!source) return null;
  if (source.startsWith('/illustrations/')) return <Image src={source} alt={alt} fill sizes={sizes} className={className} />;
  return <img src={source} alt={alt} className={className} />;
}
