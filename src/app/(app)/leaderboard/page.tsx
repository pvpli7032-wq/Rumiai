'use client';

import { useEffect, useState } from 'react';
import { Trophy, Medal, Star, Loader2, Gift } from 'lucide-react';

interface LeaderEntry { rank: number; characterId: string; name: string; avatarUrl?: string | null; giftAmount: number; giftCount: number; }

const RANK_ICONS = [
  <Trophy key="1" className="w-5 h-5 text-yellow-400" />,
  <Medal key="2" className="w-5 h-5 text-zinc-300" />,
  <Medal key="3" className="w-5 h-5 text-amber-600" />,
];

const CHAR_EMOJIS = ['🌸', '⚡', '🔮', '🌙', '✨', '💫', '🦋', '🌺', '🐉', '🦊'];

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/leaderboard/gifts')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setEntries(data); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-full bg-linear-to-br/srgb from-yellow-500 to-amber-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-yellow-500/30">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold font-athiti text-white mb-2">{"角色榜单"}</h1>
          <p className="text-zinc-400 font-athiti">{"收到礼物最多的角色"}</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-yellow-400 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20">
            <Gift className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 font-athiti">{"暂无榜单数据"}</p>
            <p className="text-zinc-600 font-athiti text-sm mt-1">{"给喜欢的角色送礼物"}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, i) => (
              <div key={entry.characterId}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  i === 0 ? 'bg-yellow-500/10 border-yellow-500/30 shadow-lg shadow-yellow-500/10' :
                  i === 1 ? 'bg-zinc-500/10 border-zinc-500/30' :
                  i === 2 ? 'bg-amber-600/10 border-amber-600/30' :
                  'bg-zinc-900 border-white/10 hover:border-white/20'
                }`}>
                <div className="w-8 text-center shrink-0">
                  {i < 3 ? RANK_ICONS[i] : <span className="text-zinc-500 font-bold text-sm">#{entry.rank}</span>}
                </div>
                <div className="w-10 h-10 rounded-full bg-linear-to-br/srgb from-purple-500 to-pink-500 flex items-center justify-center text-xl shrink-0 shadow-sm">
                  {CHAR_EMOJIS[i % CHAR_EMOJIS.length]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold font-athiti text-white truncate">{entry.name}</p>
                  <p className="text-xs text-zinc-500 font-athiti">{entry.giftCount} {"次"}</p>
                </div>
                <div className="flex items-center gap-1 text-yellow-400 shrink-0">
                  <Gift className="w-4 h-4" />
                  <span className="font-bold text-sm">{entry.giftAmount.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {entries.length > 0 && (
          <div className="mt-8 p-4 bg-zinc-900 border border-white/10 rounded-2xl text-center">
            <p className="text-zinc-400 font-athiti text-sm">{"支持喜欢的原创角色"}</p>
            <p className="text-zinc-500 font-athiti text-xs mt-1">{"在角色详情中点击礼物按钮"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
