import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/10 text-primary",
        secondary: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        verified: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300",
        pending: "border-amber-300/20 bg-amber-300/[0.08] text-amber-200",
        risk: "border-rose-300/20 bg-rose-400/[0.08] text-rose-200",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
