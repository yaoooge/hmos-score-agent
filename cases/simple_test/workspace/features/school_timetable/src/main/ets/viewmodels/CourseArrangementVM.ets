import { CourseArrangement, DateUtils, WeekMaskUtils, WeekSelectMode } from 'module_course_schedule';
import { CommonConst } from 'foundation';
import { util } from '@kit.ArkTS';

@ObservedV2
export class CourseArrangementVM {

  public id: string = util.generateRandomUUID(false);

  public courseId: string = '';

  @Trace
  public dayOfWeek: number = 1;

  @Trace
  public periodStart: number = 0;

  @Trace
  public periodEnd: number = 0;

  @Trace
  public location: string = '';

  @Trace
  public teacher: string = '';

  @Trace
  public weekMask: number = WeekMaskUtils.getWeekMaskBySelectMode(
    WeekSelectMode.All,
    CommonConst.DEFAULT_TOTAL_WEEKS
  );

  @Computed
  public get periodLabel(): string {
    const start: number = this.periodStart + 1;
    const end: number = this.periodEnd + 1;
    const periodPart: string = start === end ? `第${start}节` : `第${start}-${end}节`;
    const weekdayPart: string = DateUtils.getWeekdayLabelByDayOfWeek(this.dayOfWeek);
    return `${weekdayPart} ${periodPart}`;
  }

  public assignForm(arr: CourseArrangement): void {
    this.id = arr.id;
    this.courseId = arr.courseId;
    this.dayOfWeek = arr.dayOfWeek;
    this.periodStart = arr.periodStart;
    this.periodEnd = arr.periodEnd;
    this.location = arr.location;
    this.teacher = arr.teacher;
    this.weekMask = arr.weekMask;
  }

  public toArrangement(): CourseArrangement {
    return {
      id: this.id,
      courseId: this.courseId,
      dayOfWeek: this.dayOfWeek,
      periodStart: this.periodStart,
      periodEnd: this.periodEnd,
      location: this.location,
      teacher: this.teacher,
      weekMask: this.weekMask
    };
  }

  public static createForCourse(courseId: string): CourseArrangementVM {
    const arr: CourseArrangementVM = new CourseArrangementVM();
    arr.courseId = courseId;
    return arr;
  }

  constructor(arr?: CourseArrangement) {
    if (arr) {
      this.assignForm(arr);
    }
  }
}
