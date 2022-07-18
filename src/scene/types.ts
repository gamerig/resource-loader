import { Loader, LoaderResource } from '../loader';

export interface ResourcesAwareScene {
  readonly resources: { [name: string]: LoaderResource };
}

export interface LoaderAwareScene {
  readonly loader: Loader;
}
