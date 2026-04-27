import { routerStack, FormMode, TitleBar, RouterConst } from 'foundation';
import { WeekMaskUtils } from 'module_course_schedule';
import { CourseDetailPageParams, CourseFormPageParams } from '../common/CustomTypes';
import { CourseDetailPageVM } from '../viewmodels/CourseDetailPageVM';
import { CourseArrangementVM } from '../viewmodels/CourseArrangementVM';

@ComponentV2
struct CourseDetailPage {

  private model: CourseDetailPageVM = new CourseDetailPageVM();

  public build(): void {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
        this.buildBackgroundBanner()
        Column() {
          TitleBar({
            title: '课程详情',
            enableBackward: true,
            onBackButtonClick: () => routerStack.pop(),
            bgColor: Color.Transparent
          })
          Scroll() {
            Column() {
              Text(this.model.course.name)
                .width('100%')
                .fontWeight(FontWeight.Bold)
                .fontSize($r('sys.float.Body_L'))
                .fontColor($r('sys.color.font_primary'))
                .margin({ top: 8, bottom: 8 })
              ForEach(this.model.course.arrangements, (item: CourseArrangementVM, index: number) => {
                if (this.model.course.arrangements.length > 1) {
                  Text(`时间段${index + 1}`)
                    .width('100%')
                    .fontWeight(FontWeight.Medium)
                    .fontSize($r('sys.float.Subtitle_S'))
                    .fontColor($r('sys.color.font_secondary'))
                    .margin({ top: 12 })
                }
                Column({ space: 8 }) {
                  Text(WeekMaskUtils.getWeekLabelByMask(item.weekMask, this.model.weekCount))
                    .width('100%')
                    .fontWeight(FontWeight.Regular)
                    .fontSize($r('sys.float.Body_S'))
                    .fontColor($r('sys.color.font_secondary'))
                  Divider()
                  this.buildIconTextRow($r('sys.symbol.clock'), this.model.getArrangementTimeLabel(item))
                  this.buildIconTextRow($r('sys.symbol.local'), item.location || '暂无教室信息')
                  if (item.teacher) {
                    Row() {
                      Image($r('app.media.atomic_default_avatar'))
                        .width(24)
                        .height(24)
                        .draggable(false)
                        .margin({ right: 8 })
                      Text(item.teacher)
                        .layoutWeight(1)
                        .fontWeight(FontWeight.Medium)
                        .fontSize($r('sys.float.Body_M'))
                        .fontColor($r('sys.color.font_primary'))
                    }
                  }
                }
                .width('100%')
                .borderRadius(16)
                .backgroundColor($r('sys.color.background_primary'))
                .padding({ top: 16, bottom: 16, left: 12, right: 12 })
                .margin({ top: 8 })
              }, (item: CourseArrangementVM, index: number) => JSON.stringify(item) + index)
            }
            .width('100%')
            .constraintSize({ minHeight: '100%' })
            .padding({ left: 16, right: 16, bottom: 12 })
            .justifyContent(FlexAlign.Start)
          }
          .layoutWeight(1)
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
          Row() {
            this.buildFunctionalButton($r('sys.symbol.square_and_pencil'), '编辑', () => {
              routerStack.pushPathByName(
                RouterConst.COURSE_FORM_PAGE_NAME, {
                  formMode: FormMode.Edit,
                  courseId: this.model.course.id
                } as CourseFormPageParams
              );
            })
            this.buildFunctionalButton($r('sys.symbol.trash'), '删除', () => {
              this.getUIContext().showAlertDialog({
                message: '课程删除后将会从课程中心移除且无法恢复，是否删除？',
                height: 136,
                buttons: [
                  {
                    value: '取消',
                    fontColor: $r('sys.color.font_primary'),
                    action: () => {}
                  },
                  {
                    value: '删除',
                    fontColor: $r('sys.color.warning'),
                    action: () => this.model.delete()
                  }
                ]
              });
            })
          }
        }
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('sys.color.background_secondary'))
      .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .hideTitleBar(true)
    .onReady((ctx: NavDestinationContext): void => {
      if (ctx.pathInfo.param) {
        this.model.parseRouterParams(ctx.pathInfo.param as CourseDetailPageParams);
      }
    })
  }

  @Builder
  private buildIconTextRow(icon: Resource, label: string): void {
    Row() {
      SymbolGlyph(icon)
        .fontSize(16)
        .fontColor([$r('sys.color.icon_secondary')])
        .margin({ right: 8 })
      Text(label)
        .layoutWeight(1)
        .fontWeight(FontWeight.Regular)
        .fontSize($r('sys.float.Body_S'))
        .fontColor($r('sys.color.font_secondary'))
    }
    .width('100%')
  }

  @Builder
  private buildFunctionalButton(icon: Resource, label: string, onClick: () => void): void {
    Column() {
      SymbolGlyph(icon)
        .fontSize(24)
        .fontColor([$r('sys.color.icon_primary')])
      Text(label)
        .fontColor($r('sys.color.font_primary'))
        .fontSize($r('sys.float.Caption_M'))
        .margin({ top: 4 })
    }
    .height(52)
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .onClick(() => onClick())
  }

  @Builder
  private buildBackgroundBanner(): void {
    Column()
      .width('100%')
      .height(160)
      .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP])
      .opacity(0.4)
      .linearGradient({
        angle: 0,
        colors: [[$r('sys.color.background_secondary'), 0], ['#FFED6F21', 1]]
      })
  }
}

@Builder
export function buildCourseDetailPage(): void {
  CourseDetailPage()
}
