import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const EMPTY_SENTINEL = "__CIRCLE_EMPTY__"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const UNIFIED_DROPDOWN_TRIGGER_CLASS =
  "group inline-flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-xl border border-border bg-surface2/75 px-3.5 py-0 text-xs sm:text-sm font-semibold leading-normal text-ink shadow-xs transition-colors duration-100 ease-out hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:cursor-not-allowed disabled:opacity-50 [&>span]:inline-flex [&>span]:items-center [&>span]:truncate [&>span]:leading-normal cursor-pointer"

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      UNIFIED_DROPDOWN_TRIGGER_CLASS,
      className
    )}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 text-sub opacity-75 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-180" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("hidden", className)}
    {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("hidden", className)}
    {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef(({ className, children, position = "popper", sideOffset = 6, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "pointer-events-auto relative z-[300] min-w-[10rem] overflow-hidden rounded-2xl border border-border bg-surface text-ink shadow-xl shadow-slate-900/12 dark:shadow-black/45 animate-popover-enter",
        className
      )}
      position={position}
      {...props}>
      <SelectPrimitive.Viewport
        className={cn(
          "max-h-80 overflow-y-auto overflow-x-hidden overscroll-contain p-1.5 space-y-0.5",
          position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]"
        )}>
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sub", className)}
    {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef(({ className, children, onPointerMove, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    onPointerMove={(e) => {
      onPointerMove?.(e);
      if (e.defaultPrevented) return;
      if (document.activeElement !== e.currentTarget) {
        e.currentTarget.focus({ preventScroll: true });
      }
    }}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-xl py-2 pl-3 pr-8 text-xs sm:text-sm font-medium outline-none border border-transparent transition-colors duration-75 ease-out text-ink",
      "hover:bg-surface2 data-[highlighted]:bg-surface2 data-[highlighted]:text-ink",
      "data-[state=checked]:bg-brand/10 data-[state=checked]:text-brand data-[state=checked]:font-semibold data-[state=checked]:hover:bg-brand/15 data-[state=checked]:data-[highlighted]:bg-brand/15 data-[state=checked]:data-[highlighted]:text-brand",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute right-2.5 flex h-4 w-4 items-center justify-center pointer-events-none">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-brand" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

function extractText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) return extractText(node.props?.children);
  return "";
}

function normalizeOptionItem(item) {
  if (item == null) return null;
  if (typeof item === "string" || typeof item === "number") {
    const s = String(item);
    return { value: s, label: s };
  }
  if (Array.isArray(item)) {
    return { value: String(item[0] ?? ""), label: String(item[1] ?? item[0] ?? "") };
  }
  return {
    value: item.value !== undefined && item.value !== null ? String(item.value) : "",
    label: item.label !== undefined ? String(item.label) : String(item.value ?? ""),
    disabled: Boolean(item.disabled),
    color: item.color,
  };
}

function parseChildrenToEntries(children) {
  const entries = [];
  React.Children.forEach(children, (child) => {
    if (!child) return;
    if (Array.isArray(child)) {
      entries.push(...parseChildrenToEntries(child));
      return;
    }
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      entries.push(...parseChildrenToEntries(child.props?.children));
      return;
    }
    if (child.type === "optgroup") {
      const groupItems = parseChildrenToEntries(child.props?.children).filter((e) => e.kind === "item");
      entries.push({
        kind: "group",
        label: child.props?.label || "",
        items: groupItems,
      });
      return;
    }
    if (child.type === "option") {
      const text = extractText(child.props?.children);
      const val = child.props?.value !== undefined ? String(child.props.value) : text;
      entries.push({
        kind: "item",
        value: val,
        label: text || val,
        disabled: Boolean(child.props?.disabled),
      });
    }
  });
  return entries;
}

const AppSelect = React.forwardRef(
  (
    {
      value,
      defaultValue,
      onChange,
      onValueChange,
      options,
      groups,
      children,
      className,
      contentClassName,
      placeholder,
      disabled,
      style,
      align = "start",
      sideOffset = 6,
      id,
      name,
      "data-testid": testId,
      title,
      "aria-label": ariaLabel,
    },
    ref
  ) => {
    const rawEntries = React.useMemo(() => {
      if (Array.isArray(groups) && groups.length > 0) {
        return groups.map((g) => ({
          kind: "group",
          label: g.label || "",
          items: (g.options || []).map(normalizeOptionItem).filter(Boolean).map((it) => ({ kind: "item", ...it })),
        }));
      }
      if (Array.isArray(options) && options.length > 0) {
        return options.map(normalizeOptionItem).filter(Boolean).map((it) => ({ kind: "item", ...it }));
      }
      return parseChildrenToEntries(children);
    }, [groups, options, children]);

    const encode = (v) => (v === "" || v === undefined || v === null ? EMPTY_SENTINEL : String(v));
    const decode = (v) => (v === EMPTY_SENTINEL ? "" : v);

    const entries = React.useMemo(() => {
      const seen = new Set();
      const deduped = [];
      for (const entry of rawEntries) {
        if (entry.kind === "group") {
          const items = [];
          for (const it of entry.items || []) {
            const code = encode(it.value);
            if (seen.has(code)) continue;
            seen.add(code);
            items.push(it);
          }
          if (items.length > 0) {
            deduped.push({ ...entry, items });
          }
        } else {
          const code = encode(entry.value);
          if (seen.has(code)) continue;
          seen.add(code);
          deduped.push(entry);
        }
      }
      return deduped;
    }, [rawEntries]);

    const isControlled = value !== undefined;
    const mappedValue = isControlled ? encode(value === null ? "" : value) : undefined;
    const mappedDefault = defaultValue !== undefined ? encode(defaultValue === null ? "" : defaultValue) : undefined;

    const handleValChange = (rawNext) => {
      const actual = decode(rawNext);
      if (onValueChange) onValueChange(actual);
      if (onChange) onChange({ target: { value: actual, name, id } });
    };

    const renderItem = (item, idx) => {
      const encoded = encode(item.value);
      return (
        <SelectItem key={`${encoded}_${idx}`} value={encoded} disabled={item.disabled}>
          <span className="inline-flex items-center gap-2 min-w-0 leading-normal">
            {item.color && (
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span className="truncate leading-normal">{item.label}</span>
          </span>
        </SelectItem>
      );
    };

    const cleanClassName = (className || "").replace(/\btruncate\b/g, "").trim();

    return (
      <Select
        value={mappedValue}
        defaultValue={mappedDefault}
        onValueChange={handleValChange}
        disabled={disabled}
        name={name}
      >
        <SelectTrigger
          ref={ref}
          id={id}
          title={title}
          aria-label={ariaLabel}
          data-testid={testId}
          style={style}
          className={cn(!/(?:^|[\s:])w-/.test(cleanClassName) && "w-auto", cleanClassName)}
        >
          <SelectValue placeholder={placeholder || "Pilih..."} />
        </SelectTrigger>
        <SelectContent align={align} sideOffset={sideOffset} className={contentClassName}>
          {entries.map((entry, idx) => {
            if (entry.kind === "group") {
              return (
                <React.Fragment key={`grp_${entry.label}_${idx}`}>
                  {idx > 0 && <SelectSeparator />}
                  <SelectGroup>
                    {entry.label && <SelectLabel>{entry.label}</SelectLabel>}
                    {entry.items.map((it, i2) => renderItem(it, `${idx}_${i2}`))}
                  </SelectGroup>
                </React.Fragment>
              );
            }
            return renderItem(entry, idx);
          })}
        </SelectContent>
      </Select>
    );
  }
)
AppSelect.displayName = "AppSelect"

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
  AppSelect,
}
