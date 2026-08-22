/**
 * Test entry point.
 *
 * Angular's karma builder can bootstrap the test environment on its own, but
 * doing it explicitly is what makes `TestBed` inject the browser platform's
 * providers. Without them, every test that reaches for anything zone-aware
 * fails with NG0402 — an error that names `BrowserModule` and gives no hint
 * that the real problem is a missing test environment.
 */

import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);
