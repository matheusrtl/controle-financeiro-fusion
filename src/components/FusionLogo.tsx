import { cn } from "@/lib/utils";
import logoAsset from "@/assets/fusion-logo.png.asset.json";

export function FusionLogo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={cn("inline-flex items-center", className)}>
      <img
        src={logoAsset.url}
        alt="Fusion Logística"
        className={cn(
          "object-contain select-none",
          showText ? "h-9 sm:h-10 w-auto" : "h-8 w-8",
        )}
        draggable={false}
      />
    </div>
  );
}
