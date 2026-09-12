import * as React from "react";
import { cn } from "@/lib/utils";

export function FeedbackPanel({
  variant = "empty",
  title,
  description,
  action,
  className,
}: {
  variant?: "empty" | "error";
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      role={variant === "error" ? "alert" : undefined}
      className={cn(
        "rounded-xl border p-6 text-center",
        variant === "error" ? "border-red-200 bg-red-50" : "border-zinc-200 bg-white",
        className
      )}
    >
      <h2 className={cn("text-sm font-semibold", variant === "error" ? "text-red-900" : "text-zinc-900")}>{title}</h2>
      <p className={cn("mx-auto mt-1 max-w-[58ch] text-sm leading-6", variant === "error" ? "text-red-700" : "text-zinc-500")}>{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </section>
  );
}
