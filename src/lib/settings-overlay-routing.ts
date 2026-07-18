export type RoutePathLike = {
  pathname: string;
  search?: string;
  hash?: string;
};

export function toRoutePath(location: RoutePathLike): string {
  return `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`;
}

