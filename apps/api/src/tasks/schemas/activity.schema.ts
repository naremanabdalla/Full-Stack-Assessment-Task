import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export type ActivityDocument = HydratedDocument<Activity>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'activities' })
export class Activity {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true, index: true })
  taskId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ required: true, enum: ['TASK_ASSIGNEE_CHANGED'] })
  type: 'TASK_ASSIGNEE_CHANGED';

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  previousAssigneeId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  newAssigneeId?: Types.ObjectId | null;

  createdAt: Date;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

ActivitySchema.index({ taskId: 1, createdAt: -1 });