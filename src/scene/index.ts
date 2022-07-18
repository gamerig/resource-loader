import { LoaderAwareScene, ResourcesAwareScene } from './types';

declare module '@gamerig/core' {
  interface Scene extends ResourcesAwareScene, LoaderAwareScene {}
}

export * from './SceneLoader';
export * from './ScenePlugin';
export * from './types';
