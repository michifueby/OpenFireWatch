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

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';
import { APP_VERSION } from '@core/version';

@Component({
  selector: 'ofw-about-panel',
  standalone: true,
  templateUrl: './about-panel.component.html',
  styleUrl: './about-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutPanelComponent {
  readonly i18n = inject(TranslationService);

  /** Whether the explainer panel is expanded. */
  readonly open = signal(false);

  /** Compiled-in release version — see scripts/version.sh. */
  readonly version = APP_VERSION;

  /** The report follows the language the reader is looking at. */
  readonly reportUrl = computed(
    () => `/api/report/lagebericht.pdf?lang=${this.i18n.locale()}`,
  );

  toggle(): void {
    this.open.update((v) => !v);
  }
}
