import { Course } from 'module_course_schedule';
import { util } from '@kit.ArkTS';
import { CourseArrangementVM } from './CourseArrangementVM';

@ObservedV2
export class CourseVM {

  public id: string = util.generateRandomUUID(false);

  public color: string = '';

  @Trace
  public name: string = '';

  @Trace
  public arrangements: CourseArrangementVM[] = [];

  public assignForm(course: Course): void {
    this.id = course.id;
    this.color = course.color;
    this.name = course.name;
    this.arrangements = course.arrangements.map(arr => new CourseArrangementVM(arr));
  }

  public toCourse(): Course {
    return {
      id: this.id,
      color: this.color,
      name: this.name,
      arrangements: this.arrangements.map(vm => vm.toArrangement())
    };
  }

  constructor(course?: Course) {
    if (course) {
      this.assignForm(course);
    }
    if (this.arrangements.length === 0) {
      this.arrangements.push(CourseArrangementVM.createForCourse(this.id));
    }
  }
}
