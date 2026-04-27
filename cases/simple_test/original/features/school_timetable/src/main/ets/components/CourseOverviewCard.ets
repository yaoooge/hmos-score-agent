import { RelativeDay } from 'foundation';
import { CourseOverviewItem } from 'module_course_schedule';

@ComponentV2
export struct CourseOverviewCard {

  @Param @Require
  public course: CourseOverviewItem;

  @Param @Require
  public finishedPeriodIndex: number;

  @Param @Require
  public previewDay: RelativeDay;

  @Param @Require
  public courseDateLabel: string;

  @Computed
  private get isCourseFinished(): boolean {
    if (this.previewDay === RelativeDay.Tomorrow) {
      return false;
    }
    return this.course.periodEnd <= this.finishedPeriodIndex;
  }

  public build(): void {
    Row() {
      Circle()
        .size({ width: 16, height: 16 })
        .fill(this.isCourseFinished ? $r('sys.color.icon_tertiary') : $r('sys.color.multi_color_09'))
        .margin({ right: 16 })
      Column() {
        Text(this.courseDateLabel)
          .fontColor($r('sys.color.font_secondary'))
          .fontSize($r('sys.float.Body_S'))
          .fontWeight(FontWeight.Bold)
          .margin({ top: 8, bottom: 8 })
        Text(this.course.dayPartLabel)
          .fontColor($r('sys.color.font_secondary'))
          .fontSize($r('sys.float.Caption_M'))
          .margin({ bottom: 8 })
        Text(this.course.timeRangeLabel)
          .fontColor($r('sys.color.font_secondary'))
          .fontSize($r('sys.float.Caption_M'))
      }
      .width(80)
      .height('100%')
      .justifyContent(FlexAlign.Start)
      .alignItems(HorizontalAlign.Start)
      Stack({ alignContent: Alignment.TopEnd }) {
        Image(this.isCourseFinished ? $r('app.media.ic_notice_black') : $r('app.media.ic_notice_white'))
          .width(36)
          .draggable(false)
          .objectFit(ImageFit.Contain)
        Column() {
          Text(this.course.name)
            .fontColor(this.isCourseFinished ? $r('sys.color.font_secondary') : $r('sys.color.font_on_primary'))
            .fontSize($r('sys.float.Caption_L'))
            .fontWeight(FontWeight.Bold)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Column({ space: 6 }) {
            this.buildCardTextItem('讲师：', this.course.teacher)
            this.buildCardTextItem('教室：', this.course.location)
          }
        }
        .width('100%')
        .height('100%')
        .alignItems(HorizontalAlign.Start)
        .justifyContent(FlexAlign.SpaceBetween)
        .padding({ right: 36 })
      }
      .layoutWeight(1)
      .height('100%')
      .borderRadius(12)
      .backgroundColor(this.isCourseFinished ? $r('sys.color.background_secondary') : $r('sys.color.multi_color_09'))
      .padding({ left: 12, right: 12, top: 12, bottom: 12 })
    }
    .width('100%')
    .height(76)
  }

  @Builder
  public buildCardTextItem(label: string, content: string): void {
    Row() {
      Text(label)
        .fontColor(this.isCourseFinished ? $r('sys.color.font_secondary') : $r('sys.color.font_on_primary'))
        .fontSize($r('sys.float.Caption_M'))
        .fontWeight(FontWeight.Medium)
      Text(content ? content : '未知')
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.MARQUEE })
        .fontColor(this.isCourseFinished ? $r('sys.color.font_secondary') : $r('sys.color.font_on_primary'))
        .fontSize($r('sys.float.Caption_M'))
        .fontWeight(FontWeight.Medium)
    }
    .width('100%')
  }
}
