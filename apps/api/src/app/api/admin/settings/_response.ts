import {NextResponse} from 'next/server';
import {AdminManagementError} from '@rumiai/backend/modules/admin/management-service';
import {SettingConflictError, SettingValidationError} from '@rumiai/backend/modules/settings/index';
import {privateHeaders, readJsonBody} from '@rumiai/backend/infrastructure/http';
import {logRouteError} from '@rumiai/backend/infrastructure/logging/logger';

export {privateHeaders};

/**
 * 设置接口错误体与后台其他路由同形（`{error, code}`），校验失败与版本冲突额外带 key，
 * 设置页据此把错误挂到具体字段上；其余错误统一走 admin 的错误体。
 */
export function settingsErrorResponse(error: unknown, route: string) {
  if (error instanceof SettingValidationError || error instanceof SettingConflictError) {
    const status = error instanceof SettingConflictError ? 409 : 400;
    return NextResponse.json(
      {error: error.message, ...(error.key ? {key: error.key} : {}), code: status === 409 ? 'CONFLICT' : 'INVALID_INPUT'},
      {status, headers: privateHeaders},
    );
  }
  if (error instanceof AdminManagementError) return NextResponse.json({error: error.message, code: 'INVALID_INPUT'}, {status: error.status, headers: privateHeaders});
  logRouteError(route, error);
  return NextResponse.json({error: '设置操作失败，请刷新后重试。', code: 'INTERNAL'}, {status: 500, headers: privateHeaders});
}

/** 一次保存整组设置，正文上限按「多条提示词 + 多项数值」估算。 */
export const readSettingsJson = (request: Request) => readJsonBody(request, {maxBytes: 120_000});
