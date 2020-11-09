import * as fs from 'fs';
import * as req from 'request';

export interface SourceLocale {
  id: string;
  name: string;
  code: string;
}
export interface PhraseLocale {
  id: string;
  name: string;
  code: string;
  default: boolean;
  main: boolean;
  rtl: boolean;
  plural_forms: string[];
  source_locale: SourceLocale;
  created_at: Date;
  updated_at: Date;
}

export class PhraseClient {
  readonly token: string;
  readonly apiBaseUrl: string;

  constructor(token: string, apiBaseUrl: string) {
    this.token = token;
    this.apiBaseUrl = apiBaseUrl;
  }

  async fetchLocales(projectId: string): Promise<PhraseLocale[]> {
    return new Promise((resolve, reject) => {
      req.get(
        {
          headers: {
            Authorization: 'token ' + this.token,
          },
          url: `${this.apiBaseUrl}/projects/${projectId}/locales`,
        },
        function (error, response, body) {
          if (response && response.statusCode === 200) {
            resolve(<PhraseLocale[]>JSON.parse(body));
            return;
          }
          reject(error || response);
        },
      );
    });
  }

  async uploadLocale(
    localeId: string,
    localePath: string,
    localeName: string,
    projectId: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      req.post(
        {
          headers: {
            Authorization: 'token ' + this.token,
          },
          url: `${this.apiBaseUrl}/projects/${projectId}/uploads`,
          formData: {
            file: fs.createReadStream(localePath + '/' + localeName + '.json'),
            locale_id: localeId,
            file_format: 'nested_json',
          },
        },
        function (error, response, body) {
          if (response && response.statusCode === 201) {
            resolve(JSON.parse(body)?.id);
            return;
          }
          reject(error || response);
        },
      );
    });
  }
  async downloadLocale(localeId: string, projectId: string) {
    return new Promise((resolve, reject) => {
      req.get(
        {
          headers: {
            Authorization: 'token ' + this.token,
          },
          url: `${this.apiBaseUrl}/projects/${projectId}/locales/${localeId}/download/?file_format=nested_json`,
        },
        // tslint:disable:no-identical-functions
        function (error, response, body) {
          if (response && response.statusCode === 200) {
            resolve(body);
            return;
          }
          reject(error || response);
        },
      );
    });
  }
  async removeUnmentionedKeys(projectId: string, uploadId: string) {
    if (!uploadId) {
      return Promise.reject('uploadId must be truthy');
    }
    const uploadSucceeded = await this.ensureUploadSucceeded(
      projectId,
      uploadId,
    );
    return new Promise((resolve, reject) => {
      if (!uploadSucceeded) {
        console.warn(
          `unmentioned keys for upload with id ${uploadId} could not be removed.`,
        );
        reject();
      }
      req.delete(
        {
          headers: {
            Authorization: 'token ' + this.token,
          },
          url: `${this.apiBaseUrl}/projects/${projectId}/keys?q=unmentioned_in_upload:${uploadId}`,
        },
        // tslint:disable:no-identical-functions
        function (error, response, body) {
          if (response && response.statusCode === 200) {
            resolve(body);
            return;
          }
          reject(error || response);
        },
      );
    });
  }

  ensureUploadSucceeded(
    projectId: string,
    uploadId: string,
    interval: number = 1000,
    iterations: number = 5,
  ): Promise<boolean> {
    if (!uploadId) {
      return Promise.reject('uploadId must be truthy');
    }
    if (!projectId) {
      return Promise.reject('projectId must be truthy');
    }
    return new Promise((resolve, reject) => {
      let iteration = 0;
      const intervalId = setInterval(() => {
        if (iteration >= iterations) {
          console.warn(
            `timed out after ${
              interval * iterations
            }ms while waiting for phrase to process upload with id ${uploadId}`,
          );
          resolve(false);
          clearInterval(intervalId);
        }
        this.requestUploadState(
          projectId,
          uploadId,
          resolve,
          intervalId,
          reject,
        );
        iteration++;
      }, interval);
    });
  }

  private requestUploadState(
    projectId: string,
    uploadId: string,
    resolve: (value?: boolean | PromiseLike<boolean>) => void,
    intervalId: NodeJS.Timeout,
    reject: (reason?: any) => void,
  ) {
    req.get(
      {
        headers: {
          Authorization: 'token ' + this.token,
        },
        url: `${this.apiBaseUrl}/projects/${projectId}/uploads/${uploadId}`,
      },
      (error, response, body) => {
        if (response && response.statusCode === 200) {
          const state = JSON.parse(body)?.state;
          if (state === 'success') {
            resolve(true);
            clearInterval(intervalId);
          }
          if (state === 'error') {
            console.warn('upload details returned error state');
            resolve(false);
            clearInterval(intervalId);
          }
          return;
        }
        reject(error || response);
        clearInterval(intervalId);
      },
    );
  }
}
