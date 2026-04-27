import { CheckinRequest, CheckinResponse, GetCheckinInfoResponse } from '../models/ApiModels';
import { ErrorCode } from '../common/CustomTypes';

export const MOCK_CHECKIN_CODE: string = '1111';

export class Api {

  private static isMockCheckin: boolean = false;

  private static withDelay<T>(callback: () => T | Promise<T>, delay = 300): Promise<T> {
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result: T = await callback();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  }

  public static async getCheckinInfo(): Promise<GetCheckinInfoResponse> {
    return Api.withDelay(() => ({
      code: ErrorCode.NO_ERROR,
      message: 'success',
      courseId: 'MOCK_COURSE_ID',
      courseName: '概率论与数理统计',
      isCheckedIn: Api.isMockCheckin,
      checkinCode: Api.isMockCheckin ? MOCK_CHECKIN_CODE : ''
    } as GetCheckinInfoResponse));
  }

  public static async checkin(request: CheckinRequest): Promise<CheckinResponse> {
    return Api.withDelay(() => {
      if (request.checkinCode !== MOCK_CHECKIN_CODE) {
        return {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'unknown error'
        } as CheckinResponse;
      }
      Api.isMockCheckin = true;
      return {
        code: ErrorCode.NO_ERROR,
        message: 'success',
        checkinTime: Date.now()
      } as CheckinResponse;
    });
  }
}
