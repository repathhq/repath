# Repath Landing Page — Design Strategy

## Design Philosophy: Technical Minimalism with Precision

**Chosen Approach:** Modern technical precision for senior engineers. This design prioritizes clarity, credibility, and technical depth over marketing fluff.

### Design Movement
**Neo-Brutalism meets Technical Elegance** — inspired by Vercel, Stripe, and PlanetScale. Raw, honest design with meticulous attention to detail. Dark, high-contrast, code-first aesthetic.

### Core Principles
1. **Technical Credibility** — Every visual element serves information architecture. No decorative flourishes. Code snippets, diagrams, and real data are the heroes.
2. **Precision Over Ornamentation** — Tight spacing, monospace typography for technical content, exact color values. Feels engineered, not designed.
3. **Dark-First, High-Contrast** — #0a0a0b background with violet (#7c3aed) accents. Reduces cognitive load, emphasizes technical content.
4. **Asymmetric Layouts** — Avoid centered grids. Use alternating left-right feature rows, offset diagrams, and intentional negative space.

### Color Philosophy
- **Background:** #0a0a0b (near-black, reduces eye strain for engineers)
- **Accent:** #7c3aed (violet-600, energetic but not distracting)
- **Text:** Muted grays for body, bright white for emphasis
- **Functional Colors:** Red for errors/rollback, green for success, amber for warnings
- **Reasoning:** Dark theme signals "production-grade." Violet accent is technical, not trendy. High contrast ensures readability at any viewing angle.

### Layout Paradigm
- **Hero:** Full-viewport, centered content with asymmetric accent bar (pill badge top-left)
- **Problem Section:** Three-column incident cards with left red accent borders (not generic feature cards)
- **Architecture:** Large horizontal flow diagram (custom SVG, not flowchart tool export)
- **Features:** Alternating left-right rows with code snippets and mini visualizations
- **Comparison Table:** Dark surface with violet left border on Repath column
- **Quick Start:** Horizontal stepper with terminal blocks
- **Open Source:** Full-width violet gradient section (5% opacity)

### Signature Elements
1. **Monospace Code Blocks** — Dark surfaces (#111113), syntax highlighting, copy buttons. Code is content.
2. **Accent Borders** — Left-side colored borders on cards (red for problems, violet for highlights). Breaks monotony without clutter.
3. **Minimal Icons** — Lucide React icons only, no emoji, no illustrations. Icons are functional, not decorative.

### Interaction Philosophy
- **Smooth Transitions** — 200-300ms ease-out on hover, scale transforms on button press
- **Micro-interactions** — Copy button feedback, terminal block animations, traffic bar animations
- **No Heavy Libraries** — CSS-only animations, Framer Motion for complex sequences
- **Keyboard Navigation** — All CTAs keyboard-accessible, focus rings visible

### Animation Guidelines
- **Button Hover:** Subtle scale (1.02x) + color shift, 200ms ease-out
- **Button Press:** Scale down (0.97x), 100ms ease-out, confirms interaction
- **Terminal Blocks:** Fade-in on scroll, copy button toast feedback
- **Traffic Bar:** Smooth width transitions (300ms) when weight changes
- **Quality Graph:** Line animation on scroll, data points fade in sequentially
- **Entrance Animations:** Stagger text reveals by 30-50ms per line, fade-in from opacity 0
- **Respect prefers-reduced-motion:** All animations gated behind media query

### Typography System
- **H1 (Hero):** 56px, 700 weight, -0.02em letter-spacing, Inter
- **H2 (Section Titles):** 36px, 600 weight, -0.01em letter-spacing, Inter
- **H3 (Card Titles):** 24px, 600 weight, Inter
- **Body:** 16px, 400 weight, 1.6 line-height, Inter
- **Code:** 13px, JetBrains Mono or Fira Code, monospace
- **Labels:** 12px, 500 weight, 0.05em letter-spacing, uppercase, Inter
- **Hierarchy:** Weight variation over size variation. H1 bold + H2 semi-bold creates visual structure without size jumps.

### Brand Essence
**Positioning:** The production-grade quality gate for AI deployments. For senior engineers who refuse to ship blind.

**Personality Adjectives:** Technical. Reliable. Uncompromising.

**Brand Voice:**
- Headlines: Direct, active, technical. "Ship AI changes without the guesswork." Not "Welcome to Repath."
- CTAs: Action-oriented, specific. "Get Started" not "Learn More." "View on GitHub" not "Explore."
- Microcopy: Honest about trade-offs. "Feature flags check if code deployed. Repath checks if it actually worked."
- Tone: Confident but not arrogant. Assume the reader is a senior engineer who knows what they're doing.

**Example Lines:**
1. "Repath sits between your app and OpenAI. It splits traffic, scores responses with an LLM judge, and rolls back automatically when quality drops — before your users notice."
2. "A June 2023 Stanford study found GPT-4's accuracy on a coding task dropped from 97.6% to 2.4% in one month — with zero API errors. Nobody noticed."

### Logo & Wordmark
**Concept:** A bold, geometric symbol representing "rerouting" or "pathfinding." A forward-facing arrow or circuit-like path, violet on transparent background. No text in the mark itself. Wordmark is Inter 700 in white.

### Signature Brand Color
**Violet-600 (#7c3aed)** — Unmistakably Repath. Used for:
- Primary CTAs
- Section accent borders
- Hover states
- Gradient backgrounds (at 5% opacity)
- Code syntax highlighting (for keywords/functions)

---

## Implementation Checklist
- [ ] Set Inter font + JetBrains Mono via Google Fonts
- [ ] Configure Tailwind theme: dark mode, violet accent, #0a0a0b background
- [ ] Build Navigation component (sticky, blurred background)
- [ ] Build Hero section with pill badge, H1, subhead, CTAs, terminal block
- [ ] Build Problem section with incident cards (red left borders)
- [ ] Build Architecture diagram (custom SVG, horizontal flow)
- [ ] Build Features section (alternating left-right rows)
- [ ] Build Comparison table (dark surface, violet left border on Repath)
- [ ] Build Quick Start stepper (terminal blocks with copy buttons)
- [ ] Build Open Source callout (violet gradient background)
- [ ] Build Footer (4-column layout)
- [ ] Add animations (scroll-triggered, entrance, hover states)
- [ ] Test responsive design (mobile, tablet, desktop)
- [ ] Accessibility audit (contrast, keyboard nav, focus rings)
