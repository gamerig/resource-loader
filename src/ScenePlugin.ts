import { IEngine } from '../engine/Engine';
import { EventListener, IMessageBus } from '../messaging/MessageBus';
import { Scene } from '../scene/Scene';
import { SceneEvent } from '../scene/SceneEvent';
import { Loader } from './loader/Loader';
import { RESOURCE_CACHE_PROVIDER, ResourceCache } from './ResourceCache';

export class ScenePlugin {
  private _events: IMessageBus;
  private _sceneListeners: EventListener[] = [];

  constructor(private readonly _engine: IEngine) {
    this._events = this._engine.messaging;
    const resources = this._engine.resolve<ResourceCache>(RESOURCE_CACHE_PROVIDER);

    this._sceneListeners.push(
      this._events.subscribe(SceneEvent.Init, (scene: Scene): void => {
        const loader = new Loader(this._engine, {
          baseUrl: '',
          concurrency: 10,
        });

        Object.defineProperties(scene, {
          loader: { value: loader, writable: false },
          resources: { value: resources, writable: false },
        });
      }),
    );

    this._sceneListeners.push(
      this._events.subscribe(SceneEvent.Loading, (scene: Scene): void => {
        scene.loader.start();
      }),
    );

    this._sceneListeners.push(
      this._events.subscribe(SceneEvent.Stopped, (scene: Scene): void => {
        scene.loader.reset();
      }),
    );

    this._sceneListeners.push(
      this._events.subscribe(SceneEvent.Destroyed, (scene: Scene): void => {
        scene.loader.destroy();
      }),
    );
  }

  destroy(): void {
    this._sceneListeners.forEach((listener) => listener.off());
    this._sceneListeners = [];
  }
}
