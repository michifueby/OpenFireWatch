/**
 * AboutPanelComponent — developer credit + plain-language description.
 *
 * A slim, always-visible credit bar — bottom-left on a desktop, top-right on
 * a phone, where the bottom edge belongs to the situation sheet — with:
 *   - an expandable panel explaining what OpenFireWatch does and how it
 *     works, fully translated (EN/DE), and
 *   - a DE/EN language switch. The initial language follows the browser
 *     (see TranslationService); the switch persists an explicit choice.
 */

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { TranslationService } from '../core/i18n/translation.service';

@Component({
  selector: 'ofw-about-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Expandable explainer for non-technical visitors. -->
    <section class="about" *ngIf="open" [attr.aria-label]="i18n.t('aboutAria')">
      <h2>
        <!-- Decorative: the adjacent text already names the product, so the
             image is hidden from screen readers to avoid a duplicate label. -->
        <img
          class="panel-logo"
          src="logo.svg"
          alt=""
          aria-hidden="true"
          width="28"
          height="28"
        />
        OpenFireWatch
      </h2>
      <p class="lead">{{ i18n.t('aboutLead') }}</p>
      <ol class="steps">
        <li>
          <strong>{{ i18n.t('aboutStep1Label') }}</strong> {{ i18n.t('aboutStep1') }}
        </li>
        <li>
          <strong>{{ i18n.t('aboutStep2Label') }}</strong> {{ i18n.t('aboutStep2') }}
        </li>
        <li>
          <strong>{{ i18n.t('aboutStep3Label') }}</strong> {{ i18n.t('aboutStep3') }}
        </li>
        <li>
          <strong>{{ i18n.t('aboutStep4Label') }}</strong> {{ i18n.t('aboutStep4') }}
        </li>
      </ol>
      <p class="credit-line">
        {{ i18n.t('developedBy') }} <strong>Michael Fueby</strong> ·
        <a
          href="https://github.com/michifueby"
          target="_blank"
          rel="noopener noreferrer"
          >github.com/michifueby</a
        >
        · {{ i18n.t('openSource') }}
      </p>
    </section>

    <!-- Always-visible credit bar: info toggle, credit, language switch. -->
    <footer class="bar">
      <button
        type="button"
        class="info-toggle"
        (click)="open = !open"
        [attr.aria-expanded]="open"
        [attr.aria-label]="i18n.t('aboutInfoAria')"
      >
        {{ open ? '✕' : 'ℹ' }}
      </button>
      <img
        class="bar-logo"
        src="logo.svg"
        alt=""
        aria-hidden="true"
        width="20"
        height="20"
      />
      <span class="credit">
        OpenFireWatch — {{ i18n.t('developedBy').toLowerCase() }}
        <a
          href="https://github.com/michifueby"
          target="_blank"
          rel="noopener noreferrer"
          >Michael Fueby</a
        >
      </span>
      <span class="lang-switch" role="group" aria-label="Language / Sprache">
        <button
          type="button"
          [class.active]="i18n.locale() === 'de'"
          (click)="i18n.setLocale('de')"
        >
          DE
        </button>
        <span class="divider">|</span>
        <button
          type="button"
          [class.active]="i18n.locale() === 'en'"
          (click)="i18n.setLocale('en')"
        >
          EN
        </button>
      </span>
    </footer>
  `,
  styles: [
    `
      $alert-red: #ff2d1a;
      $font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas,
        monospace;

      // --- Always-visible credit bar (bottom-left) --------------------------
      .bar {
        position: fixed;
        z-index: 5; // see the layer table in styles.scss
        left: 1rem;
        bottom: 1rem;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.35rem 0.7rem 0.35rem 0.35rem;
        border: 1px solid rgba(230, 232, 238, 0.18);
        border-radius: 999px;
        background: rgba(7, 12, 20, 0.88);
        backdrop-filter: blur(6px);
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
      }

      .info-toggle {
        width: 1.7rem;
        height: 1.7rem;
        border-radius: 50%;
        border: 1px solid rgba(230, 232, 238, 0.35);
        background: transparent;
        color: #e6e8ee;
        font-size: 0.85rem;
        cursor: pointer;

        &:hover {
          border-color: $alert-red;
          color: $alert-red;
        }
      }

      .bar-logo {
        width: 1.25rem;
        height: 1.25rem;
        display: block;
        flex: none; // never squashed by the flex row
      }

      .credit {
        font-family: $font-mono;
        font-size: 0.68rem;
        color: #9aa4b2;

        a {
          color: #e6e8ee;
          text-decoration: none;
          border-bottom: 1px dotted rgba(230, 232, 238, 0.4);

          &:hover {
            color: $alert-red;
            border-bottom-color: $alert-red;
          }
        }
      }

      // --- Language switch ----------------------------------------------------
      .lang-switch {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-family: $font-mono;
        font-size: 0.62rem;

        .divider {
          color: #3a4560;
        }

        button {
          padding: 0.1rem 0.25rem;
          border: none;
          background: transparent;
          color: #6b7688;
          font-family: inherit;
          font-size: inherit;
          letter-spacing: 0.08em;
          cursor: pointer;

          &:hover {
            color: #e6e8ee;
          }

          &.active {
            color: $alert-red;
            font-weight: 700;
          }
        }
      }

      // --- Expandable explainer panel ----------------------------------------
      .about {
        position: fixed;
        z-index: 5;
        left: 1rem;
        bottom: 4rem;
        width: 24rem;
        max-width: calc(100vw - 2rem);
        max-height: calc(100vh - 6rem);
        max-height: calc(100dvh - 6rem);
        overflow-y: auto;
        padding: 1rem 1.1rem;
        border: 1px solid rgba(230, 232, 238, 0.18);
        border-radius: 8px;
        background: rgba(7, 12, 20, 0.92);
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        color: #e6e8ee;
        font-size: 0.8rem;
        line-height: 1.5;

        h2 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0 0 0.5rem;
          font-size: 0.95rem;
          letter-spacing: 0.06em;
        }

        .panel-logo {
          width: 1.75rem;
          height: 1.75rem;
          flex: none;
        }

        .lead {
          margin: 0 0 0.6rem;
          color: #c6ccd6;
        }

        .steps {
          margin: 0;
          padding-left: 1.1rem;
          display: grid;
          gap: 0.4rem;
          color: #c6ccd6;

          strong {
            color: #e6e8ee;
          }
        }

        .credit-line {
          margin: 0.8rem 0 0;
          padding-top: 0.6rem;
          border-top: 1px solid rgba(230, 232, 238, 0.14);
          font-family: $font-mono;
          font-size: 0.68rem;
          color: #9aa4b2;

          a {
            color: #e6e8ee;

            &:hover {
              color: $alert-red;
            }
          }
        }
      }

      /* ---------------------------------------------------------------------
       * Phone layout.
       *
       * The bar moves to the top-right corner: at the bottom-left it sat both
       * under the situation sheet and on top of the map attribution, and the
       * credit line it carries is repeated inside the panel it opens anyway.
       * ------------------------------------------------------------------ */
      @media (max-width: 640px) {
        .bar {
          left: auto;
          right: calc(0.75rem + var(--ofw-safe-right));
          bottom: auto;
          top: calc(0.75rem + var(--ofw-safe-top));
          gap: 0.35rem;
          padding: 0.25rem 0.5rem 0.25rem 0.25rem;
        }

        /* Reads fine on a desktop, truncates to noise on a phone. The same
           credit is the last line of the panel behind the ℹ button. */
        .credit,
        .bar-logo {
          display: none;
        }

        .info-toggle {
          width: 2.5rem;
          height: 2.5rem;
          font-size: 1rem;
        }

        .lang-switch {
          font-size: 0.72rem;

          button {
            min-width: 2.25rem;
            min-height: 2.5rem;
          }
        }

        /* Anchored under the bar rather than above the bottom edge, which now
           belongs to the situation sheet. */
        .about {
          top: calc(3.75rem + var(--ofw-safe-top));
          right: 0.75rem;
          bottom: auto;
          left: 0.75rem;
          width: auto;
          max-width: none;
          max-height: calc(100dvh - 8rem);
          font-size: 0.85rem;
        }
      }
    `,
  ],
})
export class AboutPanelComponent {
  /** Whether the explainer panel is expanded. */
  open = false;

  constructor(readonly i18n: TranslationService) {}
}
