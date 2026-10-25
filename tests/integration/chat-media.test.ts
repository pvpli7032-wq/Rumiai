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
  const {saveSticker,readStickers}=await import('@rumiai/backend/modules/conversations/stickers/service');
  await assert.rejects(()=>saveSticker(fixture.user.id,{id:'custom',label:'发芽',glyph:'🌱',isActive:true,sortOrder:2,version:0}),/权限/);
  const custom=await saveSticker(fixture.admin.id,{id:'custom',label:'发芽',glyph:'🌱',isActive:true,sortOrder:2,version:0});
  assert.ok((await readStickers()).some(item=>item.id==='custom'));
  const stickerRequest={requestId:randomUUID(),attachment:{type:'STICKER',stickerId:'custom'}};
  const sent=await createUserMediaMessage(fixture.user.id,conversation.id,stickerRequest);
  await saveSticker(fixture.admin.id,{id:'custom',version:'version' in custom?custom.version:1},true);
  const replaySticker=await createUserMediaMessage(fixture.user.id,conversation.id,stickerRequest);
  assert.equal(replaySticker.id,sent.id);assert.equal((replaySticker.attachments[0] as {glyph:string}).glyph,'🌱');
  await assert.rejects(()=>createUserMediaMessage(fixture.user.id,conversation.id,{...stickerRequest,requestId:randomUUID()}),/不存在|下架/);
  const wav=Buffer.alloc(44+3200);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(3200,40);
  const audio=await saveAccountUpload(fixture.user.id,new File([wav],'voice.wav',{type:'audio/wav'}));assert.equal(audio.durationMs,100);
  const audioMessage=await createUserMediaMessage(fixture.user.id,conversation.id,{requestId:randomUUID(),content:'录音备注',attachment:{type:'AUDIO',assetId:audio.id,mimeType:audio.mimeType,byteSize:audio.size}});
  assert.equal((audioMessage.attachments[0] as {durationMs:number}).durationMs,100);
  const {readVisibleUpload}=await import('@rumiai/backend/modules/uploads/read-service');
  assert.equal((await readVisibleUpload(audio.url.split('/').pop()!,fixture.user.id)).contentType,'audio/wav');
  await assert.rejects(()=>readVisibleUpload(audio.url.split('/').pop()!,fixture.admin.id),/不存在/);
  await assert.rejects(()=>saveAccountUpload(fixture.user.id,new File([wav.subarray(0,40)],'bad.wav',{type:'audio/wav'})),/WAV/);
  assert.equal(await fixture.db.generationCharge.count(),0);

  assert.equal(history[0].attachments.length, 1);
  const {readConversationExport} = await import('@rumiai/backend/modules/conversations/conversation-service');
  const exported = await readConversationExport(fixture.user.id, conversation.id);
  assert.deepEqual(exported.messages.map(message => message.attachments), (await readConversationMessages(fixture.user.id,conversation.id)).map(message => message.attachments), 'export preserves image and sticker attachments');
  await assert.rejects(() => readConversationExport(fixture.admin.id, conversation.id), /只能导出自己的对话/);
});
