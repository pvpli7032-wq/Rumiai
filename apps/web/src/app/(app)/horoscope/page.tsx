'use client';

import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';

const SIGNS = [
  { id: 'aries', thaiName: "白羊座", emoji: '♈', dates: "3月21日–4月19日" },
  { id: 'taurus', thaiName: "金牛座", emoji: '♉', dates: "4月20日–5月20日" },
  { id: 'gemini', thaiName: "双子座", emoji: '♊', dates: "5月21日–6月20日" },
  { id: 'cancer', thaiName: "巨蟹座", emoji: '♋', dates: "6月21日–7月22日" },
  { id: 'leo', thaiName: "狮子座", emoji: '♌', dates: "7月23日–8月22日" },
  { id: 'virgo', thaiName: "处女座", emoji: '♍', dates: "8月23日–9月22日" },
  { id: 'libra', thaiName: "天秤座", emoji: '♎', dates: "9月23日–10月22日" },
  { id: 'scorpio', thaiName: "天蝎座", emoji: '♏', dates: "10月23日–11月21日" },
  { id: 'sagittarius', thaiName: "射手座", emoji: '♐', dates: "11月22日–12月21日" },
  { id: 'capricorn', thaiName: "摩羯座", emoji: '♑', dates: "12月22日–1月19日" },
  { id: 'aquarius', thaiName: "水瓶座", emoji: '♒', dates: "1月20日–2月18日" },
  { id: 'pisces', thaiName: "双鱼座", emoji: '♓', dates: "2月19日–3月20日" },
];

interface HoroscopeData { sign: string; thaiName: string; title: string; description: string; luckyNumber: number; luckyColor: string; compatibility: string; advice: string; }

export default function HoroscopePage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<HoroscopeData | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchHoroscope(sign: string) {
    setSelected(sign);
    setLoading(true);
    const res = await fetch(`/api/horoscope/${sign}`);
    const result = await res.json();
    setData(result);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-full bg-linear-to-br/srgb from-violet-500 to-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-violet-500/30">
            <Star className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{"每日星座小签"}</h1>
          <p className="text-zinc-400">{"选择星座，查看今日小签（娱乐内容）"}</p>
        </div>

        {/* Zodiac Grid */}
        <div className="grid grid-cols-4 md:grid-cols-6 gap-3 mb-8">
          {SIGNS.map(sign => (
            <button key={sign.id} onClick={() => fetchHoroscope(sign.id)}
              className={`p-3 rounded-2xl border transition-all hover:scale-105 text-center ${
                selected === sign.id
                  ? 'bg-violet-500/20 border-violet-500/50 shadow-lg shadow-violet-500/20'
                  : 'bg-zinc-900 border-white/10 hover:border-white/20'
              }`}>
              <div className="text-2xl mb-1">{sign.emoji}</div>
              <p className="text-xs font-semibold text-white">{sign.thaiName}</p>
            </button>
          ))}
        </div>

        {/* Horoscope Result */}
        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
          </div>
        )}

        {!loading && data && (
          <div className="bg-zinc-900 border border-violet-500/20 rounded-2xl p-6 shadow-xl shadow-violet-500/10">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-4xl">{SIGNS.find(s => s.id === selected)?.emoji}</div>
              <div>
                <h2 className="text-xl font-bold text-white">{data.title}</h2>
                <p className="text-zinc-400 text-sm">{SIGNS.find(s => s.id === selected)?.dates}</p>
              </div>
            </div>

            <p className="text-zinc-200 leading-relaxed mb-6">{data.description}</p>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">{"幸运数字"}</p>
                <p className="text-2xl font-bold text-yellow-400">{data.luckyNumber}</p>
              </div>
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">{"幸运颜色"}</p>
                <p className="text-sm font-bold text-purple-400">{data.luckyColor}</p>
              </div>
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">{"适合的星座"}</p>
                <p className="text-xs font-bold text-pink-400">{data.compatibility}</p>
              </div>
            </div>

            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
              <p className="text-xs text-violet-400 mb-1">{"今日建议 💫"}</p>
              <p className="text-zinc-200 text-sm">{data.advice}</p>
            </div>
          </div>
        )}

        {!loading && !data && (
          <div className="text-center py-10 text-zinc-500">
            <p>{"选择上方星座 ⭐"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
