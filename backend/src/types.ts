export type Platform = "twitch" | "youtube" | "facebook" | "custom";

export interface Destination {
  platform: Platform;
  url: string;
}

export interface StreamRecord {
  ownerId: string;
  streamKey: string;
  destinations: Destination[];
}