'use client';

/**
 * Settings → Household (TASKS 4.2 slice 1 — membership core). Create a
 * household, invite a partner (one-time code shown ONCE for out-of-band
 * handoff), accept/decline an invite addressed to your sign-in email, leave,
 * and (owner) remove a member or revoke a pending invite.
 *
 * Reliable-mutation recipe (#167): plain pending state, deadline-bounded
 * await, full reload on success. EXCEPTION: a successful invite must NOT
 * reload — the one-time code exists only in this response and is shown until
 * the inviter confirms they've handed it off; the "Done" button then reloads.
 *
 * Honesty guardrail: membership alone shares NOTHING. Copy says exactly that —
 * no partner sees any account, balance, or transaction unless it is explicitly
 * shared, and no sharing control exists yet in this slice.
 */
import { useState } from 'react';
import { useConfirmArm } from '@/components/ui/confirm-action';
import { Button } from '@/components/ui/button';
import {
  acceptInvite,
  createHousehold,
  declineInvite,
  inviteToHousehold,
  leaveHousehold,
  removeMember,
  revokeInvite,
} from '@/server/household-actions';
import type { HouseholdView } from '@/server/household';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground';

export function HouseholdCard({ view }: { view: HouseholdView }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** #167 wrapper. `onSuccess` defaults to a full reload (server truth). */
  function runMutation(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    fallbackError: string,
    onSuccess?: () => void,
  ) {
    if (pending) return;
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const res = await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) {
          setError(res.error ?? fallbackError);
          setPending(false);
          return;
        }
        if (onSuccess) {
          onSuccess();
          setPending(false);
          return;
        }
        window.location.reload(); // pending stays true until the new page
      } catch (e) {
        if (e instanceof ActionDeadline) {
          window.location.reload();
          return;
        }
        setError(fallbackError);
        setPending(false);
      }
    })();
  }

  return (
    <div className="space-y-4" data-testid="household-card-body">
      {view.kind === 'none' ? (
        <NoHousehold view={view} pending={pending} runMutation={runMutation} />
      ) : (
        <MemberView view={view} pending={pending} runMutation={runMutation} />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="household-error">
          {error}
        </p>
      )}
    </div>
  );
}

type RunMutation = (
  fn: () => Promise<{ ok: boolean; error?: string }>,
  fallbackError: string,
  onSuccess?: () => void,
) => void;

function NoHousehold({
  view,
  pending,
  runMutation,
}: {
  view: Extract<HouseholdView, { kind: 'none' }>;
  pending: boolean;
  runMutation: RunMutation;
}) {
  const [name, setName] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      {view.invites.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            You&apos;re invited
          </h3>
          {view.invites.map((invite) => (
            <div
              key={invite.id}
              className="space-y-2 rounded-md border border-border/60 p-3"
              data-testid="household-incoming-invite"
            >
              <p className="text-sm">
                <span className="font-medium">{invite.householdName}</span>
                {invite.invitedByName ? ` — invited by ${invite.invitedByName}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {HOUSEHOLD_COPY.inviteCodeHint()}
              </p>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  runMutation(
                    () => acceptInvite(invite.id, codes[invite.id] ?? ''),
                    'Could not accept the invite.',
                  );
                }}
              >
                <input
                  className={`${fieldClass} max-w-40 font-mono uppercase`}
                  placeholder="XXXX-XXXX"
                  value={codes[invite.id] ?? ''}
                  onChange={(e) => setCodes((c) => ({ ...c, [invite.id]: e.target.value }))}
                  aria-label={`Invite code for ${invite.householdName}`}
                  data-testid="household-accept-code"
                />
                <Button type="submit" size="sm" disabled={pending} data-testid="household-accept-submit">
                  Join
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  data-testid="household-decline"
                  onClick={() =>
                    runMutation(() => declineInvite(invite.id), 'Could not decline the invite.')
                  }
                >
                  Decline
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}

      <form
        className="space-y-2"
        data-testid="household-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          runMutation(() => createHousehold(name), 'Could not create the household.');
        }}
      >
        <label htmlFor="household-name" className="text-sm font-medium">
          Start a household
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="household-name"
            className={`${fieldClass} max-w-60`}
            placeholder="Our household"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="household-create-name"
          />
          <Button type="submit" size="sm" disabled={pending} data-testid="household-create-submit">
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}

function MemberView({
  view,
  pending,
  runMutation,
}: {
  view: Extract<HouseholdView, { kind: 'member' }>;
  pending: boolean;
  runMutation: RunMutation;
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [issuedCode, setIssuedCode] = useState<{ code: string; email: string } | null>(null);
  const confirm = useConfirmArm();
  const isOwner = view.role === 'owner';

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm">
          <span className="font-medium" data-testid="household-name">{view.name}</span>{' '}
          <span className="text-xs text-muted-foreground">
            — you are {view.role === 'owner' ? 'the owner' : 'a partner'}
          </span>
        </p>
      </div>

      <ul role="list" className="space-y-2">
        {view.members.map((m) => (
          <li
            key={m.userId}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
            data-testid="household-member-row"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {m.name ?? m.email}
                {m.isSelf ? ' (you)' : ''}
              </div>
              {m.name && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {m.role}
              </span>
              {isOwner && !m.isSelf && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  data-testid={`household-remove-${m.userId}`}
                  onClick={() =>
                    runMutation(() => removeMember(m.userId), 'Could not remove the member.')
                  }
                >
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {view.pendingInvites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending invites
          </h3>
          {view.pendingInvites.map((i) => (
            <div
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid="household-pending-invite"
            >
              <span className="truncate text-sm">{i.email}</span>
              {isOwner && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  data-testid={`household-revoke-${i.id}`}
                  onClick={() =>
                    runMutation(() => revokeInvite(i.id), 'Could not revoke the invite.')
                  }
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {issuedCode ? (
        <div
          className="space-y-2 rounded-md border border-border/60 bg-muted/40 p-3"
          data-testid="household-invite-issued"
        >
          <p className="text-sm">
            Invite code for <span className="font-medium">{issuedCode.email}</span>:
          </p>
          <p className="font-mono text-lg tracking-wider" data-testid="household-invite-code">
            {issuedCode.code}
          </p>
          <p className="text-xs text-muted-foreground">
            {HOUSEHOLD_COPY.inviteCodeIssued(issuedCode.email)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="household-invite-done"
            onClick={() => window.location.reload()}
          >
            Done — I&apos;ve shared it
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2"
          data-testid="household-invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            runMutation(
              async () => {
                const res = await inviteToHousehold(inviteEmail);
                if (res.ok) setIssuedCode({ code: res.code, email: res.email });
                return res;
              },
              'Could not create the invite.',
              () => setInviteEmail(''),
            );
          }}
        >
          <label htmlFor="household-invite-email" className="text-sm font-medium">
            Invite a partner
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="household-invite-email"
              type="email"
              className={`${fieldClass} max-w-60`}
              placeholder="partner@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              data-testid="household-invite-email"
            />
            <Button type="submit" size="sm" disabled={pending} data-testid="household-invite-submit">
              Invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {HOUSEHOLD_COPY.inviteFormHint()}
          </p>
        </form>
      )}

      <div className="space-y-2 border-t border-border/60 pt-3">
        {confirm.isArmed('leave') ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {HOUSEHOLD_COPY.leaveConfirm(view.name)}
            </span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              data-testid="household-leave-confirm"
              onClick={() => runMutation(() => leaveHousehold(), 'Could not leave the household.')}
            >
              Confirm leave
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={confirm.disarm}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            data-testid="household-leave"
            onClick={() => confirm.arm('leave')}
          >
            Leave household
          </Button>
        )}
      </div>
    </div>
  );
}
