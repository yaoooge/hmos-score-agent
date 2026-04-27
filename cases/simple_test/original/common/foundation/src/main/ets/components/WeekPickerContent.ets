import { WeekMaskUtils, WeekSelectMode } from 'module_course_schedule';
import { common } from '@kit.AbilityKit';

import { WindowListener } from '../utils/WindowListener';
import { WeekPickerVM } from '../viewmodels/WeekPickerVM';
import { TextCheckbox } from './TextCheckbox';
import { CircleButton } from './CircleButton';

const DEFAULT_CENTER_SHEET_HEIGHT: string = '560vp';
const DEFAULT_HEIGHT_RATIO: number = 0.6;
const HEIGHT_BREAKPOINT: number = 420;

@ComponentV2
export struct WeekPickerContent {

  @Param @Require
  public model: WeekPickerVM;

  private uiContext: UIContext = this.getUIContext();

  private abilityContext: common.UIAbilityContext = this.uiContext.getHostContext() as common.UIAbilityContext;

  private listener: WindowListener = new WindowListener(this.abilityContext);

  @Computed
  private get weekIndices(): number[] {
    const indices: number[] = [];
    for (let i: number = 0; i < this.model.totalWeeks; i++) {
      indices.push(i);
    }
    return indices;
  }

  @Computed
  private get bottomPadding(): string {
    if (this.model.sheetType === SheetType.BOTTOM && this.listener.avoidBottom) {
      return `${this.listener.avoidBottom}px`;
    }
    return '16vp';
  }

  @Computed
  private get sheetHeight(): string {
    if (this.model.sheetType === SheetType.CENTER) {
      return DEFAULT_CENTER_SHEET_HEIGHT;
    }
    const windowHeight: number = this.uiContext.px2vp(this.listener.windowSize.height);
    const avoidTop: number = this.uiContext.px2vp(this.listener.avoidTop) + 8;
    const safeHeight: number = windowHeight - avoidTop;
    if (safeHeight < HEIGHT_BREAKPOINT) {
      return `${safeHeight}vp`;
    } else {
      return `${safeHeight * DEFAULT_HEIGHT_RATIO}vp`;
    }
  }

  @Computed
  private get weekSelectedMode(): WeekSelectMode {
    if (!this.model.isMaskMode) {
      return WeekSelectMode.Custom;
    }
    return WeekMaskUtils.getWeekSelectModeByMask(this.model.selectedIndexOrMask, this.model.totalWeeks);
  }

  public aboutToAppear(): void {
    this.listener.start();
  }

  public aboutToDisappear(): void {
    this.listener.stop();
  }

  public build(): void {
    Column() {
      this.buildTitleBar()
      Scroll() {
        Column() {
          if (this.model.isMaskMode) {
            Row() {
              TextCheckbox({
                label: '每周',
                isSelected: this.weekSelectedMode === WeekSelectMode.All,
                onSelected: () => this.updateSelectedMaskByBode(WeekSelectMode.All)
              })
              TextCheckbox({
                label: '单周',
                isSelected: this.weekSelectedMode === WeekSelectMode.Odd,
                onSelected: () => this.updateSelectedMaskByBode(WeekSelectMode.Odd)
              })
              TextCheckbox({
                label: '双周',
                isSelected: this.weekSelectedMode === WeekSelectMode.Even,
                onSelected: () => this.updateSelectedMaskByBode(WeekSelectMode.Even)
              })
            }
            .width('100%')
            .padding({ left: 36, right: 36 })
            .justifyContent(FlexAlign.SpaceBetween)
          }
          Grid() {
            ForEach(this.weekIndices, (weekIndex: number) => {
              GridItem() {
                Button((weekIndex + 1).toString())
                  .width('100%')
                  .type(ButtonType.Circle)
                  .fontSize($r('sys.float.Body_L'))
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.isSelected(weekIndex, this.model.selectedIndexOrMask) ?
                    $r('sys.color.font_on_primary') : $r('sys.color.font_primary')
                  )
                  .backgroundColor(this.isSelected(weekIndex, this.model.selectedIndexOrMask) ?
                    $r('sys.color.multi_color_09') : $r('sys.color.comp_background_tertiary')
                  )
                  .onClick(() => {
                    if (this.model.isMaskMode) {
                      const weekNum: number = weekIndex + 1
                      const weekMask: number = this.model.selectedIndexOrMask;
                      if (WeekMaskUtils.isWeekInMask(weekMask, weekNum)) {
                        this.model.selectedIndexOrMask = WeekMaskUtils.removeWeekFromMask(weekMask, weekNum);
                      } else {
                        this.model.selectedIndexOrMask = WeekMaskUtils.addWeekToMask(weekMask, weekNum);
                      }
                    } else {
                      this.model.selectedIndexOrMask = weekIndex;
                    }
                    this.model.onSelectedChange(this.model.selectedIndexOrMask);
                  })
              }
            }, (item: number) => item.toString())
          }
          .width('100%')
          .height('auto')
          .columnsTemplate('1fr '.repeat(6))
          .columnsGap(8)
          .rowsGap(16)
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.None)
          .padding({ left: 16, right: 16, top: 8, bottom: this.bottomPadding })
        }
        .constraintSize({ minHeight: '100%' })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    }
    .width('100%')
    .height(this.sheetHeight)
    .justifyContent(FlexAlign.Start)
  }

  @Builder
  private buildTitleBar(): void {
    Row() {
      Text(this.model.title)
        .layoutWeight(1)
        .maxLines(1)
        .fontSize($r('sys.float.Title_S'))
        .fontColor($r('sys.color.font_primary'))
        .fontWeight(FontWeight.Bold)
      CircleButton({ symbol: $r('sys.symbol.xmark') })
        .onClick(() => this.model.onWillDismiss(DismissReason.CLOSE_BUTTON))
        .margin({ left: 8 })
    }
    .width('100%')
    .height(64)
    .padding({ top: 12, bottom: 12, left: 16, right: 16 })
  }

  private isSelected(index: number, selectedIndexOrMask: number): boolean {
    if (this.model.isMaskMode) {
      return WeekMaskUtils.isWeekInMask(selectedIndexOrMask, index + 1);
    } else {
      return index === selectedIndexOrMask;
    }
  }

  private updateSelectedMaskByBode(mode: WeekSelectMode): void {
    if (this.model.isMaskMode) {
      if (this.weekSelectedMode === mode) {
        this.model.selectedIndexOrMask = 0;
      } else {
        this.model.selectedIndexOrMask = WeekMaskUtils.getWeekMaskBySelectMode(mode, this.model.totalWeeks);
      }
      this.model.onSelectedChange(this.model.selectedIndexOrMask);
    }
  }
}
