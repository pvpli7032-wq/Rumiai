import type {SystemStatusItem} from './types';

/**
 * 系统状态：AI 可用性、最近备份、后台任务三格。
 *
 * 三个数据源各自独立，缺哪个就只让那一格写「需要权限 / 读取失败」，其余照常。
 * 任务状态直接读后台任务接口：只报待处理与失败数，不在这里重算各域逻辑。
 */
export interface StatusInput {
  operations: unknown;
  models: unknown;
  tasks: unknown;
  canReadTasks: boolean;
}

interface ModelRow {
  id: string;
  displayName: string;
  isActive: boolean;
  isDefault: boolean;
  lastCheckAt: string | null;
  lastCheckStatus: string | null;
}

interface TaskRow {
  kind: string;
  name: string;
  enabled: boolean;
  pending: number;
  failed: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

interface OperationsPayload {
  backups: {singleFileBackups: number; stateBundles: number; newestAt: string | null};
  database: {connected: boolean};
  alerts: Array<{severity: string; title: string}>;
}

const CHECK_LABELS: Record<string, string> = {
  AVAILABLE: '可用',
  UNAVAILABLE: '不可达',
  REJECTED: '密钥被拒绝',
  NOT_LISTED: '模型未在供应商列表',
};

export function statusItems(input: StatusInput): SystemStatusItem[] {
  const operations = input.operations as OperationsPayload | null;
  const models = Array.isArray(input.models) ? input.models as ModelRow[] : null;
  const tasks = Array.isArray(input.tasks) ? input.tasks as TaskRow[] : null;
  const statuses: SystemStatusItem[] = [];

  if (models === null) {
    statuses.push({id: 'ai', label: 'AI 可用性', detail: '需要「查看 AI 模型」权限。', tone: 'unknown'});
  } else if (!models.length) {
    statuses.push({id: 'ai', label: 'AI 可用性', detail: '尚未登记模型，聊天无法生成。', tone: 'warning'});
  } else {
    const defaults = models.filter(model => model.isActive && model.isDefault);
    if (defaults.length !== 1) {
      statuses.push({id: 'ai', label: 'AI 可用性', detail: '启用模型中没有唯一的默认模型。', tone: 'warning'});
    } else {
      const model = defaults[0];
      const last = model.lastCheckStatus;
      statuses.push({
        id: 'ai',
        label: 'AI 可用性',
        detail: last === 'AVAILABLE'
          ? `默认模型 ${model.displayName} 最近一次检查可用。`
          : last === null
            ? `默认模型 ${model.displayName} 尚未做连通性检查。`
            : `默认模型 ${model.displayName} 最近一次检查结果：${CHECK_LABELS[last] ?? last}。`,
        tone: last === 'AVAILABLE' ? 'ok' : last === null ? 'unknown' : 'warning',
      });
    }
  }

  if (operations === null) {
    statuses.push({id: 'backup', label: '最近备份', detail: '需要「查看系统运行状态」权限。', tone: 'unknown'});
  } else {
    const backups = operations.backups;
    const total = backups.singleFileBackups + backups.stateBundles;
    const newest = backups.newestAt;
    const stale = newest ? Date.now() - Date.parse(newest) > 7 * 86_400_000 : true;
    statuses.push({
      id: 'backup',
      label: '最近备份',
      detail: total === 0
        ? '本机未发现备份文件。'
        : `最近备份 ${new Date(newest as string).toLocaleString('zh-CN')}，共 ${total} 份。`,
      tone: total === 0 ? 'danger' : stale ? 'warning' : 'ok',
    });
  }

  if (tasks === null) {
    statuses.push({id: 'tasks', label: '任务状态', detail: input.canReadTasks ? '任务数据读取失败。' : '需要「查看后台任务」权限。', tone: 'unknown'});
  } else {
    const failed = tasks.reduce((sum, row) => sum + row.failed, 0);
    const pending = tasks.reduce((sum, row) => sum + row.pending, 0);
    const broken = tasks.filter(row => row.lastStatus === 'FAILED').map(row => row.name);
    const paused = tasks.filter(row => !row.enabled).map(row => row.name);
    statuses.push({
      id: 'tasks',
      label: '任务状态',
      detail: failed > 0
        ? `${failed} 次失败，待处理 ${pending} 项${broken.length ? '：' + broken.join('、') : ''}`
        : pending > 0
          ? `待处理 ${pending} 项，没有失败记录。`
          : paused.length ? `没有待处理任务；已关闭：${paused.join('、')}。` : '没有待处理任务，近期没有失败。',
      tone: failed > 0 ? 'danger' : pending > 0 || paused.length ? 'warning' : 'ok',
    });
  }

  return statuses;
}
