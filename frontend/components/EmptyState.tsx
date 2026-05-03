import { ReactNode } from "react";

export default function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
      <p className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.62)" }}>
        {title}
      </p>
      {detail && (
        <p className="max-w-[260px] text-[11.5px] leading-relaxed" style={{ color: "rgba(255,255,255,0.32)" }}>
          {detail}
        </p>
      )}
      {children}
    </div>
  );
}
