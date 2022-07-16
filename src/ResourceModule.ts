import { IEngine, Module } from '@gamerig/core';

import { RESOURCE_CACHE_PROVIDER } from './constants';
import { Loader } from './loader/Loader';
import { caching } from './middleware/caching';
import { parsing } from './middleware/parsing';
import { GlobalResourceCache } from './ResourceCache';
import { ScenePlugin } from './scene';

export class ResourceModule implements Module {
  private _scenePlugin!: ScenePlugin;

  init(engine: IEngine): void {
    engine.addProvider({ key: RESOURCE_CACHE_PROVIDER, useValue: GlobalResourceCache });

    Loader.registerPlugin({ pre: caching(GlobalResourceCache) });
    Loader.registerPlugin({ use: parsing });

    this._scenePlugin = new ScenePlugin(engine);
  }

  destroy(): void {
    this._scenePlugin.destroy();
    GlobalResourceCache.clear();
  }
}
