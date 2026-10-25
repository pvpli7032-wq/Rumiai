import type {SettingGroup} from '@rumiai/contracts/settings/types';
export type SettingsWorkspaceId = 'chat' | 'memory' | 'story';
type Workspace = {path:string;title:string;description:string;groups:Array<{id:SettingGroup;label:string}>;sections:string[]};
export const SETTINGS_WORKSPACES:Record<SettingsWorkspaceId,Workspace>={
chat:{path:'/admin/chat/settings',title:'聊天设置',description:'管理聊天回复、身份与世界书、接话建议和附件能力。用户在聊天设置中读取这里的规则。',groups:[{id:'chat',label:'聊天规则'}],sections:['chat-scenes','chat-input','chat-response','chat-context','chat-relationship','chat-revisions','chat-suggestions','chat-media','chat-sharing']},
memory:{path:'/admin/chat/memory',title:'记忆设置',description:'手工记忆与自动摘要分别控制。自动摘要还需要AI平台中的摘要任务模型与预算；关闭自动摘要不影响手工记忆。',groups:[{id:'growth',label:'记忆规则'},{id:'prompts',label:'摘要提示词'}],sections:['growth-memory','prompts-memory']},
story:{path:'/admin/stories/settings',title:'故事场景设置',description:'管理章节故事入口、玩家设定和叙事方式；场景规则与收费规则分开查看。',groups:[{id:'billing',label:'章节故事'},{id:'chat',label:'角色场景'}],sections:['chat-scenes','billing-story','billing-story-settings','billing-story-runtime']}
};
