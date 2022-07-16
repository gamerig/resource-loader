import { parseUri } from '../base/parseUri';
import { Signal } from '../base/Signal';
import {
  STATUS_EMPTY,
  STATUS_IE_BUG_EMPTY,
  STATUS_NONE,
  STATUS_OK,
  STATUS_TYPE_OK,
} from './constants';
import { LoadType, ResourceType, StatusFlag, XhrResponseType } from './types';
import { _noop, reqType, setExtMap, useXdr } from './utils';

let tempAnchor: any = null;

export interface ResourceMetadata {
  /**
   * The element to use for loading, instead of creating one.
   */
  loadElement?: HTMLImageElement | HTMLAudioElement | HTMLVideoElement;
  /**
   * Skips adding source(s) to the load element. This
   * is useful if you want to pass in a `loadElement` that you already added load sources to.
   */
  skipSource?: boolean;
  /**
   * The mime type to use for the source element
   * of a video/audio elment. If the urls are an array, you can pass this as an array as well
   * where each index is the mime type to use for the corresponding url index.
   */
  mimeType?: string | string[];

  /**
   * Used by BitmapFonts, Spritesheet and CompressedTextures as the options to used for
   * metadata when loading the child image.
   */
  imageMetadata?: ResourceMetadata;

  [key: string]: any;
}

interface LoaderResource {
  [key: string]: any;
}

class LoaderResource {
  blob?: Blob;

  readonly name: string;

  readonly url: string;

  readonly extension: string;

  data: any;

  crossOrigin?: string | boolean;

  timeout: number;

  loadType: LoadType;

  xhrType?: string;

  readonly cache: boolean;

  metadata: ResourceMetadata;

  error?: Error;

  xhr?: XMLHttpRequest;

  private xdr: any;

  readonly children: LoaderResource[];

  type: ResourceType;

  progressChunk: number;

  onStart: Signal<LoaderResource.OnStartSignal>;

  onProgress: Signal<LoaderResource.OnProgressSignal>;

  onComplete: Signal<LoaderResource.OnCompleteSignal>;

  onAfterMiddleware: Signal<LoaderResource.OnCompleteSignal>;

  private _flags: number;

  _dequeue: any = _noop;

  _onLoadBinding: any = null;

  private _elementTimer = 0;

  private _boundComplete: any = null;

  private _boundOnError: any = null;

  private _boundOnProgress: any = null;

  private _boundOnTimeout: any = null;

  private _boundXhrOnError: any = null;
  private _boundXhrOnTimeout: any = null;
  private _boundXhrOnAbort: any = null;
  private _boundXhrOnLoad: any = null;

  static setExtensionLoadType(extname: string, loadType: LoadType): void {
    setExtMap(LoaderResource._loadTypeMap, extname, loadType);
  }

  static setExtensionXhrType(extname: string, xhrType: XhrResponseType): void {
    setExtMap(LoaderResource._xhrTypeMap, extname, xhrType as any);
  }

  constructor(
    name: string,
    url: string | string[],
    options?: {
      crossOrigin?: string | boolean;
      timeout?: number;
      loadType?: LoadType;
      xhrType?: XhrResponseType;
      metadata?: ResourceMetadata;
      cache?: boolean;
    },
  ) {
    if (typeof name !== 'string' || typeof url !== 'string') {
      throw new Error('Both name and url are required for constructing a resource.');
    }

    options = options || {};

    this._flags = 0;

    // set data url flag, needs to be set early for some _determineX checks to work.
    this._setFlag(StatusFlag.DATA_URL, url.indexOf('data:') === 0);

    this.name = name;

    this.url = url;

    this.extension = this._getExtension();

    this.data = null;

    this.crossOrigin = options.crossOrigin === true ? 'anonymous' : options.crossOrigin;

    this.timeout = options.timeout || 0;

    this.loadType = options.loadType || this._determineLoadType();

    // The type used to load the resource via XHR. If unset, determined automatically.
    this.xhrType = options.xhrType;

    // should this resource be cached in the global resource manager
    // this will make it available between multiple scenes for example
    this.cache = options?.cache ?? false;

    // Extra info for middleware, and controlling specifics about how the resource loads.
    // Note that if you pass in a `loadElement`, the Resource class takes ownership of it.
    // Meaning it will modify it as it sees fit.
    this.metadata = options.metadata || {};

    // The error that occurred while loading (if any).
    this.error = undefined;

    // The XHR object that was used to load this resource. This is only set
    // when `loadType` is `LoaderResource.LOAD_TYPE.XHR`.
    this.xhr = undefined;

    // The child resources this resource owns.
    this.children = [];

    // The resource type.
    this.type = ResourceType.UNKNOWN;

    // The progress chunk owned by this resource.
    this.progressChunk = 0;

    // The `dequeue` method that will be used a storage place for the async queue dequeue method
    // used privately by the loader.
    this._dequeue = _noop;

    // Used a storage place for the on load binding used privately by the loader.
    this._onLoadBinding = null;

    // The timer for element loads to check if they timeout.
    this._elementTimer = 0;

    this._boundComplete = this.complete.bind(this);
    this._boundOnError = this._onError.bind(this);
    this._boundOnProgress = this._onProgress.bind(this);
    this._boundOnTimeout = this._onTimeout.bind(this);

    // xhr callbacks
    this._boundXhrOnError = this._xhrOnError.bind(this);
    this._boundXhrOnTimeout = this._xhrOnTimeout.bind(this);
    this._boundXhrOnAbort = this._xhrOnAbort.bind(this);
    this._boundXhrOnLoad = this._xhrOnLoad.bind(this);

    // Dispatched when the resource beings to load.
    this.onStart = new Signal();

    // Dispatched each time progress of this resource load updates.
    // Not all resources types and loader systems can support this event
    // so sometimes it may not be available. If the resource
    // is being loaded on a modern browser, using XHR, and the remote server
    // properly sets Content-Length headers, then this will be available.
    this.onProgress = new Signal();

    // Dispatched once this resource has loaded, if there was an error it will
    // be in the `error` property.
    this.onComplete = new Signal();

    // Dispatched after this resource has had all the *after* middleware run on it.
    this.onAfterMiddleware = new Signal();
  }

  /**
   * Stores whether or not this url is a data url.
   */
  get isDataUrl(): boolean {
    return this._hasFlag(StatusFlag.DATA_URL);
  }

  /**
   * Describes if this resource has finished loading. Is true when the resource has completely
   * loaded.
   */
  get isComplete(): boolean {
    return this._hasFlag(StatusFlag.COMPLETE);
  }

  /**
   * Describes if this resource is currently loading. Is true when the resource starts loading,
   * and is false again when complete.
   */
  get isLoading(): boolean {
    return this._hasFlag(StatusFlag.LOADING);
  }

  /**
   * Marks the resource as complete.
   *
   */
  complete(): void {
    this._clearEvents();
    this._finish();
  }

  /**
   * Aborts the loading of this resource, with an optional message.
   */
  abort(message: string): void {
    // abort can be called multiple times, ignore subsequent calls.
    if (this.error) {
      return;
    }

    // store error
    this.error = new Error(message);

    // clear events before calling aborts
    this._clearEvents();

    // abort the actual loading
    if (this.xhr) {
      this.xhr.abort();
    } else if (this.xdr) {
      this.xdr.abort();
    } else if (this.data) {
      // single source
      if (this.data.src) {
        this.data.src = LoaderResource.EMPTY_GIF;
      }
      // multi-source
      else {
        while (this.data.firstChild) {
          this.data.removeChild(this.data.firstChild);
        }
      }
    }

    // done now.
    this._finish();
  }

  /**
   * Kicks off loading of this resource. This method is asynchronous.
   */
  load(cb?: LoaderResource.OnCompleteSignal): void {
    if (this.isLoading) {
      return;
    }

    if (this.isComplete) {
      if (cb) {
        setTimeout(() => cb(this), 1);
      }

      return;
    } else if (cb) {
      this.onComplete.once(cb);
    }

    this._setFlag(StatusFlag.LOADING, true);

    this.onStart.dispatch(this);

    // if unset, determine the value
    if (this.crossOrigin === false || typeof this.crossOrigin !== 'string') {
      this.crossOrigin = this._determineCrossOrigin(this.url);
    }

    switch (this.loadType) {
      case LoadType.IMAGE:
        this.type = ResourceType.IMAGE;
        this._loadElement('image');
        break;

      case LoadType.AUDIO:
        this.type = ResourceType.AUDIO;
        this._loadSourceElement('audio');
        break;

      case LoadType.VIDEO:
        this.type = ResourceType.VIDEO;
        this._loadSourceElement('video');
        break;

      case LoadType.XHR:
      /* falls through */
      default:
        if (useXdr && this.crossOrigin) {
          this._loadXdr();
        } else {
          this._loadXhr();
        }
        break;
    }
  }

  /**
   * Checks if the flag is set.
   *
   * @param flag - The flag to check.
   * @return True if the flag is set.
   */
  private _hasFlag(flag: number): boolean {
    return (this._flags & flag) !== 0;
  }

  /**
   * (Un)Sets the flag.
   *
   * @param flag - The flag to (un)set.
   * @param value - Whether to set or (un)set the flag.
   */
  private _setFlag(flag: number, value: boolean): void {
    this._flags = value ? this._flags | flag : this._flags & ~flag;
  }

  /**
   * Clears all the events from the underlying loading source.
   */
  private _clearEvents(): void {
    clearTimeout(this._elementTimer);

    if (this.data && this.data.removeEventListener) {
      this.data.removeEventListener('error', this._boundOnError, false);
      this.data.removeEventListener('load', this._boundComplete, false);
      this.data.removeEventListener('progress', this._boundOnProgress, false);
      this.data.removeEventListener('canplaythrough', this._boundComplete, false);
    }

    if (this.xhr) {
      if (this.xhr.removeEventListener) {
        this.xhr.removeEventListener('error', this._boundXhrOnError, false);
        this.xhr.removeEventListener('timeout', this._boundXhrOnTimeout, false);
        this.xhr.removeEventListener('abort', this._boundXhrOnAbort, false);
        this.xhr.removeEventListener('progress', this._boundOnProgress, false);
        this.xhr.removeEventListener('load', this._boundXhrOnLoad, false);
      } else {
        this.xhr.onerror = null;
        this.xhr.ontimeout = null;
        this.xhr.onprogress = null;
        this.xhr.onload = null;
      }
    }
  }

  /**
   * Finalizes the load.
   */
  private _finish(): void {
    if (this.isComplete) {
      throw new Error('Complete called again for an already completed resource.');
    }

    this._setFlag(StatusFlag.COMPLETE, true);
    this._setFlag(StatusFlag.LOADING, false);

    this.onComplete.dispatch(this);
  }

  _loadElement(type: string): void {
    if (this.metadata.loadElement) {
      this.data = this.metadata.loadElement;
    } else if (type === 'image' && typeof globalThis.Image !== 'undefined') {
      this.data = new Image();
    } else {
      this.data = document.createElement(type);
    }

    if (this.crossOrigin) {
      this.data.crossOrigin = this.crossOrigin;
    }

    if (!this.metadata.skipSource) {
      this.data.src = this.url;
    }

    this.data.addEventListener('error', this._boundOnError, false);
    this.data.addEventListener('load', this._boundComplete, false);
    this.data.addEventListener('progress', this._boundOnProgress, false);

    if (this.timeout) {
      this._elementTimer = setTimeout(this._boundOnTimeout, this.timeout) as any;
    }
  }

  /**
   * Loads this resources using an element that has multiple sources,
   * like an HTMLAudioElement or HTMLVideoElement.
   * @param type - The type of element to use.
   */
  private _loadSourceElement(type: string): void {
    if (this.metadata.loadElement) {
      this.data = this.metadata.loadElement;
    } else if (type === 'audio' && typeof globalThis.Audio !== 'undefined') {
      this.data = new Audio();
    } else {
      this.data = document.createElement(type);
    }

    if (this.data === null) {
      this.abort(`Unsupported element: ${type}`);

      return;
    }

    if (this.crossOrigin) {
      this.data.crossOrigin = this.crossOrigin;
    }

    if (!this.metadata.skipSource) {
      // support for CocoonJS Canvas+ runtime, lacks document.createElement('source')
      if ((navigator as any).isCocoonJS) {
        this.data.src = Array.isArray(this.url) ? this.url[0] : this.url;
      } else if (Array.isArray(this.url)) {
        const mimeTypes = this.metadata.mimeType;

        for (let i = 0; i < this.url.length; ++i) {
          this.data.appendChild(
            this._createSource(
              type,
              this.url[i],
              Array.isArray(mimeTypes) ? mimeTypes[i] : mimeTypes,
            ),
          );
        }
      } else {
        const mimeTypes = this.metadata.mimeType;

        this.data.appendChild(
          this._createSource(type, this.url, Array.isArray(mimeTypes) ? mimeTypes[0] : mimeTypes),
        );
      }
    }

    this.data.addEventListener('error', this._boundOnError, false);
    this.data.addEventListener('load', this._boundComplete, false);
    this.data.addEventListener('progress', this._boundOnProgress, false);
    this.data.addEventListener('canplaythrough', this._boundComplete, false);

    this.data.load();

    if (this.timeout) {
      this._elementTimer = setTimeout(this._boundOnTimeout, this.timeout) as any;
    }
  }

  /**
   * Loads this resources using an XMLHttpRequest.
   */
  private _loadXhr(): void {
    // if unset, determine the value
    if (typeof this.xhrType !== 'string') {
      this.xhrType = this._determineXhrType();
    }

    const xhr = (this.xhr = new XMLHttpRequest());

    // send credentials when crossOrigin with credentials requested
    if (this.crossOrigin === 'use-credentials') {
      xhr.withCredentials = true;
    }

    // set the request type and url
    xhr.open('GET', this.url, true);

    xhr.timeout = this.timeout;

    // load json as text and parse it ourselves. We do this because some browsers
    // *cough* safari *cough* can't deal with it.
    if (this.xhrType === XhrResponseType.JSON || this.xhrType === XhrResponseType.DOCUMENT) {
      xhr.responseType = XhrResponseType.TEXT;
    } else {
      xhr.responseType = this.xhrType as any;
    }

    xhr.addEventListener('error', this._boundXhrOnError, false);
    xhr.addEventListener('timeout', this._boundXhrOnTimeout, false);
    xhr.addEventListener('abort', this._boundXhrOnAbort, false);
    xhr.addEventListener('progress', this._boundOnProgress, false);
    xhr.addEventListener('load', this._boundXhrOnLoad, false);

    xhr.send();
  }

  /**
   * Loads this resources using an XDomainRequest. This is here because we need to support IE9 (gross).
   */
  private _loadXdr(): void {
    // if unset, determine the value
    if (typeof this.xhrType !== 'string') {
      this.xhrType = this._determineXhrType();
    }

    const xdr = (this.xhr = new (globalThis as any).XDomainRequest()); // eslint-disable-line no-undef

    // XDomainRequest has a few quirks. Occasionally it will abort requests
    // A way to avoid this is to make sure ALL callbacks are set even if not used
    // More info here: http://stackoverflow.com/questions/15786966/xdomainrequest-aborts-post-on-ie-9
    xdr.timeout = this.timeout || 5000; // XDR needs a timeout value or it breaks in IE9

    xdr.onerror = this._boundXhrOnError;
    xdr.ontimeout = this._boundXhrOnTimeout;
    xdr.onprogress = this._boundOnProgress;
    xdr.onload = this._boundXhrOnLoad;

    xdr.open('GET', this.url, true);

    // Note: The xdr.send() call is wrapped in a timeout to prevent an
    // issue with the interface where some requests are lost if multiple
    // XDomainRequests are being sent at the same time.
    // Some info here: https://github.com/photonstorm/phaser/issues/1248
    setTimeout(() => xdr.send(), 1);
  }

  /**
   * Creates a source used in loading via an element.
   * @param type - The element type (video or audio).
   * @param url - The source URL to load from.
   * @param [mime] - The mime type of the video
   * @return The source element.
   */
  private _createSource(type: string, url: string, mime: string | undefined): HTMLSourceElement {
    if (!mime) {
      mime = `${type}/${this._getExtension(url)}`;
    }

    const source = document.createElement('source');

    source.src = url;
    source.type = mime;

    return source;
  }

  /**
   * Called if a load errors out.
   *
   * @param event - The error event from the element that emits it.
   */
  private _onError(event: Event): void {
    this.abort(`Failed to load element using: ${(event.target as any).nodeName}`);
  }

  /**
   * Called if a load progress event fires for an element or xhr/xdr.
   * @param event - Progress event.
   */
  private _onProgress(event: ProgressEvent): void {
    if (event && event.lengthComputable) {
      this.onProgress.dispatch(this, event.loaded / event.total);
    }
  }

  /**
   * Called if a timeout event fires for an element.
   */
  private _onTimeout(): void {
    this.abort(`Load timed out.`);
  }

  /**
   * Called if an error event fires for xhr/xdr.
   */
  private _xhrOnError(): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const xhr = this.xhr!;

    this.abort(`${reqType(xhr)} Request failed. Status: ${xhr.status}, text: "${xhr.statusText}"`);
  }

  /**
   * Called if an error event fires for xhr/xdr.
   */
  private _xhrOnTimeout(): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const xhr = this.xhr!;

    this.abort(`${reqType(xhr)} Request timed out.`);
  }

  /**
   * Called if an abort event fires for xhr/xdr.
   */
  private _xhrOnAbort(): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const xhr = this.xhr!;

    this.abort(`${reqType(xhr)} Request was aborted by the user.`);
  }

  /**
   * Called when data successfully loads from an xhr/xdr request.
   */
  private _xhrOnLoad(): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const xhr = this.xhr!;
    let text = '';
    let status = typeof xhr.status === 'undefined' ? STATUS_OK : xhr.status; // XDR has no `.status`, assume 200.

    // responseText is accessible only if responseType is '' or 'text' and on older browsers
    if (
      xhr.responseType === '' ||
      xhr.responseType === 'text' ||
      typeof xhr.responseType === 'undefined'
    ) {
      text = xhr.responseText;
    }

    // status can be 0 when using the `file://` protocol so we also check if a response is set.
    // If it has a response, we assume 200; otherwise a 0 status code with no contents is an aborted request.
    if (
      status === STATUS_NONE &&
      (text.length > 0 || xhr.responseType === XhrResponseType.BUFFER)
    ) {
      status = STATUS_OK;
    }
    // handle IE9 bug: http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
    else if (status === STATUS_IE_BUG_EMPTY) {
      status = STATUS_EMPTY;
    }

    const statusType = (status / 100) | 0;

    if (statusType === STATUS_TYPE_OK) {
      // if text, just return it
      if (this.xhrType === XhrResponseType.TEXT) {
        this.data = text;
        this.type = ResourceType.TEXT;
      }
      // if json, parse into json object
      else if (this.xhrType === XhrResponseType.JSON) {
        try {
          this.data = JSON.parse(text);
          this.type = ResourceType.JSON;
        } catch (e) {
          this.abort(`Error trying to parse loaded json: ${e}`);

          return;
        }
      }
      // if xml, parse into an xml document or div element
      else if (this.xhrType === XhrResponseType.DOCUMENT) {
        try {
          if (globalThis.DOMParser) {
            const domparser = new DOMParser();

            this.data = domparser.parseFromString(text, 'text/xml');
          } else {
            const div = document.createElement('div');

            div.innerHTML = text;

            this.data = div;
          }

          this.type = ResourceType.XML;
        } catch (e) {
          this.abort(`Error trying to parse loaded xml: ${e}`);

          return;
        }
      }
      // other types just return the response
      else {
        this.data = xhr.response || text;
      }
    } else {
      this.abort(`[${xhr.status}] ${xhr.statusText}: ${xhr.responseURL}`);

      return;
    }

    this.complete();
  }

  /**
   * Sets the `crossOrigin` property for this resource based on if the url
   * for this resource is cross-origin. If crossOrigin was manually set, this
   * function does nothing.
   * @private
   * @param url - The url to test.
   * @param [loc=globalThis.location] - The location object to test against.
   * @return The crossOrigin value to use (or empty string for none).
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  _determineCrossOrigin(url: string, loc?: any): string {
    // data: and javascript: urls are considered same-origin
    if (url.indexOf('data:') === 0) {
      return '';
    }

    // A sandboxed iframe without the 'allow-same-origin' attribute will have a special
    // origin designed not to match globalThis.location.origin, and will always require
    // crossOrigin requests regardless of whether the location matches.
    if (globalThis.origin !== globalThis.location.origin) {
      return 'anonymous';
    }

    // default is globalThis.location
    loc = loc || globalThis.location;

    if (!tempAnchor) {
      tempAnchor = document.createElement('a');
    }

    // let the browser determine the full href for the url of this resource and then
    // parse with the node url lib, we can't use the properties of the anchor element
    // because they don't work in IE9 :(
    tempAnchor.href = url;
    const parsedUrl = parseUri(tempAnchor.href, { strictMode: true });

    const samePort = (!parsedUrl.port && loc.port === '') || parsedUrl.port === loc.port;
    const protocol = parsedUrl.protocol ? `${parsedUrl.protocol}:` : '';

    // if cross origin
    if (parsedUrl.host !== loc.hostname || !samePort || protocol !== loc.protocol) {
      return 'anonymous';
    }

    return '';
  }

  /**
   * Determines the responseType of an XHR request based on the extension of the
   * resource being loaded.
   */
  private _determineXhrType(): XhrResponseType {
    return LoaderResource._xhrTypeMap[this.extension] || XhrResponseType.TEXT;
  }

  /**
   * Determines the loadType of a resource based on the extension of the
   * resource being loaded.
   */
  private _determineLoadType(): LoadType {
    return LoaderResource._loadTypeMap[this.extension] || LoadType.XHR;
  }

  /**
   * Extracts the extension (sans '.') of the file being loaded by the resource.
   *
   * @param [url] - url to parse, `this.url` by default.
   * @return The extension.
   */
  private _getExtension(url = this.url): string {
    let ext = '';

    if (this.isDataUrl) {
      const slashIndex = url.indexOf('/');

      ext = url.substring(slashIndex + 1, url.indexOf(';', slashIndex));
    } else {
      const queryStart = url.indexOf('?');
      const hashStart = url.indexOf('#');
      const index = Math.min(
        queryStart > -1 ? queryStart : url.length,
        hashStart > -1 ? hashStart : url.length,
      );

      url = url.substring(0, index);
      ext = url.substring(url.lastIndexOf('.') + 1);
    }

    return ext.toLowerCase();
  }

  /**
   * Determines the mime type of an XHR request based on the responseType of
   * resource being loaded.
   *
   * @param type - The type to get a mime type for.
   * @private
   * @return The mime type to use.
   */
  _getMimeFromXhrType(type: XhrResponseType): string {
    switch (type) {
      case XhrResponseType.BUFFER:
        return 'application/octet-binary';

      case XhrResponseType.BLOB:
        return 'application/blob';

      case XhrResponseType.DOCUMENT:
        return 'application/xml';

      case XhrResponseType.JSON:
        return 'application/json';

      case XhrResponseType.DEFAULT:
      case XhrResponseType.TEXT:
      /* falls through */
      default:
        return 'text/plain';
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace LoaderResource {
  export type OnStartSignal = (resource: LoaderResource) => void;
  export type OnProgressSignal = (resource: LoaderResource, percentage: number) => void;
  export type OnCompleteSignal = (resource: LoaderResource) => void;

  export const _loadTypeMap: Record<string, number> = {
    // images
    gif: LoadType.IMAGE,
    png: LoadType.IMAGE,
    bmp: LoadType.IMAGE,
    jpg: LoadType.IMAGE,
    jpeg: LoadType.IMAGE,
    tif: LoadType.IMAGE,
    tiff: LoadType.IMAGE,
    webp: LoadType.IMAGE,
    tga: LoadType.IMAGE,
    svg: LoadType.IMAGE,
    'svg+xml': LoadType.IMAGE, // for SVG data urls

    // audio
    mp3: LoadType.AUDIO,
    ogg: LoadType.AUDIO,
    wav: LoadType.AUDIO,

    // videos
    mp4: LoadType.VIDEO,
    webm: LoadType.VIDEO,
  };

  export const _xhrTypeMap: Record<string, XhrResponseType> = {
    // xml
    xhtml: XhrResponseType.DOCUMENT,
    html: XhrResponseType.DOCUMENT,
    htm: XhrResponseType.DOCUMENT,
    xml: XhrResponseType.DOCUMENT,
    tmx: XhrResponseType.DOCUMENT,
    svg: XhrResponseType.DOCUMENT,

    // This was added to handle Tiled Tileset XML, but .tsx is also a TypeScript React Component.
    // Since it is way less likely for people to be loading TypeScript files instead of Tiled files,
    // this should probably be fine.
    tsx: XhrResponseType.DOCUMENT,

    // images
    gif: XhrResponseType.BLOB,
    png: XhrResponseType.BLOB,
    bmp: XhrResponseType.BLOB,
    jpg: XhrResponseType.BLOB,
    jpeg: XhrResponseType.BLOB,
    tif: XhrResponseType.BLOB,
    tiff: XhrResponseType.BLOB,
    webp: XhrResponseType.BLOB,
    tga: XhrResponseType.BLOB,

    // json
    json: XhrResponseType.JSON,

    // text
    text: XhrResponseType.TEXT,
    txt: XhrResponseType.TEXT,

    // fonts
    ttf: XhrResponseType.BUFFER,
    otf: XhrResponseType.BUFFER,
  };

  // We can't set the `src` attribute to empty string, so on abort we set it to this 1px transparent gif
  export const EMPTY_GIF =
    'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
}

export { LoaderResource };
