import { NormalizedError, Logger } from 'foundation';
import { ComponentContent } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';

import { PeriodRange } from '../common/CustomTypes';
import { PeriodRangePickerVM } from '../viewmodels/PeriodRangePickerVM';
import { PeriodRangePickerContent } from '../components/PeriodRangePickerContent';

export class PeriodRangePicker {

  private uiContext: UIContext;

  private model: PeriodRangePickerVM = new PeriodRangePickerVM();

  private node: ComponentContent<PeriodRangePickerVM> | null = null;

  public setTotalPeriods(total: number): PeriodRangePicker {
    this.model.totalPeriods = total;
    return this;
  }

  public setDefaultSelected(range: PeriodRange): PeriodRangePicker {
    this.model.defaultSelected = range;
    return this;
  }

  public onSelectedChange(callback: (range: PeriodRange) => void): PeriodRangePicker {
    this.model.onSelectedChange = callback;
    return this;
  }

  public onWillDismiss(callback: (reason: DismissReason) => void): PeriodRangePicker {
    this.model.onWillDismiss = callback;
    return this;
  }

  public onWillSpringBackWhenDismiss(callback: (action: SpringBackAction) => void): PeriodRangePicker {
    this.model.onWillSpringBackWhenDismiss = callback;
    return this;
  }

  public async open(): Promise<boolean> {
    if (this.model.isOpen || this.node) {
      return false;
    }
    try {
      this.model.isOpen = true;
      this.node = new ComponentContent(this.uiContext, wrapBuilder(buildPeriodRangePickerContent), this.model);
      await this.uiContext.openBindSheet(this.node, {
        height: SheetSize.FIT_CONTENT,
        preferType: SheetType.CENTER,
        showClose: false,
        enableOutsideInteractive: false,
        onWillDismiss: (action: DismissSheetAction) => this.model.onWillDismiss(action.reason),
        onWillSpringBackWhenDismiss: (action: SpringBackAction) => this.model.onWillSpringBackWhenDismiss(action),
        onTypeDidChange: (type: SheetType) => this.model.sheetType = type,
        backgroundColor: $r('sys.color.background_secondary'),
        keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY
      });
      return true;
    } catch {
      this.model.isOpen = false;
      this.node = null;
      return false;
    }
  }

  public close(): void {
    if (this.model.isOpen && this.node) {
      this.model.isOpen = false;
      this.uiContext.closeBindSheet(this.node)
        .catch((e: BusinessError<void>) => Logger.error(NormalizedError.from(e).toLogLine()))
        .finally(() => this.node = null);
    }
  }

  constructor(uiContext: UIContext) {
    this.uiContext = uiContext;
    this.model.close = () => this.close();
    this.model.onWillDismiss = () => this.close();
  }
}

@Builder
function buildPeriodRangePickerContent(model: PeriodRangePickerVM): void {
  PeriodRangePickerContent({ model: model })
}
