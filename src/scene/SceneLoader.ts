import { Engine } from '@gamerig/core';

import { Loader, LoaderEvent, LoaderOptions } from '../loader';

export class SceneLoader extends Loader {
  constructor(engine: Engine, options?: LoaderOptions) {
    super(options);

    this.onStart((loader) => {
      engine.messaging.publish(LoaderEvent.Started, loader);
    });

    this.onProgress((loader, resource) => {
      engine.messaging.publish(LoaderEvent.Progress, loader, resource);
    });

    this.onLoad((loader, resource): void => {
      engine.messaging.publish(LoaderEvent.Loaded, loader, resource);
    });

    this.onError((error, loader, resource) => {
      engine.messaging.publish(LoaderEvent.Failed, error, loader, resource);
    });

    this.onComplete((loader, resources) => {
      engine.messaging.publish(LoaderEvent.Complete, loader, resources);
    });
  }
}
