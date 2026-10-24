import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db, pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {mayAttachSiteOwnedUpload, readSiteOwnedUpload} from '@rumiai/backend/modules/uploads/read-service';
import {SiteContentError} from '@rumiai/backend/modules/site-content/errors';
import {parseSiteContentType, readSiteContentCommand, SITE_CONTENT_TYPES, validateSiteContent, type SiteContentType} from '@rumiai/backend/modules/site-content/content';

type Tx = Prisma.TransactionClient;
const CONTENT_LIMIT:Record<SiteContentType,number>={BANNER:200,TAG:300,BADGE:200,SECTION:100,NAVIGATION:100,PAGE:200,BRANDING:1};
const projections = {
  BANNER: (row: any) => ({id: row.id, placement: row.placement, title: row.title, description: row.description, href: row.href, gradientFrom: row.gradientFrom, gradientTo: row.gradientTo, imageUrl: row.imageUrl, sortOrder: row.sortOrder, isActive: row.isActive}),
  TAG: (row: any) => ({id: row.id, key: row.key, label: row.label, group: row.group, filterRow: row.filterRow, sortOrder: row.sortOrder, isActive: row.isActive}),
  BADGE: (row: any) => ({id: row.id, emoji: row.emoji, label: row.label, sortOrder: row.sortOrder, isActive: row.isActive}),
  SECTION: (row: any) => ({id: row.id, key: row.key, emoji: row.emoji, title: row.title, source: row.source, tagKey: row.tagKey, sortOrder: row.sortOrder, isActive: row.isActive}),
  NAVIGATION: (row: any) => ({id: row.id, placement: row.placement, label: row.label, href: row.href, sortOrder: row.sortOrder, isActive: row.isActive}),
  PAGE: (row: any) => ({id: row.id, slug: row.slug, kind: row.kind, title: row.title, summary: row.summary, blocks: row.blocks ? row.blocks : JSON.parse(row.blocksJson), sortOrder: row.sortOrder, isActive: row.isActive, startsAt: row.startsAt, endsAt: row.endsAt}),
  BRANDING: (row: any) => ({id: row.id, brandName: row.brandName, logoUrl: row.logoUrl, accentFrom: row.accentFrom, accentTo: row.accentTo, footerNote: row.footerNote, isActive: row.isActive}),
} as const;
function contentValues(type: SiteContentType, row: any): Record<string, unknown> {
  const {id: _id, ...content} = projections[type](row);
  return content;
}
async function requireContentAccess(actor: string, permission: 'site.content.read'|'site.content.manage'|'site.content.publish', tx: Tx) {
  if (!await hasAdminPermission(actor, permission, tx) || permission !== 'site.content.read' && !await hasAdminPermission(actor, 'site.content.read', tx)) throw new SiteContentError('当前账号没有站点内容管理权限。', 403);
}
async function liveRow(tx: Tx, type: SiteContentType, id: string) {
  switch (type) {
    case 'BANNER': return tx.banner.findUnique({where: {id}});
    case 'TAG': return tx.tag.findUnique({where: {id}});
    case 'BADGE': return tx.badge.findUnique({where: {id}});
    case 'SECTION': return tx.homeSection.findUnique({where: {id}});
    case 'NAVIGATION': return tx.siteNavigationItem.findUnique({where: {id}});
    case 'PAGE': return tx.sitePage.findUnique({where: {id}});
    case 'BRANDING': return tx.siteBranding.findUnique({where: {id}});
  }
}
async function listLive(tx: Tx, type: SiteContentType) {
  switch (type) {
    case 'BANNER': return tx.banner.findMany({orderBy: [{placement: 'asc'}, {sortOrder: 'asc'}, {id: 'asc'}], take: 200});
    case 'TAG': return tx.tag.findMany({orderBy: [{sortOrder: 'asc'}, {id: 'asc'}], take: 300});
    case 'BADGE': return tx.badge.findMany({orderBy: [{sortOrder: 'asc'}, {id: 'asc'}], take: 200});
    case 'SECTION': return tx.homeSection.findMany({orderBy: [{sortOrder: 'asc'}, {id: 'asc'}], take: 100});
    case 'NAVIGATION': return tx.siteNavigationItem.findMany({orderBy: [{placement: 'asc'}, {sortOrder: 'asc'}, {id: 'asc'}], take: 100});
    case 'PAGE': return tx.sitePage.findMany({orderBy: [{kind: 'asc'}, {sortOrder: 'asc'}, {id: 'asc'}], take: 200});
    case 'BRANDING': {const row = await tx.siteBranding.findUnique({where: {id: 'primary'}}); return row ? [row] : [];}
  }
}
async function saveLive(tx: Tx, type: SiteContentType, id: string, content: Record<string, unknown>) {
  switch (type) {
    case 'BANNER': return tx.banner.upsert({where: {id}, create: {...content, id} as unknown as Prisma.BannerUncheckedCreateInput, update: content as unknown as Prisma.BannerUncheckedUpdateInput});
    case 'TAG': return tx.tag.upsert({where: {id}, create: {...content, id} as unknown as Prisma.TagUncheckedCreateInput, update: content as unknown as Prisma.TagUncheckedUpdateInput});
    case 'BADGE': return tx.badge.upsert({where: {id}, create: {...content, id} as unknown as Prisma.BadgeUncheckedCreateInput, update: content as unknown as Prisma.BadgeUncheckedUpdateInput});
    case 'SECTION': return tx.homeSection.upsert({where: {id}, create: {...content, id} as unknown as Prisma.HomeSectionUncheckedCreateInput, update: content as unknown as Prisma.HomeSectionUncheckedUpdateInput});
    case 'NAVIGATION': return tx.siteNavigationItem.upsert({where: {id}, create: {...content, id} as unknown as Prisma.SiteNavigationItemUncheckedCreateInput, update: content as unknown as Prisma.SiteNavigationItemUncheckedUpdateInput});
    case 'PAGE': {const {blocks, ...fields} = content; const data = {...fields, blocksJson: JSON.stringify(blocks)}; return tx.sitePage.upsert({where: {id}, create: {...data, id} as unknown as Prisma.SitePageUncheckedCreateInput, update: data as unknown as Prisma.SitePageUncheckedUpdateInput});}
    case 'BRANDING': return tx.siteBranding.upsert({where: {id: 'primary'}, create: {...content, id: 'primary'} as unknown as Prisma.SiteBrandingUncheckedCreateInput, update: content as unknown as Prisma.SiteBrandingUncheckedUpdateInput});
  }
}
async function deactivateLive(tx: Tx, type: SiteContentType, id: string) {
  switch (type) {
    case 'BANNER': return tx.banner.update({where: {id}, data: {isActive: false}});
    case 'TAG': return tx.tag.update({where: {id}, data: {isActive: false}});
    case 'BADGE': return tx.badge.update({where: {id}, data: {isActive: false}});
    case 'SECTION': return tx.homeSection.update({where: {id}, data: {isActive: false}});
    case 'NAVIGATION': return tx.siteNavigationItem.update({where: {id}, data: {isActive: false}});
    case 'PAGE': return tx.sitePage.update({where: {id}, data: {isActive: false}});
    case 'BRANDING': return tx.siteBranding.update({where: {id: 'primary'}, data: {isActive: false}});
  }
}
function parsedDraft(value: string | null) {
  if (!value) return null;
  const result = JSON.parse(value) as unknown;
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
}
function readReasonAndVersion(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SiteContentError('站点内容操作数据格式错误。');
  const body = input as Record<string, unknown>;
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new SiteContentError('请填写 1–500 字操作理由。');
  if (!Number.isSafeInteger(body.version) || (body.version as number) < 0) throw new SiteContentError('版本信息无效，请刷新后重试。');
  return {body, reason: body.reason.trim(), version: body.version as number};
}
function versionConflict() {throw new SiteContentError('站点内容已被其他操作修改，请刷新后重试。', 409);}
async function validateReferences(tx: Tx, _actor: string, type: SiteContentType, contentId: string | null, content: Record<string, unknown>) {
  if (type === 'BANNER' && typeof content.imageUrl === 'string' && content.imageUrl.startsWith('/uploads/') && !await mayAttachSiteOwnedUpload(content.imageUrl,tx)) throw new SiteContentError('横幅只能引用站点素材。');
  if (type === 'BRANDING' && typeof content.logoUrl === 'string' && content.logoUrl.startsWith('/uploads/') && !await mayAttachSiteOwnedUpload(content.logoUrl,tx)) throw new SiteContentError('品牌图标只能引用站点素材。');
  if (type === 'PAGE' && Array.isArray(content.blocks)) {
    for(const block of content.blocks) if(block&&typeof block==='object'&&(block as Record<string,unknown>).type==='IMAGE'&&typeof (block as Record<string,unknown>).src==='string'&&String((block as Record<string,unknown>).src).startsWith('/uploads/')&&!await mayAttachSiteOwnedUpload(String((block as Record<string,unknown>).src),tx)) throw new SiteContentError('页面图片只能引用站点素材。');
  }
  if (type === 'SECTION' && content.source === 'TAG') {
    const tagKey = String(content.tagKey);
    if (!await tx.tag.findFirst({where: {key: tagKey, isActive: true}, select: {id: true}})) throw new SiteContentError('首页展示区引用的分类不存在或未发布。');
  }
  if (type === 'TAG' && typeof content.key === 'string') {
    const collision = await tx.tag.findFirst({where: {key: content.key, ...(contentId ? {id: {not: contentId}} : {})}, select: {id: true}});
    if (collision) throw new SiteContentError('分类键已被使用。', 409);
  }
  if (type === 'BADGE' && typeof content.emoji === 'string') {
    const collision = await tx.badge.findFirst({where: {emoji: content.emoji, ...(contentId ? {id: {not: contentId}} : {})}, select: {id: true}});
    if (collision) throw new SiteContentError('该徽章符号已被使用。', 409);
  }
}

export async function readSiteContentImagePreview(actor:string,pageId:string,name:string) {
  const url=`/uploads/${name}`;
  const allowed=await db.$transaction(async tx=>{
    await requireContentAccess(actor,'site.content.manage',tx);
    const draft=await tx.siteContentDraft.findUnique({where:{contentType_contentId:{contentType:'PAGE',contentId:pageId}},select:{draftJson:true}});
    const page=draft?.draftJson?parsedDraft(draft.draftJson):await tx.sitePage.findUnique({where:{id:pageId},select:{blocksJson:true}}).then(row=>row?{blocks:JSON.parse(row.blocksJson) as unknown}:null);
    const blocks=page&&Array.isArray(page.blocks)?page.blocks:[];
    return blocks.some(block=>Boolean(block&&typeof block==='object'&&(block as Record<string,unknown>).type==='IMAGE'&&(block as Record<string,unknown>).src===url))&&await mayAttachSiteOwnedUpload(url,tx);
  });
  if(!allowed)throw new SiteContentError('页面图片不可预览。',404);
  return readSiteOwnedUpload(name);
}
async function bumpDraft(tx: Tx, type: SiteContentType, id: string, actor: string, version: number, draftJson: string | null, scheduledAt: Date | null) {
  return tx.siteContentDraft.upsert({where: {contentType_contentId: {contentType: type, contentId: id}}, create: {contentType: type, contentId: id, actorId: actor, version: version + 1, draftJson: draftJson ?? '', scheduledAt}, update: {actorId: actor, version: version + 1, draftJson: draftJson ?? '', scheduledAt}});
}

export async function readManagedSiteContent(actor: string) {
  return db.$transaction(async tx => {
    await requireContentAccess(actor, 'site.content.read', tx);
    const [live, drafts] = await Promise.all([
      Promise.all(SITE_CONTENT_TYPES.map(async type => [type, await listLive(tx, type)] as const)),
      tx.siteContentDraft.findMany({where: {contentType: {in: [...SITE_CONTENT_TYPES]}}, orderBy: [{updatedAt: 'desc'}, {contentId: 'asc'}], take: 1000}),
    ]);
    const allDrafts = new Map(drafts.map(row => [`${row.contentType}:${row.contentId}`, row]));
    const result: Record<string, {items: unknown[]}> = {};
    for (const [type, rows] of live) {
      const seen = new Set<string>();
      const items = rows.map(row => {
        seen.add(row.id);
        const draft = allDrafts.get(`${type}:${row.id}`);
        const current = contentValues(type, row);
        return {id: row.id, content: draft?.draftJson ? parsedDraft(draft.draftJson) : current, status: draft?.draftJson ? draft.scheduledAt ? 'SCHEDULED' : 'DRAFT' : current.isActive ? 'PUBLISHED' : 'UNPUBLISHED', isPublished: true, scheduledAt: draft?.scheduledAt ?? null, version: draft?.version ?? 0, updatedAt: draft?.updatedAt ?? ('createdAt' in row ? row.createdAt : null)};
      });
      for (const draft of drafts.filter(item => item.contentType === type && !seen.has(item.contentId) && item.draftJson)) items.push({id: draft.contentId, content: parsedDraft(draft.draftJson), status: draft.scheduledAt ? 'SCHEDULED' : 'DRAFT', isPublished: false, scheduledAt: draft.scheduledAt, version: draft.version, updatedAt: draft.updatedAt});
      result[type] = {items};
    }
    return result;
  });
}

export async function listSiteContentRevisions(actor: string, rawType: string, id: string) {
  const type = parseSiteContentType(rawType);
  return db.$transaction(async tx => {
    await requireContentAccess(actor, 'site.content.read', tx);
    if (!await liveRow(tx, type, id) && !await tx.siteContentDraft.findUnique({where: {contentType_contentId: {contentType: type, contentId: id}}, select: {contentId: true}})) throw new SiteContentError('站点内容不存在。', 404);
    const rows = await tx.siteContentRevision.findMany({where: {contentType: type, contentId: id}, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 50, select: {id: true, version: true, snapshotJson: true, reason: true, createdAt: true, actor: {select: {username: true}}}});
    return rows.map(row => ({...row, snapshot: JSON.parse(row.snapshotJson)}));
  });
}

export async function changeSiteContent(actor: string, rawType: string, rawId: string | null, input: unknown) {
  const type = parseSiteContentType(rawType), {body, reason, expectedVersion, action, scheduledAt} = readSiteContentCommand(input, rawId !== null);
  if (action === 'DELETE_DRAFT' && !rawId) throw new SiteContentError('缺少草稿编号。');
  const permission = action === 'SAVE' || action === 'DELETE_DRAFT' ? 'site.content.manage' : 'site.content.publish';
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actor}`;
    await requireContentAccess(actor, permission, tx);
    const id = rawId ?? (type === 'BRANDING' ? 'primary' : randomUUID().replaceAll('-', ''));
    if(!rawId){const liveRows=await listLive(tx,type),liveIds=new Set(liveRows.map(row=>row.id)),drafts=await tx.siteContentDraft.findMany({where:{contentType:type,draftJson:{not:''}},select:{contentId:true}}),reserved=liveRows.length+drafts.filter(row=>!liveIds.has(row.contentId)).length;if(reserved>=CONTENT_LIMIT[type])throw new SiteContentError('当前内容类型已达到管理条目上限。',409);}
    const draft = await tx.siteContentDraft.findUnique({where: {contentType_contentId: {contentType: type, contentId: id}}});
    const before = await liveRow(tx, type, id);
    const currentVersion = draft?.version ?? 0;
    if (currentVersion !== expectedVersion) versionConflict();
    if (action === 'DELETE_DRAFT') {
      if (!draft?.draftJson) throw new SiteContentError('没有可删除的草稿。', 404);
      const after = await bumpDraft(tx, type, id, actor, currentVersion, null, null);
      await recordAdminAudit(tx, actor, 'SITE_CONTENT_DRAFT_DISCARDED', `${type}:${id}`, reason, {contentType: type, version: after.version});
      return {id, status: before ? 'PUBLISHED' : 'DELETED', version: after.version};
    }
    if (action === 'UNPUBLISH') {
      if (!before) throw new SiteContentError('站点内容尚未发布。', 404);
      const archived = contentValues(type, before);
      archived.isActive = false;
      const afterVersion = currentVersion + 1;
      await deactivateLive(tx, type, id);
      await tx.siteContentRevision.create({data: {contentType: type, contentId: id, version: afterVersion, snapshotJson: JSON.stringify(archived), actorId: actor, reason}});
      await bumpDraft(tx, type, id, actor, currentVersion, null, null);
      await recordAdminAudit(tx, actor, 'SITE_CONTENT_UNPUBLISHED', `${type}:${id}`, reason, {contentType: type, version: afterVersion, isActive: false});
      return {id, status: 'UNPUBLISHED', version: afterVersion};
    }
    const rawContent = body.content ?? (action === 'PUBLISH' ? parsedDraft(draft?.draftJson ?? null) : null);
    if (!rawContent) throw new SiteContentError('请先填写站点内容。');
    const content = validateSiteContent(type, rawContent) as unknown as Record<string, unknown>;
    await validateReferences(tx, actor, type, id, content);
    if (before && (type === 'TAG' && content.key !== (before as {key: string}).key || type === 'SECTION' && content.key !== (before as {key: string}).key || type === 'PAGE' && content.slug !== (before as {slug: string}).slug)) throw new SiteContentError('已发布内容的配置键/路径不能修改，请新建条目并调整引用。', 409);
    if (action === 'SAVE' || action === 'SCHEDULE') {
      const next = await bumpDraft(tx, type, id, actor, currentVersion, JSON.stringify(content), action === 'SCHEDULE' ? scheduledAt : null);
      await recordAdminAudit(tx, actor, action === 'SCHEDULE' ? 'SITE_CONTENT_SCHEDULED' : 'SITE_CONTENT_DRAFT_SAVED', `${type}:${id}`, reason, {contentType: type, fields: Object.keys(content), version: next.version, scheduledAt: next.scheduledAt});
      return {id, status: action === 'SCHEDULE' ? 'SCHEDULED' : 'DRAFT', version: next.version, scheduledAt: next.scheduledAt};
    }
    const published = await saveLive(tx, type, id, content);
    const nextVersion = currentVersion + 1;
    await tx.siteContentRevision.create({data: {contentType: type, contentId: id, version: nextVersion, snapshotJson: JSON.stringify(contentValues(type, published)), actorId: actor, reason}});
    await bumpDraft(tx, type, id, actor, currentVersion, null, null);
    await recordAdminAudit(tx, actor, 'SITE_CONTENT_PUBLISHED', `${type}:${id}`, reason, {contentType: type, fields: Object.keys(content), version: nextVersion});
    return {id, content: projections[type](published), status: 'PUBLISHED', version: nextVersion};
  }).catch(error => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new SiteContentError('站点内容中的键或唯一值已被使用。', 409);
    throw error;
  });
}

export async function restoreSiteContentRevision(actor: string, rawType: string, id: string, revisionId: string, input: unknown) {
  const type = parseSiteContentType(rawType), {reason, version} = readReasonAndVersion(input);
  await pragmasReady;
  return db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actor}`;
    await requireContentAccess(actor, 'site.content.manage', tx);
    const revision = await tx.siteContentRevision.findFirst({where: {id: revisionId, contentType: type, contentId: id}});
    if (!revision) throw new SiteContentError('历史版本不存在。', 404);
    const draft = await tx.siteContentDraft.findUnique({where: {contentType_contentId: {contentType: type, contentId: id}}});
    const currentVersion = draft?.version ?? 0;
    if (currentVersion !== version) versionConflict();
    const content = validateSiteContent(type, JSON.parse(revision.snapshotJson));
    await validateReferences(tx, actor, type, id, content as Record<string, unknown>);
    const saved = await bumpDraft(tx, type, id, actor, currentVersion, JSON.stringify(content), null);
    await recordAdminAudit(tx, actor, 'SITE_CONTENT_RESTORED_AS_DRAFT', `${type}:${id}`, reason, {contentType: type, revisionVersion: revision.version, version: saved.version});
    return {id, status: 'DRAFT', version: saved.version};
  });
}
