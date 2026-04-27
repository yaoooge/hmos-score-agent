export interface Location {
  latitude: number;
  longitude: number;
}

export enum ViewModelState {
  UNINITIALIZED = 'UNINITIALIZED',
  READY = 'READY',
  INIT_FAILED = 'INIT_FAILED'
}

export enum ErrorCode {
  UNKNOWN_ERROR = -1,
  NO_ERROR = 0
}
