import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFixture} from '../helpers/sqlite-fixture.mjs';

test('chat media validates ownership, persists metadata, and replays one request once', async t => {
  const fixture = await createFixture();
  process.env.UPLOADS_DIRECTORY = `${fixture.dir}/uploads`;
  t.after(() => { delete process.env.UPLOADS_DIRECTORY; return fixture.cleanup(); });
  const {readConversationMessages} = await import('@rumiai/backend/modules/conversations/message-service');
  const {createUserMediaMessage} = await import('@rumiai/backend/modules/conversations/attachments/attachment-service');
  const {saveAccountUpload} = await import('@rumiai/backend/modules/uploads/storage-service');
  const character = await fixture.db.character.create({data: {name: '媒体测试角色', personality: 'test', background: 'test', creatorId: fixture.user.id}});
  const conversation = await fixture.db.conversation.create({data: {userId: fixture.user.id, characterId: character.id}});
  await assert.rejects(() => saveAccountUpload(fixture.user.id, new File([new Uint8Array([1,2,3,4])], 'spoofed.png', {type: 'image/png'})), /内容与格式不符/);
  const uploaded = await saveAccountUpload(fixture.user.id, new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])], 'owned.png', {type: 'image/png'}));
  const owned = await fixture.db.uploadAsset.findUniqueOrThrow({where: {id: uploaded.id}});
  const foreign = await fixture.db.uploadAsset.create({data: {ownerId: fixture.admin.id, url: '/uploads/media-foreign.png', mimeType: 'image/png', byteSize: 64}});

  await assert.rejects(() => createUserMediaMessage(fixture.user.id, conversation.id, {requestId: randomUUID(), attachment: {type: 'IMAGE', assetId: foreign.id, mimeType: 'image/png', byteSize: 64}}), /不属于/);
  await assert.rejects(() => createUserMediaMessage(fixture.user.id, conversation.id, {requestId: randomUUID(), attachment: {type: 'IMAGE', assetId: owned.id, mimeType: 'image/jpeg', byteSize: uploaded.size}}), /元数据不匹配/);
  await assert.rejects(() => createUserMediaMessage(fixture.user.id, conversation.id, {requestId: randomUUID(), attachment: {type: 'STICKER', stickerId: 'not-in-catalog'}}), /不存在|下架/);

  const requestId = randomUUID();
  const [first, replay] = await Promise.all([
    createUserMediaMessage(fixture.user.id, conversation.id, {requestId, content: '图片说明', attachment: {type: 'IMAGE', assetId: owned.id, mimeType: 'image/png', byteSize: uploaded.size}}),
    createUserMediaMessage(fixture.user.id, conversation.id, {requestId, content: '图片说明', attachment: {type: 'IMAGE', assetId: owned.id, mimeType: 'image/png', byteSize: uploaded.size}}),
  ]);
  assert.equal(first.id, replay.id);
  assert.equal(await fixture.db.message.count({where: {conversationId: conversation.id, mediaRequestId: requestId}}), 1);
  assert.equal(await fixture.db.messageAttachment.count({where: {messageId: first.id}}), 1);
  const imageAttachment = first.attachments[0] as {id:string;type:string;url:string;mimeType:string;byteSize:number};
  assert.deepEqual(imageAttachment, {id: imageAttachment.id, type: 'IMAGE', url: owned.url, mimeType: 'image/png', byteSize: uploaded.size});
  await assert.rejects(() => createUserMediaMessage(fixture.user.id, conversation.id, {requestId, content: '换一段说明', attachment: {type: 'IMAGE', assetId: owned.id, mimeType: 'image/png', byteSize: uploaded.size}}), /已用于其他内容/);

  const sticker = await createUserMediaMessage(fixture.user.id, conversation.id, {requestId: randomUUID(), attachment: {type: 'STICKER', stickerId: 'wave'}});
  assert.equal((sticker.attachments[0] as {type:string})?.type, 'STICKER');
  const history = await readConversationMessages(fixture.user.id, conversation.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].attachments.length, 1);
  const {readConversationExport} = await import('@rumiai/backend/modules/conversations/conversation-service');
  const exported = await readConversationExport(fixture.user.id, conversation.id);
  assert.deepEqual(exported.messages.map(message => message.attachments), history.map(message => message.attachments), 'export preserves image and sticker attachments');
  await assert.rejects(() => readConversationExport(fixture.admin.id, conversation.id), /只能导出自己的对话/);
});
