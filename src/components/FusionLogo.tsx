import { cn } from "@/lib/utils";

export function FusionLogo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden="true">
        <defs>
          <linearGradient id="fusion-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1565C0" />
            <stop offset="100%" stopColor="#0D47A1" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#fusion-g)" strokeWidth="3.5" strokeLinejoin="round">
          <rect x="6" y="12" width="20" height="20" transform="rotate(45 16 22)" />
          <rect x="22" y="12" width="20" height="20" transform="rotate(45 32 22)" />
        </g>
      </svg>
      {showText && (
        <div className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-extrabold tracking-tight text-foreground">FUSION</span>
          <span className="text-[9px] font-semibold tracking-[0.25em] text-muted-foreground">LOGÍSTICA</span>
        </div>
      )}
    </div>
  );
}
