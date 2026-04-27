import { CommonConst } from '../../common/CommonConst';

@ObservedV2
export class UIStore {

  public static readonly KEY: string = 'UI_STORE';

  @Trace
  public nickname: string = CommonConst.DEFAULT_NICKNAME;

  @Trace
  public avatar: string = '';

  @Trace
  public anonymousPhone: string = '';

  @Trace
  public hasPhoneBinding: boolean = false;

}
