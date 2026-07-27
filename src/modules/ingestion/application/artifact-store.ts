export interface ArtifactWrite {
  key: string;
  mediaType: string;
  body: string | Uint8Array;
  contentHash: string;
}

export interface ArtifactStore {
  putIfAbsent(input: ArtifactWrite): Promise<{ objectKey: string }>;
}
