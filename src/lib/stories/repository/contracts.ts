export class StoryError extends Error {
  /** Optional structured payload (e.g. {currentRevision, run}) merged into the HTTP error body. */
  constructor(readonly code: string, message: string, readonly status: number, readonly data?: Record<string, unknown>) {
    super(message);
    this.name = 'StoryError';
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoryError('INVALID_STORY_DATA', '故事数据格式不正确。', 422);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max) {
    throw new StoryError('INVALID_STORY_DATA', '故事字段格式不正确。', 422);
  }
  return value;
}

export function parseCreate(input: unknown) {
  const body = object(input);
  return {templateVersionId: text(body.templateVersionId), chapterKey: text(body.chapterKey), requestId: text(body.requestId)};
}

export function parseTurn(input: unknown) {
  const body = object(input);
  if (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new StoryError('INVALID_TURN_REQUEST', '回合请求参数不正确。', 422);
  }
  const raw = body.content;
  if (typeof raw !== 'string' || raw.length > 5000) throw new StoryError('INVALID_TURN_REQUEST', '消息须为文本，最多 5000 字。', 422);
  const content = raw.trim();
  if (!content) throw new StoryError('INVALID_TURN_REQUEST', 'Message content is required', 422);
  return {expectedRevision: body.expectedRevision, requestId: text(body.requestId, 200), content};
}

/** Only explicitly public fields leave this module; definitions may contain hidden plot data. */
export function readVersion(definitionJson: string, characterSnapshotJson: string) {
  try {
    const definition = object(JSON.parse(definitionJson));
    const snapshot = object(JSON.parse(characterSnapshotJson));
    if (definition.schemaVersion !== 1 || snapshot.schemaVersion !== 1 || !Array.isArray(definition.chapters) || !definition.chapters.length) throw Error();
    const chapters = definition.chapters.map(value => {
      const chapter = object(value);
      return {key: text(chapter.key), title: text(chapter.title)};
    });
    if (new Set(chapters.map(chapter => chapter.key)).size !== chapters.length) throw Error();
    return {characterId: text(snapshot.characterId), publicSummary: text(definition.publicSummary, 2000), chapters};
  } catch {
    throw new StoryError('INVALID_STORY_DATA', '故事版本数据不完整，暂时无法使用。', 422);
  }
}
