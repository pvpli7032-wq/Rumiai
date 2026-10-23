import type {LandingCopy} from './i18n/landing-copy';
import type {SiteContent, SitePage} from './site-content/types';

export type PublicCharacterSummary = {id:string;name:string;tagline:string|null;avatarUrl:string|null;chatCount:number;tags:string|null};
export type PublicCharacter = PublicCharacterSummary & {greeting:string|null;personality:string;creator:{username:string;displayName:string|null}|null};
export type PublicCharacterPost = {id:string;content:string;createdAt:string;circle:{id:string;name:string}};
export type HomeProjection = {site:SiteContent;characters:Array<PublicCharacterSummary & {personality:string;creator:{username:string;displayName:string|null}|null}>;homeCopy:Partial<LandingCopy>;mirrorEnabled:boolean};
export type ExploreProjection = {total:number;labelByKey:Record<string,string>;characters:Array<PublicCharacterSummary & {conversationCount:number}>};
export type PublicCharacterProjection = {character:PublicCharacter|null;tagLabels:string[];communityPosts:PublicCharacterPost[]};
export type SharedConversationProjection = {id:string;title:string|null;createdAt:string;character:{id:string;name:string;avatarUrl:string|null}|null;messages:Array<{id:string;role:string;content:string;createdAt:string}>};
export type CreatorProfileProjection = {creator:{id:string;username:string;displayName:string|null;avatarUrl:string|null;tier:string;followerCount:number;isFollowing:boolean;publicCharacterCount:number;chatCount:number;messageCount:number;likeCount:number};characters:Array<{id:string;name:string;tagline:string|null;avatarUrl:string|null;chatCount:number;likeCount:number;messageCount:number;tags:string|null;isAdult:boolean}>};
export type SitePageProjection = SitePage|null;
