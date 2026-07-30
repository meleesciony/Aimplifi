'use client';

/**
 * Your Money or Your Life: big purchases as hours of working life.
 * A lens the user can toggle — never a judgment.
 */
import { useState } from 'react';
import Link from 'next/link';
import { MERCHANT_LINK_CLASS, merchantRegisterHref } from '@/lib/engine/transactions/links';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { cents, formatCents } from '@/lib/money';
import { formatISODate, isoDate } from '@/lib/dates';

export function LifeEnergyCard({
  items,
  hourlyWageCents,
}: {
  items: { merchant: string; amountCents: number; hours: number; date: string }[];
  hourlyWageCents: number;
}) {
  const [showHours, setShowHours] = useState(false);

  return (
    <Card data-testid="life-energy-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardDescription>Life-energy view</CardDescription>
            <CardTitle className="text-base">Biggest purchases, last 90 days</CardTitle>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            hours
            <Switch
              checked={showHours}
              onCheckedChange={setShowHours}
              data-testid="life-energy-toggle"
              aria-label="Show purchases as hours of work"
            />
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground" data-testid="life-energy-empty">
            No large purchases in the last 90 days.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5 text-sm" data-testid="life-energy-list">
              {items.map((item, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    {/* Same Merchant-Lens entry as the register row (DECISIONS #250). */}
                    <Link
                      href={merchantRegisterHref(item.merchant)}
                      data-testid="life-energy-merchant-link"
                      className={MERCHANT_LINK_CLASS}
                    >
                      {item.merchant}
                    </Link>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {formatISODate(isoDate(item.date))}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {showHours ? `${item.hours} hrs` : formatCents(cents(item.amountCents))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {COACH_COPY.lifeEnergyFootnote(cents(hourlyWageCents))}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
