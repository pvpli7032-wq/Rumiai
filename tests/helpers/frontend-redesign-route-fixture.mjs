/** Synthetic, disposable dynamic-route data for the frontend redesign fixture. */
export async function seedFrontendRouteData(fixture) {
  const {db, user, admin} = fixture;
  const connection = await db.user.create({data: {username: 'e2e-connection', email: 'e2e-connection@example.test', passwordHash: 'fixture-only', displayName: 'E2E 关系用户'}});
  await db.follow.create({data: {followerId: connection.id, followingId: user.id}});
  const notification = await db.notification.create({data: {userId: user.id, type: 'E2E', title: 'E2E 未读通知', body: '仅隔离通知验收', targetType: 'PROFILE', targetId: user.id}});
  const character = await db.character.create({data: {name: 'E2E 路由角色', tagline: '仅隔离路由验收', personality: '友好', background: 'synthetic fixture only', greeting: '你好，E2E。', creatorId: user.id, isPublic: true, reviewStatus: 'APPROVED'}});
  const ownedCharacter = await db.character.create({data: {name: 'E2E 可编辑草稿', personality: '草稿', background: 'synthetic', creatorId: user.id, avatarUrl: '/brand/icon-192.png', isPublic: false, reviewStatus: 'DRAFT'}});
  const plan = await db.membershipPlan.create({data: {code: 'E2E_ROUTE', name: 'E2E 会员', durationDays: 30, priceCents: 100, benefitsJson: '[]', isActive: true}});
  const paid = await db.membershipOrder.create({data: {orderNo: 'E2E-PAID-1', userId: user.id, idempotencyKey: 'e2e-paid', planId: plan.id, amountCents: 100, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: '[]', status: 'PAID', paidAt: new Date()}});
  const pending = await db.membershipOrder.create({data: {orderNo: 'E2E-PENDING-1', userId: user.id, idempotencyKey: 'e2e-pending', planId: plan.id, amountCents: 100, durationDays: 30, refundWindowHours: 24, usageChargePeriodHours: 24, benefitsJson: '[]', status: 'PENDING'}});
  await db.characterBookmark.create({data: {userId: user.id, characterId: character.id}});
  const giftCatalog = await db.giftCatalogItem.create({data: {code: 'E2E_GIFT', name: 'E2E 礼物', description: 'synthetic gift only', emoji: '🎁', coinPrice: 1, isActive: true}});
  const sceneCharacter = await db.character.create({data: {id: 'xingban-original-4', name: 'E2E 场景角色', tagline: 'static scene fixture', personality: '沉稳', background: 'synthetic static scene fixture', creatorId: user.id, isPublic: true, reviewStatus: 'APPROVED'}});
  const conversation = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: 'E2E 已登录对话'}});
  await db.message.createMany({data: [{conversationId: conversation.id, role: 'USER', content: 'E2E 合成用户消息'}, {conversationId: conversation.id, role: 'ASSISTANT', content: 'E2E 合成角色回复'}]});
  const circle = await db.circle.create({data: {name: 'E2E 路由圈子', description: '仅隔离路由验收。', ownerId: user.id, status: 'ACTIVE', isFeatured: true}});
  await db.circleMember.create({data: {circleId: circle.id, userId: user.id}});
  const post = await db.post.create({data: {circleId: circle.id, authorId: admin.id, characterId: character.id, content: 'E2E 合成广场帖子。', status: 'VISIBLE', isPinned: true}});
  const dispute = await db.disputeCase.create({data: {postId: post.id, authorId: admin.id, characterId: character.id, excerptJson: JSON.stringify([{role: 'USER', content: 'E2E 争议片段'}]), claim: 'E2E 合成评理主张', ruleSnapshotJson: JSON.stringify({version: 1}), deadlineAt: new Date(Date.now() + 86400000)}});
  const ownedPost = await db.post.create({data: {circleId: circle.id, authorId: user.id, characterId: character.id, content: 'E2E 本人撤回争议帖子。', status: 'VISIBLE'}});
  const ownedDispute = await db.disputeCase.create({data: {postId: ownedPost.id, authorId: user.id, characterId: character.id, excerptJson: JSON.stringify([{role: 'USER', content: 'E2E 本人争议片段'}]), claim: 'E2E 本人撤回主张', ruleSnapshotJson: JSON.stringify({version: 1}), deadlineAt: new Date(Date.now() + 86400000)}});
  const story = await db.storyTemplate.create({data: {slug: 'e2e-route-story', title: 'E2E 路由故事', status: 'PUBLISHED', ownerId: user.id}});
  const version = await db.storyTemplateVersion.create({data: {templateId: story.id, version: 1, locale: 'zh', publishedAt: new Date(), definitionJson: JSON.stringify({schemaVersion: 1, publicSummary: '仅隔离路由验收的故事。', chapters: [{key: 'e2e-chapter', title: 'E2E 第一章'}]}), characterSnapshotJson: JSON.stringify({schemaVersion: 1, characterId: character.id})}});
  const storyConversation = await db.conversation.create({data: {userId: user.id, characterId: character.id, title: 'E2E 故事会话'}});
  const run = await db.storyRun.create({data: {userId: user.id, conversationId: storyConversation.id, templateVersionId: version.id, chapterKey: 'e2e-chapter', stateJson: JSON.stringify({schemaVersion: 1, chapterKey: 'e2e-chapter'}), createRequestId: 'e2e-route-run-request', startedAt: new Date()}});
  const mirror = await db.mirrorResult.create({data: {shareId: 'e2e-route-mirror', userId: user.id, characterId: character.id, answersJson: '[]', title: 'E2E 他眼中的你', observationsJson: JSON.stringify(['E2E 观察一', 'E2E 观察二', 'E2E 观察三']), quote: '仅隔离验收', indicesJson: JSON.stringify({atmosphere: 80, rapport: 75}), status: 'READY'}});
  const page = await db.sitePage.create({data: {slug: 'e2e-route-page', title: 'E2E CMS 页面', summary: '仅隔离路由验收', blocksJson: '[]', isActive: true}});
  return {locale: 'zh', characterId: character.id, bookmarkedCharacterId: character.id, sceneCharacterId: sceneCharacter.id, giftCatalogId: giftCatalog.id, conversationId: conversation.id, shareChatId: conversation.id, storySlug: story.slug, storyRunId: run.id, circleId: circle.id, postId: post.id, disputeId: dispute.id, voteDisputeId: dispute.id, ownedDisputeId: ownedDispute.id, mirrorShareId: mirror.shareId, cmsPageSlug: page.slug, creatorUsername: user.username, connectionName: connection.displayName, notificationId: notification.id, notificationTitle: notification.title, ownedCharacterId: ownedCharacter.id, membershipPaidOrderNo: paid.orderNo, membershipPendingOrderNo: pending.orderNo, sitemapFile: null};
}
