import * as React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export const Card = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} className={`card ${className}`} {...props} />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} className={`card-header ${className}`} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} className={`card-title ${className}`} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} className={`card-desc ${className}`} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} className={`card-content ${className}`} {...props} />
  ),
);
CardContent.displayName = "CardContent";
