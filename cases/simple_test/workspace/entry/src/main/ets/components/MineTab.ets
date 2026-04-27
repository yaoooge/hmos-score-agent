import { AtomicserviceLogin } from 'atomicservice_login';
import { TitleBar, CommonConst, stores, Logger, NormalizedError, AccountErrorCode } from 'foundation';
import { BusinessError } from '@kit.BasicServicesKit';
import { UIContext } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { MineTabVM } from '../viewmodels/MineTabVM';

@ComponentV2
struct MineTab {

  private uiContext: UIContext = this.getUIContext();

  private model: MineTabVM = new MineTabVM();

  public build(): void {
    Column() {
      TitleBar({
        title: '我的',
        bgColor: $r('sys.color.background_primary')
      })
      Scroll() {
        Column() {
          Stack({ alignContent: Alignment.End }) {
            Image($r('app.media.ic_cap'))
              .height(86)
              .draggable(false)
              .margin({ right: 20 })
              .objectFit(ImageFit.Contain)
            this.buildUserInfoPanel()
          }
          .width('100%')
          .height(112)
          .borderRadius({ bottomLeft: 32, bottomRight: 32 })
          .padding({ left: 24, right: 24 })
          .backgroundColor($r('sys.color.background_primary'))
        }
        .constraintSize({ minHeight: '100%' })
        .justifyContent(FlexAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: false })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private buildUserInfoPanel(): void {
    Row() {
      AtomicserviceLogin({
        userInfo: this.model.userInfo,
        initValue: CommonConst.DEFAULT_NICKNAME,
        isLink: stores.ui.hasPhoneBinding,
        unBindPhone: () => this.model.unBindPhone(),
        bindPhone: (code: string | undefined) => this.model.bindPhone(code),
        onGetPhoneError: (e: BusinessError<void>) => {
          const err: NormalizedError = NormalizedError.from(e);
          if (err.code !== AccountErrorCode.USER_CANCELED) {
            Logger.error(err.toLogLine());
            this.uiContext.showAlertDialog({
              title: '授权服务拉起失败',
              message: '您可以通过模拟关联继续流程。',
              buttons: [
                {
                  value: '取消',
                  action: () => {}
                },
                {
                  value: '模拟关联',
                  action: () => this.model.bindPhone(util.generateRandomUUID(false))
                }
              ]
            });
          }
        }
      })
    }
    .width('100%')
    .height('100%')
    .alignItems(VerticalAlign.Center)
  }
}

@Builder
export function buildMineTab(): void {
  MineTab()
}
