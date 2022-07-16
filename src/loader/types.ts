export enum XhrResponseType {
  DEFAULT = 'text',
  BUFFER = 'arraybuffer',
  BLOB = 'blob',
  DOCUMENT = 'document',
  JSON = 'json',
  TEXT = 'text',
}

export enum LoadType {
  XHR = 1,
  IMAGE = 2,
  AUDIO = 3,
  VIDEO = 4,
}

export enum StatusFlag {
  NONE = 0,
  DATA_URL = 1 << 0,
  COMPLETE = 1 << 1,
  LOADING = 1 << 2,
}

export enum ResourceType {
  UNKNOWN = 0,
  JSON = 1,
  XML = 2,
  IMAGE = 3,
  AUDIO = 4,
  VIDEO = 5,
  TEXT = 6,
}
