'use client';

import {
  CaretDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  UserCircleIcon,
} from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import type { ProjectMemberEntry, UserSummary } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AssigneeSelectorProps {
  value: UserSummary | null;
  members?: ProjectMemberEntry[];
  isLoading: boolean;
  disabled: boolean;
  disabledReason?: string;
  isSaving: boolean;
  canAssignOthers: boolean;
  currentUserId?: string;
  onChange: (userId: string | null) => void;
}

export function AssigneeSelector({
  value,
  members = [],
  isLoading,
  disabled,
  disabledReason,
  isSaving,
  onChange,
  canAssignOthers,
  currentUserId,
}: AssigneeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();
  const eligibleMembers = canAssignOthers
    ? members
    : members.filter(({ user }) => user.id === currentUserId);
  const filteredMembers = eligibleMembers.filter(({ user }) =>
    `${user.name} ${user.email}`.toLowerCase().includes(normalizedSearch),
  );

  const selectAssignee = (userId: string | null) => {
    setOpen(false);
    setSearch('');
    onChange(userId);
  };

  if (isLoading) {
    return <Skeleton className="h-8 w-full" />;
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled || isSaving}
        title={disabled ? disabledReason : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-left text-[13px] text-foreground',
          'hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {value ? (
            <>
              <Avatar user={value} size="sm" />
              <span className="truncate">{isSaving ? 'Saving…' : value.name}</span>
            </>
          ) : (
            <>
              <UserCircleIcon size={18} className="text-subtle-foreground" />
              <span className="text-subtle-foreground">{isSaving ? 'Saving…' : 'Unassigned'}</span>
            </>
          )}
        </span>
        <CaretDownIcon size={12} weight="bold" className="shrink-0 text-subtle-foreground" />
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-full min-w-60 overflow-hidden rounded-md border border-border bg-background p-1 shadow-md">
          <label className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <MagnifyingGlassIcon size={14} className="text-subtle-foreground" />
            <span className="sr-only">Search project members</span>
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search members"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </label>

          <div
            role="listbox"
            aria-label="Project members"
            className="max-h-56 overflow-y-auto py-1"
          >
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onClick={() => selectAssignee(null)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-surface-strong"
            >
              <UserCircleIcon size={20} className="text-subtle-foreground" />
              <span className="flex-1">Unassigned</span>
              {value === null ? <CheckIcon size={13} className="text-primary" /> : null}
            </button>

            {filteredMembers.map(({ user }) => (
              <button
                key={user.id}
                type="button"
                role="option"
                aria-selected={value?.id === user.id}
                onClick={() => selectAssignee(user.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-strong"
              >
                <Avatar user={user} size="sm" />
                <span className="min-w-0 flex-1 truncate">{user.name}</span>
                {value?.id === user.id ? <CheckIcon size={13} className="text-primary" /> : null}
              </button>
            ))}

            {filteredMembers.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12px] text-subtle-foreground">
                No matching members
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
