/**
 * Versioned schemas for persisted story state and extractor output.
 *
 * SQLite stores JSON as text：the database guarantees
 * neither syntax nor shape, so every read validates against the versioned schema
 * here. Corrupt stored state is a data-integrity fault — callers refuse to
 * advance state and surface a failure instead of overwriting it.
 */
import {StoryError} from '../repository/contracts';

export const STATE_SCHEMA_VERSION = 1;

/** Event types an extractor may emit; CHAPTER_RESULT is reserved for close-chapter. */
export const EXTRACTABLE_EVENT_TYPES = ['FACT', 'PROMISE', 'RELATIONSHIP'] as const;
export type ExtractableEventType = (typeof EXTRACTABLE_EVENT_TYPES)[number];

const MAX_FACTS = 50;
const MAX_FACT_LENGTH = 500;
const MAX_EVENTS_PER_TURN = 10;

export interface StoryState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  chapterKey: string;
  facts: string[];
}

export interface ExtractedEvent {
  type: ExtractableEventType;
  summary: string;
}

function isSchemaVersion(value: unknown): value is typeof STATE_SCHEMA_VERSION {
  return value === STATE_SCHEMA_VERSION;
}

function cleanFact(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const summary = value.trim();
  return summary && summary.length <= MAX_FACT_LENGTH ? summary : null;
}

/** Parses a persisted run/checkpoint state; `null` means corrupt (never defaulted away). */
export function readState(raw: string): StoryState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const state = parsed as Record<string, unknown>;
    if (!isSchemaVersion(state.schemaVersion) || typeof state.chapterKey !== 'string' || !state.chapterKey.trim()) return null;
    let facts: string[] = [];
    if (state.facts !== undefined) {
      if (!Array.isArray(state.facts) || state.facts.length > MAX_FACTS) return null;
      facts = [];
      for (const item of state.facts) {
        const fact = cleanFact(item);
        if (!fact) return null;
        facts.push(fact);
      }
    }
    return {schemaVersion: STATE_SCHEMA_VERSION, chapterKey: state.chapterKey, facts};
  } catch {
    return null;
  }
}

/** Merges confirmed summaries into the rolling state, newest last, capped. */
export function withFacts(state: StoryState, added: readonly string[]): StoryState {
  return {...state, facts: [...state.facts, ...added].slice(-MAX_FACTS)};
}

/** Validates extractor output; `null` means the model (or mock) returned unusable JSON. */
export function readExtraction(raw: string): ExtractedEvent[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const body = parsed as Record<string, unknown>;
    if (!isSchemaVersion(body.schemaVersion) || !Array.isArray(body.events) || body.events.length > MAX_EVENTS_PER_TURN) return null;
    const events: ExtractedEvent[] = [];
    for (const item of body.events) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const event = item as Record<string, unknown>;
      if (!EXTRACTABLE_EVENT_TYPES.includes(event.type as ExtractableEventType)) return null;
      const summary = cleanFact(event.summary);
      if (!summary) return null;
      events.push({type: event.type as ExtractableEventType, summary});
    }
    return events;
  } catch {
    return null;
  }
}

/** The public CHAPTER_RESULT envelope (same shape the run view maps `payload.summary` from). */
export function chapterResultPayload(summary: string): string {
  if (!summary.trim() || summary.length > 2000) {
    throw new StoryError('INVALID_STORY_DATA', '故事章节数据不完整。', 422);
  }
  return JSON.stringify({schemaVersion: STATE_SCHEMA_VERSION, publicSummary: summary.trim()});
}
