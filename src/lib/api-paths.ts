/**
 * 前端能调的接口路径都在这里。组件里不再写 `/api/...` 字面量，改路径只改这一处。
 * 参数一律 `encodeURIComponent`，避免 id 里的特殊字符破坏路径。
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
  upload: '/api/upload',
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
    audit: '/api/admin/audit',
    operators: '/api/admin/operators',
    operatorLookup: (query: string) => `/api/admin/operators/lookup?${query}`,
    roles: '/api/admin/roles',
  },
} as const;
