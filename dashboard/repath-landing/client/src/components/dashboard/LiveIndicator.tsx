interface LiveIndicatorProps {
  active: boolean;
}

export function LiveIndicator({ active }: LiveIndicatorProps) {
  if (!active) return null;

  return (
    <div className="live-indicator">
      <div className="live-dot" />
      <span>Live</span>
    </div>
  );
}
