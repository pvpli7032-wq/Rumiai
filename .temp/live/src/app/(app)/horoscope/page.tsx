'use client';
import { zhText } from '@/lib/zh-text';

import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';

const SIGNS = [
  { id: 'aries', thaiName: zhText("เมษ"), emoji: '♈', dates: zhText("21 มี.ค. – 19 เม.ย.") },
  { id: 'taurus', thaiName: zhText("พฤษภ"), emoji: '♉', dates: zhText("20 เม.ย. – 20 พ.ค.") },
  { id: 'gemini', thaiName: zhText("เมถุน"), emoji: '♊', dates: zhText("21 พ.ค. – 20 มิ.ย.") },
  { id: 'cancer', thaiName: zhText("กรกฎ"), emoji: '♋', dates: zhText("21 มิ.ย. – 22 ก.ค.") },
  { id: 'leo', thaiName: zhText("สิงห์"), emoji: '♌', dates: zhText("23 ก.ค. – 22 ส.ค.") },
  { id: 'virgo', thaiName: zhText("กันย์"), emoji: '♍', dates: zhText("23 ส.ค. – 22 ก.ย.") },
  { id: 'libra', thaiName: zhText("ตุลย์"), emoji: '♎', dates: zhText("23 ก.ย. – 22 ต.ค.") },
  { id: 'scorpio', thaiName: zhText("พิจิก"), emoji: '♏', dates: zhText("23 ต.ค. – 21 พ.ย.") },
  { id: 'sagittarius', thaiName: zhText("ธนู"), emoji: '♐', dates: zhText("22 พ.ย. – 21 ธ.ค.") },
  { id: 'capricorn', thaiName: zhText("มังกร"), emoji: '♑', dates: zhText("22 ธ.ค. – 19 ม.ค.") },
  { id: 'aquarius', thaiName: zhText("กุมภ์"), emoji: '♒', dates: zhText("20 ม.ค. – 18 ก.พ.") },
  { id: 'pisces', thaiName: zhText("มีน"), emoji: '♓', dates: zhText("19 ก.พ. – 20 มี.ค.") },
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
          <h1 className="text-3xl font-bold font-athiti text-white mb-2">{zhText("ดวงชะตาประจำวัน")}</h1>
          <p className="text-zinc-400 font-athiti">{zhText("เลือกราศีของคุณเพื่อดูดวงวันนี้")}</p>
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
              <p className="text-xs font-semibold font-athiti text-white">{sign.thaiName}</p>
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
                <h2 className="text-xl font-bold font-athiti text-white">{data.title}</h2>
                <p className="text-zinc-400 text-sm font-athiti">{SIGNS.find(s => s.id === selected)?.dates}</p>
              </div>
            </div>

            <p className="text-zinc-200 font-athiti leading-relaxed mb-6">{data.description}</p>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-500 font-athiti mb-1">{zhText("เลขมงคล")}</p>
                <p className="text-2xl font-bold text-yellow-400">{data.luckyNumber}</p>
              </div>
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-500 font-athiti mb-1">{zhText("สีมงคล")}</p>
                <p className="text-sm font-bold text-purple-400 font-athiti">{data.luckyColor}</p>
              </div>
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-500 font-athiti mb-1">{zhText("เข้ากันได้กับ")}</p>
                <p className="text-xs font-bold text-pink-400 font-athiti">{data.compatibility}</p>
              </div>
            </div>

            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
              <p className="text-xs text-violet-400 font-athiti mb-1">{zhText("คำแนะนำวันนี้ 💫")}</p>
              <p className="text-zinc-200 font-athiti text-sm">{data.advice}</p>
            </div>
          </div>
        )}

        {!loading && !data && (
          <div className="text-center py-10 text-zinc-500 font-athiti">
            <p>{zhText("เลือกราศีของคุณด้านบนเพื่อดูดวง ⭐")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
