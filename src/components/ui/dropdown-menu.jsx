import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium outline-none border border-transparent transition-colors duration-75 ease-out hover:bg-surface2 data-[highlighted]:bg-surface2 data-[highlighted]:text-ink data-[state=open]:bg-surface2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}>
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "pointer-events-auto z-[300] min-w-[9rem] overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface p-1.5 text-ink shadow-xl shadow-slate-900/10 dark:shadow-black/40 animate-popover-enter",
      className
    )}
    {...props} />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "pointer-events-auto z-[300] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[10rem] overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface p-1.5 text-ink shadow-xl shadow-slate-900/10 dark:shadow-black/40 space-y-0.5 animate-popover-enter",
        className
      )}
      {...props} />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef(({ className, inset, onPointerMove, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    onPointerMove={(e) => {
      onPointerMove?.(e);
      if (e.defaultPrevented) return;
      if (document.activeElement !== e.currentTarget) {
        e.currentTarget.focus({ preventScroll: true });
      }
    }}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium outline-none border border-transparent transition-colors duration-75 ease-out text-ink",
      "hover:bg-surface2 data-[highlighted]:bg-surface2 data-[highlighted]:text-ink",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props} />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef(({ className, children, checked, onPointerMove, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    onPointerMove={(e) => {
      onPointerMove?.(e);
      if (e.defaultPrevented) return;
      if (document.activeElement !== e.currentTarget) {
        e.currentTarget.focus({ preventScroll: true });
      }
    }}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-xl py-2 pl-8 pr-3 text-xs sm:text-sm font-medium outline-none border border-transparent transition-colors duration-75 ease-out hover:bg-surface2 data-[highlighted]:bg-surface2 data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}>
    <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center pointer-events-none">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-brand" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef(({ className, children, onPointerMove, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    onPointerMove={(e) => {
      onPointerMove?.(e);
      if (e.defaultPrevented) return;
      if (document.activeElement !== e.currentTarget) {
        e.currentTarget.focus({ preventScroll: true });
      }
    }}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-xl py-2 pl-8 pr-3 text-xs sm:text-sm font-medium outline-none border border-transparent transition-colors duration-75 ease-out hover:bg-surface2 data-[highlighted]:bg-surface2 data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center pointer-events-none">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-brand text-brand" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-sub", inset && "pl-8", className)}
    {...props} />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-slate-200/70 dark:bg-slate-800", className)}
    {...props} />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props} />
  );
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
