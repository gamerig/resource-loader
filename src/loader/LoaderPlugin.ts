import { LoaderResource } from './LoaderResource';

export type LoaderMiddleware = (resource: LoaderResource, next: (...args: any[]) => void) => void;

export interface LoaderPlugin {
  init?(): void;
  pre?: LoaderMiddleware;
  use?: LoaderMiddleware;
}
