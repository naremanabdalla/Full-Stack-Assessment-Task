import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export type TaskCounterDocument = HydratedDocument<TaskCounter>;

@Schema({ collection: 'task_counters' })
export class TaskCounter {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, unique: true })
  projectId: Types.ObjectId;

  @Prop({ required: true, default: 0, min: 0 })
  nextNumber: number;
}

export const TaskCounterSchema = SchemaFactory.createForClass(TaskCounter);
