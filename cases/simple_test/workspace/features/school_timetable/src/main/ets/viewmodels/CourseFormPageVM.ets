import { routerStack, stores, FormMode, Toast } from 'foundation';
import { ColorPalette, Course, Timetable, TimetableUtils } from 'module_course_schedule';
import { CourseFormPageParams } from '../common/CustomTypes';
import { CourseVM } from './CourseVM';
import { CourseArrangementVM } from './CourseArrangementVM';

@ObservedV2
export class CourseFormPageVM {

  private _timetable: Timetable = TimetableUtils.deepClone(stores.pref.timetable);

  public semesterLabel: string = this._timetable.semester.label;

  public totalPeriods: number = this._timetable.periods.length;

  public weekCount: number = this._timetable.semester.weekCount;

  @Trace
  public formMode: FormMode = FormMode.Create;

  @Trace
  public course: CourseVM = new CourseVM();

  public createCourseArrangement(): void {
    const arr: CourseArrangementVM = CourseArrangementVM.createForCourse(this.course.id);
    this.course.arrangements.push(arr);
  }

  public deleteCourseArrangement(id: string): void {
    if (this.course.arrangements.length === 1) {
      return;
    }
    const index: number = this.course.arrangements.findIndex(a => a.id === id);
    if (index >= 0) {
      this.course.arrangements.splice(index, 1);
    }
  }

  public parseRouterParams(params: CourseFormPageParams): void {
    if (params.formMode === FormMode.Edit && params.courseId) {
      this.formMode = params.formMode;
      for (const course of this._timetable.courses) {
        if (course.id === params.courseId && course.arrangements.length > 0) {
          this.course.assignForm(course);
          break;
        }
      }
    }
  }

  public save(): void {
    const course: Course = this.course.toCourse();
    if (!this.verify(course)) {
      return;
    }
    if (!course.color) {
      const lastCourseIndex: number = this._timetable.courses.length - 1;
      if (lastCourseIndex >= 0) {
        ColorPalette.setIndexByColor(this._timetable.courses[lastCourseIndex].color);
        course.color = ColorPalette.nextColor();
      } else {
        course.color = ColorPalette.getColor(0);
      }
    }
    TimetableUtils.upsertCourse(this._timetable, course);
    stores.pref.timetable = this._timetable;
    stores.pref.flushSync();
    stores.cache.courseDataVersion++;
    Toast.showMsg('保存成功');
    routerStack.pop();
  }

  private verify(course: Course): boolean {
    if (!course.name) {
      Toast.showMsg('请输入课程名称');
      return false;
    }
    if (TimetableUtils.hasSelfArrangementConflict(course)) {
      Toast.showMsg('当前课程存在时段重叠');
      return false;
    }
    for (const other of this._timetable.courses) {
      if (other.id === course.id) {
        continue;
      }
      if (TimetableUtils.isCourseTimeConflict(course, other)) {
        Toast.showMsg(`当前课程与已有课程 '${other.name}' 存在时段重叠`);
        return false;
      }
    }
    return true;
  }
}
