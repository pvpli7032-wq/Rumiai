/**
 * API 路径登记表。参数一律 `encodeURIComponent`，避免 id 里的特殊字符破坏路径。
 *
 * 约定（2026-10-20 结构审查后修订）：
 * - 新增代码强制走本表的 `API.*` 常量，不再新写 `/api/...` 字面量。
 * - 存量代码不批量迁移（纯搅动、零用户价值）；仅在因其他原因触碰该文件时顺手迁移。
 * - 本文件同时是路由事实清单：未被消费的条目记录的是真实存在的路由，不是死代码，不删。
 */
const e = encodeURIComponent;

export const API = {
  auth: {
    me: '/api/auth/me',
    login: '/api/auth/login',
    register: '/api/auth/register',
    logout: '/api/auth/logout',
  },
  site: '/api/site',
  status: '/api/operations/status',
  uiConfig: '/api/ui-config',
  /** 玩法埋点上报（V3 表 22 玩法漏斗）。匿名可调，事件名必须在白名单内。 */
  events: '/api/events',
  growth: {
    onboarding: '/api/growth/onboarding',
    invite: '/api/growth/invite',
  },
  me: {
    quota: '/api/me/quota',
    notifications: '/api/me/notifications',
    notification: (id: string) => `/api/me/notifications/${e(id)}`,
  },
  mirror: {
    generate: '/api/mirror',
    result: (shareId: string) => `/api/mirror/${e(shareId)}`,
    mine: '/api/mirror/mine',
    compare: '/api/mirror/compare',
  },
  disputes: {
    list: (query: string) => `/api/disputes?${query}`,
    create: '/api/disputes',
    detail: (id: string) => `/api/disputes/${e(id)}`,
    vote: (id: string) => `/api/disputes/${e(id)}/vote`,
    withdraw: (id: string) => `/api/disputes/${e(id)}/withdraw`,
  },
  upload: '/api/upload',
  analytics: {
    funnelEvents: '/api/analytics/funnel-events',
  },
  universes: '/api/universes',
  rankings: '/api/rankings',
  reports: '/api/reports',
  appeals: '/api/community-appeals',
  registrationPolicy: '/api/compliance/registration-policy',
  leaderboardGifts: '/api/leaderboard/gifts',
  horoscope: (sign: string) => `/api/horoscope/${e(sign)}`,

  ai: {
    usage: '/api/ai/usage',
    models: (conversationId?: string | null) => `/api/ai/models${conversationId ? `?conversationId=${e(conversationId)}` : ''}`,
  },

  conversations: {
    list: (archived?: boolean) => `/api/conversations${archived ? '?archived=true' : ''}`,
    detail: (id: string) => `/api/conversations/${e(id)}`,
    messages: (id: string) => `/api/conversations/${e(id)}/messages`,
    message: (id: string, mid: string) => `/api/conversations/${e(id)}/messages/${e(mid)}`,
    like: (id: string, mid: string) => `/api/conversations/${e(id)}/messages/${e(mid)}/like`,
    regenerate: (id: string, mid: string) => `/api/conversations/${e(id)}/messages/${e(mid)}/regenerate`,
    export: (id: string, format: 'json' | 'txt' = 'json') => `/api/conversations/${e(id)}/export?format=${format}`,
    /** 一次点击一个 requestId，断线后按编号查回执（V3 §20）。 */
    turns: (id: string, requestId: string) => `/api/conversations/${e(id)}/turns?requestId=${e(requestId)}`,
    /** 聊天记忆：列表、确认、忽略、删除（V3 §25）。 */
    memory: (id: string) => `/api/conversations/${e(id)}/memory`,
    memoryConfirm: (id: string, factId: string) => `/api/conversations/${e(id)}/memory/${e(factId)}/confirm`,
    memoryIgnore: (id: string, factId: string) => `/api/conversations/${e(id)}/memory/${e(factId)}/ignore`,
    memoryFact: (id: string, factId: string) => `/api/conversations/${e(id)}/memory/${e(factId)}`,
  },

  stories: {
    list: (query?: string) => `/api/stories${query ? `?${query}` : ''}`,
    detail: (slug: string) => `/api/stories/${e(slug)}`,
  },
  characters: {
    list: (query?: string) => `/api/characters${query ? `?${query}` : ''}`,
    detail: (id: string) => `/api/characters/${e(id)}`,
    comments: (id: string) => `/api/characters/${e(id)}/comments`,
    quests: (id: string) => `/api/characters/${e(id)}/quests`,
    completeQuest: (id: string, qid: string) => `/api/characters/${e(id)}/quests/${e(qid)}/complete`,
    gifts: (id: string) => `/api/characters/${e(id)}/gifts`,
    like: (id: string) => `/api/characters/${e(id)}/like`,
    bookmark: (id: string) => `/api/characters/${e(id)}/bookmark`,
    gift: (id: string) => `/api/characters/${e(id)}/gift`,
  },

  comments: {
    detail: (id: string) => `/api/comments/${e(id)}`,
    like: (id: string) => `/api/comments/${e(id)}/like`,
  },

  circles: {
    list: '/api/circles',
    detail: (id: string) => `/api/circles/${e(id)}`,
    posts: (id: string) => `/api/circles/${e(id)}/posts`,
    subscription: (id: string) => `/api/circles/${e(id)}/subscription`,
  },

  creators: {
    profile: (username: string) => `/api/creators/${e(username)}`,
    activity: (username: string) => `/api/creators/${e(username)}/activity`,
    connections: (username: string) => `/api/creators/${e(username)}/connections`,
    follow: (username: string) => `/api/creators/${e(username)}/follow`,
  },

  coins: {
    packages: '/api/coins/packages',
    orders: '/api/coins/orders',
    order: (orderNo: string) => `/api/coins/orders/${e(orderNo)}`,
    ledger: (query?: string) => `/api/coins/ledger${query ? `?${query}` : ''}`,
  },

  users: {
    me: '/api/users/me',
    export: '/api/users/me/export',
  },

  missions: {
    list: '/api/missions',
    complete: (id: string) => `/api/missions/${e(id)}/complete`,
  },

  checkin: {
    submit: '/api/checkin',
    status: '/api/checkin/status',
  },

  admin: {
    session: '/api/admin/session',
    access: '/api/admin/access',
    accounts: (query?: string) => `/api/admin/accounts${query ? `?${query}` : ''}`,
    account: (id: string) => `/api/admin/accounts/${e(id)}`,
    characters: (query?: string) => `/api/admin/characters${query ? `?${query}` : ''}`,
    character: (id: string) => `/api/admin/characters/${e(id)}`,
    characterModels: (id: string) => `/api/admin/characters/${e(id)}/models`,
    circles: (query?: string) => `/api/admin/circles${query ? `?${query}` : ''}`,
    circle: (id: string) => `/api/admin/circles/${e(id)}`,
    circleMembers: (id: string) => `/api/admin/circles/${e(id)}/members`,
    circleMember: (id: string, userId: string) => `/api/admin/circles/${e(id)}/members/${e(userId)}`,
    posts: (query?: string) => `/api/admin/community/posts${query ? `?${query}` : ''}`,
    post: (id: string) => `/api/admin/community/posts/${e(id)}`,
    comments: (query?: string) => `/api/admin/community/comments${query ? `?${query}` : ''}`,
    comment: (id: string) => `/api/admin/community/comments/${e(id)}`,
    moderation: {
      characters: '/api/admin/moderation/characters',
      character: (id: string) => `/api/admin/moderation/characters/${e(id)}`,
      characterBatch: '/api/admin/moderation/characters/batch',
      reports: '/api/admin/moderation/reports',
      report: (id: string) => `/api/admin/moderation/reports/${e(id)}`,
      appeals: '/api/admin/moderation/appeals',
      appeal: (id: string) => `/api/admin/moderation/appeals/${e(id)}`,
      audit: '/api/admin/moderation/audit',
    },
    finance: {
      orders: (query?: string) => `/api/admin/finance/orders${query ? `?${query}` : ''}`,
      allOrders: (query?: string) => `/api/admin/finance/orders/all${query ? `?${query}` : ''}`,
      exportOrders: (query?: string) => `/api/admin/finance/orders/export${query ? `?${query}` : ''}`,
      refund: (orderNo: string) => `/api/admin/finance/orders/${e(orderNo)}/refund`,
      packages: '/api/admin/finance/packages',
      package: (id: string) => `/api/admin/finance/packages/${e(id)}`,
      reconciliation: '/api/admin/finance/reconciliation',
      reconciliationBatch: (id: string) => `/api/admin/finance/reconciliation/${e(id)}`,
      report: (days: number) => `/api/admin/finance/report?days=${days}`,
      callbackAlerts: '/api/admin/finance/callback-alerts',
    },
    ai: {
      providers: '/api/admin/ai/providers',
      provider: (id: string) => `/api/admin/ai/providers/${e(id)}`,
      testProvider: (id: string) => `/api/admin/ai/providers/${e(id)}/test`,
      models: '/api/admin/ai/models',
      model: (id: string) => `/api/admin/ai/models/${e(id)}`,
      testModel: (id: string) => `/api/admin/ai/models/${e(id)}/test`,
      prices: '/api/admin/ai/prices',
      costs: '/api/admin/ai/costs',
    },
    growth: {
      missions: '/api/admin/growth/missions',
      mission: (id: string) => `/api/admin/growth/missions/${e(id)}`,
      checkins: '/api/admin/growth/checkins',
      gifts: '/api/admin/growth/gifts',
      gift: (id: string) => `/api/admin/growth/gifts/${e(id)}`,
      rewards: '/api/admin/growth/rewards',
    },
    siteContent: '/api/admin/site-content',
    siteContentType: (type: string) => `/api/admin/site-content/${e(type)}`,
    siteContentItem: (type: string, id: string) => `/api/admin/site-content/${e(type)}/${e(id)}`,
    siteContentRevisions: (type: string, id: string) => `/api/admin/site-content/${e(type)}/${e(id)}/revisions`,
    siteContentRestore: (type: string, id: string) => `/api/admin/site-content/${e(type)}/${e(id)}/restore`,
    payments: {
      merchants: '/api/admin/payments/merchants',
      testMerchant: (id: string) => `/api/admin/payments/merchants/${e(id)}/test`,
      checkout: '/api/admin/payments/checkout',
    },
    operations: '/api/admin/operations',
    backups: '/api/admin/operations/backups',
    maintenance: '/api/admin/operations/maintenance',
    certificate: '/api/admin/operations/certificate',
    compliance: '/api/admin/compliance',
    analytics: '/api/admin/analytics',
    analyticsFunnel: '/api/admin/analytics/scene-funnel',
    analyticsProductFunnel: '/api/admin/analytics/product-funnel',
    analyticsOpsMetrics: '/api/admin/analytics/ops-metrics',
    audit: '/api/admin/audit',
    settings: '/api/admin/settings',
    settingsHistory: (query: string) => `/api/admin/settings/history?${query}`,
    settingsRestore: '/api/admin/settings/restore',
    settingsExport: '/api/admin/settings/export',
    settingsImport: '/api/admin/settings/import',
    settingsImportConfirm: '/api/admin/settings/import/confirm',
    settingsPromptPreview: '/api/admin/settings/prompts/preview',
    accountSettings: (id: string) => `/api/admin/accounts/${e(id)}/settings`,
    accountSetting: (id: string, key: string) => `/api/admin/accounts/${e(id)}/settings/${e(key)}`,
    coinPrices: '/api/admin/ai/coin-prices',
    billing: '/api/admin/billing',
    billingCharges: (query: string) => `/api/admin/billing/charges?${query}`,
    tasks: '/api/admin/tasks',
    task: (id: string) => `/api/admin/tasks/${e(id)}`,
    mirrorResults: (query: string) => `/api/admin/mirror/results?${query}`,
    disputeCases: (query: string) => `/api/admin/disputes/cases?${query}`,
    disputeCase: (id: string) => `/api/admin/disputes/cases/${e(id)}`,
    operators: '/api/admin/operators',
    operatorLookup: (query: string) => `/api/admin/operators/lookup?${query}`,
    roles: '/api/admin/roles',
  },
} as const;
