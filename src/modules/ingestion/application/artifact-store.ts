export interface ArtifactWrite {
  key: string;
  mediaType: string;
  body: string;
  contentHash: string;
}

export interface ArtifactStore {
  putIfAbsent(input: ArtifactWrite): Promise<{ objectKey: string }>;
}
