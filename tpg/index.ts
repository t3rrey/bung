import { z } from "zod";
import { rawLogData } from "./data";
import { udpConfig } from "./udp_config";

/* ============================
 * Schemas & Types
 * ============================ */

// Data type options for fields
const DataTypeSchema = z
  .enum(["uint8_t", "uint16_t", "uint32_t", "uint64_t", "float", "bool"])
  .nullable();

const UdpUnitEnum = z.enum([
  "mV",
  "uA",
  "L/s",
  "L",
  "%",
  "RPM",
  "V",
  "Bar",
  "ms",
  "",
]);

type UdpUnit = z.infer<typeof UdpUnitEnum>;
type DataType = z.infer<typeof DataTypeSchema>;

type LogRowWithDateAndMessageIDAndType = {
  date: string; // epoch milliseconds
  message_id: number | null;
  log: number[];
  type: "sb_can0" | "sb_can1" | "dnr_udp";
};

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
  unit: UdpUnitEnum,
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

// Union type for handling both prefix and message configurations
type ConfigMessage =
  | z.infer<typeof PrefixEntrySchema>
  | z.infer<typeof MessageEntrySchema>;

/**
 * Defines the structure of a parsed log message, representing a time series data point.
 */
export interface ParsedLogMessage {
  id: string;
  label: string;
  unit: UdpUnit;
  isEnum: boolean;
  series: [number, number][]; // [timestamp, value]
  sender: string;
}

/* ============================
 * Device ID mapping
 * ============================ */

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
 * This avoids the O(N) Object.keys().find() operation inside the main processing loop.
 */
const deviceIdToNameMap: Record<number, string> = {};
for (const key in deviceIds) {
  if (Object.prototype.hasOwnProperty.call(deviceIds, key)) {
    deviceIdToNameMap[deviceIds[key] ?? 0] = key;
  }
}

/* ============================
 * Constants & Shared Buffers
 * ============================ */

const UDP_HEADER_LENGTH = 16;

/**
 * Maximum expected UDP message length. Adjust based on actual maximum possible size.
 */
const MAX_UDP_MESSAGE_LENGTH = 2048;

/**
 * Shared ArrayBuffer, Uint8Array, and DataView instances to avoid repeated memory allocations.
 */
const sharedBuffer = new ArrayBuffer(MAX_UDP_MESSAGE_LENGTH);
const sharedUint8View = new Uint8Array(sharedBuffer);
const sharedDataView = new DataView(sharedBuffer);

/* ============================
 * Helpers
 * ============================ */

/**
 * Extracts a specified number of bits from a given numerical value.
 * @param value Number to extract bits from
 * @param start Starting bit position (0-indexed)
 * @param num   Number of bits to extract
 */
function getBits(value: number, start: number, num: number): number {
  return (value >> start) & ((1 << num) - 1);
}

/**
 * Returns message ID as a lower-case hex string of the two ID bytes at offsets 6..7 (little-endian).
 * e.g. high=0x10, low=0x03 -> "1003"
 */
function getMessageIdHex(view: DataView): string {
  const low = view.getUint8(6);
  const high = view.getUint8(7);
  return (
    high.toString(16).padStart(2, "0") + low.toString(16).padStart(2, "0")
  ).toLowerCase();
}

/**
 * Reads a single dependency bit (payload-relative) with bounds checking.
 * Payload bytes are indexed from 0; absolute offset adds UDP_HEADER_LENGTH.
 */
function getDependentBit(
  view: DataView,
  rawMessageLength: number,
  dep: { byte: number; bit: number }
): number | null {
  const abs = UDP_HEADER_LENGTH + dep.byte;
  if (abs >= rawMessageLength || dep.bit < 0 || dep.bit > 7) return null;
  const b = view.getUint8(abs);
  return (b >> dep.bit) & 0b1;
}

/**
 * Parses a numeric value from the DataView based on absolute byte offsets and data type.
 * Note: uint64_t may overflow JS Number for large values; left as-is for now.
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
      return Math.round(dataView.getUint8(firstByteAbsOffset) * 1000) / 1000;

    case "uint16_t":
      return (
        Math.round(dataView.getUint16(firstByteAbsOffset, true) * 1000) / 1000
      );

    case "uint32_t":
      return (
        Math.round(dataView.getUint32(firstByteAbsOffset, true) * 1000) / 1000
      );

    case "float":
      return (
        Math.round(dataView.getFloat32(firstByteAbsOffset, true) * 1000) / 1000
      );

    case "bool":
      return (
        Math.round(
          (dataView.getUint8(firstByteAbsOffset) === 1 ? 1 : 0) * 1000
        ) / 1000
      );

    case "uint64_t":
      for (let i = 0; i < absByteOffsets.length && i < 8; i++) {
        value |= (dataView.getUint8(absByteOffsets[i] ?? 0) ?? 0) << (8 * i);
      }
      return Math.round(value * 1000) / 1000;

    case null:
      throw new Error("DataType cannot be null");

    default:
      for (let i = 0; i < absByteOffsets.length; i++) {
        value |= (dataView.getUint8(absByteOffsets[i] ?? 0) ?? 0) << (8 * i);
      }
      return Math.round(value * 1000) / 1000;
  }
}

/**
 * Parses individual fields from a raw UDP message based on configuration.
 * This version supports `dependent_on` to dynamically pick label via "Decoded | Voltage" convention.
 */
function parseFieldsFromConfig(
  dataView: DataView,
  rawMessageLength: number,
  fieldConfigs: z.infer<typeof UdpFieldSchema>[],
  messageTimestamp: number,
  outArray: ParsedLogMessage[],
  messageIdStr: string,
  deviceName: string,
  messageIdHex: string
): void {
  for (const fieldConfig of fieldConfigs) {
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
      dependent_on,
    } = fieldConfig;

    try {
      // ---- NEW: Resolve label from dependency bit if present ----
      let finalLabel = label;
      if (dependent_on) {
        const bit = getDependentBit(dataView, rawMessageLength, dependent_on);
        if (bit !== null) {
          // Expect labels like "Decoded | Voltage"
          const parts = label.split(" | ");
          if (parts.length === 2) {
            finalLabel = bit ? parts[0] ?? "" : parts[1] ?? "";
            console.debug(
              `Resolved label for field '${label}' to '${finalLabel}' based on dependent bit.`
            );
          } else {
            console.warn(
              `Dependent label '${label}' does not follow 'PartA | PartB' convention. Skipping dynamic label resolution.`
            );
          }
        }
      }

      if (use_bits === 1 && bits && bytes && Array.isArray(bytes)) {
        // --- Bit Field Parsing ---
        let combinedValue = 0;
        for (let i = 0; i < bytes.length; i++) {
          const byteOffset = bytes[i];
          if (byteOffset === undefined) {
            console.warn(
              `Invalid byte offset encountered in bit field configuration for label '${label}'. Skipping.`
            );
            continue;
          }
          const bitFieldOffset = UDP_HEADER_LENGTH + byteOffset;
          if (bitFieldOffset >= rawMessageLength) {
            console.warn(
              `Bit field offset ${bitFieldOffset} for label '${label}' is out of bounds (message length ${rawMessageLength}). Skipping.`
            );
            throw new Error("Out of bounds"); // Throw to catch block
          }
          combinedValue |= dataView.getUint8(bitFieldOffset) << (8 * i);
        }

        for (const bitConfig of bits) {
          let bitValue = getBits(combinedValue, bitConfig.Start, bitConfig.Num);
          if (multiplier !== undefined && multiplier !== 1.0) {
            bitValue *= multiplier;
            console.debug(
              `Applied multiplier ${multiplier} to bit field value for '${bitConfig.Name}'.`
            );
          }

          outArray.push({
            label: `${messageIdStr}_${finalLabel}_${bitConfig.Name}`,
            unit: unit || "",
            isEnum: false,
            series: [[messageTimestamp, bitValue]],
            id: `${deviceName}_${messageIdHex}_${finalLabel}_${bitConfig.Name}`,
            sender: deviceName,
          });
          console.debug(
            `Parsed bit field: ${messageIdStr}_${finalLabel}_${bitConfig.Name} = ${bitValue}`
          );
        }
      } else if (type && bytes && Array.isArray(bytes)) {
        // --- Standard Field Parsing ---
        const absByteOffsets = bytes.map(
          (idx: number) => UDP_HEADER_LENGTH + idx
        );

        if (bytes.length === 0) {
          console.warn(
            `Field '${label}' has no bytes configured. Skipping standard field parsing.`
          );
          continue;
        }

        if (
          (absByteOffsets[0] ?? 0) + bytes.length > rawMessageLength ||
          absByteOffsets.some((offset) => offset >= rawMessageLength)
        ) {
          console.warn(
            `Field '${label}' bytes [${bytes.join(
              ", "
            )}] (absolute offsets [${absByteOffsets.join(
              ", "
            )}]) are out-of-bounds for message length ${rawMessageLength}. Skipping field.`
          );
          continue; // out-of-bounds; skip
        }

        let value = getNumericValueFromBytes(dataView, absByteOffsets, type);
        if (multiplier !== undefined && multiplier !== 1.0) {
          value *= multiplier;
          console.debug(
            `Applied multiplier ${multiplier} to standard field value for '${finalLabel}'.`
          );
        }

        outArray.push({
          label: `${finalLabel}`,
          unit: unit || "",
          isEnum: !!(use_enum === 1 && enumMap),
          series: [[messageTimestamp, value]],
          id: `${deviceName}_${messageIdHex}_${finalLabel}`,
          sender: deviceName,
        });
        console.debug(
          `Parsed standard field: ${finalLabel} = ${value} (type: ${type})`
        );
      } else {
        // Fields with no numeric type (e.g., purely-enum/meta) are ignored here by design.
        console.debug(
          `Field '${label}' skipped: No valid 'use_bits' or 'type' configuration found for numeric parsing.`
        );
      }
    } catch (error) {
      // Ignore parsing errors for individual fields (but log for diagnostics)
      // eslint-disable-next-line no-console
      console.error(
        `Error parsing field '${label}' for message '${messageIdStr}' (Device: ${deviceName}, ID: ${messageIdHex}):`,
        error
      );
    }
  }
}

/**
 * Transforms rows of raw UDP logs into a flat array of time series datapoints.
 */
export function transformUDPLogToTimeSeries(
  tableRows: LogRowWithDateAndMessageIDAndType[]
): ParsedLogMessage[] {
  if (!tableRows || !Array.isArray(tableRows)) return [];

  const tempFieldsForMessage: ParsedLogMessage[] = [];

  for (let i = 0; i < tableRows.length; i++) {
    const row = tableRows[i];
    if (!row || !Array.isArray(row.log)) continue;

    const { log: rawMessage, date: messageTimestamp } = row;
    const currentMessageLength = rawMessage.length;

    if (
      currentMessageLength > MAX_UDP_MESSAGE_LENGTH ||
      currentMessageLength < UDP_HEADER_LENGTH
    ) {
      continue;
    }

    // Copy payload into shared buffer
    sharedUint8View.set(rawMessage);

    // Message ID (little-endian u16) lives at bytes 6..7
    const messageIdLE = sharedDataView.getUint16(6, true);
    const messageIdHighByte = (messageIdLE >> 8) & 0xff;
    const prefixStr = messageIdHighByte.toString();

    // Device ID (little-endian u16) lives at bytes 0..1
    const deviceId = sharedDataView.getUint16(0, true);
    const deviceName = deviceIdToNameMap[deviceId] || "invalid";

    const messageIdHex = getMessageIdHex(sharedDataView);

    // Pick section by device
    const configSection = (udpConfig as UdpConfig)[
      deviceName === "dock"
        ? "Dock Messages"
        : deviceName === "swarmbot"
        ? "SwarmBot Messages"
        : "Other Messages"
    ];

    // 1) Prefer prefix match based on high byte (as decimal string), e.g., "7", "16", etc.
    const prefixConfig = configSection.Prefixes[prefixStr];

    // 2) Fallback to direct message ID match in decimal (little-endian full ID)
    let configMessage: ConfigMessage | undefined;
    let messageIdStr: string;

    if (prefixConfig) {
      configMessage = prefixConfig;
      messageIdStr = `${deviceName}:${messageIdHex}`;
    } else {
      const messageIdDecStr = String(messageIdLE);
      configMessage = configSection.Messages[messageIdDecStr];
      messageIdStr = `${messageIdDecStr}`;
    }

    if (configMessage) {
      parseFieldsFromConfig(
        sharedDataView,
        currentMessageLength,
        configMessage.Fields,
        Number(messageTimestamp),
        tempFieldsForMessage,
        messageIdStr,
        deviceName,
        messageIdHex
      );
    }
  }

  return tempFieldsForMessage;
}

/* ============================
 * Response
@parsed: a list of all messages parsed down to the field level
@unique_messages: a list of all unique messages, each with a unique id and the fields present inside of that message

 * ============================ */

type Response = {
  parsed: ParsedLogMessage[];
  unique_messages: {
    id: string;
    sender: string;
    fields: {
      label: string;
    }[];
  }[];
};

function parseUDPLogToResponse(
  tableRows: LogRowWithDateAndMessageIDAndType[]
): Response {
  const parsed = transformUDPLogToTimeSeries(tableRows);

  // Use a Map for O(1) lookups - key is messageId, value is {sender, fields Set}
  const uniqueMessagesMap = new Map<
    string,
    { sender: string; fields: Set<string> }
  >();

  // Single pass through parsed messages - O(n) time complexity
  for (const message of parsed) {
    // Extract the base message ID (without the field label suffix)
    // The ID format is like: "dock_0703_Decoded" or "swarmbot_1001_Fill Type"
    const parts = message.id.split("_");
    if (parts.length >= 2) {
      // Reconstruct the message ID without the field label
      const messageId = `${parts[0]}_${parts[1]}`;

      // O(1) Map operations
      if (!uniqueMessagesMap.has(messageId)) {
        uniqueMessagesMap.set(messageId, {
          sender: message.sender,
          fields: new Set<string>(),
        });
      }

      // O(1) Set add operation
      uniqueMessagesMap.get(messageId)?.fields.add(message.label);
    }
  }

  // Convert map to array - O(m) where m is number of unique messages (m << n)
  const unique_messages = Array.from(uniqueMessagesMap.entries()).map(
    ([id, data]) => ({
      id,
      sender: data.sender,
      fields: Array.from(data.fields).map((label) => ({ label })),
    })
  );

  return {
    parsed,
    unique_messages,
  };
}

const response = parseUDPLogToResponse(rawLogData);

console.log(response);

console.log(JSON.stringify(response.unique_messages, null, 2));
