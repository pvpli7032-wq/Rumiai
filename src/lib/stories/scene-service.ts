import type {SceneConfig} from './scene-config';
import {SCENE_CONFIGS} from './scene-config';

/**
 * The character fields the scene entry actually renders. Optional members are optional
 * because the `Character` columns behind them are nullable — callers pass the row through
 * instead of inventing empty strings to satisfy the type.
 */
export type CharacterPublicFields = Readonly<{
  id: string;
  name: string;
  tagline?: string | null;
  personality: string;
  background?: string | null;
  greeting?: string | null;
  avatarUrl?: string | null;
}>;

export type SceneAvailability =
  | Readonly<{kind: 'available'; scene: SceneConfig}>
  | Readonly<{kind: 'unavailable'; reason: 'missing-config' | 'disabled' | 'incomplete-copy' | 'incompatible-character'}>;

const requiredCopy = (value: string | undefined): boolean => Boolean(value?.trim());

export function isSceneEntryComplete(config: SceneConfig): boolean {
  return requiredCopy(config.id)
    && requiredCopy(config.version)
    && requiredCopy(config.characterId)
    && requiredCopy(config.title)
    && requiredCopy(config.hook)
    && requiredCopy(config.userIdentity)
    && requiredCopy(config.conflict)
    && requiredCopy(config.goal)
    && config.suggestions.length === 3
    && config.suggestions.every(suggestion => requiredCopy(suggestion.id) && requiredCopy(suggestion.text))
    && requiredCopy(config.compatibility.approvedCharacterScenarioVersion)
    && requiredCopy(config.compatibility.reviewedAt);
}

export function resolveScene(character: CharacterPublicFields, config?: SceneConfig): SceneAvailability {
  if (!config) return {kind: 'unavailable', reason: 'missing-config'};
  if (!config.enabled) return {kind: 'unavailable', reason: 'disabled'};
  if (!isSceneEntryComplete(config)) return {kind: 'unavailable', reason: 'incomplete-copy'};
  // Compatibility is deliberately limited to the reviewed static character binding.
  if (config.characterId !== character.id) return {kind: 'unavailable', reason: 'incompatible-character'};
  return {kind: 'available', scene: config};
}

export function getPublishedSceneConfigs(): readonly SceneConfig[] {
  return SCENE_CONFIGS.filter(config => config.enabled && isSceneEntryComplete(config));
}
