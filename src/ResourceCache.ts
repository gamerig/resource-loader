import { LoaderResource } from './loader/LoaderResource';

class ResourceCache {
  private _cache: { [name: string]: LoaderResource } = {};

  add(name: string, resource: LoaderResource): void {
    this._cache[name] = resource;
  }

  has(name: string): boolean {
    return name in this._cache;
  }

  get(name: string): LoaderResource | undefined {
    return this._cache[name];
  }

  remove(resource: string | LoaderResource): void {
    if (typeof resource === 'string') {
      delete this._cache[resource];
    } else {
      const name = Object.keys(this._cache).find((name) => this._cache[name] === resource);
      if (name) {
        delete this._cache[name];
      }
    }
  }

  clear(): void {
    this._cache = {};
  }

  get cache() {
    return this._cache;
  }
}

const GlobalResourceCache = new ResourceCache();

export { GlobalResourceCache, ResourceCache };
