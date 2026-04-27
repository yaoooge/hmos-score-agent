

@ComponentV2
export struct TextCheckbox {

  @Param
  public label: string = '';

  @Param
  public isSelected: boolean = false;

  @Event
  public onSelected: () => void = () => {};

  public build(): void {
    Row({ space: 8 }) {
      Checkbox()
        .select(this.isSelected)
        .shape(CheckBoxShape.CIRCLE)
        .selectedColor($r('sys.color.multi_color_09'))
        .hitTestBehavior(HitTestMode.None)
      Text(this.label)
        .fontColor(this.isSelected ? $r('sys.color.font_primary') : $r('sys.color.font_secondary'))
        .fontSize($r('sys.float.Body_L'))
        .fontWeight(FontWeight.Medium)
    }
    .height(48)
    .onClick(() => this.onSelected())
  }
}
