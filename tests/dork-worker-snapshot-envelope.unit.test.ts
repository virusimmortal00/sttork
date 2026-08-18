import { canonicalizeCommand } from "@zork-voice/contracts";
import {
  WORKER_SNAPSHOT_MAX_TOTAL_BYTES,
  WORKER_SNAPSHOT_SCHEMA_VERSION,
  WorkerSnapshotCodecError,
  decodeWorkerSnapshotEnvelope,
  encodeWorkerSnapshotEnvelope,
  type WorkerSnapshotEnvelope,
} from "../spikes/dork-worker/worker-snapshot-envelope.js";
import { describe, expect, it } from "vitest";

function innerCheckpoint(): Uint8Array {
  return new Uint8Array(256).fill(0x5a);
}

function envelope(): WorkerSnapshotEnvelope {
  return {
    schemaVersion: WORKER_SNAPSHOT_SCHEMA_VERSION,
    revision: 1,
    lastOutput: "South Room\n\n> ",
    boundary: "input-requested",
    innerCheckpoint: innerCheckpoint(),
    receipts: [
      {
        requestId: "look-1",
        expectedRevision: 0,
        command: canonicalizeCommand("look"),
        result: {
          requestId: "look-1",
          previousRevision: 0,
          revision: 1,
          command: "look",
          output: "South Room\n\n> ",
          turnComplete: true,
          boundary: "input-requested",
          status: "committed",
        },
      },
      {
        requestId: "capacity-1",
        expectedRevision: 1,
        command: canonicalizeCommand("north"),
        result: {
          requestId: "capacity-1",
          previousRevision: 1,
          revision: 1,
          command: "north",
          output: "",
          turnComplete: true,
          boundary: "input-requested",
          status: "rejected",
          rejection: "receipt_capacity",
        },
      },
    ],
  };
}

describe("Dork worker snapshot envelope", () => {
  it("round-trips detached bytes and preserves receipt journal order", () => {
    const source = envelope();
    const encoded = encodeWorkerSnapshotEnvelope(source);
    const decoded = decodeWorkerSnapshotEnvelope(encoded);

    expect(decoded).toEqual(source);
    expect(decoded.innerCheckpoint).not.toBe(source.innerCheckpoint);
    expect(decoded.receipts.map((receipt) => receipt.requestId)).toEqual([
      "look-1",
      "capacity-1",
    ]);
  });

  it("rejects missing committed revision history", () => {
    const source = envelope();
    expect(() =>
      encodeWorkerSnapshotEnvelope({
        ...source,
        receipts: source.receipts.slice(1),
      }),
    ).toThrow("missing committed revision 1");
  });

  it("rejects trailing, truncated, and oversized bytes before decoding", () => {
    const encoded = encodeWorkerSnapshotEnvelope(envelope());
    expect(() =>
      decodeWorkerSnapshotEnvelope(new Uint8Array([...encoded, 0])),
    ).toThrow(WorkerSnapshotCodecError);
    expect(() => decodeWorkerSnapshotEnvelope(encoded.slice(0, -1))).toThrow(
      WorkerSnapshotCodecError,
    );
    expect(() =>
      decodeWorkerSnapshotEnvelope(
        new Uint8Array(WORKER_SNAPSHOT_MAX_TOTAL_BYTES + 1),
      ),
    ).toThrow(/limit/u);
  });
});
