// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { consoleNav } from '../src/components/console/consoleNav';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  // jsdom does not implement the browser's modal methods or focus restoration.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = true;
    this.querySelector<HTMLButtonElement>('button')?.focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  } });
  signInAsSuperAdmin();
});
afterEach(() => {
  cleanup(); signOut();
  for (const [name, descriptor] of [['showModal', originalShow], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

function mount() {
  return render(<MemoryRouter initialEntries={['/overview']}><ConsoleShell title="DeveloperCards Console" {...consoleNav()}><h1>Overview</h1></ConsoleShell></MemoryRouter>);
}

function openDrawer() {
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, drawer: screen.getByRole('dialog', { name: 'Console navigation' }) };
}

describe('responsive console navigation', () => {
  it('opens a modal drawer and returns focus after Escape or explicit close', () => {
    mount();
    const { trigger, drawer } = openDrawer();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Close navigation' }));
    fireEvent(drawer, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps real destination links, closes on navigation and updates the active section', () => {
    mount();
    const { drawer, trigger } = openDrawer();
    const review = within(drawer).getByRole('link', { name: 'Review queue' });
    expect(review.getAttribute('href')).toBe('/review');
    fireEvent.click(review);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'Review queue' }).getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(trigger);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#console-main');
  });

  it('removes privileged links from the open drawer when the current session becomes an editor', () => {
    mount();
    const { drawer } = openDrawer();
    expect(within(drawer).getByRole('link', { name: 'Admin Management' })).toBeTruthy();
    act(() => { signInAsEditor(); });
    for (const name of ['Overview', 'Operations', 'Learners', 'Webhooks', 'Admin Management']) {
      expect(within(drawer).queryByRole('link', { name })).toBeNull();
    }
    expect(within(drawer).getByRole('link', { name: 'Review queue' })).toBeTruthy();
    expect(within(drawer).queryByRole('group', { name: 'System navigation' })).toBeNull();
  });
});
