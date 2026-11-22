export interface WallEntry {
  join_seq: number;
  full_name: string;
  city: string;
  photo: string | null;
  joined_at: string;
  is_simulated: boolean;
  removed?: boolean;
}

export interface StoredPerson {
  id: string;
  token: string;
}
