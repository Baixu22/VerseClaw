export type ImageMetadata = {
  width: number;
  height: number;
};

export type ImageProbe = ImageMetadata & {
  orientation?: number;
  hasAlpha?: boolean;
};

export class RastermillError extends Error {
  constructor(
    message: string,
    readonly code = 'RASTERMILL_ERROR',
  ) {
    super(message);
    this.name = 'RastermillError';
  }
}

export class RastermillUnavailableError extends RastermillError {
  readonly causes: unknown[];

  constructor(message = 'Rastermill is unavailable in Vitest', causes: unknown[] = []) {
    super(message, 'RASTERMILL_UNAVAILABLE');
    this.name = 'RastermillUnavailableError';
    this.causes = causes;
  }
}

export function isRastermillUnavailableError(error: unknown): boolean {
  return error instanceof RastermillUnavailableError;
}

export function readImageProbeFromHeader(): ImageProbe | null {
  return null;
}

export function readImageMetadataFromHeader(): ImageMetadata | null {
  return null;
}

export function createRastermill() {
  const unavailable = async (): Promise<never> => {
    throw new RastermillUnavailableError();
  };
  return {
    encode: unavailable,
    probe: unavailable,
    transparency: unavailable,
  };
}
