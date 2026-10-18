import {db} from '@/lib/db';
import {SITE_CONTENT_TYPES, type SiteContentType} from './content';
import type {SitePageBlock} from '@/lib/use-site-content';
import {DEFAULT_ACCENT_FROM, DEFAULT_ACCENT_TO, DEFAULT_BRAND_LOGO, DEFAULT_BRAND_NAME} from './brand-defaults';

const DEFAULT_BRANDING={id:'primary',brandName:DEFAULT_BRAND_NAME,logoUrl:DEFAULT_BRAND_LOGO,accentFrom:DEFAULT_ACCENT_FROM,accentTo:DEFAULT_ACCENT_TO,footerNote:'',isActive:true,updatedAt:new Date(0)};
const now=()=>new Date();

async function applyDueDrafts<T extends {id:string}>(type:SiteContentType,rows:T[],at:Date):Promise<T[]>{
  const drafts=await db.siteContentDraft.findMany({where:{contentType:type,scheduledAt:{lte:at},draftJson:{not:''}},orderBy:[{scheduledAt:'asc'},{contentId:'asc'}],take:500});
  const merged=new Map(rows.map(row=>[row.id,row]));
  for(const draft of drafts){const content=JSON.parse(draft.draftJson) as Record<string,unknown>;merged.set(draft.contentId,{...merged.get(draft.contentId),...content,id:draft.contentId} as T);}
  return [...merged.values()];
}

async function readEffectivePages(at:Date){
  const stored=await db.sitePage.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}],take:500});
  const rows=stored.map(row=>({...row,blocks:JSON.parse(row.blocksJson) as SitePageBlock[]}));
  const effective=await applyDueDrafts('PAGE',rows,at);
  return effective.filter(page=>page.isActive&&(!page.startsAt||new Date(page.startsAt)<=at)&&(!page.endsAt||new Date(page.endsAt)>at)).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)).map(({blocksJson:_blocksJson,...page})=>page);
}

/** The uploads domain uses this projection to expose images attached to currently public pages. */
export async function isPublicSiteContentImageReference(url:string,at=now()) {
  const pages=await readEffectivePages(at);
  return pages.some(page=>page.blocks.some(block=>block.type==='IMAGE'&&block.src===url));
}

/** Returns the effective published state, including scheduled items as soon as their time arrives. */
export async function readPublicSiteContent(at=now()){
  const [storedBanners,storedTags,storedBadges,storedSections,storedNavigation,storedBranding,upcoming]=await Promise.all([
    db.banner.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}],take:200}),
    db.tag.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}],take:300}),
    db.badge.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}],take:200}),
    db.homeSection.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}],take:100}),
    db.siteNavigationItem.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}],take:100}),
    db.siteBranding.findUnique({where:{id:'primary'}}),
    db.siteContentDraft.findFirst({where:{contentType:{in:[...SITE_CONTENT_TYPES]},scheduledAt:{gt:at},draftJson:{not:''}},orderBy:{scheduledAt:'asc'},select:{scheduledAt:true}}),
  ]);
  const [banners,tags,badges,sections,navigation,pages,brandingRows]=await Promise.all([
    applyDueDrafts('BANNER',storedBanners,at),applyDueDrafts('TAG',storedTags,at),applyDueDrafts('BADGE',storedBadges,at),
    applyDueDrafts('SECTION',storedSections,at),applyDueDrafts('NAVIGATION',storedNavigation,at),readEffectivePages(at),
    applyDueDrafts('BRANDING',storedBranding?[storedBranding]:[DEFAULT_BRANDING],at),
  ]);
  const publicTags=tags.filter(tag=>tag.isActive),activeTagKeys=new Set(publicTags.map(tag=>tag.key));
  const activeBranding=brandingRows.find(item=>item.id==='primary'&&item.isActive)??DEFAULT_BRANDING;
  const orderedBanners=[...banners].sort((a,b)=>a.placement.localeCompare(b.placement)||a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
  return{
    banners:{hero:orderedBanners.filter(item=>item.isActive&&item.placement==='HERO'),sidebar:orderedBanners.filter(item=>item.isActive&&item.placement==='SIDEBAR')},
    tags:publicTags.sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)),
    badges:badges.filter(item=>item.isActive).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)),
    sections:sections.filter(item=>item.isActive&&(item.source!=='TAG'||activeTagKeys.has(item.tagKey??''))).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)),
    navigation:{header:navigation.filter(item=>item.isActive&&item.placement==='HEADER').sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id)),footer:navigation.filter(item=>item.isActive&&item.placement==='FOOTER').sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id))},
    branding:activeBranding,
    announcements:pages.filter(page=>page.kind==='ANNOUNCEMENT'),
    nextScheduledAt:upcoming?.scheduledAt??null,
  };
}

export async function readPublishedSitePage(slug:string,at=now()){
  if(!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug))return null;
  return (await readEffectivePages(at)).find(page=>page.kind==='PAGE'&&page.slug===slug)??null;
}

export async function readPublishedAnnouncements(at=now()){
  return (await readEffectivePages(at)).filter(page=>page.kind==='ANNOUNCEMENT');
}

export async function readPublicHeroBanners(){
  return(await readPublicSiteContent()).banners.hero.map(({id,title,description,href,gradientFrom,gradientTo,imageUrl})=>({id,title,description,href,gradientFrom,gradientTo,imageUrl}));
}
