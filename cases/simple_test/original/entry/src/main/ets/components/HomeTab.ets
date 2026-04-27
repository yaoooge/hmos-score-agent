import { TitleBar, SegmentButtonV1, routerStack, RouterConst, RelativeDay, CommonConst } from 'foundation';
import { CourseOverviewCard, CourseDetailPageParams } from 'school_timetable';
import { CourseOverviewItem } from 'module_course_schedule';
import { ItemRestriction, SegmentButtonOptions, SegmentButtonTextItem } from '@kit.ArkUI';

import { HomeTabVM } from '../viewmodels/HomeTabVM';

@ComponentV2
struct HomeTab {

  private model: HomeTabVM = HomeTabVM.getInstance();

  public build(): void {
    Column() {
      TitleBar({ title: '首页' })
      Scroll() {
        GridRow({
          columns: 12,
          breakpoints: { value: ['320vp', '600vp', '840vp'] }
        }) {
          GridCol({
            span: { xs: 12, sm: 12, md: 10, lg: 8 },
            offset: { xs: 0, sm: 0, md: 1, lg: 2 }
          }) {
            Column({ space: 12 }) {
              this.buildBannerSwiper()
              this.buildCheckInButton()
              this.buildCourseOverview()
            }
            .width('100%')
            .padding({ left: 16, right: 16, bottom: 12 })
            .justifyContent(FlexAlign.Start)
          }
        }
        .constraintSize({ minHeight: '100%' })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Start)
  }

  @Builder
  private buildBannerSwiper(): void {
    Swiper() {
      ForEach(CommonConst.HOME_BANNER_LIST, (item: ResourceStr) => {
        Image(item)
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Cover)
          .draggable(false)
      }, (item: ResourceStr, index: number) => index + String(item))
    }
    .width('100%')
    .aspectRatio(21 / 10) // AspectRatio = Width / Height
    .indicator(Indicator.dot().selectedColor($r('sys.color.multi_color_09')))
    .loop(true)
    .autoPlay(true)
    .borderRadius(16)
    .backgroundColor(Color.Gray)
  }

  @Builder
  private buildCheckInButton(): void {
    Stack({ alignContent: Alignment.Start}) {
      RelativeContainer() {
        Image($r('app.media.ic_check_in_shadow'))
          .height(72)
          .draggable(false)
          .objectFit(ImageFit.Contain)
          .alignRules({
            center: { anchor: 'ic_check_in', align: VerticalAlign.Center },
            middle: { anchor: 'ic_check_in', align: HorizontalAlign.Center }
          })
          .translate({ x: -6, y: 6, z: -72 })
        Image($r('app.media.ic_check_in'))
          .height(72)
          .margin({ left: 16 })
          .draggable(false)
          .objectFit(ImageFit.Contain)
          .offset({ y: -4 })
          .id('ic_check_in')
      }
      .width('auto')
      .height('auto')
      Text('去签到')
        .width('100%')
        .textAlign(TextAlign.Center)
        .fontColor($r('sys.color.font_on_primary'))
        .fontSize($r('sys.float.Title_M'))
        .fontWeight(FontWeight.Bold)
        .offset({ y: -8 })
      Row() {
        Button() {
          SymbolGlyph($r('sys.symbol.chevron_forward'))
            .fontSize(24)
            .fontColor([$r('sys.color.multi_color_09')])
            .fontWeight(FontWeight.Normal)
        }
        .width(40)
        .height(40)
        .margin({ right: 16, bottom: 16 })
        .type(ButtonType.Circle)
        .backgroundColor($r('sys.color.comp_background_primary'))
      }
      .width('100%')
      .height('100%')
      .alignItems(VerticalAlign.Bottom)
      .justifyContent(FlexAlign.End)
    }
    .width('100%')
    .height(96)
    .clip(true)
    .borderRadius(16)
    .linearGradient({
      angle: '270deg',
      colors: [['#FFED6F21', 0], ['#FFFFC39F', 1]]
    })
    .onClick(() => this.model.goToCheckinPage())
  }

  @Builder
  private buildCourseOverview(): void {
    Column() {
      Stack({ alignContent: Alignment.End }) {
        Row() {
          SegmentButtonV1({
            options: SegmentButtonOptions.capsule({
              buttons: [
                { text: '今日课程' },
                { text: '明日课程' }
              ] as ItemRestriction<SegmentButtonTextItem>,
              multiply: false,
              fontColor: $r('sys.color.font_secondary'),
              selectedFontColor: $r('sys.color.font_on_primary'),
              fontSize: $r('sys.float.Body_S'),
              selectedFontSize: $r('sys.float.Body_S'),
              fontWeight: FontWeight.Bold,
              selectedFontWeight: FontWeight.Bold,
              selectedBackgroundColor: $r('sys.color.multi_color_09'),
              buttonPadding: { top: 8, bottom: 8, left: 0, right: 0 }
            }),
            selectedIndexes: [0],
            onIndexChanged: (index: number) => {
              /*
               * 主动调用 animateTo 并将 duration 设置为 0，以屏蔽 SegmentButtonV1 自带动画。
               */
              this.getUIContext().animateTo({ duration: 0 }, () => {
                this.model.previewDay = index === 0 ? RelativeDay.Today : RelativeDay.Tomorrow;
              });
            }
          })
            .width('60%')
        }
        .width('100%')
        .justifyContent(FlexAlign.Center)
        Column() {
          Image($r('app.media.ic_small_calendar_black'))
            .width(16)
            .height(16)
            .draggable(false)
          Text('全部')
            .fontColor($r('sys.color.font_primary'))
            .fontSize($r('sys.float.Caption_M'))
            .fontWeight(FontWeight.Regular)
            .margin({ top: 3 })
        }
        .padding({ left: 8, right: 8 })
        .onClick(() => routerStack.pushPathByName(RouterConst.TIMETABLE_PAGE_NAME, null))
      }
      this.buildCourseList()
    }
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor($r('sys.color.comp_background_primary'))
  }

  @Builder
  private buildCourseList(): void {
    Column() {
      Row() {
        Text(this.model.previewDay === RelativeDay.Today ? '今日课程' : '明日课程')
          .fontColor($r('sys.color.font_primary'))
          .fontSize($r('sys.float.Body_M'))
          .fontWeight(FontWeight.Bold)
        Text(` ${this.model.courseList.length}节`)
          .fontColor(this.model.courseList.length > 0 ?
            $r('sys.color.multi_color_09') :
            $r('sys.color.font_secondary')
          )
          .fontSize($r('sys.float.Subtitle_S'))
          .fontWeight(FontWeight.Bold)
      }
      .width('100%')
      .justifyContent(FlexAlign.Start)
      .margin({ top: 12 })
      Column() {
        if (this.model.courseList.length > 0) {
          Column({ space: 12 }) {
            ForEach(this.model.courseList, (item: CourseOverviewItem) => {
              CourseOverviewCard({
                course: item,
                finishedPeriodIndex: this.model.finishedPeriodIndex,
                previewDay: this.model.previewDay,
                courseDateLabel: this.model.courseDateLabel
              })
                .onClick(() => {
                  routerStack.pushPathByName(
                    RouterConst.COURSE_DETAIL_PAGE_NAME,
                    {
                      courseId: item.courseId
                    } as CourseDetailPageParams
                  );
                })
            }, (item: CourseOverviewItem, index: number) => JSON.stringify(item) + index)
          }
        } else {
          Image($r('app.media.ic_no_course'))
            .width(120)
            .draggable(false)
            .objectFit(ImageFit.Contain)
          Text('暂无预课程安排')
            .fontSize($r('sys.float.Body_M'))
            .fontWeight(FontWeight.Regular)
            .fontColor($r('sys.color.font_tertiary'))
          Button() {
            Row() {
              Image($r('app.media.ic_small_calendar_black'))
                .width(16)
                .height(16)
                .fillColor($r('sys.color.font_on_primary'))
                .draggable(false)
              Text('全部课程')
                .fontColor($r('sys.color.font_on_primary'))
                .fontSize($r('sys.float.Body_M'))
                .fontWeight(FontWeight.Regular)
                .margin({ left: 4 })
            }
          }
          .type(ButtonType.ROUNDED_RECTANGLE)
          .height(28)
          .padding({ left: 12, right: 12 })
          .backgroundColor($r('sys.color.multi_color_09'))
          .margin({ top: 16, bottom: 16 })
          .onClick(() => routerStack.pushPathByName(RouterConst.TIMETABLE_PAGE_NAME, null))
        }
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .margin({ top: 12 })
    }
  }
}

@Builder
export function buildHomeTab(): void {
  HomeTab()
}
