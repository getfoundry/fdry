import * as React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement> & { variant?: string };

export const Alert = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", variant, ...props }, ref) => (
    <div ref={ref} role="alert" data-variant={variant} className={`alert ${className}`} {...props} />
  ),
);
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} className={`alert-title ${className}`} {...props} />
  ),
);
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} className={`alert-desc ${className}`} {...props} />
  ),
);
AlertDescription.displayName = "AlertDescription";
