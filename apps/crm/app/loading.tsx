function LoadingBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-200/70 motion-reduce:animate-none ${className}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={{ fontFamily: "Verdana, Geneva, sans-serif" }} aria-label="Loading page">
      <div className="space-y-2">
        <LoadingBlock className="h-3 w-28" />
        <LoadingBlock className="h-9 w-64" />
        <LoadingBlock className="h-4 w-[min(38rem,80%)]" />
      </div>
      <LoadingBlock className="h-24 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <LoadingBlock key={item} className="h-28" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <LoadingBlock className="h-72 lg:col-span-3" />
        <LoadingBlock className="h-72 lg:col-span-2" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2].map((item) => <LoadingBlock key={item} className="h-16" />)}
      </div>
    </div>
  );
}
