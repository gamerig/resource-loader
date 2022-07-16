import { Loader } from '../loader';
import { ResourceCache } from '../ResourceCache';

declare module '@gamerig/core' {
  interface Scene {
    readonly loader: Loader;
    readonly resources: ResourceCache;
  }
}

export * from './SceneLoader';
export * from './ScenePlugin';
