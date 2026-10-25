import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('chat funnel deduplicates visits, trusts server receipts and separates mature D1 cohorts', async t => {
  const fixture = await createFixture();
  t.after(() => fixture.cleanup());
  const extra = await fixture.db.user.create({data: {username: 'funnel-extra', email: 'funnel-extra@example.test', passwordHash: fixture.user.passwordHash}});
  const character = await fixture.db.character.create({data: {name: 'funnel-character', personality: 'fixture', background: '', creatorId: fixture.user.id}});
  const users = [fixture.user, fixture.admin, extra];
  const conversations = await Promise.all(users.map(user => fixture.db.conversation.create({data: {userId: user.id, characterId: character.id}})));
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = (offset: number, hour = 0) => new Date(utc + offset * 86400000 + hour * 3600000);
  await fixture.db.productEvent.createMany({data: [
    {name: 'chat_opened', userId: fixture.user.id, subjectKey: conversations[0].id, createdAt: day(-3, 1)},
    {name: 'chat_opened', userId: fixture.user.id, subjectKey: conversations[0].id, createdAt: day(-3, 2)},
    {name: 'chat_opened', userId: fixture.admin.id, subjectKey: conversations[1].id, createdAt: new Date(now.getTime() - 10000)},
    {name: 'chat_opened', userId: extra.id, subjectKey: conversations[2].id, createdAt: day(-2, 1)},
  ]});
  async function receipt(index: number, requestId: string, at: Date, operation = 'CHAT_SEND', status = 'SETTLED', hasReply = true) {
    const message = hasReply ? await fixture.db.message.create({data: {conversationId: conversations[index].id, role: 'ASSISTANT', content: 'fixture reply', createdAt: at}}) : null;
    await fixture.db.generationCharge.create({data: {
      userId: users[index].id, conversationId: conversations[index].id, requestId, operation, status,
      messageId: message?.id ?? null, heldAt: at, settledAt: status === 'SETTLED' ? at : null,
      coins: 0, allowanceSource: 'FREE_MODE', priceSnapshotJson: '{}',
    }});
  }
  await receipt(0, 'funnel-round-1', day(-3, 3));
  await receipt(0, 'funnel-round-2', day(-3, 4));
  await receipt(0, 'funnel-round-3', day(-3, 5));
  await receipt(1, 'funnel-new-sample', new Date(now.getTime() - 5000));
  await receipt(2, 'funnel-regenerate', day(-2, 2), 'CHAT_REGENERATE');
  await receipt(2, 'funnel-cancelled', day(-2, 3), 'CHAT_SEND', 'SETTLED', false);
  await receipt(2, 'funnel-failed', day(-2, 4), 'CHAT_SEND', 'RELEASED');
  await receipt(2, 'funnel-cancelled-settled-message', day(-2, 5));
  await fixture.db.generationCharge.update({where: {userId_operation_requestId: {userId: extra.id, operation: 'CHAT_SEND', requestId: 'funnel-cancelled-settled-message'}}, data: {cancelReason: 'USER_CANCELLED'}});
  await receipt(1, 'funnel-new-cancelled-one', new Date(now.getTime() - 4000));
  await receipt(1, 'funnel-new-cancelled-two', new Date(now.getTime() - 3000));
  await fixture.db.generationCharge.updateMany({where: {userId: fixture.admin.id, requestId: {in: ['funnel-new-cancelled-one', 'funnel-new-cancelled-two']}}, data: {cancelReason: 'USER_CANCELLED'}});
  await fixture.db.userActivityDay.create({data: {userId: fixture.user.id, activityDate: day(-2)}});
  const {parseProductEventInput, recordClientProductEvent} = await import('@rumiai/backend/modules/analytics/product-events-service');
  assert.throws(() => parseProductEventInput({event: 'mirror_completed'}), /只能由服务端/);
  assert.throws(() => parseProductEventInput({event: 'invite_registered'}), /只能由服务端/);
  await assert.rejects(() => recordClientProductEvent(parseProductEventInput({event: 'chat_opened', subjectKey: conversations[0].id}), {userId: extra.id, anonymousSubject: null}), /不可访问/);
  await recordClientProductEvent(parseProductEventInput({event: 'chat_opened', subjectKey: conversations[0].id}), {userId: fixture.user.id, anonymousSubject: null});
  const {readProductFunnelReport} = await import('@rumiai/backend/modules/analytics/product-funnel-report-service');
  const report = await readProductFunnelReport(fixture.admin.id, 7);
  assert.equal(report.chatOnboarding.opened, 3, 'repeat opens count once per user');
  assert.equal(report.chatOnboarding.firstReply, 2, 'regeneration, failed and cancelled rounds do not fabricate first replies');
  assert.equal(report.chatOnboarding.thirdReply, 1);
  assert.equal(report.chatOnboarding.firstReplyRate, 2 / 3);
  assert.equal(report.chatOnboarding.nextDayMatured, 1, 'today first replies are immature');
  assert.equal(report.chatOnboarding.nextDayReturned, 1);
  assert.equal(report.chatOnboarding.nextDayRate, 1);
  assert.ok(report.chatOnboarding.trackingSince);
});
