export const styles = /* CSS */ `
  :root {
    color-scheme: light;
    --ink: #26333c;
    --muted: #52605f;
    --line: #d7d1c6;
    --accent: #874628;
    --peach: #efb397;
    --mint: #b9ead3;
    --mono: ui-monospace, 'SFMono-Regular', Consolas, monospace;
    --gutter: clamp(1.125rem, 3.8vw, 2.75rem);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  body {
    min-height: 100vh;
    margin: 0;
    display: flex;
    flex-direction: column;
    color: var(--ink);
    background: radial-gradient(ellipse at 0 0, #f8eadd, transparent 48rem), #f8f5ee;
    font: 1rem/1.5 system-ui, sans-serif;
  }

  a {
    color: inherit;
    text-underline-offset: 0.24em;
  }

  a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }

  .shell {
    width: min(74rem, calc(100% - var(--gutter) - var(--gutter)));
    margin-inline: auto;
  }

  .masthead,
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .masthead {
    padding-block: 1.25rem;
    border-bottom: 1px solid var(--line);
  }

  .brand,
  .masthead nav,
  .masthead nav a {
    display: flex;
    align-items: center;
  }

  .brand,
  .masthead nav a {
    min-height: 2.75rem;
    text-decoration: none;
  }

  .brand {
    gap: 0.55rem;
    font-size: 1.35rem;
    font-weight: 720;
    letter-spacing: -0.05em;
  }

  .brand svg {
    width: 2.25rem;
    padding: 0.32rem;
    border-radius: 0.7rem;
    background: var(--ink);
  }

  .masthead nav {
    gap: clamp(0.6rem, 2.4vw, 1.5rem);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .masthead nav a:hover,
  .masthead nav a[aria-current='page'] {
    text-decoration: underline;
  }

  .status-link {
    gap: 0.45rem;
  }

  .dot {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    border: 1px solid currentColor;
    border-radius: 50%;
  }

  main {
    flex: 1;
  }

  .hero {
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
    align-items: center;
    gap: clamp(1.75rem, 5vw, 4.5rem);
    padding-block: clamp(2.5rem, 7vw, 6.25rem);
  }

  .label {
    font: 600 0.72rem/1.5 var(--mono);
    letter-spacing: 0.11em;
    text-transform: uppercase;
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin: 0 0 1.25rem;
    color: var(--accent);
  }

  .eyebrow::before {
    width: 1.25rem;
    height: 1px;
    background: currentColor;
    content: '';
  }

  h1 {
    margin: 0;
    font: 400 clamp(3.15rem, 6.2vw, 5.85rem)/0.99 Georgia, serif;
    letter-spacing: -0.068em;
  }

  h1 em {
    display: block;
    color: var(--accent);
  }

  .lede {
    max-width: 39ch;
    margin: 1.45rem 0 0;
    color: var(--muted);
    font-size: clamp(1rem, 1.6vw, 1.16rem);
    line-height: 1.6;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin-top: 1.65rem;
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.9rem;
    min-height: 2.85rem;
    padding: 0.55rem 1rem;
    border: 1px solid var(--ink);
    border-radius: 0.65rem;
    color: #fffaf3;
    background: var(--ink);
    font-size: 0.9rem;
    font-weight: 650;
    text-decoration: none;
  }

  .button svg {
    width: 1.1rem;
    height: 1.1rem;
    flex: none;
    stroke: var(--peach);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .button:hover {
    background: #394b55;
    border-color: #394b55;
    text-decoration: underline;
  }

  .button.secondary {
    border-color: var(--line);
    color: var(--ink);
    background: transparent;
  }

  .button.secondary:hover {
    border-color: var(--ink);
  }

  .button.secondary svg {
    stroke: var(--accent);
  }

  .instrument {
    --panel-glow: #394a50;
    min-width: 0;
    margin: 0;
    padding: clamp(1rem, 2.3vw, 1.85rem);
    border: 1px solid #3c4a51;
    border-radius: 1.35rem;
    background:
      linear-gradient(#ffffff09 1px, transparent 1px) center / 24px 24px,
      linear-gradient(90deg, #ffffff09 1px, transparent 1px) center / 24px 24px,
      radial-gradient(ellipse at 40% 40%, var(--panel-glow), #1d282e 79%);
    color: #d7dfdc;
    box-shadow: 0 1.25rem 3rem #26333c24;
  }

  .instrument-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .instrument-meta > :last-child {
    text-align: right;
  }

  .instrument-meta:first-child {
    color: var(--peach);
  }

  figcaption {
    padding-top: 0.85rem;
    border-top: 1px solid #607077;
  }

  .artwork {
    display: block;
    width: 100%;
    height: auto;
  }

  .instrument.pulse {
    --panel-glow: #2d4944;
  }

  .signal {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--mint);
  }

  .signal .dot {
    background: currentColor;
    box-shadow: 0 0 0 0.23rem #b9ead327;
  }

  .detail-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 0;
    padding: 1.4rem 0;
    border-block: 1px solid var(--line);
    list-style: none;
  }

  .detail-strip > * + * {
    padding-left: clamp(0.85rem, 3vw, 2rem);
    border-left: 1px solid var(--line);
  }

  .detail-strip .label {
    color: var(--accent);
  }

  .detail-title {
    margin: 0.38rem 0 0;
    font-size: 1.05rem;
    font-weight: 680;
  }

  .detail-title code,
  .detail-title time {
    font: 600 0.95rem/1.4 var(--mono);
  }

  .detail-strip p {
    margin: 0.25rem 0 0;
    padding-right: 0.6rem;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .footer {
    margin-top: 1.5rem;
    padding-block: 1rem 1.5rem;
    color: var(--muted);
    font-size: 0.82rem;
  }

  @media (max-width: 48rem) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
    }

    .instrument {
      width: min(100%, 34rem);
    }
  }

  @media (max-width: 36rem) {
    .masthead {
      padding-block: 0.7rem;
    }

    .masthead nav,
    .instrument-meta {
      font-size: 0.7rem;
    }

    .detail-strip {
      grid-template-columns: 1fr;
      padding-block: 0;
    }

    .detail-strip > * {
      padding: 0.9rem 0;
    }

    .detail-strip > * + * {
      padding-left: 0;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
  }
`;
