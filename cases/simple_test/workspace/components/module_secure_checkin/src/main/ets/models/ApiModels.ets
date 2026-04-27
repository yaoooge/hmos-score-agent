import { Location } from '../common/CustomTypes';

export interface ApiResponseBase {
  code?: number;
  message?: string;
}

export interface CheckinRequest {
  courseId: string;
  checkinCode: string;
  location: Location;
}

export interface CheckinResponse extends ApiResponseBase {
  checkinTime?: number;
}

export interface GetCheckinInfoResponse extends ApiResponseBase {
  courseId: string;
  courseName: string;
  checkinCode: string;
  isCheckedIn: boolean;
}
