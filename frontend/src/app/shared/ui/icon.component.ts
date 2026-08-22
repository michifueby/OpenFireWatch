/**
 * IconComponent — `<ofw-icon name="alert" />`.
 *
 * A thin wrapper over the shared path data so a template never contains SVG
 * markup. Sized in `em` by default, which keeps an icon proportional to the
 * text beside it however that text is scaled — the alternative, fixed pixel
 * sizes, drifts out of step the moment a font size changes.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { ICONS, IconDefinition, IconName } from './icons';

@Component({
  selector: 'ofw-icon',
  standalone: true,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  /** Signal input: an `@Input` setter writing into a signal said this twice. */
  readonly name = input.required<IconName>();

  readonly definition = computed<IconDefinition>(() => ICONS[this.name()]);
}
