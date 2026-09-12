import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col justify-between gap-4 lg:flex-row lg:items-end", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#55705c]">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[#14231a] sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-[65ch] text-sm leading-6 text-zinc-600">{description}</p>}
      </div>
      {(meta || action) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 lg:justify-end">
          {meta && <div className="text-xs text-zinc-500">{meta}</div>}
          {action}
        </div>
      )}
    </header>
  );
}
