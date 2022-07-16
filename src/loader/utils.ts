// tests if CORS is supported in XHR, if not we need to use XDR
export const useXdr = !!(
  (globalThis as any).XDomainRequest && !('withCredentials' in new XMLHttpRequest())
);

// noop
export function _noop(): void {
  /* empty */
}

export const setExtMap = (map: Record<string, any>, extname: string, val: number) => {
  if (extname && extname.indexOf('.') === 0) {
    extname = extname.substring(1);
  }

  if (!extname) {
    return;
  }

  map[extname] = val;
};

export const reqType = (xhr: XMLHttpRequest) => {
  return xhr.toString().replace('object ', '');
};
