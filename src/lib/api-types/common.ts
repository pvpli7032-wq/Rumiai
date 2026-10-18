/** 所有接口共用的形状。 */

/** 迁移到 `@/lib/http` 的管理接口都带 `code`；旧接口只有 `error`，故 code 可选。 */
export type ApiErrorBody = {error: string; code?: string};

export type OkResponse = {ok: true};

export type Paginated<T> = {items: T[]; total: number; page: number; pageSize: number};
