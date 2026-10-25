export type MediaOperation='IMAGE_UNDERSTANDING'|'AUDIO_TRANSCRIPTION';
export interface MediaCapability {available:boolean;reason:string|null;remaining:number;maxChars:number}
export interface ConversationMediaCapabilities {image:MediaCapability;transcription:MediaCapability;uploadMaxBytes:number;audioMaxDurationSeconds:number}
export interface MediaTaskResult {requestId:string;status:'COMPLETE';text:string;assetId:string}
export interface AudioUpload {id:string;url:string;size:number;mimeType:string;durationMs:number}
