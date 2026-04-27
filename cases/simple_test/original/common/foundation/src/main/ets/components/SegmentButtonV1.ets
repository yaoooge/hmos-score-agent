import { SegmentButton, SegmentButtonOptions } from '@kit.ArkUI';

@Component
export struct SegmentButtonV1 {

  @State @Require
  public options: SegmentButtonOptions;

  @Prop @Watch('onSelectedIndexesChanged')
  public selectedIndexes: number[] = [];

  public onIndexChanged: Callback<number> | undefined = undefined;

  public build(): void {
    SegmentButton({
      options: this.options,
      selectedIndexes: this.selectedIndexes
    })
  }

  public onSelectedIndexesChanged(): void {
    this.onIndexChanged && this.onIndexChanged(this.selectedIndexes[0]);
  }
}
