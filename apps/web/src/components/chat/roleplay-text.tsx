'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { parseRoleplay, type Node } from '@web/lib/rp-markup';

/**
 * Renders a message's roleplay markup. Narration and dialogue are the two forms the
 * characters actually write in, and the chat used to print the raw asterisks.
 *
 * Inner thoughts render collapsed: they are the character's private read on the scene, so
 * showing them inline would give away what the prose is holding back.
 */
export function RoleplayText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const nodes = parseRoleplay(text);

  return (
    <span className="text-sm leading-relaxed">
      {nodes.map((node, i) => (
        <Piece key={i} node={node} />
      ))}
      {streaming && <span className="animate-pulse">▍</span>}
    </span>
  );
}

function Piece({ node }: { node: Node }) {
  switch (node.type) {
    case 'narration':
      return <em className="text-zinc-400">{node.value}</em>;
    case 'speech':
      return <span className="text-zinc-50">“{node.value}”</span>;
    case 'gradient':
      return (
        <span className="bg-linear-to-r/srgb from-brand-2 to-brand bg-clip-text font-semibold text-transparent">
          {node.value}
        </span>
      );
    case 'underline':
      return <span className="underline decoration-brand-strong/60 underline-offset-2">{node.value}</span>;
    case 'thought':
      return <Thought value={node.value} />;
    default:
      return <span className="whitespace-pre-wrap">{node.value}</span>;
  }
}

function Thought({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="my-1 block">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full bg-zinc-700/60 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
      >
        <span aria-hidden="true">💭</span>
        {open ? "隐藏内心想法" : "内心想法"}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <span className="mt-1 block border-l-2 border-zinc-600 pl-2 text-xs italic text-zinc-400">
          {value}
        </span>
      )}
    </span>
  );
}
