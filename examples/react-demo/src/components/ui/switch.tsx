import * as SwitchPrimitives from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cn } from "@/lib/utils";

export const Switch = forwardRef<
  ComponentRef<typeof SwitchPrimitives.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-[#d9cbb6] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4552a] data-[state=checked]:border-[#c4552a] data-[state=checked]:bg-[#c4552a] data-[state=unchecked]:bg-[#f6efe4]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb className="pointer-events-none block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5" />
  </SwitchPrimitives.Root>
));
Switch.displayName = "Switch";
