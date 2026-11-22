export interface WallEntry {
  seq: number;
  pid: string;
  full_name: string;
  city: string;
  photo_id: string | null;
  joined_at: unknown;
  is_simulated: boolean;
  hidden: boolean;
}

/** What a phone keeps in localStorage: the records registered from it. */
export interface StoredPerson {
  pid: string;
}
