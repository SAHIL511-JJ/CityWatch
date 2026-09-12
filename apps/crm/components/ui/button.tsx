import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 active:translate-y-px focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
