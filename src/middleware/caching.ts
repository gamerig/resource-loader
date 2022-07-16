import { LoaderMiddleware } from '../loader';
import { LoaderResource } from '../loader/LoaderResource';
import { ResourceCache } from '../ResourceCache';

export const caching = (cache: ResourceCache): LoaderMiddleware => {
  return (resource: LoaderResource, next: (...args: any[]) => void): void => {
    if (cache.has(resource.url)) {
      resource.data = cache.get(resource.url)?.data;
      resource.complete();
    } else {
      resource.onComplete.once((r: LoaderResource) => {
        r.cache && cache.add(r.url, r);
        r.cache && cache.add(r.name, r);
      });
    }

    next();
  };
};
