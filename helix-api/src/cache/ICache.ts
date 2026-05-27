// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

export interface ICache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}
