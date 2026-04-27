import { routerStack, stores, Toast } from 'foundation';
import { Timetable, TimetableUtils } from 'module_course_schedule';
import { CourseDetailPageParams } from '../common/CustomTypes';
import { CourseVM } from './CourseVM';
import { CourseArrangementVM } from './CourseArrangementVM';

@ObservedV2
export class CourseDetailPageVM {

  @Trace
  private _timetable: Timetable = TimetableUtils.deepClone(stores.pref.timetable);

  @Trace
  public course: CourseVM = new CourseVM();

  @Computed
  public get weekCount(): number {
    return this._timetable.semester.weekCount;
  }

  @Computed
  public get courseDataVersion(): number {
    return stores.cache.courseDataVersion;
  }

  @Monitor('courseDataVersion')
  public onCourseDataVersionChange(): void {
    this._timetable = TimetableUtils.deepClone(stores.pref.timetable);
    this.refreshCourseData(this.course.id);
  }

  public parseRouterParams(params: CourseDetailPageParams): void {
    this.refreshCourseData(params.courseId);
  }

  public getArrangementTimeLabel(arr: CourseArrangementVM): string {
    const timeRange: string = TimetableUtils.getTimeRangeLabel(this._timetable, arr.periodStart, arr.periodEnd);
    return `${arr.periodLabel} ${timeRange}`;
  }

  public delete(): void {
    this._timetable.courses = this._timetable.courses.filter(c => c.id !== this.course.id);
    stores.pref.timetable = TimetableUtils.deepClone(this._timetable);
    stores.cache.courseDataVersion++;
    stores.pref.flushSync();
    Toast.showMsg('删除成功');
    routerStack.pop();
  }

  private refreshCourseData(courseId: string): void {
    for (const course of this._timetable.courses) {
      if (course.id === courseId && course.arrangements.length > 0) {
        this.course.assignForm(course);
        break;
      }
    }
  }
}
