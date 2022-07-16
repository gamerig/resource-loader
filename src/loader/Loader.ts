import { IEngine } from '../../engine/Engine';
import { IMessageBus } from '../../messaging/MessageBus';
import { AsyncQueue } from '../base/AsyncQueue';
import { parseUri } from '../base/parseUri';
import { Signal } from '../base/Signal';
import { LoaderEvent } from '.';
import { MAX_PROGRESS, rgxExtractUrlHash } from './constants';
import { LoaderMiddleware, LoaderPlugin } from './LoaderPlugin';
import { LoaderResource, ResourceMetadata } from './LoaderResource';
import { LoadType, XhrResponseType } from './types';

export type AddOptions = {
  crossOrigin?: string | boolean;
  timeout?: number;
  parentResource?: LoaderResource;
  loadType?: LoadType;
  xhrType?: XhrResponseType;
  metadata?: ResourceMetadata;
  cache?: boolean;
};

export type LoaderOptions = {
  baseUrl?: string;
  concurrency?: number;
};

class Loader {
  private _baseUrl: string;
  private _progress = 0;
  private _loading = false;
  private _defaultQueryString = '';

  private _beforeMiddleware: LoaderMiddleware[] = [];
  private _afterMiddleware: LoaderMiddleware[] = [];
  private _resourcesParsing: LoaderResource[] = [];

  /**
   * The `_loadResource` function bound with this object context.
   */
  private _boundLoadResource = (r: LoaderResource, d: () => void): void => this._loadResource(r, d);

  /**
   * The resources waiting to be loaded.
   */
  private _queue: AsyncQueue<any>;

  private _resources: Record<string, LoaderResource> = {};

  private _onProgressSignal: Signal<Loader.OnProgressSignal>;
  private _onErrorSignal: Signal<Loader.OnErrorSignal>;
  private _onLoadSignal: Signal<Loader.OnLoadSignal>;
  private _onStartSignal: Signal<Loader.OnStartSignal>;
  private _onCompleteSignal: Signal<Loader.OnCompleteSignal>;

  private readonly _events: IMessageBus;

  constructor(private readonly _engine: IEngine, options?: LoaderOptions) {
    this._events = this._engine.messaging;

    this._baseUrl = options?.baseUrl || '';

    this._beforeMiddleware = [];
    this._afterMiddleware = [];
    this._resourcesParsing = [];

    this._boundLoadResource = (r, d) => this._loadResource(r, d);

    this._queue = AsyncQueue.queue(this._boundLoadResource, options?.concurrency ?? 10);
    this._queue.pause();

    this._resources = {};

    this._onProgressSignal = new Signal();
    this._onErrorSignal = new Signal();
    this._onLoadSignal = new Signal();
    this._onStartSignal = new Signal();
    this._onCompleteSignal = new Signal();

    for (let i = 0; i < Loader._plugins.length; ++i) {
      const plugin = Loader._plugins[i];
      const { pre, use } = plugin;

      if (pre) {
        this.pre(pre);
      }

      if (use) {
        this.use(use);
      }
    }
  }

  add(
    name: string,
    url: string,
    options?: AddOptions,
    callback?: LoaderResource.OnCompleteSignal,
  ): this {
    // if loading already you can only add resources that have a parent.
    if (this._loading && (!options || !options.parentResource)) {
      throw new Error('Cannot add resources while the loader is running.');
    }

    // check if resource already exists.
    if (this._resources[name]) {
      throw new Error(`Resource named "${name}" already exists.`);
    }

    // add base url if this isn't an absolute url
    url = this._prepareUrl(url);

    // create the store the resource
    this._resources[name] = new LoaderResource(name, url, options);

    if (typeof callback === 'function') {
      this.resources[name].onAfterMiddleware.once(callback);
    }

    // if actively loading, make sure to adjust progress chunks for that parent and its children
    if (this._loading) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const parent = options?.parentResource;
      if (parent) {
        const incompleteChildren = [];

        for (let i = 0; i < parent.children.length; ++i) {
          if (!parent.children[i].isComplete) {
            incompleteChildren.push(parent.children[i]);
          }
        }

        const fullChunk = parent.progressChunk * (incompleteChildren.length + 1); // +1 for parent
        const eachChunk = fullChunk / (incompleteChildren.length + 2); // +2 for parent & new child

        parent.children.push(this._resources[name]);
        parent.progressChunk = eachChunk;

        for (let i = 0; i < incompleteChildren.length; ++i) {
          incompleteChildren[i].progressChunk = eachChunk;
        }

        this._resources[name].progressChunk = eachChunk;
      }
    }

    // add the resource to the queue
    this._queue.push(this._resources[name]);

    return this;
  }

  /**
   * Sets up a middleware function that will run *before* the
   * resource is loaded.
   */
  pre(fn: LoaderMiddleware): this {
    this._beforeMiddleware.push(fn);

    return this;
  }

  /**
   * Sets up a middleware function that will run *after* the
   * resource is loaded.
   */
  use(fn: LoaderMiddleware): this {
    this._afterMiddleware.push(fn);

    return this;
  }

  /**
   * Resets the queue of the loader to prepare for a new load.
   */
  reset(): this {
    this._progress = 0;
    this._loading = false;

    this._queue.kill();
    this._queue.pause();

    // abort all resource loads
    for (const k in this._resources) {
      const res = this._resources[k];

      if (res._onLoadBinding) {
        res._onLoadBinding.detach();
      }

      if (res.isLoading) {
        res.abort('loader reset');
      }
    }

    this._resources = {};

    return this;
  }

  /**
   * Starts loading the queued resources.
   */
  start(): this {
    // if the queue has already started we are done here
    if (this._loading) {
      return this;
    }

    if (this._queue.idle()) {
      this._onStart();
      this._onComplete();
    } else {
      // distribute progress chunks
      const numTasks = this._queue._tasks.length;
      const chunk = MAX_PROGRESS / numTasks;

      for (let i = 0; i < this._queue._tasks.length; ++i) {
        this._queue._tasks[i].data.progressChunk = chunk;
      }

      // notify we are starting
      this._onStart();

      // start loading
      this._queue.resume();
    }

    return this;
  }

  onStart(fn: Loader.OnStartSignal): void {
    this._onStartSignal.once(fn);
  }

  onProgress(fn: Loader.OnProgressSignal): void {
    this._onProgressSignal.add(fn);
  }

  onError(fn: Loader.OnErrorSignal): void {
    this._onErrorSignal.add(fn);
  }

  onLoad(fn: Loader.OnLoadSignal): void {
    this._onLoadSignal.add(fn);
  }

  onComplete(fn: Loader.OnCompleteSignal): void {
    this._onCompleteSignal.once(fn);
  }

  /**
   * The number of resources to load concurrently.
   */
  get concurrency(): number {
    return this._queue.concurrency;
  }
  set concurrency(concurrency: number) {
    this._queue.concurrency = concurrency;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }
  set baseUrl(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  get progress(): number {
    return this._progress;
  }

  get loading(): boolean {
    return this._loading;
  }

  get resources(): Record<string, LoaderResource> {
    return this._resources;
  }

  /**
   * Prepares a url for usage based on the configuration of this object
   */
  private _prepareUrl(url: string): string {
    const parsedUrl = parseUri(url, { strictMode: true });
    let result;

    // absolute url, just use it as is.
    if (parsedUrl.protocol || !parsedUrl.path || url.indexOf('//') === 0) {
      result = url;
    }
    // if baseUrl doesn't end in slash and url doesn't start with slash, then add a slash inbetween
    else if (
      this._baseUrl.length &&
      this._baseUrl.lastIndexOf('/') !== this._baseUrl.length - 1 &&
      url.charAt(0) !== '/'
    ) {
      result = `${this._baseUrl}/${url}`;
    } else {
      result = this._baseUrl + url;
    }

    // if we need to add a default querystring, there is a bit more work
    if (this._defaultQueryString) {
      const hash = rgxExtractUrlHash.exec(result)?.[0];
      if (hash) {
        // strip out current query
        result = result.substr(0, result.length - hash.length);

        if (result.indexOf('?') !== -1) {
          result += `&${this._defaultQueryString}`;
        } else {
          result += `?${this._defaultQueryString}`;
        }

        result += hash;
      }
    }

    return result;
  }

  /**
   * Loads a single resource.
   */
  private _loadResource(resource: LoaderResource, dequeue: () => void): void {
    resource._dequeue = dequeue;

    // run before middleware
    AsyncQueue.eachSeries(
      this._beforeMiddleware,
      (fn: any, next: (...args: any) => void) => {
        fn.call(this, resource, () => {
          // if the before middleware marks the resource as complete,
          // break and don't process any more before middleware
          next(resource.isComplete ? {} : null);
        });
      },
      () => {
        if (resource.isComplete) {
          this._onLoad(resource);
        } else {
          resource._onLoadBinding = resource.onComplete.once(this._onLoad, this);
          resource.load();
        }
      },
      true,
    );
  }

  /**
   * Called once loading has started.
   */
  private _onStart(): void {
    this._progress = 0;
    this._loading = true;

    this._onStartSignal.dispatch(this);

    this._events.publish(LoaderEvent.Started, this);
  }

  /**
   * Called once each resource has loaded.
   */
  private _onComplete(): void {
    this._progress = MAX_PROGRESS;
    this._loading = false;

    this._onCompleteSignal.dispatch(this, this._resources);

    this._events.publish(LoaderEvent.Complete, this, this._resources);
  }

  /**
   * Called each time a resources is loaded.
   * @param resource - The resource that was loaded
   */
  private _onLoad(resource: LoaderResource): void {
    resource._onLoadBinding = null;

    // remove this resource from the async queue, and add it to our list of resources that are being parsed
    this._resourcesParsing.push(resource);
    resource._dequeue();

    // run all the after middleware for this resource
    AsyncQueue.eachSeries(
      this._afterMiddleware,
      (fn: any, next: any) => {
        fn.call(this, resource, next);
      },
      () => {
        resource.onAfterMiddleware.dispatch(resource);

        this._progress = Math.min(MAX_PROGRESS, this._progress + resource.progressChunk);

        this._onProgressSignal.dispatch(this, resource);
        this._events.publish(LoaderEvent.Progress, this, resource);

        if (resource.error) {
          this._onErrorSignal.dispatch(resource.error, this, resource);
          this._events.publish(LoaderEvent.Failed, this, resource);
        } else {
          this._onLoadSignal.dispatch(this, resource);
          this._events.publish(LoaderEvent.Loaded, this, resource);
        }

        this._resourcesParsing.splice(this._resourcesParsing.indexOf(resource), 1);

        // do completion check
        if (this._queue.idle() && this._resourcesParsing.length === 0) {
          this._onComplete();
        }
      },
      true,
    );
  }

  private static _plugins: LoaderPlugin[] = [];

  public destroy(): void {
    this.reset();
  }

  public static registerPlugin(plugin: LoaderPlugin): typeof Loader {
    Loader._plugins.push(plugin);

    if (plugin.init) {
      plugin.init();
    }

    return Loader;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace Loader {
  export type OnStartSignal = (loader: Loader) => void;
  export type OnProgressSignal = (loader: Loader, resource: LoaderResource) => void;
  export type OnLoadSignal = (loader: Loader, resource: LoaderResource) => void;
  export type OnCompleteSignal = (
    loader: Loader,
    resources: Record<string, LoaderResource>,
  ) => void;
  export type OnErrorSignal = (error: Error, loader: Loader, resource: LoaderResource) => void;
}

export { Loader };
