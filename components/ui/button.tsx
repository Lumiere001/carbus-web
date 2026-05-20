import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * 디자인 시스템 Button (carbus-design-system 시안 §1.4).
 * variant: default(primary)·secondary·ghost·danger·outline·link
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200",
  {
    variants: {
      variant: {
        default: "bg-primary-800 text-white shadow-sm hover:bg-primary-700",
        secondary:
          "bg-surface border border-border text-foreground hover:bg-surface-2 shadow-sm",
        ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
        danger:
          "bg-surface border border-danger-border text-danger hover:bg-danger-bg",
        outline: "border border-border-2 bg-transparent hover:bg-surface-2",
        link: "text-primary-800 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5 text-sm",
        sm: "h-7 px-2.5 text-xs gap-1",
        lg: "h-10 px-4 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
