export interface SaveManifestV1 {
  readonly formatVersion: 1;
  readonly saveId: string;
  readonly createdAt: string;
  readonly committedSequence: number;
  readonly engineRevision: number;
  readonly story: {
    readonly id: string;
    readonly sourceRevision: string;
    readonly artifactSha256: string;
  };
  readonly interpreter: {
    readonly id: string;
    readonly version: string;
    readonly artifactSha256: string;
    readonly provenanceRecordId: string;
  };
  readonly engineAdapter: {
    readonly id: string;
    readonly version: string;
  };
  readonly engineSnapshot: {
    readonly schemaVersion: number;
    readonly encoding: "binary";
    readonly sha256: string;
    readonly byteLength: number;
  };
  readonly guideMemory: {
    readonly schemaVersion: number;
    readonly sha256: string;
  };
  readonly eventTail?: {
    readonly fromSequence: number;
    readonly sha256: string;
  };
}
