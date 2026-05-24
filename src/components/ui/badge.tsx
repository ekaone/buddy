import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium leading-none ring-1 ring-inset",
  {
    variants: {
      variant: {
        idle: "bg-white/10 text-white/60 ring-white/10",
        capturing: "bg-blue-500/20 text-blue-300 ring-blue-500/30",
        thinking: "bg-violet-500/20 text-violet-300 ring-violet-500/30",
        speaking: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30",
        error: "bg-red-500/20 text-red-300 ring-red-500/30",
      },
    },
    defaultVariants: { variant: "idle" },
  },
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string;
  children: React.ReactNode;
}

export function Badge({ className, variant, children }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {children}
    </span>
  );
}
