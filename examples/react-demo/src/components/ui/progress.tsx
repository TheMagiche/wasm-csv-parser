import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const width = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className={cn("h-2 overflow-hidden rounded-full bg-[#eadfce]", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <div className="h-full rounded-full bg-[#c4552a] transition-[width] duration-150" style={{ width: `${width}%` }} />
    </div>
  );
}
