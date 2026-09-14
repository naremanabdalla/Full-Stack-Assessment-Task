'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  TaskActivityEntry,
  TaskDetail,
  TaskStatus,
  TaskSummary,
} from '@projectflow/shared';
import { queryKeys } from '@/lib/query-keys';
import {
  createTask,
  type CreateTaskPayload,
  fetchProjectTasks,
  fetchTask,
  fetchTaskActivity,
  updateTask,
  updateTaskStatus,
} from './api';

export function useProjectTasks(projectId: string) {
  return useQuery<Paginated<TaskSummary>>({
    queryKey: queryKeys.projectTasks(projectId),
    queryFn: () => fetchProjectTasks(projectId),
    enabled: projectId.length > 0,
  });
}

export function useTask(taskId: string) {
  return useQuery<TaskDetail>({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(taskId),
    enabled: taskId.length > 0,
  });
}

export function useTaskActivity(taskId: string) {
  return useQuery<Paginated<TaskActivityEntry>>({
    queryKey: queryKeys.taskActivity(taskId),
    queryFn: () => fetchTaskActivity(taskId),
    enabled: taskId.length > 0,
  });
}

export function useUpdateTaskAssignee(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, string | null>({
    mutationFn: (assignee) => updateTask(taskId, { assignee }),
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(task.projectId) }),
      ]);
    },
  });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, CreateTaskPayload>({
    mutationFn: (payload) => createTask(projectId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
    },
  });
}

export function useUpdateTaskStatus(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, TaskStatus>({
    mutationFn: (status) => updateTaskStatus(taskId, status),
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}
