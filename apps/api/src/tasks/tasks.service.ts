import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import type {
  Paginated,
  TaskActivityEntry,
  TaskDetail,
  TaskSummary,
} from '@projectflow/shared';
import { toObjectId } from '../common/utils/object-id';
import { toUserSummary } from '../common/utils/serialize';
import { Comment, type CommentDocument } from '../comments/schemas/comment.schema';
import { canManage, ProjectAccessService } from '../projects/project-access.service';
import { Project, type ProjectDocument } from '../projects/schemas/project.schema';
import { ProjectMembersService } from '../project-members/project-members.service';
import { UsersService } from '../users/users.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { ListTasksQueryDto } from './dto/list-tasks.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { Task, type TaskDocument } from './schemas/task.schema';
import { TaskCounter, type TaskCounterDocument } from './schemas/task-counter.schema';
import { Activity, type ActivityDocument } from './schemas/activity.schema';
import type { PaginationQueryDto } from '../common/dto/pagination.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(TaskCounter.name) private readonly taskCounterModel: Model<TaskCounterDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(Activity.name) private readonly activityModel: Model<ActivityDocument>,
    private readonly projectAccessService: ProjectAccessService,
    private readonly projectMembersService: ProjectMembersService,
    private readonly usersService: UsersService,
  ) {}

  async findByProject(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    query: ListTasksQueryDto,
  ): Promise<Paginated<TaskSummary>> {
    await this.projectAccessService.assertCanView(projectId, userId);

    const filter: FilterQuery<TaskDocument> = { projectId };
    if (query.status) {
      filter.status = query.status;
    }
    if (query.priority) {
      filter.priority = query.priority;
    }

    const [tasks, total] = await Promise.all([
      this.taskModel.find(filter).sort({ number: 1 }).skip(query.skip).limit(query.pageSize).exec(),
      this.taskModel.countDocuments(filter),
    ]);

    return {
      items: await this.toSummaries(tasks),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: CreateTaskDto,
  ): Promise<TaskDetail> {
    const { project } = await this.projectAccessService.assertCanView(projectId, userId);
    const assigneeId = parseAssigneeId(dto.assignee);
    await this.assertCanChangeAssignee(projectId, userId, assigneeId, null);

    let task: TaskDocument | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const number = await this.allocateTaskNumber(projectId);

      try {
        task = await this.taskModel.create({
          projectId,
          number,
          key: `${project.key}-${number}`,
          title: dto.title,
          description: dto.description ?? null,
          status: dto.status,
          priority: dto.priority,
          createdBy: userId,
          assigneeId,
        });
        break;
      } catch (error: unknown) {
        if (!isDuplicateKeyError(error) || attempt === 2) {
          throw error;
        }
      }
    }

    if (!task) {
      throw new Error('Unable to create task with an allocated number');
    }

    if (assigneeId) {
      await this.recordAssigneeChange(task, userId, null, assigneeId);
    }

    return this.toDetail(task, project);
  }

  async findOne(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const { project } = await this.projectAccessService.assertCanView(task.projectId, userId);

    return this.toDetail(task, project);
  }

  async update(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateTaskDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, userId);
    const previousAssigneeId = task.assigneeId ?? null;
    const hasAssigneeChange = dto.assignee !== undefined;
    const nextAssigneeId = hasAssigneeChange
      ? dto.assignee === null
        ? null
        : parseAssigneeId(dto.assignee)
      : task.assigneeId ?? null;

    if (hasAssigneeChange) {
      await this.assertCanChangeAssignee(task.projectId, userId, nextAssigneeId, task.assigneeId ?? null, access);
    }

    const isCreator = task.createdBy.equals(userId);
    const hasOtherChanges =
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.status !== undefined ||
      dto.priority !== undefined;
    if (hasOtherChanges && !canManage(access) && !isCreator) {
      throw new ForbiddenException('You do not have permission to edit this task');
    }

    if (dto.title !== undefined) {
      task.title = dto.title;
    }
    if (dto.description !== undefined) {
      task.description = dto.description;
    }
    if (dto.status !== undefined) {
      task.status = dto.status;
    }
    if (dto.priority !== undefined) {
      task.priority = dto.priority;
    }
    if (hasAssigneeChange) {
      task.assigneeId = nextAssigneeId;
    }

    await task.save();

    if (hasAssigneeChange && !sameObjectId(previousAssigneeId, nextAssigneeId)) {
      await this.recordAssigneeChange(task, userId, previousAssigneeId, nextAssigneeId);
    }

    return this.toDetail(task, access.project);
  }

  async updateStatus(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateTaskStatusDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const { project } = await this.projectAccessService.assertCanView(task.projectId, userId);

    task.status = dto.status;
    await task.save();

    return this.toDetail(task, project);
  }

  async remove(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanManage(task.projectId, userId);

    await Promise.all([this.commentModel.deleteMany({ taskId: task._id }), task.deleteOne()]);
  }

  async findActivity(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    query: PaginationQueryDto,
  ): Promise<Paginated<TaskActivityEntry>> {
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanView(task.projectId, userId);

    const filter = { taskId };
    const [activities, total] = await Promise.all([
      this.activityModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.pageSize)
        .exec(),
      this.activityModel.countDocuments(filter),
    ]);

    return {
      items: await this.toActivityEntries(activities),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findTaskOrFail(taskId: Types.ObjectId): Promise<TaskDocument> {
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private async allocateTaskNumber(projectId: Types.ObjectId): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const counter = await this.taskCounterModel
          .findOneAndUpdate(
            { projectId },
            { $inc: { nextNumber: 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
          )
          .exec();

        if (!counter) {
          throw new Error('Task number counter was not returned');
        }

        return counter.nextNumber;
      } catch (error: unknown) {
        if (!isDuplicateKeyError(error) || attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error('Unable to allocate a task number');
  }

  private async toSummaries(tasks: TaskDocument[]): Promise<TaskSummary[]> {
    if (tasks.length === 0) {
      return [];
    }

    const userIds = tasks.flatMap((task) => [task.createdBy, ...(task.assigneeId ? [task.assigneeId] : [])]);
    const [users, commentRows] = await Promise.all([
      this.usersService.findManyByIds(userIds),
      this.commentModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
          { $group: { _id: '$taskId', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const commentCounts = new Map(commentRows.map((row) => [row._id.toString(), row.count]));

    return tasks.map((task) => ({
      id: task._id.toString(),
      projectId: task.projectId.toString(),
      number: task.number,
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
      commentCount: commentCounts.get(task._id.toString()) ?? 0,
      createdBy: toCreatorSummary(usersById.get(task.createdBy.toString())),
      assignee: task.assigneeId
        ? toCreatorSummary(usersById.get(task.assigneeId.toString()))
        : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));
  }

  private async assertCanChangeAssignee(
    projectId: Types.ObjectId,
    actorId: Types.ObjectId,
    nextAssigneeId: Types.ObjectId | null,
    currentAssigneeId: Types.ObjectId | null,
    access?: Awaited<ReturnType<ProjectAccessService['resolve']>>,
  ): Promise<void> {
    const resolvedAccess = access ?? (await this.projectAccessService.assertCanView(projectId, actorId));
    if (nextAssigneeId === null && currentAssigneeId === null) {
      return;
    }

    const actorCanAssignOthers = canManage(resolvedAccess);
    const isSelfAssignment = nextAssigneeId?.equals(actorId) ?? false;
    const isSelfUnassignment = nextAssigneeId === null && currentAssigneeId?.equals(actorId);

    if (!actorCanAssignOthers && !isSelfAssignment && !isSelfUnassignment) {
      throw new ForbiddenException('You can only assign tasks to yourself');
    }

    if (nextAssigneeId) {
      const role = await this.projectMembersService.findRole(projectId, nextAssigneeId);
      if (!role) {
        throw new BadRequestException('Assignee must be a member of this project');
      }
    }
  }

  private async recordAssigneeChange(
    task: TaskDocument,
    actorId: Types.ObjectId,
    previousAssigneeId: Types.ObjectId | null,
    newAssigneeId: Types.ObjectId | null,
  ): Promise<void> {
    await this.activityModel.create({
      taskId: task._id,
      actorId,
      type: 'TASK_ASSIGNEE_CHANGED',
      previousAssigneeId,
      newAssigneeId,
    });
  }

  private async toActivityEntries(activities: ActivityDocument[]): Promise<TaskActivityEntry[]> {
    if (activities.length === 0) {
      return [];
    }

    const userIds = activities.flatMap((activity) => [
      activity.actorId,
      ...(activity.previousAssigneeId ? [activity.previousAssigneeId] : []),
      ...(activity.newAssigneeId ? [activity.newAssigneeId] : []),
    ]);
    const users = await this.usersService.findManyByIds(userIds);
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    return activities.map((activity) => ({
      id: activity._id.toString(),
      taskId: activity.taskId.toString(),
      type: activity.type,
      actor: toCreatorSummary(usersById.get(activity.actorId.toString())),
      metadata: {
        previousAssignee: activity.previousAssigneeId
          ? toCreatorSummary(usersById.get(activity.previousAssigneeId.toString()))
          : null,
        newAssignee: activity.newAssigneeId
          ? toCreatorSummary(usersById.get(activity.newAssigneeId.toString()))
          : null,
      },
      createdAt: activity.createdAt.toISOString(),
    }));
  }

  private async toDetail(task: TaskDocument, project?: ProjectDocument): Promise<TaskDetail> {
    const [summary] = await this.toSummaries([task]);
    const resolvedProject = project ?? (await this.projectModel.findById(task.projectId).exec());

    if (!resolvedProject) {
      throw new NotFoundException('Project not found');
    }

    return {
      ...summary!,
      description: task.description ?? null,
      project: {
        id: resolvedProject._id.toString(),
        name: resolvedProject.name,
        key: resolvedProject.key,
      },
    };
  }
}

const DELETED_USER = {
  id: '',
  name: 'Unknown user',
  email: '',
  avatarUrl: null,
};

function toCreatorSummary(user: Parameters<typeof toUserSummary>[0] | undefined) {
  return user ? toUserSummary(user) : DELETED_USER;
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function sameObjectId(left: Types.ObjectId | null, right: Types.ObjectId | null): boolean {
  return left === null ? right === null : right !== null && left.equals(right);
}

function parseAssigneeId(value: string | null | undefined): Types.ObjectId | null {
  return value === undefined || value === null ? null : toObjectId(value, 'assignee id');
}
