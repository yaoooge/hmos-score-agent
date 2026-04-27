import { DialogType, TypePicker, CalendarPickerUtil } from '@hw-agconnect/ui-calendar-picker';
import { routerStack, CommonConst, TitleBar, WeekPicker, FeatureMenuItem, RouterConst, FormMode } from 'foundation';
import { CourseSchedulePanel } from 'module_course_schedule';
import { CourseFormPageParams, CourseDetailPageParams } from '../common/CustomTypes';
import { TimetablePageVM } from '../viewmodels/TimetablePageVM';

@ComponentV2
struct TimetablePage {

  private model: TimetablePageVM = new TimetablePageVM();

  private weekPicker: WeekPicker = new WeekPicker(this.getUIContext())
    .setTitle('查看周课表')
    .setTotalWeeks(CommonConst.DEFAULT_TOTAL_WEEKS)
    .onSelectedChange((weekIndex: number) => {
      this.model.setWeekNum(weekIndex + 1);
    })
    .onWillDismiss((reason: DismissReason) => {
      if (reason !== DismissReason.SLIDE_DOWN) {
        this.weekPicker.close();
      }
    });

  private readonly FEATURE_MENU_LIST: FeatureMenuItem[] = [
    {
      label: '设置开学日期',
      action: () => {
        CalendarPickerUtil.show({
          selected: this.model.getAnchorDate(),
          startDayOfWeek: 1,
          sheetTitle: '开学日期',
          type: TypePicker.SINGLE,
          dialogType: DialogType.SHEET,
          customColor: $r('sys.color.multi_color_09'),
          onSelected: (date: Date | Date[]) => {
            if (!Array.isArray(date)) {
              this.model.setAnchorDate(date);
            }
          }
        });
      }
    },
    {
      label: '添加课程',
      routerPageName: RouterConst.COURSE_FORM_PAGE_NAME,
      routerParams: { formMode: FormMode.Create } as CourseFormPageParams
    }
  ];

  public build(): void {
    NavDestination() {
      Column() {
        TitleBar({
          title: '课程中心',
          enableBackward: true,
          onBackButtonClick: () => routerStack.pop(),
          bgColor: $r('sys.color.comp_background_primary')
        })
        Scroll() {
          Column() {
            Divider()
              .strokeWidth(1)
              .color(Color.Transparent)
            Row() {
              Column() {
                Text(`第${this.model.weekNum}周`)
                  .fontColor($r('sys.color.multi_color_09'))
                  .fontSize($r('sys.float.Subtitle_L'))
                  .fontWeight(FontWeight.Medium)
                Text(this.model.weekRangeLabel)
                  .fontColor($r('sys.color.font_secondary'))
                  .fontSize($r('sys.float.Subtitle_S'))
                  .margin({ top: 4 })
              }
              .alignItems(HorizontalAlign.Start)
              Row({ space: 16 }) {
                this.buildWeekPickerButton()
                this.buildMenuButton()
              }
            }
            .width('100%')
            .height(72)
            .padding({ left: 16, right: 16 })
            .alignItems(VerticalAlign.Center)
            .justifyContent(FlexAlign.SpaceBetween)
            .backgroundColor($r('sys.color.comp_background_primary'))
            Divider()
              .color($r('sys.color.comp_divider'))
            CourseSchedulePanel({
              timetable: this.model.timetable,
              onCourseClick: (courseId: string) => {
                routerStack.pushPathByName(
                  RouterConst.COURSE_DETAIL_PAGE_NAME,
                  {
                    courseId: courseId
                  } as CourseDetailPageParams
                );
              }
            })
          }
          .width('100%')
          .constraintSize({ minHeight: '100%' })
          .justifyContent(FlexAlign.Start)
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('sys.color.background_secondary'))
      .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .hideTitleBar(true)
  }

  @Builder
  private buildWeekPickerButton(): void {
    Button() {
      Image($r('app.media.ic_calendar'))
        .width(14)
        .fillColor($r('sys.color.icon_on_primary'))
        .objectFit(ImageFit.Contain)
        .draggable(false)
    }
    .width(24)
    .height(24)
    .type(ButtonType.Circle)
    .backgroundColor($r('sys.color.multi_color_09'))
    .onClick(() => this.weekPicker.setSelectedIndexOrMask(this.model.weekNum - 1).open())
  }

  @Builder
  private buildMenuButton(): void {
    Button() {
      Stack({ alignContent: Alignment.Center }) {
        /*
         * Button 距离屏幕边缘过近，经测试，Menu 正常显示仍需 4vp，在不影响正常布局的情况下，需采用一
         * 个宽度相对较小的不可见组件做为菜单锚点。
         */
        Column()
          .width(20)
          .height('100%')
          .bindMenu(this.model.isFeatureMenuShown!!, this.buildFeatureMenu())
        SymbolGlyph($r('sys.symbol.plus'))
          .fontSize(14)
          .fontColor([$r('sys.color.icon_on_primary')])
          .fontWeight(FontWeight.Bold)
      }
    }
    .width(22)
    .height(22)
    .borderRadius(4)
    .type(ButtonType.Normal)
    .backgroundColor($r('sys.color.multi_color_09'))
    .onClick(() => this.model.isFeatureMenuShown = true)
  }

  @Builder
  private buildFeatureMenu(): void {
    Column() {
      ForEach(this.FEATURE_MENU_LIST, (item: FeatureMenuItem, index: number) => {
        if (index !== 0) {
          Divider()
            .padding({ left: 12, right: 12 })
        }
        Button() {
          Text(item.label)
            .width('100%')
            .textAlign(TextAlign.Start)
            .fontSize($r('sys.float.Subtitle_M'))
            .fontColor($r('sys.color.font_primary'))
            .fontWeight(FontWeight.Medium)
        }
        .width('100%')
        .height(48)
        .type(ButtonType.Normal)
        .borderRadius(16)
        .padding({ left: 12, right: 12 })
        .backgroundColor($r('sys.color.comp_background_primary'))
        .onClick(() => {
          // 菜单关闭动画立即下发
          animateToImmediately({ duration: 0 }, () => {
            this.model.isFeatureMenuShown = false;
          });
          if (item.routerPageName) {
            routerStack.pushPathByName(item.routerPageName, item.routerParams);
          }
          item.action && item.action();
        })
      }, (item: FeatureMenuItem, index: number) => item.label + index)
    }
    .width(140)
  }
}

@Builder
export function buildTimetablePage() {
  TimetablePage()
}
