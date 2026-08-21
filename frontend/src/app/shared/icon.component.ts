/**
 * IconComponent — `<ofw-icon name="alert" />`.
 *
 * A thin wrapper over the shared path data so a template never contains SVG
 * markup. Sized in `em` by default, which keeps an icon proportional to the
 * text beside it however that text is scaled — the alternative, fixed pixel
 * sizes, drifts out of step the moment a font size changes.
 */

import { CommonModule } from '@angular/common';
import { Component, Input, computed, signal } from '@angular/core';

import { ICONS, IconDefinition, IconName } from './icons';

@Component({
  selector: 'ofw-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      viewBox="0 0 24 24"
      [attr.fill]="definition().filled ? 'currentColor' : 'none'"
      [attr.stroke-width]="definition().filled ? 0 : 2"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path *ngFor="let d of definition().paths" [attr.d]="d"></path>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        // Follows the surrounding text size rather than fighting it.
        width: 1.05em;
        height: 1.05em;
        // Optically centres the glyph on the text baseline; without this an
        // icon sits noticeably high next to capitals.
        vertical-align: -0.16em;
        flex: none;
      }

      svg {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class IconComponent {
  private readonly current = signal<IconName>('dot');

  @Input({ required: true })
  set name(value: IconName) {
    this.current.set(value);
  }

  readonly definition = computed<IconDefinition>(() => ICONS[this.current()]);
}
