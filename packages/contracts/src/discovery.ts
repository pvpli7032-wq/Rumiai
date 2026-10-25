export const DISCOVERY_PREFERENCES_CHANGED='xingban:discovery-preferences-changed';
export interface DiscoveryPreferences {history:Array<{query:string;lastUsedAt:string}>;hidden:Array<{id:string;name:string}>}
