import * as React from "react";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & { variant?: string };

export function Badge({ className = "", variant, ...props }: BadgeProps) {
  return <span data-variant={variant} className={`badge ${className}`} {...props} />;
}
