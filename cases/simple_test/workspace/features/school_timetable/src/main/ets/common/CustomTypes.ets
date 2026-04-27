import { FormMode } from 'foundation';

export interface CourseFormPageParams {
  formMode: FormMode;
  courseId?: string;
}

export interface CourseDetailPageParams {
  courseId: string;
}

export interface PeriodRange {
  dayOfWeek: number;
  periodStart: number;
  periodEnd: number;
}

export enum FunctionalMode {
  TOGGLE,
  TEXT_INPUT,
  BUTTON
}
