'use client';

import type { TaskActivityEntry } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { useTaskActivity } from '../hooks';

interface ActivityTimelineProps {
  taskId: string;
}

export function ActivityTimeline({ taskId }: ActivityTimelineProps) {
  const { data, isPending, isError } = useTaskActivity(taskId);

  return (
    <section aria-label="Activity" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        <p className="text-[12px] text-muted-foreground">Assignment history</p>
      </div>

      {isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-11/12" />
        </div>
      ) : isError ? (
        <p className="text-[13px] text-danger">Unable to load activity.</p>
      ) : data.items.length === 0 ? (
        <p className="text-[13px] text-subtle-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-4">
          {data.items.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityItem({ activity }: { activity: TaskActivityEntry }) {
  const previous = activity.metadata.previousAssignee;
  const next = activity.metadata.newAssignee;
  const message = previous
    ? next
      ? `${activity.actor.name} reassigned task from ${previous.name} to ${next.name}`
      : `${activity.actor.name} unassigned ${previous.name}`
    : next
      ? `${activity.actor.name} assigned ${next.name}`
      : `${activity.actor.name} cleared the assignee`;

  return (
    <li className="flex gap-2.5">
      <Avatar user={activity.actor} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-foreground">{message}</p>
        <time dateTime={activity.createdAt} className="text-[11px] text-subtle-foreground">
          {formatDateTime(activity.createdAt)}
        </time>
      </div>
    </li>
  );
}
