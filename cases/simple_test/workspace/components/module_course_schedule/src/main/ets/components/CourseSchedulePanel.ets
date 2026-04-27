import * as Style from '../common/TimetableStyle';
import { DayPartBlock, CourseOverviewItem } from '../common/CustomTypes';
import { TimetableVM } from '../viewmodels/TimetableVM';
import { DateUtils } from '../utils/DateUtils';
import { ColorPalette } from '../utils/ColorPalette';

const WEEKDAY_ORDER: number[] = [1, 2, 3, 4, 5, 6, 0];

@ComponentV2
export struct CourseSchedulePanel {

  @Param @Require
  public timetable: TimetableVM;

  @Param
  public bgColor: ResourceColor = Color.Transparent;

  @Event
  public onCourseClick: (courseId: string) => void = () => {};

  @Local
  private timetableHeight: string | number = 'auto';

  @Computed
  private get guidelines(): GuideLineStyle[] {
    const lines: GuideLineStyle[] = [];
    let totalHeight: number = 0;
    for (const block of this.timetable.dayPartBlocks) {
      totalHeight = totalHeight + Style.DAY_PART_LABEL_HEIGHT;
      for (const index of block.periodIndices) {
        lines.push({
          id: this.getVAnchor(index),
          direction: Axis.Horizontal,
          position: { start: totalHeight }
        });
        totalHeight = totalHeight + Style.GRID_CELL_HEIGHT + Style.GRID_CELL_SPACE * 2;
      }
    }
    this.timetableHeight = totalHeight;
    return lines;
  }

  public build(): void {
    Column() {
      this.buildHeader()
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          ForEach(this.timetable.dayPartBlocks, (block: DayPartBlock) => {
            Text(block.dayPartLabel)
              .width('100%')
              .height(Style.DAY_PART_LABEL_HEIGHT)
              .fontColor('#FF333333')
              .fontSize($r('sys.float.Body_L'))
              .fontWeight(FontWeight.Medium)
              .padding({ left: Style.PADDING_LEFT })
            this.buildPeriodTable(block.periodIndices)
          }, (block: DayPartBlock, index: number) => JSON.stringify(block) + index)
        }
        RelativeContainer() {
          /*
           * 课程卡片在水平方向参照 '星期几' 进行相对布局
           *
           * WEEKDAY_ORDER: [1, 2, 3, 4, 5, 6, 0] -> 1: 周一, 2: 周二, ...0: 周日
           */
          ForEach(WEEKDAY_ORDER, (dayOfWeek: number, index: number) => {
            Column()
              .id(this.getHAnchor(dayOfWeek))
              .chainMode(Axis.Horizontal, ChainStyle.PACKED)
              .chainWeight({ horizontal: 1 })
              .alignRules({
                left: index === 0 ? {
                  anchor: '__container__', align: HorizontalAlign.Start
                } : {
                  anchor: this.getHAnchor(WEEKDAY_ORDER[index - 1]), align: HorizontalAlign.End
                },
                right: index === 6 ? {
                  anchor: '__container__', align: HorizontalAlign.End
                } : {
                  anchor: this.getHAnchor(WEEKDAY_ORDER[index + 1]), align: HorizontalAlign.Start
                }
              })
          }, (dayOfWeek: number) => dayOfWeek.toString())
          ForEach(this.timetable.weekCourseList, (course: CourseOverviewItem) => {
            Column() {
              this.buildCourseOverviewCard(course)
            }
            .height(this.calcCardContainerHeight(course))
            .alignRules({
              left: { anchor: this.getHAnchor(course.dayOfWeek), align: HorizontalAlign.Start },
              right: { anchor: this.getHAnchor(course.dayOfWeek), align: HorizontalAlign.End },
              top: { anchor: this.getVAnchor(course.periodStart), align: VerticalAlign.Top }
            })
            .padding({ left: Style.GRID_CELL_SPACE, top: Style.GRID_CELL_SPACE, bottom: Style.GRID_CELL_SPACE })
          }, (course: CourseOverviewItem, index: number) => JSON.stringify(course) + index)
        }
        .width('100%')
        .height(this.timetableHeight)
        .padding({ left: Style.PADDING_LEFT + Style.PERIOD_FLAG_WIDTH, right: Style.PADDING_RIGHT })
        .guideLine(this.guidelines)
      }
    }
    .width('100%')
    .backgroundColor(this.bgColor)
  }

  @Builder
  private buildHeader(): void {
    Row() {
      Column() {
        Text(this.timetable.monthStr)
          .fontSize($r('sys.float.Body_M'))
          .fontColor('#FF333333')
        Text('月')
          .fontSize($r('sys.float.Caption_M'))
          .fontColor('#FF333333')
          .margin({ top: 4 })
      }
      .width(Style.PERIOD_FLAG_WIDTH)
      .height(Style.GRID_CELL_HEIGHT)
      .borderRadius(12)
      .backgroundColor($r('sys.color.background_secondary'))
      .margin({ right: Style.GRID_CELL_SPACE })
      .alignItems(HorizontalAlign.Center)
      .justifyContent(FlexAlign.Center)
      Row({ space: Style.GRID_CELL_SPACE }) {
        ForEach(
          this.timetable.monToSunDates,
          (weekday: Date) => this.buildWeekdayCard(weekday, DateUtils.isSameDay(weekday, this.timetable.today)),
          (weekday: Date) => weekday.getTime().toString()
        )
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height(60)
    .padding({ left: Style.PADDING_LEFT, right: Style.PADDING_RIGHT })
    .backgroundColor($r('sys.color.comp_background_primary'))
  }

  @Builder
  private buildWeekdayCard(weekday: Date, isToday: boolean): void {
    Column() {
      Text(DateUtils.getWeekdayLabel(weekday))
        .fontSize($r('sys.float.Body_M'))
        .fontColor(isToday ? $r('sys.color.font_on_primary') : '#FF333333')
      Text(DateUtils.formatDateMdDot(weekday))
        .fontSize($r('sys.float.Caption_M'))
        .fontColor(isToday ? $r('sys.color.font_on_primary') : '#FF333333')
        .margin({ top: 4 })
    }
    .layoutWeight(1)
    .height(Style.GRID_CELL_HEIGHT)
    .borderRadius(8)
    .justifyContent(FlexAlign.Center)
    .backgroundColor(isToday ? $r('sys.color.multi_color_09') : Color.Transparent)
  }

  @Builder
  private buildPeriodTable(periodIndices: number[]): void {
    Column() {
      ForEach(periodIndices, (periodIndex: number) => {
        Text(`${periodIndex + 1}`)
          .width(Style.PERIOD_FLAG_WIDTH)
          .height(Style.GRID_CELL_HEIGHT)
          .textAlign(TextAlign.Center)
          .fontSize($r('sys.float.Body_M'))
          .fontColor('#FF333333')
          .margin({ left: Style.PADDING_LEFT, top: Style.GRID_CELL_SPACE, bottom: Style.GRID_CELL_SPACE })
          .borderRadius(12)
          .maxLines(1)
          .backgroundColor($r('sys.color.background_secondary'))
      }, (periodIndex: number) => periodIndex.toString())
    }
    .width('100%')
    .backgroundColor($r('sys.color.comp_background_primary'))
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private buildCourseOverviewCard(course: CourseOverviewItem): void {
    Column() {
      Text(`${course.name}${course.location ? `\n@${course.location}` : ''}`)
        .textAlign(TextAlign.Start)
        .fontColor(course.color)
        .fontSize($r('sys.float.Caption_M'))
        .fontWeight(FontWeight.Regular)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .heightAdaptivePolicy(TextHeightAdaptivePolicy.LAYOUT_CONSTRAINT_FIRST)
    }
    .width('100%')
    .height('100%')
    .borderRadius(8)
    .borderWidth(1)
    .borderColor(ColorPalette.applyAlpha(course.color, 0.4))
    .backgroundColor(ColorPalette.applyAlpha(course.color, 0.1))
    .alignItems(HorizontalAlign.Center)
    .justifyContent(FlexAlign.Center)
    .padding({ top: 4, bottom: 4 })
    .clip(true)
    .onClick(() => this.onCourseClick(course.courseId))
  }

  private getHAnchor(suffix: number | string): string {
    return Style.H_ANCHOR_PREFIX + suffix;
  }

  private getVAnchor(suffix: number | string): string {
    return Style.V_ANCHOR_PREFIX + suffix;
  }

  private calcCardContainerHeight(course: CourseOverviewItem): number {
    const periodCount: number = course.periodEnd - course.periodStart + 1;
    return (Style.GRID_CELL_HEIGHT + Style.GRID_CELL_SPACE * 2) * periodCount;
  }
}
