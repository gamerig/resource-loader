import { LoaderResource } from './loader/LoaderResource';

export class ResourceCache {
  private _cache: { [key: string]: LoaderResource } = {};

  add(key: string, resource: LoaderResource): void {
    this._cache[key] = resource;
  }

  has(key: string): boolean {
    return key in this._cache;
  }

  get(key: string): LoaderResource | undefined {
    return this._cache[key];
  }

  remove(resource: string | LoaderResource): void {
    if (typeof resource === 'string') {
      delete this._cache[resource];
    } else {
      const key = Object.keys(this._cache).find((key) => this._cache[key] === resource);
      if (key) {
        delete this._cache[key];
      }
    }
  }

  clear(): void {
    this._cache = {};
  }
}

export const GlobalResourceCache = new ResourceCache();
