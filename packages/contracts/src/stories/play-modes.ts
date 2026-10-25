export type StoryPlayModeKey='chat'|'scene'|'chapter';
export interface StoryPlayMode {key:StoryPlayModeKey;sceneId?:string|null;label:string;available:boolean;reason:string|null;href:string|null;description:string}
export interface StoryPlayModes {characterId:string|null;modes:StoryPlayMode[];scene:{title:string;hook:string;userIdentity:string;goal:string}|null}
