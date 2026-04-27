import { PeriodRange } from '../common/CustomTypes';

const DEFAULT_PERIOD_RANGE: PeriodRange = {
  dayOfWeek: 0,
  periodStart: 0,
  periodEnd: 0
};

@ObservedV2
export class PeriodRangePickerVM {

  @Trace
  public totalPeriods: number = 1;

  @Trace
  public defaultSelected: PeriodRange = DEFAULT_PERIOD_RANGE;

  @Trace
  public onSelectedChange: Callback<PeriodRange> = () => {};

  @Trace
  public isOpen: boolean = false;

  @Trace
  public sheetType: SheetType = SheetType.BOTTOM;

  @Trace
  public onWillDismiss: Callback<DismissReason> = () => {};

  @Trace
  public onWillSpringBackWhenDismiss: Callback<SpringBackAction> = (action: SpringBackAction) => action.springBack();

  @Trace
  public close: () => void = () => {};
}
