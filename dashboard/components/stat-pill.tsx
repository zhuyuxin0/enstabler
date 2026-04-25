import { cn } from "@/lib/cn";

type Props = {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "signal" | "alert";
  className?: string;
};

export function StatPill({ label, value, tone = "default", className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border px-4 py-3 min-w-[148px]",
        "border-line backdrop-blur-sm bg-foreground/[0.015]",
        tone === "signal" && "border-signal/40",
        tone === "alert" && "border-alert/40",
        className,
      )}
    >
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-2xl tabular-nums leading-none",
          tone === "signal" && "text-signal",
          tone === "alert" && "text-alert",
        )}
      >
        {value}
      </span>
    </div>
  );
}
