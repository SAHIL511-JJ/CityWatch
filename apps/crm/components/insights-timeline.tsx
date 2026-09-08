"use client";

import { useEffect, useState } from "react";

export function InsightsTimeline({
  days,
  value,
  onChange,
  label = "Replay reporting",
}: {
  days: { date: string; count: number }[];
  value: string | null;
  onChange: (date: string | null) => void;
  label?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const lastDate = days.at(-1)?.date ?? null;
  const selected = value ?? lastDate;
  const selectedIndex = Math.max(0, days.findIndex((day) => day.date === selected));

  useEffect(() => {
    if (!playing || !days.length) return;
    const timer = window.setInterval(() => {
      const nextIndex = selectedIndex + 1;
      if (nextIndex >= days.length) {
        setPlaying(false);
        return;
      }
      onChange(days[nextIndex].date);
    }, 850);
    return () => window.clearInterval(timer);
  }, [days, onChange, playing, selectedIndex]);

  if (!days.length) return null;
  const format = (valueToFormat: string) => new Date(`${valueToFormat}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="border-t border-[#e4e9e2] bg-[#fbfcfa] px-4 py-4 lg:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#55705c]">{label}</p><p className="mt-1 text-sm font-semibold text-[#14231a]">{selected === lastDate ? "All reports through today" : `Reports through ${format(selected ?? "")}`}</p></div>
        <div className="flex items-center gap-2"><button type="button" aria-label="Previous day" onClick={() => onChange(days[Math.max(0, selectedIndex - 1)].date)} className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">←</button><button type="button" aria-pressed={playing} onClick={() => { if (selected === lastDate) onChange(days[0].date); setPlaying((current) => !current); }} className="rounded-md bg-[#14231a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">{playing ? "Pause" : "Play"}</button><button type="button" aria-label="Next day" onClick={() => onChange(days[Math.min(days.length - 1, selectedIndex + 1)].date)} className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">→</button></div>
      </div>
      <input aria-label="Replay reporting by day" type="range" min={0} max={days.length - 1} value={selectedIndex} onChange={(event) => { setPlaying(false); onChange(days[Number(event.target.value)].date); }} className="mt-4 h-1.5 w-full cursor-pointer accent-[#2a4a33]" />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-400"><span>{format(days[0].date)}</span><span>{format(lastDate ?? days[0].date)}</span></div>
    </div>
  );
}
