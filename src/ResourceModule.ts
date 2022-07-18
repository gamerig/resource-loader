import { Engine, Module } from '@gamerig/core';

import { RESOURCE_CACHE_PROVIDER } from './constants';
import { Loader } from './loader/Loader';
import { caching } from './middleware/caching';
import { parsing } from './middleware/parsing';
import { GlobalResourceCache } from './ResourceCache';
import { ScenePlugin } from './scene';

export class ResourceModule implements Module {
  private scenePlugin: ScenePlugin;

  init(engine: Engine): void {
    engine.registerProvider({ key: RESOURCE_CACHE_PROVIDER, useValue: GlobalResourceCache });

    Loader.registerPlugin({ pre: caching(GlobalResourceCache) });
    Loader.registerPlugin({ use: parsing });

    this.scenePlugin = new ScenePlugin(engine, GlobalResourceCache);
  }

  destroy(): void {
    this.scenePlugin.destroy();
    GlobalResourceCache.clear();
  }
}
