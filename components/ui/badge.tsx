import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * 상태 Badge (carbus-design-system 시안 §1.5).
 * 납부상태·배차상태·학번 특수값 등 모든 상태 표현을 이 컴포넌트로 통일.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        success: "bg-success-bg text-success ring-success-border",
        warning: "bg-warning-bg text-warning ring-warning-border",
        danger: "bg-danger-bg text-danger ring-danger-border",
        mute: "bg-surface-2 text-muted ring-border-2",
        primary: "bg-primary-50 text-primary-800 ring-primary-200",
      },
    },
    defaultVariants: { variant: "mute" },
  }
);

const dotColor: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  mute: "bg-muted",
  primary: "bg-primary-800",
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({
  className,
  variant = "mute",
  dot = true,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            dotColor[variant ?? "mute"]
          )}
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };
