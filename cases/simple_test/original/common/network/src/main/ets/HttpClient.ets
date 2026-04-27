import { stores, CommonConst, ErrorCode, NormalizedError } from 'foundation';
import axios, { AxiosInstance, AxiosResponse, HttpStatusCode, InternalAxiosRequestConfig } from '@ohos/axios';
import { MockServer } from './mock/MockServer';

function createHttpClient(): AxiosInstance {
  const axiosInstance: AxiosInstance = axios.create({
    baseURL: CommonConst.API_BASE_URL,
    timeout: CommonConst.REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json'
    }
  });
  axiosInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (stores.pref.sessionToken) {
      config.headers.Authorization = stores.pref.sessionToken;
    }
    return config;
  });
  axiosInstance.interceptors.response.use(
    (response: AxiosResponse) => {
      const data: ESObject = response.data;
      if (data?.code !== undefined && data.code !== ErrorCode.NO_ERROR) {
        throw new NormalizedError(data.message, data.code);
      }
      return data;
    },
    (error: ESObject) => {
      if (
        axios.isAxiosError(error) &&
        error.response?.status === HttpStatusCode.Unauthorized &&
        error.config?.headers?.Authorization &&
        error.config.headers.Authorization === stores.pref.sessionToken
      ) {
        stores.cache.invalidSessionToken = stores.pref.sessionToken;
        return Promise.reject(new NormalizedError('Phone binding invalid', ErrorCode.PHONE_BINDING_INVALID));
      }
      return Promise.reject(error);
    }
  );
  if (CommonConst.IS_MOCK_ADAPTER_ENABLE) {
    const server: MockServer = new MockServer(axiosInstance);
    server.start();
  }
  return axiosInstance;
}

export const http: AxiosInstance = createHttpClient();
