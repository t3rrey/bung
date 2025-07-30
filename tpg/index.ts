import { z } from "zod";
import { udpConfig } from "./config";

// Data type options for fields
const DataTypeSchema = z
  .enum(["uint8_t", "uint16_t", "uint32_t", "uint64_t", "float", "bool"])
  .nullable();

type DataType = z.infer<typeof DataTypeSchema>;

// Bit definition for fields that use bit-level access
const BitSchema = z.object({
  Name: z.string(),
  Start: z.number(),
  Num: z.number(),
});

// Dependency configuration for fields that depend on other fields
const FieldDependencySchema = z.object({
  byte: z.number(),
  bit: z.number(),
});

// Enhanced Field schema that matches the actual structure in udpConfig
const UdpFieldSchema = z.object({
  label: z.string(),
  display: z.number(),
  offset: z.number(),
  raw: z.number(),
  sum_bools: z.number(),
  use_enum: z.number(),
  use_bits: z.number(),
  unit: z.string(),
  multiplier: z.number(),
  type: DataTypeSchema,
  bytes: z.array(z.number()),

  // Optional properties
  enum: z.record(z.string(), z.string()).optional(),
  bits: z.array(BitSchema).optional(),
  dependent_on: FieldDependencySchema.optional(),
  isHiddenOnChart: z.boolean().optional(),
});

// Schema for a prefix entry
const PrefixEntrySchema = z.object({
  prefix_description: z.string(),
  Description: z.string(),
  Fields: z.array(UdpFieldSchema),
});

// Schema for a message entry
const MessageEntrySchema = z.object({
  Description: z.string(),
  Fields: z.array(UdpFieldSchema),
});

// Schema for prefixes collection
const PrefixesSchema = z.record(z.string(), PrefixEntrySchema);

// Schema for messages collection
const MessagesSchema = z.record(z.string(), MessageEntrySchema);

// Schema for the main sections (Dock Messages, SwarmBot Messages)
const MessageSectionSchema = z.object({
  Prefixes: PrefixesSchema,
  Messages: MessagesSchema,
});

// Schema for the Other Messages section
const OtherMessageSectionSchema = z.object({
  Prefixes: PrefixesSchema,
  Messages: z.record(z.string(), z.never()), // Enforces an empty object
});

// Complete UDP Config schema
const UdpConfigSchema = z.object({
  "Dock Messages": MessageSectionSchema,
  "SwarmBot Messages": MessageSectionSchema,
  "Other Messages": OtherMessageSectionSchema,
});

export type UdpConfig = z.infer<typeof UdpConfigSchema>;

/**
 * Defines the structure of a parsed log message, representing a time series data point.
 */
interface ParsedLogMessage {
  id: string;
  label: string;
  unit: string;
  isEnum: boolean;
  enumValues?: Record<string, unknown>;
  series: [number, number][]; // [timestamp, value]
}

/**
 * Mapping of device names to their corresponding numerical IDs.
 * Used for looking up device names from raw message IDs.
 */
const deviceIds: Record<string, number> = {
  mainPLC: 0,
  mower: 1,
  spotSprayer: 2,
  offsetMower: 3,
  blanketSprayer: 4,
  spreader: 5,
  swarmView: 256,
  dock: 257,
  swarmbot: 258,
  paramSyncer: 259,
  tooling: 260,
  invalid: 65535,
};

/**
 * Pre-computed reverse map for O(1) device ID to name lookup.
 * This avoids the O(N) `Object.keys().find()` operation inside the main processing loop.
 */
const deviceIdToNameMap: Record<number, string> = {};
for (const key in deviceIds) {
  if (Object.prototype.hasOwnProperty.call(deviceIds, key)) {
    deviceIdToNameMap[deviceIds[key] ?? 0] = key;
  }
}

const UDP_HEADER_LENGTH = 16;

/**
 * Maximum expected UDP message length. This determines the size of the pre-allocated shared buffer.
 * Adjust this value based on the actual maximum possible size of your UDP log messages.
 * A common Ethernet MTU is 1500 bytes.
 */
const MAX_UDP_MESSAGE_LENGTH = 2048;

/**
 * Shared ArrayBuffer, Uint8Array, and DataView instances to avoid repeated memory allocations.
 * Each raw UDP message is copied into this shared buffer for highly efficient parsing.
 * This is a core optimization strategy.
 */
const sharedBuffer = new ArrayBuffer(MAX_UDP_MESSAGE_LENGTH);
const sharedUint8View = new Uint8Array(sharedBuffer);
const sharedDataView = new DataView(sharedBuffer);

/**
 * Extracts a specified number of bits from a given numerical value.
 * @param value The number from which to extract bits.
 * @param start The starting bit position (0-indexed).
 * @param num The number of bits to extract.
 * @returns The extracted bits as a number.
 */
function getBits(value: number, start: number, num: number): number {
  // This is a standard, highly efficient bitwise operation.
  return (value >> start) & ((1 << num) - 1);
}

/**
 * Parses a numeric value from the shared DataView based on absolute byte offsets and data type.
 * This function is heavily optimized to use direct memory access via DataView.
 *
 * @param dataView The DataView containing the raw message bytes.
 * @param absByteOffsets An array of absolute byte offsets for the field's data.
 * @param dataType The expected data type from the Zod schema.
 * @returns The parsed numerical value.
 * @throws Error if data type is unknown or float bytes are not contiguous.
 */
function getNumericValueFromBytes(
  dataView: DataView,
  absByteOffsets: number[],
  dataType: DataType
): number {
  const firstByteAbsOffset = absByteOffsets[0] ?? 0;
  let value = 0;

  switch (dataType) {
    case "uint8_t":
      return dataView.getUint8(firstByteAbsOffset);
    case "uint16_t":
      return dataView.getUint16(firstByteAbsOffset, true); // true for little-endian
    case "uint32_t":
      return dataView.getUint32(firstByteAbsOffset, true);
    case "float":
      return dataView.getFloat32(firstByteAbsOffset, true);
    case "bool":
      return dataView.getUint8(firstByteAbsOffset) === 1 ? 1 : 0;
    case "uint64_t":
      // NOTE: JavaScript `number` has a 53-bit integer precision limit.
      // Reading a full 64-bit value may result in precision loss. For full precision,
      // `dataView.getBigUint64(offset, true)` should be used, and the return type of this
      // function and `ParsedLogMessage.series` would need to support `bigint`.
      // We stick to `number` to match the original function's behavior.
      for (let i = 0; i < absByteOffsets.length && i < 8; i++) {
        value |= (dataView.getUint8(absByteOffsets[i] ?? 0) ?? 0) << (8 * i);
      }
      return value;
    case null:
      throw new Error(`DataType cannot be null`);
    default:
      // This fallback handles non-contiguous integer types manually.
      // For performance, contiguous byte layouts in the config are preferred.
      for (let i = 0; i < absByteOffsets.length; i++) {
        value |= (dataView.getUint8(absByteOffsets[i] ?? 0) ?? 0) << (8 * i);
      }
      return value;
  }
}

/**
 * Parses individual fields from a raw UDP message based on configuration.
 * This optimized version leverages the shared DataView and avoids intermediate array allocations.
 *
 * @param dataView The shared DataView instance containing the current message.
 * @param rawMessageLength The actual length of the current raw message (for bounds checking).
 * @param fieldConfigs The configuration array defining the fields to parse (from Zod-validated config).
 * @param messageTimestamp The timestamp for all data points in this message.
 * @param outArray The array to push results into, avoiding creating new arrays for each message.
 */
function parseFieldsFromConfig(
  dataView: DataView,
  rawMessageLength: number,
  fieldConfigs: z.infer<typeof UdpFieldSchema>[],
  messageTimestamp: number,
  outArray: Omit<ParsedLogMessage, "id">[]
): void {
  for (const fieldConfig of fieldConfigs) {
    // All fields from Zod schema are available here.
    const {
      label,
      bytes,
      type,
      unit,
      enum: enumMap,
      bits,
      use_enum,
      use_bits,
      multiplier,
    } = fieldConfig;

    try {
      if (use_bits === 1 && bits) {
        // --- Bit Field Parsing ---
        let combinedValue = 0;
        let bitFieldOffset = 0;
        for (let i = 0; i < bytes.length; i++) {
          bitFieldOffset = UDP_HEADER_LENGTH + (bytes[i] ?? 0);
          if (bitFieldOffset >= rawMessageLength)
            throw new Error("Out of bounds");
          combinedValue |= dataView.getUint8(bitFieldOffset) << (8 * i);
        }

        for (const bitConfig of bits) {
          let bitValue = getBits(combinedValue, bitConfig.Start, bitConfig.Num);
          if (multiplier !== 1.0) {
            bitValue *= multiplier;
          }
          outArray.push({
            label: `${label}_${bitConfig.Name}`,
            unit: unit || "",
            isEnum: false,
            enumValues: undefined,
            series: [[messageTimestamp, bitValue]],
          });
        }
      } else if (type) {
        // --- Standard Field Parsing ---
        const absByteOffsets = bytes.map(
          (idx: number) => UDP_HEADER_LENGTH + idx
        );
        if ((absByteOffsets[0] ?? 0) + bytes.length > rawMessageLength) {
          // Quick bounds check for contiguous case
          continue;
        }

        let value = getNumericValueFromBytes(dataView, absByteOffsets, type);
        if (multiplier !== 1.0) {
          value *= multiplier;
        }

        outArray.push({
          label: label,
          unit: unit || "",
          isEnum: !!(use_enum === 1 && enumMap),
          enumValues: use_enum === 1 ? enumMap : undefined,
          series: [[messageTimestamp, value]],
        });
      }
    } catch (error) {
      // console.error(`Error parsing field "${label}":`, error);
    }
  }
}

/**
 * Transforms an array of raw UDP log messages into a time series format.
 * This is the main optimized entry point for processing large datasets efficiently.
 *
 * @param rawMessages A 2D array where each inner array is a UDP packet's bytes as numbers.
 * @returns An array of ParsedLogMessage objects.
 */
export function transformUDPLogToTimeSeries(
  rawMessages: number[][]
): ParsedLogMessage[] {
  const finalParsedMessages: ParsedLogMessage[] = [];
  // Pre-allocate a temporary array to hold fields for a single message.
  // This array is cleared and reused to reduce allocations.
  const tempFieldsForMessage: Omit<ParsedLogMessage, "id">[] = [];

  for (const rawMessage of rawMessages) {
    const currentMessageLength = rawMessage.length;

    // --- Input Validation and Buffer Setup ---
    if (currentMessageLength > MAX_UDP_MESSAGE_LENGTH) {
      console.warn(
        `Skipping message: length (${currentMessageLength}) exceeds MAX_UDP_MESSAGE_LENGTH.`
      );
      continue;
    }
    if (currentMessageLength < UDP_HEADER_LENGTH) {
      console.warn(
        `Skipping message: length (${currentMessageLength}) is smaller than header.`
      );
      continue;
    }

    // Copy the current rawMessage into the single, shared Uint8Array buffer.
    // This is a crucial optimization, avoiding thousands or millions of ArrayBuffer allocations.
    sharedUint8View.set(rawMessage);

    const messageTimestamp = Date.now();

    // --- Header Parsing using DataView ---
    const messageId = sharedDataView.getUint16(6, true); // (offset, littleEndian)
    const deviceId = sharedDataView.getUint16(0, true);
    const deviceName = deviceIdToNameMap[deviceId] || "invalid";
    const messageIdStr = messageId.toString();

    // --- Configuration Lookup ---
    const configSection = (udpConfig as UdpConfig)[
      deviceName === "dock"
        ? "Dock Messages"
        : deviceName === "swarmbot"
        ? "SwarmBot Messages"
        : "Other Messages"
    ];

    const configMessage =
      configSection.Prefixes[messageIdStr] ||
      configSection.Messages[messageIdStr];

    // --- Field Parsing and Aggregation ---
    if (configMessage) {
      // Clear the temporary array for reuse.
      tempFieldsForMessage.length = 0;

      // Parse fields and push results directly into the temporary array.
      parseFieldsFromConfig(
        sharedDataView,
        currentMessageLength,
        configMessage.Fields,
        messageTimestamp,
        tempFieldsForMessage
      );

      // Append the parsed fields to the final results, adding the message ID.
      for (const field of tempFieldsForMessage) {
        finalParsedMessages.push({
          id: messageIdStr,
          ...field,
        });
      }
    }
  }

  return finalParsedMessages;
}

// raw messages are udp bytes in decimal form
const rawMessages: number[][] = [
  // [
  //   2, 1, 26, 0, 255, 255, 7, 16, 1, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0,
  //   0, 0, 0, 0, 0, 0, 0, 7, 0,
  // ],
  // Test message matching prefix 32784 (first bit = 1, should use prefix decoding)
  // [
  //   2, 1, 26, 0, 255, 255, 16, 128, 1, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0,
  //   0, 0, 0, 0, 0, 0, 0, 7, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 10, 0, 1, 0, 0, 255, 255, 255, 255, 255, 26, 0, 56,
  //   0, 102, 102, 195, 66, 0, 0, 0, 0, 205, 204, 140, 63, 205, 204, 76, 62, 0, 0,
  //   0, 0, 0, 0, 128, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 2, 0, 0,
  //   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  //   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  //   0, 0, 0, 0, 0, 0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 52, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   11, 0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 3, 0, 1, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0,
  //   0, 0, 72, 62, 0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 23, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   15, 0, 0, 3, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 20, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   3, 0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 30, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   16, 0, 0, 1, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 53, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   12, 0, 0, 2, 0,
  // ],
  [
    1, 1, 47, 197, 255, 255, 2, 0, 1, 0, 0, 255, 255, 255, 255, 255, 100, 0, 0,
    0, 0, 0, 0, 0, 76, 55, 87, 65, 3, 0, 0, 0,
  ],
  // [
  //   1, 1, 47, 197, 255, 255, 26, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   10, 0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 28, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   13, 0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 4, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0, 7,
  //   0, 0, 9, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 5, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0, 9,
  //   0, 0, 8, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 22, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   5, 0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 1, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0, 2,
  //   0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 6, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0, 6,
  //   0, 0, 0, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 21, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   1, 0, 0, 6, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 24, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 1,
  //   14, 174, 52, 108, 0,
  // ],
  // [
  //   1, 1, 47, 197, 255, 255, 25, 7, 1, 0, 0, 255, 255, 255, 255, 255, 1, 1, 0,
  //   8, 0, 0, 6, 0,
  // ],
];

console.log(transformUDPLogToTimeSeries(rawMessages));
