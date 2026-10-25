import type {MemoryFactView,MemorySummaryView} from './types';
export interface MemoryPanelData {enabled:boolean;facts:MemoryFactView[];summary:MemorySummaryView|null;summaryStatus:{available:boolean;reason:string|null;triggerMessages:number;maxChars:number;task:{status:string;attempts:number;updatedAt:string}|null};sources:{coveredMessageId:string|null}}
