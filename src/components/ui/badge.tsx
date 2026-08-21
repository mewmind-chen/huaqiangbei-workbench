import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        outline: "border-line bg-surface-2 text-muted",
        pending: "border-danger/20 bg-danger/10 text-danger",
        progress: "border-wait/20 bg-wait/10 text-wait",
        done: "border-ok/20 bg-ok/10 text-ok",
        urgent: "border-danger/30 bg-danger/15 text-danger",
        important: "border-wait/30 bg-wait/10 text-wait",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
