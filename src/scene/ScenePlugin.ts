import { Engine, EventListener, MessageBus, Scene, SceneEvent } from '@gamerig/core';

import { ResourceCache } from '../ResourceCache';
import { SceneLoader } from './SceneLoader';

export class ScenePlugin {
  private events: MessageBus;
  private sceneListeners: EventListener[] = [];

  constructor(readonly engine: Engine, readonly resources: ResourceCache) {
    this.events = this.engine.messaging;

    this.sceneListeners.push(
      this.events.subscribe(SceneEvent.Init, (scene: Scene): void => {
        const loader = new SceneLoader(this.engine, {
          baseUrl: '',
          concurrency: 10,
        });

        Object.defineProperties(scene, {
          loader: { value: loader, writable: false },
          resources: { value: this.resources.cache, writable: false },
        });
      }),
    );

    this.sceneListeners.push(
      this.events.subscribe(SceneEvent.Loading, (scene: Scene): void => {
        scene.loader.start();
      }),
    );

    this.sceneListeners.push(
      this.events.subscribe(SceneEvent.Stopped, (scene: Scene): void => {
        scene.loader.reset();
      }),
    );

    this.sceneListeners.push(
      this.events.subscribe(SceneEvent.Destroyed, (scene: Scene): void => {
        scene.loader.destroy();
      }),
    );
  }

  destroy(): void {
    this.sceneListeners.forEach((listener) => listener.off());
    this.sceneListeners = [];
  }
}
