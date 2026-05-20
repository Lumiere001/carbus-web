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
}: React.HTMLAttributes<HTMLDivElement> & {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-xl shadow-1",
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border">
          <div>
            {title && (
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
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
