import { CircleButton, WindowListener } from 'foundation';
import { common } from '@kit.AbilityKit';
import { PeriodRangePickerVM } from '../viewmodels/PeriodRangePickerVM';
import { PeriodRange } from '../common/CustomTypes';

const TITLE_BAR_HEIGHT: number = 64;
const PICKER_ITEM_HEIGHT: number = 48;
const WEEKDAY_LABELS: readonly string[] = [
  '周一', '周二', '周三', '周四', '周五', '周六', '周日'
];

@ComponentV2
export struct PeriodRangePickerContent {

  @Param @Require
  public model: PeriodRangePickerVM;

  @Local
  private selectedIndices: number[] = [0, 0, 0];

  private uiContext: UIContext = this.getUIContext();

  private abilityContext: common.UIAbilityContext = this.uiContext.getHostContext() as common.UIAbilityContext;

  private listener: WindowListener = new WindowListener(this.abilityContext);

  @Computed
  private get bottomPadding(): string {
    if (this.model.sheetType === SheetType.BOTTOM) {
      return `${this.listener.avoidBottom}px`;
    }
    return '0px';
  }

  @Computed
  private get sheetHeight(): string {
    const avoidBottom: number = this.uiContext.px2vp(this.listener.avoidBottom);
    const defaultSheetHeight: number = TITLE_BAR_HEIGHT + PICKER_ITEM_HEIGHT * 5 + avoidBottom + 24;
    if (this.model.sheetType === SheetType.BOTTOM) {
      const windowHeight: number = this.uiContext.px2vp(this.listener.windowSize.height);
      const avoidTop: number = this.uiContext.px2vp(this.listener.avoidTop) + 8;
      if (defaultSheetHeight > (windowHeight - avoidTop)) {
        return `${windowHeight - avoidTop}vp`;
      }
    }
    return `${defaultSheetHeight}vp`;
  }

  @Computed
  private get rangeForPicker(): string[][] {
    const range: string[][] = [[...WEEKDAY_LABELS], [], []];
    for (let i: number = 1; i <= this.model.totalPeriods; i++) {
      const periodLabel: string = `第${i}节`;
      range[1].push(periodLabel);
      range[2].push(periodLabel);
    }
    return range;
  }

  public aboutToAppear(): void {
    this.listener.start();
    this.initSelectedByPeriodRange(this.model.defaultSelected);
  }

  public aboutToDisappear(): void {
    this.listener.stop();
  }

  public build(): void {
    Column() {
      this.buildTitleBar()
      TextPicker({
        range: this.rangeForPicker,
        selected: $$this.selectedIndices
      })
        .width('100%')
        .layoutWeight(1)
        .canLoop(true)
        .defaultPickerItemHeight(PICKER_ITEM_HEIGHT)
        .selectedTextStyle({
          color: $r('sys.color.multi_color_09')
        })
        .onChange((_: string | string[], indices: number | number[]) => {
          if (Array.isArray(indices) && indices[2] < indices[1]) {
            this.selectedIndices = [indices[0], indices[1], indices[1]];
          }
        })
        .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    }
    .width('100%')
    .height(this.sheetHeight)
    .padding({ bottom: this.bottomPadding })
    .justifyContent(FlexAlign.Start)
  }

  @Builder
  private buildTitleBar(): void {
    Row() {
      CircleButton({ symbol: $r('sys.symbol.xmark') })
        .onClick(() => this.model.onWillDismiss(DismissReason.CLOSE_BUTTON))
        .margin({ right: 8 })
      Text('课程节数')
        .layoutWeight(1)
        .maxLines(1)
        .textAlign(TextAlign.Start)
        .fontSize($r('sys.float.Title_S'))
        .fontColor($r('sys.color.font_primary'))
        .fontWeight(FontWeight.Bold)
      CircleButton({ symbol: $r('sys.symbol.checkmark') })
        .onClick(() => {
          this.model.onSelectedChange({
            dayOfWeek: this.toSundayFirst(this.selectedIndices[0]),
            periodStart: this.selectedIndices[1],
            periodEnd: this.selectedIndices[2]
          });
        })
        .margin({ left: 8 })
    }
    .width('100%')
    .height(TITLE_BAR_HEIGHT)
    .padding({ top: 12, bottom: 12, left: 16, right: 16 })
  }

  private initSelectedByPeriodRange(range: PeriodRange): void {
    if (WEEKDAY_LABELS[range.dayOfWeek]) {
      this.selectedIndices[0] = this.toMondayFirst(range.dayOfWeek);
    }
    if (range.periodStart <= range.periodEnd && range.periodEnd < this.model.totalPeriods) {
      this.selectedIndices[1] = range.periodStart;
      this.selectedIndices[2] = range.periodEnd;
    }
  }

  private toMondayFirst(dayOfWeekSun0: number): number {
    return ((dayOfWeekSun0 % 7) + 6) % 7;
  }

  private toSundayFirst(dayOfWeekMon0: number): number {
    return ((dayOfWeekMon0 % 7) + 1) % 7;
  }
}
