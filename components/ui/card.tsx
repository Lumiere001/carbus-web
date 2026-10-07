import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card (carbus-design-system 시안). 제목·부제·우상단 액션 옵션.
 */
export function Card({
  className,
  title,
  subtitle,
  action,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-lg",
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border">
          <div>
            {title && (
              <h3 className="text-xl font-normal tracking-tight text-foreground">{title}</h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
