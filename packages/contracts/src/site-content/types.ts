export type SitePageBlock =
  | {type:'PARAGRAPH';text:string}
  | {type:'HEADING';text:string;level:2|3}
  | {type:'LINK';text:string;href:string}
  | {type:'NOTICE';text:string;tone:'INFO'|'WARNING'}
  | {type:'BUTTON';text:string;href:string;variant:'PRIMARY'|'SECONDARY'}
  | {type:'CARD_GRID';heading:string;cards:Array<{title:string;description:string;href:string;actionLabel:string}>}
  | {type:'IMAGE';src:string;alt:string;caption:string}
  | {type:'LIST';ordered:boolean;items:string[]};
export interface SiteBanner {id:string;title:string;description:string;href:string;gradientFrom:string;gradientTo:string;imageUrl:string|null}
export interface SiteTag {key:string;label:string;group:string;filterRow:string|null}
export interface SiteBadge {emoji:string;label:string}
export interface SiteSection {key:string;emoji:string;title:string;source:string;tagKey:string|null}
export interface SiteNavigationItem {id:string;placement:'HEADER'|'FOOTER';label:string;href:string;sortOrder:number}
export interface SiteBranding {id:string;brandName:string;logoUrl:string|null;accentFrom:string;accentTo:string;footerNote:string|null}
export interface SitePage {id:string;slug:string;kind:'PAGE'|'ANNOUNCEMENT';title:string;summary:string;blocks:SitePageBlock[];sortOrder:number;startsAt:string|null;endsAt:string|null;createdAt?:string}
export interface SiteContent {banners:{hero:SiteBanner[];sidebar:SiteBanner[]};tags:SiteTag[];badges:SiteBadge[];sections:SiteSection[];navigation:{header:SiteNavigationItem[];footer:SiteNavigationItem[]};branding:SiteBranding;announcements:SitePage[];nextScheduledAt:string|null}
