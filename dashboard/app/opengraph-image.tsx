import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The card shown when a Repath link is shared (LinkedIn, X, Slack). Every
// page inherits it. Colours are the landing page's dark tokens in hex, since
// the image renderer does not read oklch.

export const alt = "Repath — every prompt change ships behind a quality gate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/repath-mark.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#07070a",
          backgroundImage:
            "radial-gradient(circle at 85% 0%, rgba(80, 200, 220, 0.22), transparent 55%), radial-gradient(circle at 10% 110%, rgba(130, 110, 240, 0.18), transparent 50%)",
          color: "#f4f4f6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img src={logoSrc} width={52} height={52} alt="" />
          <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em" }}>Repath</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 76, fontWeight: 600, lineHeight: 1.04, letterSpacing: "-0.04em", maxWidth: 980 }}>
            <span>Every prompt change ships behind a&nbsp;</span>
            <span
              style={{
                backgroundImage: "linear-gradient(100deg, #9ee6ee, #4fcfdc 45%, #8b7cf6)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              quality gate.
            </span>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#a1a1aa", lineHeight: 1.4, maxWidth: 940 }}>
            Canary rollouts for prompts and models — judged on real traffic, rolled back automatically.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#a1a1aa" }}>
          <span style={{ display: "flex", padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(74, 222, 128, 0.35)", color: "#4ade80" }}>
            advance ≥ 0.90
          </span>
          <span style={{ display: "flex", padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(255, 138, 122, 0.35)", color: "#ff8a7a" }}>
            rollback &lt; 0.70
          </span>
          <span style={{ display: "flex", marginLeft: "auto" }}>tryrepath.com</span>
        </div>
      </div>
    ),
    size,
  );
}
