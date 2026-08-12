export interface ShotprintStateStore {
  getJson<T>(key: string): Promise<T | null>;
  putJson(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  updateJson<T>(key: string, fallback: T, mutate: (current: T) => T | Promise<T>): Promise<T>;
}

