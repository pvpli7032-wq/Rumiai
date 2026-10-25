export type ConversationToolSettings = {
  settings: {personaId: string | null; personalCharacterOverride: string; responseStyle: string | null; responseLength: string | null; worldbookIds: string[]};
  personas: Array<{id: string; name: string; description: string; version: number}>;
  worldbooks: Array<{id: string; name: string; userId: string; enabled: boolean; isPublic: boolean}>;
  styles: Array<{key: string; label: string}>; lengths: Array<{key: string; label: string}>;
  overrideMaxChars: number; memoryEnabled: boolean; characterId: string; canBindCharacterBooks: boolean;
  generation: {available: boolean; reason: string | null; maxInstructionChars: number; modelName: string | null; coins: number | null; pricing: string | null};
};
export type MessageVersionView = {id: string; messageId: string; content: string; source: string; createdAt: string};
