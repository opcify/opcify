interface AgentBadgeProps {
  name: string;
  size?: "sm" | "md";
}

export function AgentBadge({ name, size = "sm" }: AgentBadgeProps) {
  const isMd = size === "md";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-zinc-500`}
    >
      <span
        className={`flex items-center justify-center rounded-full bg-zinc-800 font-medium text-zinc-500 ${
          isMd ? "h-5 w-5 text-[10px]" : "h-4 w-4 text-[9px]"
        }`}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="max-w-[120px] truncate">{name}</span>
    </span>
  );
}
