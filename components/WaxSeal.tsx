type Props = {
  size?: number;
  rotating?: boolean;
  className?: string;
};

export function WaxSeal({ size = 64, rotating = false, className = "" }: Props) {
  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full ${
        rotating ? "seal-rotating" : ""
      } ${className}`}
      style={{
        width: size,
        height: size,
        background: "var(--color-bordeaux)",
        boxShadow: "inset 0 -1px 3px rgba(0,0,0,0.16), inset 0 1px 2px rgba(255,255,255,0.06)",
      }}
      aria-hidden
    >
      <span
        className="font-display italic"
        style={{
          fontSize: size * 0.45,
          color: "var(--color-cream)",
          lineHeight: 1,
          transform: "translateY(-2%)",
          textShadow: "0 1px 0 rgba(0,0,0,0.12)",
        }}
      >
        D
      </span>
    </div>
  );
}
