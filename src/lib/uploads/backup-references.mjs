/** Read only attachment locations from a frozen database snapshot, never account or chat content. */
export async function readPersistedUploadUrls(client) {
  const groups = await Promise.all([
    client.user.findMany({ select: { avatarUrl: true } }),
    client.character.findMany({ select: { avatarUrl: true } }),
    client.characterImage.findMany({ select: { url: true } }),
    client.characterEmoji.findMany({ select: { url: true } }),
    client.supportCharacter.findMany({ select: { avatarUrl: true } }),
    client.message.findMany({ select: { imageUrl: true } }),
    client.postMedia.findMany({ select: { url: true } }),
    client.postComment.findMany({ select: { imageUrl: true } }),
    client.uploadAsset.findMany({ select: { url: true } }),
    client.banner.findMany({ select: { imageUrl: true } }),
    client.universe.findMany({ select: { imageUrl: true } }),
  ]);
  return [...new Set(groups.flat().flatMap(row => Object.values(row)).filter(url => typeof url === 'string' && url.startsWith('/uploads/')))];
}
