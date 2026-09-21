import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop sidebar shell', () => {
  it('test_regression__desktop_nav_is_a_grouped_sidebar_not_a_pill_wrap', () => {
    const nav = readFileSync(resolve('src/components/app-nav.tsx'), 'utf8');
    expect(nav).toContain('desktop-sidebar');
    expect(nav).toContain('Money & accounts');
    expect(nav).toContain('Explore');
    expect(nav).toContain('BrandMark');
    expect(nav).not.toMatch(/hidden sm:inline-flex/);
    const layout = readFileSync(resolve('src/app/(app)/layout.tsx'), 'utf8');
    expect(layout).toContain('sm:flex sm:min-h-screen');
    expect(layout).not.toContain('SignOutButton');
  });

  it('test_regression__desktop_sidebar_rows_are_labels_not_a_described_sitemap', () => {
    const nav = readFileSync(resolve('src/components/app-nav.tsx'), 'utf8');
    expect(nav).not.toContain('DESCRIBED_SIDEBAR');
    expect(nav).toContain('Money & accounts');
    expect(nav).toContain('Explore');
    const row = nav.slice(nav.indexOf('function SidebarRow'), nav.indexOf('function SheetRow'));
    expect(row).not.toContain('described ?');
    expect(row).toContain('title={item.description}');
    expect(row).toContain('{item.label}');
    expect(row.split('{item.description}')).toHaveLength(2);
    expect(nav).not.toContain('text-brand-500">plifi');
    expect(nav).toContain("document.getElementById(searchId)?.focus()");
    expect(nav).toContain('last.focus()');
    expect(nav).toMatch(/data-testid="bottom-nav"[\s\S]*text-\[11px\]/);
  });
});

