import { OPENAPI_DOCS_PREFIX } from '../../plugins/openapi.ts';
import { styles } from './system.styles.ts';

const mark = `<path d="M4 19V5h5v9h5V5h6v14M4 11h16" fill="none" stroke="#efb397"
  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
const favicon = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32"
    rx="8" fill="#26333c"/><g transform="translate(4 4)">${mark}</g></svg>`,
);
const stylesheet = `<style>${styles}</style>`;

const arrow = /* HTML */ `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 12h15m-6-6 6 6-6 6" />
  </svg>
`;
const refresh = /* HTML */ `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19 11a7 7 0 1 0-2 6m2-11v5h-5" />
  </svg>
`;

function layout({
  isHealth = false,
  docsEnabled,
  title,
  description,
  content,
}: {
  isHealth?: boolean;
  docsEnabled: boolean;
  title: string;
  description: string;
  content: string;
}): string {
  const currentPage = ' aria-current="page"';
  return /* HTML */ `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="${description}" />
        <title>${title}</title>
        <link rel="icon" href="data:image/svg+xml,${favicon}" />
        ${stylesheet}
      </head>
      <body>
        <header class="masthead shell">
          <a class="brand" href="/" ${isHealth ? '' : currentPage}>
            <svg viewBox="0 0 24 24" aria-hidden="true">${mark}</svg>
            Welyt
          </a>
          <nav aria-label="Primary">
            ${docsEnabled ? `<a href="${OPENAPI_DOCS_PREFIX}">API docs</a>` : ''}
            <a class="status-link" href="/health" ${isHealth ? currentPage : ''}>
              <span class="dot" aria-hidden="true"></span>
              Service status
            </a>
          </nav>
        </header>
        <main class="shell">${content}</main>
        <footer class="footer shell">
          <span>Welyt &middot; Personal finance</span>
          <span>Welyt API</span>
        </footer>
      </body>
    </html>
  `;
}

export function renderIndex(docsEnabled: boolean): string {
  return layout({
    docsEnabled,
    title: 'Welyt | Your money, in focus',
    description: 'Track your accounts, income, and monthly plans in one place with Welyt.',
    content: /* HTML */ `
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow label">A personal finance workspace</p>
          <h1 id="page-title">Your money, <em>in focus.</em></h1>
          <p class="lede">
            See what you have, keep track of what comes in, and give every month a plan.
          </p>
          <div class="actions">
            <a class="button" href="/health">Check the API pulse ${arrow}</a>
          </div>
        </div>
        <figure class="instrument">
          <div class="instrument-meta label">
            <span>The money map</span>
            <span>Fig. 01</span>
          </div>
          <svg class="artwork" viewBox="0 0 480 270" aria-hidden="true">
            <g fill="none" stroke="#84969c">
              <path d="M26 139h428M240 20v238" stroke-dasharray="3 7" opacity=".54" />
              <circle cx="240" cy="139" r="52" stroke-dasharray="2 6" opacity=".65" />
              <circle cx="240" cy="139" r="95" opacity=".36" />
              <ellipse
                cx="240"
                cy="139"
                rx="188"
                ry="79"
                transform="rotate(-16 240 139)"
                opacity=".6"
              />
              <ellipse
                cx="240"
                cy="139"
                rx="168"
                ry="74"
                transform="rotate(22 240 139)"
                opacity=".45"
              />
            </g>
            <ellipse
              cx="240"
              cy="139"
              rx="156"
              ry="63"
              transform="rotate(-16 240 139)"
              fill="none"
              stroke="#efb397"
              stroke-width="1.5"
            />
            <g fill="#efb397">
              <circle cx="90" cy="182" r="5" />
              <circle cx="390" cy="96" r="5" />
              <path d="M390 48v14m-7-7h14M101 99v10m-5-5h10" stroke="#efb397" stroke-width="1.5" />
            </g>
            <circle cx="281" cy="71" r="4" fill="#b9ded0" />
            <circle cx="382" cy="219" r="4" fill="#b9ded0" />
            <circle cx="240" cy="139" r="35" fill="#26333c" stroke="#efb397" />
            <svg x="217" y="116" width="46" height="46" viewBox="0 0 24 24">${mark}</svg>
          </svg>
          <figcaption class="instrument-meta label">
            <span>Accounts / Income / Plans</span>
            <span>In orbit</span>
          </figcaption>
        </figure>
      </section>
      <ol class="detail-strip" role="list" aria-label="Welyt features">
        <li>
          <span class="label" aria-hidden="true">01</span>
          <h2 class="detail-title">Accounts &amp; cash</h2>
          <p>See balances across accounts and currencies.</p>
        </li>
        <li>
          <span class="label" aria-hidden="true">02</span>
          <h2 class="detail-title">Income &amp; history</h2>
          <p>Track what came in and when.</p>
        </li>
        <li>
          <span class="label" aria-hidden="true">03</span>
          <h2 class="detail-title">Monthly plans</h2>
          <p>Decide where your income will go each month.</p>
        </li>
      </ol>
    `,
  });
}

export function renderServicePulse(docsEnabled: boolean, checkedAt: Date): string {
  const timestamp = checkedAt.toISOString();
  const date = timestamp.slice(0, 10);
  const time = timestamp.slice(11, 19);
  return layout({
    isHealth: true,
    docsEnabled,
    title: 'Welyt | Service Pulse',
    description: 'Check whether the Welyt API is responding.',
    content: /* HTML */ `
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow label">Service pulse</p>
          <h1 id="page-title">The API is <em>responding.</em></h1>
          <p class="lede">
            Welyt answered this request. This check covers HTTP liveness only and doesn't test the
            database or other services.
          </p>
          <div class="actions">
            <a class="button" href="/health">Check again ${refresh}</a>
            <a class="button secondary" href="/health?format=json">View JSON ${arrow}</a>
          </div>
        </div>
        <figure class="instrument pulse">
          <div class="instrument-meta label">
            <span>HTTP liveness</span>
            <span class="signal"><span class="dot" aria-hidden="true"></span> Signal received</span>
          </div>
          <svg class="artwork" viewBox="0 0 480 270" aria-hidden="true">
            <path
              d="M28 142h424M240 32v206"
              fill="none"
              stroke="#91aaa5"
              stroke-dasharray="3 7"
              opacity=".55"
            />
            <circle cx="196" cy="142" r="86" fill="none" stroke="#9cbbb2" opacity=".25" />
            <circle cx="196" cy="142" r="106" fill="none" stroke="#9cbbb2" opacity=".16" />
            <path
              id="signal-trace"
              d="M28 142h67l13-14 14 14h39l14 17 20-65 19 98 18-56 12 6h55l13-18 17 18h115"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <use href="#signal-trace" stroke="#b9ead3" stroke-width="13" opacity=".12" />
            <use href="#signal-trace" stroke="#b9ead3" stroke-width="3" />
            <circle cx="444" cy="142" r="10" fill="#b9ead3" opacity=".18" />
            <circle cx="444" cy="142" r="4.5" fill="#b9ead3" />
          </svg>
          <figcaption class="instrument-meta label">
            <span>Welyt API</span>
            <span>Response confirmed</span>
          </figcaption>
        </figure>
      </section>
      <dl class="detail-strip" aria-label="Check details">
        <div>
          <dt class="label">Endpoint</dt>
          <dd class="detail-title"><code>GET /health</code></dd>
        </div>
        <div>
          <dt class="label">HTTP response</dt>
          <dd class="detail-title"><code>200 OK</code></dd>
        </div>
        <div>
          <dt class="label">Checked at</dt>
          <dd class="detail-title"><time datetime="${timestamp}">${date} ${time} UTC</time></dd>
        </div>
      </dl>
    `,
  });
}
