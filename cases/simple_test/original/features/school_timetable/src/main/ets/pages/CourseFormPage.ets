import { routerStack, FormMode, TitleBar, WeekPicker, CommonConst } from 'foundation';
import { WeekMaskUtils } from 'module_course_schedule';
import { UIContext } from '@kit.ArkUI';

import { CourseFormPageParams, FunctionalMode, PeriodRange } from '../common/CustomTypes';
import { PeriodRangePicker } from '../controller/PeriodRangePicker';
import { CourseFormPageVM } from '../viewmodels/CourseFormPageVM';
import { CourseArrangementVM } from '../viewmodels/CourseArrangementVM';
import { FunctionalRow } from '../components/FunctionalRow';

@ComponentV2
struct CourseFormPage {

  private uiContext: UIContext = this.getUIContext();

  private model: CourseFormPageVM = new CourseFormPageVM();

  private scroller: Scroller = new Scroller();

  private periodRangePicker: PeriodRangePicker = new PeriodRangePicker(this.uiContext)
    .setTotalPeriods(this.model.totalPeriods)
    .onWillDismiss((reason: DismissReason) => {
      if (reason !== DismissReason.SLIDE_DOWN) {
        this.periodRangePicker.close();
      }
    });

  private weekPicker: WeekPicker = new WeekPicker(this.uiContext)
    .enableMaskMode(true)
    .setTitle('课程周期')
    .setTotalWeeks(this.model.weekCount)
    .onWillDismiss((reason: DismissReason) => {
      if (reason !== DismissReason.SLIDE_DOWN) {
        this.weekPicker.close();
      }
    });

  public build(): void {
    NavDestination() {
      Column() {
        TitleBar({
          title: this.model.formMode === FormMode.Create ? '添加课程' : '编辑课程',
          enableBackward: true,
          onBackButtonClick: () => routerStack.pop(),
          bgColor: Color.Transparent
        })
        Scroll(this.scroller) {
          Column({ space: 8 }) {
            this.buildBanner()
            FunctionalRow({
              label: '课程名称',
              placeholder: '请输入添加的课程名称',
              text: this.model.course.name,
              maxLength: CommonConst.MAX_COURSE_NAME_LENGTH,
              onTextChange: (name: string) => this.model.course.name = name
            })
            Divider()
            ForEach(this.model.course.arrangements, (arr: CourseArrangementVM, index: number) => {
              Column() {
                Row() {
                  Text(`时段${index + 1}`)
                    .fontSize($r('sys.float.Body_M'))
                    .fontColor($r('sys.color.font_secondary'))
                    .fontWeight(FontWeight.Medium)
                  if (this.model.course.arrangements.length > 1) {
                    SymbolGlyph($r('sys.symbol.xmark'))
                      .fontSize(24)
                      .fontWeight(FontWeight.Medium)
                      .fontColor([$r('sys.color.icon_primary')])
                      .onClick(() => this.model.deleteCourseArrangement(arr.id))
                  }
                }
                .width('100%')
                .height(36)
                .justifyContent(FlexAlign.SpaceBetween)
                .padding({ left: 12, right: 12 })
                Column({ space: 8 }) {
                  FunctionalRow({
                    label: '课程周期',
                    text: WeekMaskUtils.getWeekLabelByMask(arr.weekMask, this.model.weekCount),
                    mode: FunctionalMode.BUTTON,
                    onButtonClick: () => {
                      this.uiContext.getFocusController().clearFocus();
                      this.weekPicker
                        .setSelectedIndexOrMask(arr.weekMask)
                        .onSelectedChange((weekMask: number) => {
                          if (weekMask > 0) {
                            arr.weekMask = weekMask;
                          }
                        })
                        .open();
                    }
                  })
                  FunctionalRow({
                    label: '课程节数',
                    text: arr.periodLabel,
                    mode: FunctionalMode.BUTTON,
                    onButtonClick: () => {
                      this.uiContext.getFocusController().clearFocus();
                      this.periodRangePicker
                        .setDefaultSelected({
                          dayOfWeek: arr.dayOfWeek,
                          periodStart: arr.periodStart,
                          periodEnd: arr.periodEnd
                        })
                        .onSelectedChange((range: PeriodRange) => {
                          arr.dayOfWeek = range.dayOfWeek;
                          arr.periodStart = range.periodStart;
                          arr.periodEnd = range.periodEnd;
                          this.periodRangePicker.close();
                        })
                        .open();
                    }
                  })
                  FunctionalRow({
                    label: '教室地点',
                    placeholder: '请输入教室地点',
                    text: arr.location,
                    onTextChange: (location: string) => arr.location = location
                  })
                  FunctionalRow({
                    label: '任课教师',
                    placeholder: '请输入任课教师',
                    text: arr.teacher,
                    onTextChange: (teacher: string) => arr.teacher = teacher
                  })
                }
                .borderRadius(16)
                .backgroundColor($r('sys.color.comp_background_primary'))
              }
            }, (arr: CourseArrangementVM) => JSON.stringify(arr))
            Row() {
              SymbolGlyph($r('sys.symbol.plus'))
                .fontSize($r('sys.float.Body_S'))
                .fontColor([$r('sys.color.multi_color_09')])
                .fontWeight(FontWeight.Bolder)
              Text('添加更多时间段')
                .margin({ left: 4, right: 4 })
                .fontSize($r('sys.float.Body_S'))
                .fontColor($r('sys.color.multi_color_09'))
                .fontWeight(FontWeight.Bold)
            }
            .height(36)
            .justifyContent(FlexAlign.End)
            .onClick(() => {
              this.uiContext.animateTo(
                {
                  duration: 0,
                  onFinish: () => this.scroller.scrollEdge(Edge.Bottom)
                },
                () => this.model.createCourseArrangement()
              );
            })
          }
          .width('100%')
          .constraintSize({ minHeight: '100%' })
          .padding({ left: 16, right: 16, top: 8, bottom: 8 })
          .justifyContent(FlexAlign.Start)
          .alignItems(HorizontalAlign.End)
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
        Column() {
          Button('保存')
            .width('100%')
            .constraintSize({ maxWidth: 480 })
            .height(40)
            .type(ButtonType.Normal)
            .fontSize($r('sys.float.Body_L'))
            .fontWeight(FontWeight.Medium)
            .fontColor($r('sys.color.font_on_primary'))
            .backgroundColor($r('sys.color.multi_color_09'))
            .borderRadius(20)
            .onClick(() => this.model.save())
        }
        .padding({ left: 16, right: 16, bottom: 16 })
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('sys.color.background_secondary'))
      .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .hideTitleBar(true)
    .onReady((ctx: NavDestinationContext): void => {
      if (ctx.pathInfo.param) {
        this.model.parseRouterParams(ctx.pathInfo.param as CourseFormPageParams);
      }
    })
  }

  @Builder
  private buildBanner(): void {
    Row() {
      Column() {
        Text('当前学期')
          .width('100%')
          .maxLines(1)
          .fontColor($r('sys.color.font_on_primary'))
          .fontSize($r('sys.float.Subtitle_M'))
          .fontWeight(FontWeight.Bold)
          .margin({ bottom: 12 })
        Text(this.model.semesterLabel)
          .width('100%')
          .maxLines(2)
          .fontColor($r('sys.color.font_on_primary'))
          .fontSize($r('sys.float.Subtitle_M'))
          .fontWeight(FontWeight.Bold)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      Image($r('app.media.ic_people'))
        .height('100%')
        .draggable(false)
        .objectFit(ImageFit.Contain)
    }
    .width('100%')
    .height(104)
    .borderRadius(16)
    .padding({ left: 16, right: 12 })
    .linearGradient({
      angle: 90,
      colors: [['#FFED6F21', 0], ['#FFFFC39F', 1]]
    })
    .alignItems(VerticalAlign.Center)
  }
}

@Builder
export function buildCourseFormPage(): void {
  CourseFormPage()
}
